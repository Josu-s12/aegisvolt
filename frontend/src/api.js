// Cliente GraphQL mínimo (fetch). Cada frontend habla con el gateway de SU ambiente.
const URL = (window.__AEGISVOLT_CONFIG__ && window.__AEGISVOLT_CONFIG__.graphqlUrl) || '/graphql';

export async function gql(query, variables = {}) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

export const DASHBOARD_QUERY = `{
  environment { name version track }
  health { service status version track }
  featureFlags { name enabled description environment updatedAt updatedBy }
  stations { id name city availableConnectors connectors { id type powerKw ultraFast status sagaId updatedAt } }
  wallets { fleetId fleetName balance currency }
  transactions(limit: 30) {
    sagaId correlationId status amount failureReason connectorId fleetId estimatedKwh priority createdAt updatedAt
    steps { name status at detail }
  }
}`;

export const START_MUTATION = `mutation($i: StartChargingInput!) {
  reserveAndStartCharging(input: $i) {
    sagaId correlationId status amount failureReason steps { name status at detail }
  }
}`;

export const STOP_MUTATION = `mutation($s: ID!) { stopCharging(sagaId: $s) { sagaId status } }`;
export const SET_FLAG_MUTATION = `mutation($n: String!, $e: Boolean!) { setFeatureFlag(name: $n, enabled: $e) { name enabled updatedAt } }`;
export const TELEMETRY_QUERY = `query($c: ID!) { telemetry(connectorId: $c, limit: 12) { timestamp powerKw energyKwh voltage temperatureC } }`;
export const QUOTE_QUERY = `query($k: Float!, $p: Boolean) { quote(estimatedKwh: $k, priority: $p) { amount currency surgeApplied } }`;
