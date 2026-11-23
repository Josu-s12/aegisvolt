// GraphQL Aggregation Layer + orquestador SAGA
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createSchema, createYoga } from 'graphql-yoga';
import { GraphQLError } from 'graphql';
import { APP_ENV, APP_TRACK, APP_VERSION, AWS_REGION } from '../../shared/config.js';
import { createLogger } from '../../shared/logger.js';
import { listFlags, setFlag } from '../../shared/flags.js';
import { createClients } from './service-clients.js';
import { createDynamoSagaStore } from './saga-store.js';
import { createOrchestrator } from './saga-orchestrator.js';

const SERVICE = 'graphql-gateway';
const log = createLogger(SERVICE);
const typeDefs = readFileSync(new URL('./schema.graphql', import.meta.url), 'utf8');
const clients = createClients();
const store = createDynamoSagaStore();
const saga = createOrchestrator({ clients, store, logger: log, env: APP_ENV });

const toGqlError = (e) => new GraphQLError(e.message, { extensions: { code: e.code || 'INTERNAL_ERROR' } });
const safe = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { throw toGqlError(e); }
};

const resolvers = {
  Query: {
    environment: () => ({ name: APP_ENV, version: APP_VERSION, track: APP_TRACK, region: AWS_REGION }),
    health: async () => Promise.all(
      [['station-reservation-service', clients.reservation], ['billing-wallet-service', clients.billing], ['energy-dispatch-service', clients.dispatch]]
        .map(async ([name, c]) => {
          try { const h = await c.health(); return { service: name, status: h.status, version: h.version, track: h.track }; }
          catch { return { service: name, status: 'DOWN' }; }
        }),
    ),
    stations: safe(() => clients.reservation.stations()),
    connectors: safe(async (_, { stationId }) => {
      const all = await clients.reservation.connectors();
      return stationId ? all.filter((c) => c.stationId === stationId) : all;
    }),
    telemetry: safe((_, { connectorId, limit }) => clients.dispatch.telemetry(connectorId, limit)),
    featureFlags: safe(() => listFlags()),
    wallets: safe(() => clients.billing.wallets()),
    wallet: async (_, { fleetId }) => {
      try { return await clients.billing.wallet(fleetId); } catch (e) { if (e.status === 404) return null; throw toGqlError(e); }
    },
    quote: safe((_, { estimatedKwh, priority }) => clients.billing.quote(estimatedKwh, priority)),
    transactions: safe((_, { limit, status }) => store.list({ limit, status })),
    transaction: safe((_, { sagaId }) => store.get(sagaId)),
  },
  Mutation: {
    reserveAndStartCharging: safe((_, { input }) => saga.start(input)),
    stopCharging: safe((_, { sagaId }) => saga.stop(sagaId)),
    setFeatureFlag: safe(async (_, { name, enabled }) => {
      const f = await setFlag(name, enabled, 'graphql');
      log.warn('feature_flag_changed', { flag: name, enabled, environment: APP_ENV });
      return f;
    }),
    topUpWallet: safe((_, { fleetId, amount }) => clients.billing.topUp(fleetId, amount)),
  },
  Station: {
    availableConnectors: (s) => s.connectors.filter((c) => c.status === 'AVAILABLE').length,
  },
};

const yoga = createYoga({
  schema: createSchema({ typeDefs, resolvers }),
  graphqlEndpoint: '/graphql',
  cors: { origin: '*', methods: ['GET', 'POST', 'OPTIONS'] },
  landingPage: false,
  logging: false,
});

const server = createServer((req, res) => {
  if (req.url === '/health') {
    const failing = process.env.FAIL_HEALTH === 'true';
    if (failing) log.error('health_check_failed', { reason: 'FAIL_HEALTH=true' });
    res.writeHead(failing ? 500 : 200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: failing ? 'DOWN' : 'UP', service: SERVICE, environment: APP_ENV, version: APP_VERSION, track: APP_TRACK }));
  }
  return yoga(req, res);
});

const PORT = Number(process.env.PORT || 4000);
server.listen(PORT, () => log.info('service_started', { port: PORT, graphql: `/graphql` }));
const shutdown = async () => { await log.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
