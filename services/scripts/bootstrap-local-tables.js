// Crea (si no existen) las 5 tablas de UN ambiente y carga los datos semilla.
// Lo usan los pipelines de CI (integration / e2e) y el modo rápido sin Terraform.
// En los ambientes reales las tablas las crea Terraform (infra/modules/dynamodb).
//   APP_ENV=dev AWS_ENDPOINT_URL=http://localhost:4566 node scripts/bootstrap-local-tables.js [--reset]
import { readFileSync } from 'node:fs';
import {
  CreateTableCommand, DeleteTableCommand, DescribeTableCommand, DynamoDBClient, waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { APP_ENV, TABLES } from '../shared/config.js';
import { awsClientConfig } from '../shared/aws.js';

const raw = new DynamoDBClient(awsClientConfig());
const doc = DynamoDBDocumentClient.from(raw);
const seed = JSON.parse(readFileSync(new URL('../../seed/seed-data.json', import.meta.url), 'utf8'));
const reset = process.argv.includes('--reset');

const defs = [
  { name: TABLES.reservations, keys: ['pk', 'sk'] },
  { name: TABLES.billing, keys: ['pk', 'sk'] },
  { name: TABLES.dispatch, keys: ['pk', 'sk'] },
  { name: TABLES.sagas, keys: ['pk', 'sk'] },
  { name: TABLES.flags, keys: ['flagName'] },
];

async function exists(name) {
  try { await raw.send(new DescribeTableCommand({ TableName: name })); return true; } catch (e) {
    if (e.name === 'ResourceNotFoundException') return false; throw e;
  }
}

for (const d of defs) {
  if (reset && (await exists(d.name))) {
    await raw.send(new DeleteTableCommand({ TableName: d.name }));
    console.log(`  borrada ${d.name}`);
  }
  if (!(await exists(d.name))) {
    await raw.send(new CreateTableCommand({
      TableName: d.name,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: d.keys.map((k) => ({ AttributeName: k, AttributeType: 'S' })),
      KeySchema: d.keys.map((k, i) => ({ AttributeName: k, KeyType: i === 0 ? 'HASH' : 'RANGE' })),
    }));
    await waitUntilTableExists({ client: raw, maxWaitTime: 30 }, { TableName: d.name });
    console.log(`  creada ${d.name}`);
  }
}

const now = new Date().toISOString();
for (const c of seed.connectors) {
  await doc.send(new PutCommand({ TableName: TABLES.reservations, Item: { pk: `CONNECTOR#${c.connectorId}`, sk: 'STATE', ...c, status: 'AVAILABLE', updatedAt: now } }));
}
for (const w of seed.wallets) {
  await doc.send(new PutCommand({ TableName: TABLES.billing, Item: { pk: `WALLET#${w.fleetId}`, sk: 'PROFILE', ...w, updatedAt: now } }));
}
for (const [name, f] of Object.entries(seed.flags)) {
  await doc.send(new PutCommand({ TableName: TABLES.flags, Item: { flagName: name, enabled: f.values[APP_ENV], description: f.description, updatedAt: now, updatedBy: 'seed' } }));
}
console.log(`OK ambiente=${APP_ENV}: ${seed.connectors.length} conectores, ${seed.wallets.length} billeteras, ${Object.keys(seed.flags).length} flags`);
