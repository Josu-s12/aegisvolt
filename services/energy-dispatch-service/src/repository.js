// energy-dispatch-service: orden de activación física del cargador y telemetría.
// Tabla propia: aegisvolt-dispatch-<env>
//   pk = SAGA#<sagaId>,        sk = SESSION      -> sesión de carga (ACTIVE | FAILED | STOPPED)
//   pk = TELEMETRY#<connector>, sk = <ISO time>  -> lecturas de telemetría
import { GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isConditionalFailure } from '../../shared/aws.js';
import { TABLES } from '../../shared/config.js';
import { DomainError } from '../../shared/http.js';

const T = () => TABLES.dispatch;
const now = () => new Date().toISOString();

export async function getSession(sagaId) {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: { pk: `SAGA#${sagaId}`, sk: 'SESSION' } }));
  return res.Item || null;
}

// PASO 3 de la SAGA: activar el flujo eléctrico.
// Si la flag SIMULATE_CHARGER_HARDWARE_FAULT está activa (o el cargador reporta falla),
// se registra la sesión como FAILED y se responde 503 -> el orquestador compensa.
export async function startSession({ sagaId, connectorId, hardwareFault }) {
  const existing = await getSession(sagaId);
  if (existing) {
    if (existing.status === 'FAILED') {
      throw new DomainError('CHARGER_HARDWARE_FAULT', existing.error, 503, { connectorId, idempotentReplay: true });
    }
    return { session: existing, idempotentReplay: true };
  }

  const session = {
    pk: `SAGA#${sagaId}`, sk: 'SESSION', sagaId, connectorId,
    status: hardwareFault ? 'FAILED' : 'ACTIVE',
    startedAt: now(), updatedAt: now(), energyKwh: 0,
  };
  if (hardwareFault) {
    session.error = `Falla física reportada por el cargador ${connectorId} (SIMULATE_CHARGER_HARDWARE_FAULT)`;
  }
  try {
    await ddb().send(new PutCommand({ TableName: T(), Item: session, ConditionExpression: 'attribute_not_exists(pk)' }));
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    return startSession({ sagaId, connectorId, hardwareFault });
  }
  if (hardwareFault) {
    throw new DomainError('CHARGER_HARDWARE_FAULT', session.error, 503, { connectorId });
  }
  await recordTelemetry(connectorId, sagaId, 0);
  return { session, idempotentReplay: false };
}

export async function stopSession(sagaId) {
  try {
    await ddb().send(new UpdateCommand({
      TableName: T(), Key: { pk: `SAGA#${sagaId}`, sk: 'SESSION' },
      UpdateExpression: 'SET #st = :stopped, stoppedAt = :now, updatedAt = :now',
      ConditionExpression: '#st = :active',
      ExpressionAttributeNames: { '#st': 'status' },
      ExpressionAttributeValues: { ':stopped': 'STOPPED', ':active': 'ACTIVE', ':now': now() },
    }));
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
  }
  return getSession(sagaId);
}

export async function activeSessions() {
  const res = await ddb().send(new ScanCommand({
    TableName: T(), FilterExpression: 'sk = :s AND #st = :a',
    ExpressionAttributeNames: { '#st': 'status' }, ExpressionAttributeValues: { ':s': 'SESSION', ':a': 'ACTIVE' },
  }));
  return res.Items || [];
}

// Simula la lectura del medidor del cargador (en la vida real llegaría por OCPP/IoT)
export async function recordTelemetry(connectorId, sagaId, energyKwh) {
  const powerKw = Math.round((40 + Math.random() * 100) * 10) / 10;
  const item = {
    pk: `TELEMETRY#${connectorId}`, sk: now(), connectorId, sagaId,
    powerKw, energyKwh: Math.round(energyKwh * 100) / 100,
    voltage: Math.round(380 + Math.random() * 40), temperatureC: Math.round(28 + Math.random() * 12),
    ttl: Math.floor(Date.now() / 1000) + 3600 * 24,
  };
  await ddb().send(new PutCommand({ TableName: T(), Item: item }));
  return item;
}

export async function tick() {
  for (const s of await activeSessions()) {
    const energy = Number(s.energyKwh || 0) + 0.5 + Math.random();
    await ddb().send(new UpdateCommand({
      TableName: T(), Key: { pk: s.pk, sk: 'SESSION' },
      UpdateExpression: 'SET energyKwh = :e, updatedAt = :now', ExpressionAttributeValues: { ':e': energy, ':now': now() },
    }));
    await recordTelemetry(s.connectorId, s.sagaId, energy);
  }
}

export async function getTelemetry(connectorId, limit = 20) {
  const res = await ddb().send(new QueryCommand({
    TableName: T(), KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': `TELEMETRY#${connectorId}` },
    ScanIndexForward: false, Limit: limit,
  }));
  return (res.Items || []).map((i) => ({
    connectorId: i.connectorId, sagaId: i.sagaId, timestamp: i.sk, powerKw: Number(i.powerKw),
    energyKwh: Number(i.energyKwh), voltage: Number(i.voltage), temperatureC: Number(i.temperatureC),
  }));
}
