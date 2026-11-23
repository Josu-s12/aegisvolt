// station-reservation-service: disponibilidad y bloqueo temporal de bahías de carga.
// Tabla propia (Database-per-Service): aegisvolt-reservations-<env>
//   pk = CONNECTOR#<id>, sk = STATE        -> estado actual del conector
//   pk = SAGA#<sagaId>,  sk = RESERVATION  -> registro de la reserva (clave de idempotencia)
import { GetCommand, ScanCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isConditionalFailure } from '../../shared/aws.js';
import { TABLES } from '../../shared/config.js';
import { DomainError } from '../../shared/http.js';

const T = () => TABLES.reservations;
const now = () => new Date().toISOString();

export async function listConnectors() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await ddb().send(
      new ScanCommand({
        TableName: T(),
        FilterExpression: 'sk = :s',
        ExpressionAttributeValues: { ':s': 'STATE' },
        ExclusiveStartKey,
      }),
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items.map(toConnector).sort((a, b) => a.id.localeCompare(b.id));
}

export async function listStations() {
  const connectors = await listConnectors();
  const byStation = new Map();
  for (const c of connectors) {
    if (!byStation.has(c.stationId)) {
      byStation.set(c.stationId, { id: c.stationId, name: c.stationName, city: c.city, connectors: [] });
    }
    byStation.get(c.stationId).connectors.push(c);
  }
  return [...byStation.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function getConnector(connectorId) {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: { pk: `CONNECTOR#${connectorId}`, sk: 'STATE' } }));
  return res.Item ? toConnector(res.Item) : null;
}

export async function getReservation(sagaId) {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: { pk: `SAGA#${sagaId}`, sk: 'RESERVATION' } }));
  return res.Item || null;
}

