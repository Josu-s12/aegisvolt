// Sistema propio de Feature Flags sobre DynamoDB.
// Cada ambiente tiene SU PROPIA tabla: aegisvolt-feature-flags-dev / -test / -prod.
// Por eso cambiar una flag en dev no puede afectar a prod (aislamiento físico).
// El valor se lee en cada petición (con caché de pocos segundos), así que cambiar
// una flag NO requiere redesplegar ni reiniciar pods.
import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from './aws.js';
import { APP_ENV, TABLES } from './config.js';

export const FLAG_NAMES = [
  'ENABLE_DYNAMIC_SURGE_PRICING',
  'ENABLE_FAST_CHARGE_BOOST',
  'SIMULATE_CHARGER_HARDWARE_FAULT',
];

const CACHE_TTL_MS = Number(process.env.FLAGS_CACHE_TTL_MS ?? 2000);
const cache = new Map();

export async function isEnabled(name) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const res = await ddb().send(new GetCommand({ TableName: TABLES.flags, Key: { flagName: name } }));
  const value = Boolean(res.Item && res.Item.enabled);
  cache.set(name, { value, at: Date.now() });
  return value;
}

export async function listFlags() {
  const res = await ddb().send(new ScanCommand({ TableName: TABLES.flags }));
  return (res.Items || [])
    .map((i) => ({
      name: i.flagName,
      enabled: Boolean(i.enabled),
      description: i.description || '',
      environment: APP_ENV,
      updatedAt: i.updatedAt || null,
      updatedBy: i.updatedBy || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function setFlag(name, enabled, updatedBy = 'graphql') {
  if (!FLAG_NAMES.includes(name)) {
    const err = new Error(`Flag desconocida: ${name}`);
    err.code = 'UNKNOWN_FLAG';
    throw err;
  }
  const current = await ddb().send(new GetCommand({ TableName: TABLES.flags, Key: { flagName: name } }));
  const item = {
    ...(current.Item || {}),
    flagName: name,
    enabled: Boolean(enabled),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await ddb().send(new PutCommand({ TableName: TABLES.flags, Item: item }));
  cache.delete(name);
  return { name, enabled: item.enabled, description: item.description || '', environment: APP_ENV, updatedAt: item.updatedAt, updatedBy };
}

export function clearFlagCache() {
  cache.clear();
}
