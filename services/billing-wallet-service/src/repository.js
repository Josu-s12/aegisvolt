// billing-wallet-service: fondos, cobro y reembolso de la billetera de la flota.
// Tabla propia: aegisvolt-billing-<env>
//   pk = WALLET#<fleetId>, sk = PROFILE         -> saldo
//   pk = SAGA#<sagaId>,    sk = CHARGE          -> cobro (CHARGED | REFUNDED) = clave de idempotencia
//   pk = SAGA#<sagaId>,    sk = EVENT#REFUND    -> evento de reversión (auditoría)
import { GetCommand, QueryCommand, ScanCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isConditionalFailure } from '../../shared/aws.js';
import { TABLES } from '../../shared/config.js';
import { DomainError } from '../../shared/http.js';

const T = () => TABLES.billing;
const now = () => new Date().toISOString();

export async function getWallet(fleetId) {
  const res = await ddb().send(new GetCommand({ TableName: T(), Key: { pk: `WALLET#${fleetId}`, sk: 'PROFILE' } }));
  return res.Item ? toWallet(res.Item) : null;
}

export async function listWallets() {
  const res = await ddb().send(new ScanCommand({
    TableName: T(), FilterExpression: 'sk = :p', ExpressionAttributeValues: { ':p': 'PROFILE' },
  }));
  return (res.Items || []).map(toWallet).sort((a, b) => a.fleetId.localeCompare(b.fleetId));
}

export async function topUp(fleetId, amount) {
  if (!(amount > 0)) throw new DomainError('BAD_REQUEST', 'amount debe ser > 0', 400);
  try {
    await ddb().send(new UpdateCommand({
      TableName: T(),
      Key: { pk: `WALLET#${fleetId}`, sk: 'PROFILE' },
      UpdateExpression: 'SET balance = balance + :a, updatedAt = :now',
      ConditionExpression: 'attribute_exists(pk)',
      ExpressionAttributeValues: { ':a': amount, ':now': now() },
    }));
  } catch (err) {
    if (isConditionalFailure(err)) throw new DomainError('WALLET_NOT_FOUND', `No existe la billetera ${fleetId}`, 404);
    throw err;
  }
  return getWallet(fleetId);
}

export async function getCharge(sagaId) {
  const res = await ddb().send(new QueryCommand({
    TableName: T(), KeyConditionExpression: 'pk = :pk', ExpressionAttributeValues: { ':pk': `SAGA#${sagaId}` },
  }));
  const items = res.Items || [];
  const charge = items.find((i) => i.sk === 'CHARGE') || null;
  const events = items.filter((i) => i.sk.startsWith('EVENT#'));
  return charge ? { ...charge, events } : null;
}

// PASO 2 de la SAGA: descontar el saldo estimado. Idempotente por sagaId.
export async function charge({ sagaId, fleetId, amount, currency = 'COP', pricing = {} }) {
  const existing = await getCharge(sagaId);
  if (existing) return { charge: existing, idempotentReplay: true };

  const chargeItem = {
    pk: `SAGA#${sagaId}`, sk: 'CHARGE', sagaId, fleetId, amount, currency, pricing,
    status: 'CHARGED', createdAt: now(), updatedAt: now(),
  };
  try {
    await ddb().send(new TransactWriteCommand({
      TransactItems: [
        { Put: { TableName: T(), Item: chargeItem, ConditionExpression: 'attribute_not_exists(pk)' } },
        {
          Update: {
            TableName: T(),
            Key: { pk: `WALLET#${fleetId}`, sk: 'PROFILE' },
            UpdateExpression: 'SET balance = balance - :a, updatedAt = :now',
            ConditionExpression: 'attribute_exists(pk) AND balance >= :a',
            ExpressionAttributeValues: { ':a': amount, ':now': now() },
          },
        },
      ],
    }));
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    const again = await getCharge(sagaId);
    if (again) return { charge: again, idempotentReplay: true };
    const wallet = await getWallet(fleetId);
    if (!wallet) throw new DomainError('WALLET_NOT_FOUND', `No existe la billetera ${fleetId}`, 404);
    throw new DomainError('INSUFFICIENT_FUNDS', `Fondos insuficientes: saldo ${wallet.balance} < ${amount} ${currency}`, 402, {
      balance: wallet.balance, required: amount,
    });
  }
  return { charge: chargeItem, idempotentReplay: false };
}

// COMPENSACIÓN del paso 2: reembolso + evento de reversión, todo en UNA transacción.
// Idempotente: solo se reembolsa si status = CHARGED. Un segundo intento encuentra
// REFUNDED, la condición falla y NO se devuelve el dinero dos veces.
export async function refund(sagaId, reason = 'SAGA_COMPENSATION') {
  const existing = await getCharge(sagaId);
  if (!existing) return { refunded: false, alreadyCompensated: false, nothingToRefund: true };
  if (existing.status === 'REFUNDED') return { refunded: false, alreadyCompensated: true, charge: existing };

  try {
    await ddb().send(new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: T(),
            Key: { pk: `SAGA#${sagaId}`, sk: 'CHARGE' },
            UpdateExpression: 'SET #st = :refunded, refundReason = :reason, refundedAt = :now, updatedAt = :now',
            ConditionExpression: '#st = :charged',
            ExpressionAttributeNames: { '#st': 'status' },
            ExpressionAttributeValues: { ':refunded': 'REFUNDED', ':charged': 'CHARGED', ':reason': reason, ':now': now() },
          },
        },
        {
          Update: {
            TableName: T(),
            Key: { pk: `WALLET#${existing.fleetId}`, sk: 'PROFILE' },
            UpdateExpression: 'SET balance = balance + :a, updatedAt = :now',
            ExpressionAttributeValues: { ':a': existing.amount, ':now': now() },
          },
        },
        {
          Put: {
            TableName: T(),
            Item: {
              pk: `SAGA#${sagaId}`, sk: 'EVENT#REFUND', sagaId, type: 'REVERSAL', fleetId: existing.fleetId,
              amount: existing.amount, currency: existing.currency, reason, createdAt: now(),
            },
            ConditionExpression: 'attribute_not_exists(pk)',
          },
        },
      ],
    }));
  } catch (err) {
    if (!isConditionalFailure(err)) throw err;
    const again = await getCharge(sagaId);
    return { refunded: false, alreadyCompensated: again?.status === 'REFUNDED', charge: again };
  }
  return { refunded: true, alreadyCompensated: false, charge: await getCharge(sagaId) };
}

function toWallet(i) {
  return { fleetId: i.fleetId, fleetName: i.fleetName, balance: Number(i.balance), currency: i.currency || 'COP', updatedAt: i.updatedAt || null };
}
