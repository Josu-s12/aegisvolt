// Utilidades para integration / e2e tests
export const GRAPHQL_URL = process.env.GRAPHQL_URL || 'http://localhost:4000/graphql';

export async function gql(query, variables = {}) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}

export const SAGA_FIELDS = 'sagaId correlationId status amount failureReason environment steps { name status detail }';

export async function setFlag(name, enabled) {
  return gql('mutation($n:String!,$e:Boolean!){ setFeatureFlag(name:$n, enabled:$e){ name enabled } }', { n: name, e: enabled });
}

export async function waitFlagCache() {
  // los servicios cachean las flags FLAGS_CACHE_TTL_MS (2s por defecto)
  await new Promise((r) => setTimeout(r, Number(process.env.FLAGS_CACHE_TTL_MS ?? 2000) + 300));
}
