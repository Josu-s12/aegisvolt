// Pruebas unitarias de la SAGA y de sus compensaciones (sin red ni DynamoDB)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../../graphql-gateway/src/saga-orchestrator.js';
import { createMemorySagaStore } from '../../graphql-gateway/src/saga-store.js';

const silent = { info() {}, warn() {}, error() {}, flush: async () => {} };
const err = (code, retryable = false) => Object.assign(new Error(code), { code, retryable });

function fakeClients({ failCharge, failDispatch, failRefundTimes = 0 } = {}) {
  const calls = [];
  const state = { refunds: 0, releases: 0, refundFailures: failRefundTimes };
  return {
    calls, state,
    reservation: {
      reserve: async () => { calls.push('reserve'); return {}; },
      release: async () => { calls.push('release'); state.releases++; return { released: true }; },
      markCharging: async () => { calls.push('markCharging'); return {}; },
      complete: async () => { calls.push('complete'); return {}; },
    },
    billing: {
      charge: async () => { calls.push('charge'); if (failCharge) throw err('INSUFFICIENT_FUNDS'); return { charge: { amount: 12000 } }; },
      refund: async () => {
        calls.push('refund');
        if (state.refundFailures > 0) { state.refundFailures--; throw err('UNREACHABLE', true); }
        state.refunds++; return { refunded: true };
      },
    },
    dispatch: {
      start: async () => { calls.push('dispatch'); if (failDispatch) throw err('CHARGER_HARDWARE_FAULT', true); return {}; },
      stop: async () => { calls.push('stop'); return {}; },
    },
  };
}

const input = { fleetId: 'F1', connectorId: 'C1', estimatedKwh: 10 };
const make = (clients) => createOrchestrator({ clients, store: createMemorySagaStore(), logger: silent, env: 'test', retry: { attempts: 3, baseDelayMs: 1 } });

test('camino feliz: 3 pasos y COMPLETED', async () => {
  const c = fakeClients();
  const s = await make(c).start(input);
  assert.equal(s.status, 'COMPLETED');
  assert.deepEqual(c.calls, ['reserve', 'charge', 'dispatch', 'markCharging']);
  assert.equal(s.amount, 12000);
});

test('falla el paso 3 -> reembolso y luego liberación (orden inverso)', async () => {
  const c = fakeClients({ failDispatch: true });
  const s = await make(c).start(input);
  assert.equal(s.status, 'COMPENSATED');
  assert.deepEqual(c.calls, ['reserve', 'charge', 'dispatch', 'refund', 'release']);
  assert.match(s.failureReason, /CHARGER_HARDWARE_FAULT/);
  assert.deepEqual(s.steps.map((x) => `${x.name}:${x.status}`), [
    'RESERVE_CONNECTOR:SUCCEEDED', 'CHARGE_WALLET:SUCCEEDED', 'ACTIVATE_CHARGER:FAILED',
    'REFUND_WALLET:COMPENSATED', 'RELEASE_CONNECTOR:COMPENSATED',
  ]);
});

test('falla el paso 2 (fondos insuficientes) -> solo se libera el conector', async () => {
  const c = fakeClients({ failCharge: true });
  const s = await make(c).start(input);
  assert.equal(s.status, 'COMPENSATED');
  assert.deepEqual(c.calls, ['reserve', 'charge', 'release']);
  assert.equal(c.state.refunds, 0);
});

test('compensación con fallo transitorio se reintenta con backoff', async () => {
  const c = fakeClients({ failDispatch: true, failRefundTimes: 2 });
  const s = await make(c).start(input);
  assert.equal(s.status, 'COMPENSATED');
  assert.equal(c.calls.filter((x) => x === 'refund').length, 3);
  assert.equal(c.state.refunds, 1);
});

test('compensación que agota reintentos -> COMPENSATION_FAILED (Prefect la detecta)', async () => {
  const c = fakeClients({ failDispatch: true, failRefundTimes: 99 });
  const s = await make(c).start(input);
  assert.equal(s.status, 'COMPENSATION_FAILED');
});

test('mismo requestId => misma SAGA, no se cobra dos veces', async () => {
  const c = fakeClients();
  const o = make(c);
  const a = await o.start({ ...input, requestId: 'abc' });
  const b = await o.start({ ...input, requestId: 'abc' });
  assert.equal(a.sagaId, b.sagaId);
  assert.equal(c.calls.filter((x) => x === 'charge').length, 1);
});
