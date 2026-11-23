// E2E: flujo completo desde la API GraphQL (lo mismo que hace el Frontend)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { gql, setFlag, waitFlagCache, SAGA_FIELDS } from '../helpers.js';

const START = `mutation($i: StartChargingInput!){ reserveAndStartCharging(input:$i){ ${SAGA_FIELDS} } }`;
const connector = async (id) => (await gql('{ connectors { id status } }')).connectors.find((c) => c.id === id);
const balance = async (f) => (await gql('query($f:ID!){ wallet(fleetId:$f){ balance } }', { f })).wallet.balance;

after(async () => { await setFlag('SIMULATE_CHARGER_HARDWARE_FAULT', false); });

test('camino feliz: COMPLETED, conector CHARGING y luego FINISHED', async () => {
  await setFlag('SIMULATE_CHARGER_HARDWARE_FAULT', false);
  await waitFlagCache();
  const before = await balance('FLEET-ANDES');
  const { reserveAndStartCharging: s } = await gql(START, { i: { fleetId: 'FLEET-ANDES', connectorId: 'BOG-80-A', estimatedKwh: 20 } });
  assert.equal(s.status, 'COMPLETED', JSON.stringify(s));
  assert.equal((await connector('BOG-80-A')).status, 'CHARGING');
  assert.equal(await balance('FLEET-ANDES'), before - s.amount);
  const { stopCharging } = await gql(`mutation($s:ID!){ stopCharging(sagaId:$s){ status } }`, { s: s.sagaId });
  assert.equal(stopCharging.status, 'FINISHED');
  assert.equal((await connector('BOG-80-A')).status, 'AVAILABLE');
});

test('falla de hardware (flag) => reembolso + liberación (COMPENSATED)', async () => {
  await setFlag('SIMULATE_CHARGER_HARDWARE_FAULT', true);
  await waitFlagCache();
  const before = await balance('FLEET-ANDES');
  const { reserveAndStartCharging: s } = await gql(START, { i: { fleetId: 'FLEET-ANDES', connectorId: 'BOG-80-B', estimatedKwh: 15 } });
  assert.equal(s.status, 'COMPENSATED', JSON.stringify(s));
  assert.deepEqual(s.steps.map((x) => x.name), ['RESERVE_CONNECTOR', 'CHARGE_WALLET', 'ACTIVATE_CHARGER', 'REFUND_WALLET', 'RELEASE_CONNECTOR']);
  assert.equal(await balance('FLEET-ANDES'), before, 'el saldo debe quedar igual tras el reembolso');
  assert.equal((await connector('BOG-80-B')).status, 'AVAILABLE');
  await setFlag('SIMULATE_CHARGER_HARDWARE_FAULT', false);
  await waitFlagCache();
});

test('fondos insuficientes => solo se libera el conector', async () => {
  const { reserveAndStartCharging: s } = await gql(START, { i: { fleetId: 'FLEET-PACIFICO', connectorId: 'CLO-SUR-A', estimatedKwh: 200 } });
  assert.equal(s.status, 'COMPENSATED');
  assert.match(s.failureReason, /INSUFFICIENT_FUNDS/);
  assert.deepEqual(s.steps.map((x) => x.name), ['RESERVE_CONNECTOR', 'CHARGE_WALLET', 'RELEASE_CONNECTOR']);
  assert.equal((await connector('CLO-SUR-A')).status, 'AVAILABLE');
});

test('idempotencia: reenviar el mismo requestId no crea otra SAGA ni cobra dos veces', async () => {
  const before = await balance('FLEET-ANDES');
  const i = { fleetId: 'FLEET-ANDES', connectorId: 'MDE-POB-A', estimatedKwh: 5, requestId: `e2e-${Date.now()}` };
  const a = (await gql(START, { i })).reserveAndStartCharging;
  const b = (await gql(START, { i })).reserveAndStartCharging;
  assert.equal(a.status, 'COMPLETED', JSON.stringify(a));
  assert.equal(a.sagaId, b.sagaId);
  assert.equal(await balance('FLEET-ANDES'), before - a.amount);
  await gql(`mutation($s:ID!){ stopCharging(sagaId:$s){ status } }`, { s: a.sagaId });
});

test('el historial de transacciones refleja las compensaciones', async () => {
  const d = await gql('{ transactions(limit: 50) { sagaId status } }');
  assert.ok(d.transactions.some((t) => t.status === 'COMPENSATED'));
});