// PASO 1 de la SAGA: AVAILABLE -> RESERVED (atómico dentro del servicio).
// Idempotente: si la reserva de ese sagaId ya existe se devuelve la misma, no se reserva dos veces.
export async function reserve({ sagaId, connectorId, fleetId, priority = false, fastChargeBoostEnabled = false }) {
  const existing = await getReservation(sagaId);
  if (existing) return { reservation: existing, idempotentReplay: true };

  const connector = await getConnector(connectorId);
  if (!connector) throw new DomainError('CONNECTOR_NOT_FOUND', `No existe el conector ${connectorId}`, 404);
  if (connector.ultraFast && !priority) {
    throw new DomainError('PRIORITY_REQUIRED', 'Los conectores de ultra-carga requieren reserva prioritaria', 409);
  }
  if (priority && !fastChargeBoostEnabled) {
    throw new DomainError(
      'FEATURE_DISABLED',
      'La reserva prioritaria de ultra-carga está deshabilitada en este ambiente (ENABLE_FAST_CHARGE_BOOST=false)',
      409,
    );
  }

  const reservation = {
    pk: `SAGA#${sagaId}`,
    sk: 'RESERVATION',
    sagaId,
    connectorId,
    stationId: connector.stationId,
    fleetId,
    priority: Boolean(priority),
    status: 'RESERVED',
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await ddb().send(
      new TransactWriteCommand({
        TransactItems: [
          { Put: { TableName: T(), Item: reservation, ConditionExpression: 'attribute_not_exists(pk)' } },
          {
            Update: {
              TableName: T(),
              Key: { pk: `CONNECTOR#${connectorId}`, sk: 'STATE' },
              UpdateExpression: 'SET #st = :reserved, sagaId = :saga, updatedAt = :now',
              ConditionExpression: '#st = :available',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: { ':reserved': 'RESERVED', ':available': 'AVAILABLE', ':saga': sagaId, ':now': now() },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    const again = await getReservation(sagaId);
    if (again) return { reservation: again, idempotentReplay: true };
    throw new DomainError('CONNECTOR_UNAVAILABLE', `El conector ${connectorId} no está disponible (${connector.status})`, 409);
  }
  return { reservation, idempotentReplay: false };
}

// COMPENSACIÓN del paso 1: RESERVED -> AVAILABLE.
// Idempotente: la ConditionExpression exige status = RESERVED; si llega duplicada,
// la reserva ya está RELEASED y se responde OK sin tocar nada.
export async function release(sagaId, reason = 'SAGA_COMPENSATION') {
  const reservation = await getReservation(sagaId);
  if (!reservation) return { released: false, alreadyCompensated: false, nothingToRelease: true };
  if (reservation.status === 'RELEASED') return { released: false, alreadyCompensated: true, reservation };

  try {
    await ddb().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: T(),
              Key: { pk: `SAGA#${sagaId}`, sk: 'RESERVATION' },
              UpdateExpression: 'SET #st = :released, releaseReason = :reason, updatedAt = :now',
              ConditionExpression: '#st IN (:reserved, :charging)',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: {
                ':released': 'RELEASED',
                ':reserved': 'RESERVED',
                ':charging': 'CHARGING',
                ':reason': reason,
                ':now': now(),
              },
            },
          },
          {
            Update: {
              TableName: T(),
              Key: { pk: `CONNECTOR#${reservation.connectorId}`, sk: 'STATE' },
              UpdateExpression: 'SET #st = :available, updatedAt = :now REMOVE sagaId',
              ConditionExpression: 'sagaId = :saga',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: { ':available': 'AVAILABLE', ':saga': sagaId, ':now': now() },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    const again = await getReservation(sagaId);
    return { released: false, alreadyCompensated: again?.status === 'RELEASED', reservation: again };
  }
  return { released: true, alreadyCompensated: false, reservation: await getReservation(sagaId) };
}

// Tras el paso 3 exitoso: RESERVED -> CHARGING
export async function markCharging(sagaId) {
  return transition(sagaId, 'RESERVED', 'CHARGING', 'CHARGING');
}

// Fin de la sesión de carga (stopCharging): CHARGING -> AVAILABLE
export async function complete(sagaId) {
  return transition(sagaId, 'CHARGING', 'COMPLETED', 'AVAILABLE');
}

async function transition(sagaId, fromStatus, reservationStatus, connectorStatus) {
  const reservation = await getReservation(sagaId);
  if (!reservation) throw new DomainError('RESERVATION_NOT_FOUND', `No existe reserva para ${sagaId}`, 404);
  if (reservation.status === reservationStatus) return { reservation, idempotentReplay: true };
  try {
    await ddb().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: T(),
              Key: { pk: `SAGA#${sagaId}`, sk: 'RESERVATION' },
              UpdateExpression: 'SET #st = :to, updatedAt = :now',
              ConditionExpression: '#st = :from',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: { ':to': reservationStatus, ':from': fromStatus, ':now': now() },
            },
          },
          {
            Update: {
              TableName: T(),
              Key: { pk: `CONNECTOR#${reservation.connectorId}`, sk: 'STATE' },
              UpdateExpression:
                connectorStatus === 'AVAILABLE'
                  ? 'SET #st = :cs, updatedAt = :now REMOVE sagaId'
                  : 'SET #st = :cs, updatedAt = :now',
              ConditionExpression: 'sagaId = :saga',
              ExpressionAttributeNames: { '#st': 'status' },
              ExpressionAttributeValues: { ':cs': connectorStatus, ':saga': sagaId, ':now': now() },
            },
          },
        ],
      }),
    );
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    throw new DomainError('INVALID_STATE', `La reserva ${sagaId} está en ${reservation.status}, se esperaba ${fromStatus}`, 409);
  }
  return { reservation: await getReservation(sagaId), idempotentReplay: false };
}

function toConnector(i) {
  return {
    id: i.connectorId,
    stationId: i.stationId,
    stationName: i.stationName,
    city: i.city,
    type: i.connectorType,
    powerKw: Number(i.powerKw),
    ultraFast: Boolean(i.ultraFast),
    status: i.status,
    sagaId: i.sagaId || null,
    updatedAt: i.updatedAt || null,
  };
}
