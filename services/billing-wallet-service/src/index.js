import { createApp, errorHandler, listen, wrap, DomainError } from '../../shared/http.js';
import { createLogger } from '../../shared/logger.js';
import { isEnabled } from '../../shared/flags.js';
import { estimateAmount } from './pricing.js';
import * as repo from './repository.js';

const SERVICE = 'billing-wallet-service';
const log = createLogger(SERVICE);
const app = createApp(SERVICE, log);

app.get('/wallets', wrap(async (req, res) => res.json(await repo.listWallets())));

app.get('/wallets/:fleetId', wrap(async (req, res) => {
  const w = await repo.getWallet(req.params.fleetId);
  if (!w) throw new DomainError('WALLET_NOT_FOUND', 'No existe la billetera', 404);
  res.json(w);
}));

app.post('/wallets/:fleetId/topup', wrap(async (req, res) => {
  const w = await repo.topUp(req.params.fleetId, Number(req.body?.amount));
  log.info('wallet_topped_up', { fleet_id: req.params.fleetId, amount: Number(req.body?.amount) });
  res.json(w);
}));

app.get('/quote', wrap(async (req, res) => {
  const surgeEnabled = await isEnabled('ENABLE_DYNAMIC_SURGE_PRICING');
  try {
    res.json(estimateAmount({ estimatedKwh: Number(req.query.kwh), priority: req.query.priority === 'true', surgeEnabled }));
  } catch (e) {
    throw new DomainError('BAD_REQUEST', e.message, 400);
  }
}));

app.get('/charges/:sagaId', wrap(async (req, res) => {
  const c = await repo.getCharge(req.params.sagaId);
  if (!c) throw new DomainError('CHARGE_NOT_FOUND', 'No existe el cobro', 404);
  res.json(c);
}));

// SAGA Paso 2
app.post('/charges', wrap(async (req, res) => {
  const { sagaId, fleetId, estimatedKwh, priority } = req.body || {};
  if (!sagaId || !fleetId) throw new DomainError('BAD_REQUEST', 'sagaId y fleetId son obligatorios', 400);
  const surgeEnabled = await isEnabled('ENABLE_DYNAMIC_SURGE_PRICING');
  let pricing;
  try {
    pricing = estimateAmount({ estimatedKwh, priority, surgeEnabled });
  } catch (e) {
    throw new DomainError('BAD_REQUEST', e.message, 400);
  }
  const result = await repo.charge({ sagaId, fleetId, amount: pricing.amount, currency: pricing.currency, pricing });
  log.info(result.idempotentReplay ? 'charge_idempotent_replay' : 'wallet_charged', {
    correlation_id: sagaId, saga_step: 'CHARGE_WALLET', fleet_id: fleetId, amount: pricing.amount, surge_applied: pricing.surgeApplied,
  });
  res.status(result.idempotentReplay ? 200 : 201).json(result);
}));

// Compensación del Paso 2
app.post('/charges/:sagaId/refund', wrap(async (req, res) => {
  const sagaId = req.params.sagaId;
  const result = await repo.refund(sagaId, req.body?.reason);
  log.warn(result.alreadyCompensated ? 'refund_already_compensated' : 'wallet_refunded', {
    correlation_id: sagaId, saga_step: 'COMPENSATE_REFUND_WALLET', reason: req.body?.reason,
    refunded: result.refunded, already_compensated: result.alreadyCompensated, amount: result.charge?.amount,
  });
  res.json(result);
}));

app.use(errorHandler(log));
listen(app, Number(process.env.PORT || 4002), log, SERVICE);
