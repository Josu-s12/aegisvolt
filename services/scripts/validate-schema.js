// Valida el esquema GraphQL (parte de la etapa lint & build del pipeline)
import { readFileSync } from 'node:fs';
import { buildSchema } from 'graphql';

const sdl = readFileSync(new URL('../graphql-gateway/src/schema.graphql', import.meta.url), 'utf8');
const schema = buildSchema(sdl);
const required = {
  Query: ['stations', 'telemetry', 'featureFlags', 'transactions', 'environment'],
  Mutation: ['reserveAndStartCharging', 'setFeatureFlag', 'stopCharging'],
};
for (const [type, fields] of Object.entries(required)) {
  const t = schema.getType(type);
  for (const f of fields) {
    if (!t.getFields()[f]) { console.error(`Falta ${type}.${f}`); process.exit(1); }
  }
}
console.log('Esquema GraphQL válido ✔', Object.keys(schema.getQueryType().getFields()).length, 'queries,', Object.keys(schema.getMutationType().getFields()).length, 'mutations');
