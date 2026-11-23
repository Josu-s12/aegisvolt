import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateAmount, isPeakHour, BASE_RATE_COP_PER_KWH } from '../../billing-wallet-service/src/pricing.js';

test('tarifa base sin flags', () => {
  const q = estimateAmount({ estimatedKwh: 10, surgeEnabled: false });
  assert.equal(q.amount, 10 * BASE_RATE_COP_PER_KWH);
  assert.equal(q.surgeApplied, false);
});

test('ENABLE_DYNAMIC_SURGE_PRICING aplica x1.5', () => {
  const q = estimateAmount({ estimatedKwh: 10, surgeEnabled: true, forcePeak: true });
  assert.equal(q.amount, 18000);
  assert.equal(q.surgeApplied, true);
});

test('reserva prioritaria aplica x1.2', () => {
  assert.equal(estimateAmount({ estimatedKwh: 10, priority: true }).amount, 14400);
});

test('kWh inválidos lanzan error', () => {
  assert.throws(() => estimateAmount({ estimatedKwh: -1 }), RangeError);
  assert.throws(() => estimateAmount({ estimatedKwh: 'abc' }), RangeError);
});

test('horas pico en hora Colombia (UTC-5)', () => {
  assert.equal(isPeakHour(new Date('2026-11-23T12:00:00Z')), true); // 7am COL
  assert.equal(isPeakHour(new Date('2026-11-23T17:00:00Z')), false); // 12m COL
});
