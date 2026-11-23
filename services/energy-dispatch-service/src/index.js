import { createApp, errorHandler, listen, wrap, DomainError } from '../../shared/http.js';
import { createLogger } from '../../shared/logger.js';
import { isEnabled } from '../../shared/flags.js';
import * as repo from './repository.js';

const SERVICE = 'energy-dispatch-service';
const log = createLogger(SERVICE);
const app = createApp(SERVICE, log);

app.get('/sessions/:sagaId', wrap(async (req, res) => {
  const s = await repo.getSession(req.params.sagaId);
  if (!s) throw new DomainError('SESSION_NOT_FOUND', 'No existe la sesión', 404);
  res.json(s);
}));

// SAGA Paso 3: activación física
app.post('/sessions', wrap(async (req, res) => {
  const { sagaId, connectorId } = req.body || {};
  if (!sagaId || !connectorId) throw new DomainError('BAD_REQUEST', 'sagaId y connectorId son obligatorios', 400);
  const hardwareFault = await isEnabled('SIMULATE_CHARGER_HARDWARE_FAULT');
  if (hardwareFault) {
    log.error('charger_hardware_fault', {
      correlation_id: sagaId, saga_step: 'ACTIVATE_CHARGER', connector_id: connectorId,
      flag: 'SIMULATE_CHARGER_HARDWARE_FAULT',
    });
  }
  const result = await repo.startSession({ sagaId, connectorId, hardwareFault });
  log.info(result.idempotentReplay ? 'session_idempotent_replay' : 'charger_activated', {
    correlation_id: sagaId, saga_step: 'ACTIVATE_CHARGER', connector_id: connectorId,
  });
  res.status(result.idempotentReplay ? 200 : 201).json(result);
}));

app.post('/sessions/:sagaId/stop', wrap(async (req, res) => {
  const s = await repo.stopSession(req.params.sagaId);
  log.info('charger_stopped', { correlation_id: req.params.sagaId });
  res.json(s);
}));

app.get('/telemetry/:connectorId', wrap(async (req, res) => {
  res.json(await repo.getTelemetry(req.params.connectorId, Math.min(Number(req.query.limit || 20), 100)));
}));

app.use(errorHandler(log));
listen(app, Number(process.env.PORT || 4003), log, SERVICE);

// Telemetría simulada de las sesiones activas cada N segundos
const TICK_MS = Number(process.env.TELEMETRY_TICK_MS || 5000);
if (TICK_MS > 0) {
  setInterval(() => repo.tick().catch((e) => log.error('telemetry_tick_failed', { error: e.message })), TICK_MS).unref();
}
