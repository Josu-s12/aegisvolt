// Integración contra el endpoint GraphQL (gateway + 3 microservicios corriendo)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gql } from '../helpers.js';

test('query environment / health', async () => {
  const d = await gql('{ environment { name } health { service status } }');
  assert.ok(['dev', 'test', 'prod'].includes(d.environment.name));
  assert.equal(d.health.length, 3);
  assert.ok(d.health.every((h) => h.status === 'UP'), JSON.stringify(d.health));
});

test('query stations devuelve estaciones y conectores', async () => {
  const d = await gql('{ stations { id name availableConnectors connectors { id status powerKw } } }');
  assert.ok(d.stations.length >= 3);
  assert.ok(d.stations[0].connectors.length > 0);
});

test('query featureFlags devuelve las 3 flags del ambiente', async () => {
  const d = await gql('{ featureFlags { name enabled environment } }');
  const names = d.featureFlags.map((f) => f.name);
  for (const n of ['ENABLE_DYNAMIC_SURGE_PRICING', 'ENABLE_FAST_CHARGE_BOOST', 'SIMULATE_CHARGER_HARDWARE_FAULT']) assert.ok(names.includes(n));
});

test('query quote calcula tarifa', async () => {
  const d = await gql('{ quote(estimatedKwh: 10) { amount currency } }');
  assert.ok(d.quote.amount >= 12000);
});
