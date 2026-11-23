// Integración contra tablas DynamoDB reales (Floci en CI). Verifica la idempotencia
// de los pasos y de las compensaciones a nivel de base de datos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as reservations from '../../station-reservation-service/src/repository.js';
import * as billing from '../../billing-wallet-service/src/repository.js';

const id = () => `it-${crypto.randomUUID()}`;

test('reserva idempotente: el mismo sagaId no bloquea dos veces', async () => {
  const sagaId = id();
  const a = await reservations.reserve({ sagaId, connectorId: 'MDE-POB-B', fleetId: 'FLEET-ANDES' });
  const b = await reservations.reserve({ sagaId, connectorId: 'MDE-POB-B', fleetId: 'FLEET-ANDES' });
  assert.equal(a.idempotentReplay, false);
  assert.equal(b.idempotentReplay, true);
  assert.equal((await reservations.getConnector('MDE-POB-B')).status, 'RESERVED');
  const r1 = await reservations.release(sagaId, 'test');
  const r2 = await reservations.release(sagaId, 'test');
  assert.equal(r1.released, true);
  assert.equal(r2.alreadyCompensated, true);
  assert.equal((await reservations.getConnector('MDE-POB-B')).status, 'AVAILABLE');
});

test('no se puede reservar un conector ocupado', async () => {
  const s1 = id();
  await reservations.reserve({ sagaId: s1, connectorId: 'MDE-POB-A', fleetId: 'FLEET-ANDES' });
  await assert.rejects(reservations.reserve({ sagaId: id(), connectorId: 'MDE-POB-A', fleetId: 'FLEET-ANDES' }), { code: 'CONNECTOR_UNAVAILABLE' });
  await reservations.release(s1);
});

test('reembolso idempotente: procesar la compensación dos veces devuelve el dinero UNA vez', async () => {
  const sagaId = id();
  const before = (await billing.getWallet('FLEET-ANDES')).balance;
  await billing.charge({ sagaId, fleetId: 'FLEET-ANDES', amount: 1000 });
  await billing.charge({ sagaId, fleetId: 'FLEET-ANDES', amount: 1000 }); // replay
  assert.equal((await billing.getWallet('FLEET-ANDES')).balance, before - 1000);
  const r1 = await billing.refund(sagaId, 'test');
  const r2 = await billing.refund(sagaId, 'test');
  assert.equal(r1.refunded, true);
  assert.equal(r2.alreadyCompensated, true);
  assert.equal((await billing.getWallet('FLEET-ANDES')).balance, before);
  const c = await billing.getCharge(sagaId);
  assert.equal(c.status, 'REFUNDED');
  assert.equal(c.events.length, 1);
});

test('fondos insuficientes no descuenta nada', async () => {
  const before = (await billing.getWallet('FLEET-PACIFICO')).balance;
  await assert.rejects(billing.charge({ sagaId: id(), fleetId: 'FLEET-PACIFICO', amount: before + 1 }), { code: 'INSUFFICIENT_FUNDS' });
  assert.equal((await billing.getWallet('FLEET-PACIFICO')).balance, before);
});
