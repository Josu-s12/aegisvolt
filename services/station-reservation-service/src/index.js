import { createApp, errorHandler, listen, wrap, DomainError } from '../../shared/http.js';
import { createLogger } from '../../shared/logger.js';
import { isEnabled } from '../../shared/flags.js';
import * as repo from './repository.js';

const SERVICE = 'station-reservation-service';
const log = createLogger(SERVICE);
const app = createApp(SERVICE, log);

app.get('/stations', wrap(async (req, res) => res.json(await repo.listStations())));
app.get('/connectors', wrap(async (req, res) => res.json(await repo.listConnectors())));

app.get('/reservations/:sagaId', wrap(async (req, res) => {
  const r = await repo.getReservation(req.params.sagaId);
  if (!r) throw new DomainError('RESERVATION_NOT_FOUND', 'No existe la reserva', 404);
  res.json(r);
}));

// SAGA Paso 1
app.post('/reservations', wrap(async (req, res) => {
  const { sagaId, connectorId, fleetId, priority } = req.body || {};
  if (!sagaId || !connectorId || !fleetId) throw new DomainError('BAD_REQUEST', 'sagaId, connectorId y fleetId son obligatorios', 400);
  const fastChargeBoostEnabled = await isEnabled('ENABLE_FAST_CHARGE_BOOST');
  const result = await repo.reserve({ sagaId, connectorId, fleetId, priority, fastChargeBoostEnabled });
  log.info(result.idempotentReplay ? 'reservation_idempotent_replay' : 'connector_reserved', {
    correlation_id: sagaId, saga_step: 'RESERVE_CONNECTOR', connector_id: connectorId, fleet_id: fleetId, priority: Boolean(priority),
  });
  res.status(result.idempotentReplay ? 200 : 201).json(result);
}));

// Compensación del Paso 1
app.post('/reservations/:sagaId/release', wrap(async (req, res) => {
  const sagaId = req.params.sagaId;
  const result = await repo.release(sagaId, req.body?.reason);
  log.warn(result.alreadyCompensated ? 'release_already_compensated' : 'connector_released', {
    correlation_id: sagaId, saga_step: 'COMPENSATE_RELEASE_CONNECTOR', reason: req.body?.reason, ...result, reservation: undefined,
  });
  res.json(result);
}));

app.post('/reservations/:sagaId/charging', wrap(async (req, res) => {
  const result = await repo.markCharging(req.params.sagaId);
  log.info('connector_charging', { correlation_id: req.params.sagaId, saga_step: 'MARK_CHARGING' });
  res.json(result);
}));

app.post('/reservations/:sagaId/complete', wrap(async (req, res) => {
  const result = await repo.complete(req.params.sagaId);
  log.info('reservation_completed', { correlation_id: req.params.sagaId });
  res.json(result);
}));

app.use(errorHandler(log));
listen(app, Number(process.env.PORT || 4001), log, SERVICE);
