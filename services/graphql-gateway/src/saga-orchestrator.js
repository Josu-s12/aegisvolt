// ============================================================================
// ORQUESTADOR SAGA - flujo "Reservar y Activar Carga"
// ============================================================================
// SAGA por ORQUESTACIÓN: un coordinador central (este módulo, dentro de la capa
// GraphQL) llama a cada microservicio en orden y, si algo falla, ejecuta las
// transacciones compensatorias en ORDEN INVERSO.
//
//   Paso 1 RESERVE_CONNECTOR  (station-reservation-service)  comp: RELEASE_CONNECTOR
//   Paso 2 CHARGE_WALLET      (billing-wallet-service)       comp: REFUND_WALLET
//   Paso 3 ACTIVATE_CHARGER   (energy-dispatch-service)      (último paso, no compensa)
//
//   Falla paso 3 -> REFUND_WALLET -> RELEASE_CONNECTOR   => COMPENSATED
//   Falla paso 2 -> RELEASE_CONNECTOR                    => COMPENSATED
//   Falla paso 1 -> nada que compensar                    => FAILED
//
// Idempotencia: el sagaId viaja a todos los servicios y es la clave de
// idempotencia en sus tablas (ConditionExpression attribute_not_exists / status).
// Por eso reintentar un paso o una compensación nunca cobra/reembolsa dos veces.
// ============================================================================
import crypto from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createOrchestrator({ clients, store, logger, env, retry = { attempts: 3, baseDelayMs: 200 } }) {
  const now = () => new Date().toISOString();

  function addStep(saga, name, status, detail) {
    saga.steps.push({ name, status, at: now(), detail: detail ?? null });
    saga.updatedAt = now();
  }

  // Las compensaciones DEBEN terminar: se reintentan con backoff exponencial.
  // Como son idempotentes, reintentar es seguro.
  async function withRetry(fn, label, sagaId) {
    let lastErr;
    for (let attempt = 1; attempt <= retry.attempts; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        logger.warn('saga_compensation_retry', { correlation_id: sagaId, step: label, attempt, error: err.message });
        if (err.retryable === false) break;
        if (attempt < retry.attempts) await sleep(retry.baseDelayMs * 2 ** (attempt - 1));
      }
    }
    throw lastErr;
  }

  async function compensate(saga, completedSteps, reason) {
    saga.status = 'COMPENSATING';
    await store.save(saga);
    logger.warn('saga_compensation_started', { correlation_id: saga.sagaId, reason, completed_steps: completedSteps });

    // Orden inverso
    const plan = [];
    if (completedSteps.includes('CHARGE_WALLET')) {
      plan.push(['REFUND_WALLET', () => clients.billing.refund(saga.sagaId, reason)]);
    }
    if (completedSteps.includes('RESERVE_CONNECTOR')) {
      plan.push(['RELEASE_CONNECTOR', () => clients.reservation.release(saga.sagaId, reason)]);
    }

    for (const [name, fn] of plan) {
      try {
        const result = await withRetry(fn, name, saga.sagaId);
        addStep(saga, name, 'COMPENSATED', result?.alreadyCompensated ? 'ya estaba compensado (idempotente)' : reason);
        logger.warn('saga_step_compensated', { correlation_id: saga.sagaId, step: name, result: summarize(result) });
      } catch (err) {
        addStep(saga, name, 'COMPENSATION_FAILED', err.message);
        saga.status = 'COMPENSATION_FAILED';
        saga.failureReason = `${reason} | compensación ${name} falló: ${err.message}`;
        await store.save(saga);
        logger.error('saga_compensation_failed', { correlation_id: saga.sagaId, step: name, error: err.message });
        return saga;
      }
    }
    saga.status = 'COMPENSATED';
    saga.failureReason = reason;
    await store.save(saga);
    logger.warn('saga_compensated', { correlation_id: saga.sagaId, reason });
    return saga;
  }

  async function start({ fleetId, connectorId, estimatedKwh, priority = false, requestId }) {
    // Idempotencia a nivel de API: el mismo requestId => la misma SAGA
    const sagaId = requestId ? `saga-${requestId}` : `saga-${crypto.randomUUID()}`;
    if (requestId) {
      const existing = await store.get(sagaId);
      if (existing) {
        logger.info('saga_idempotent_replay', { correlation_id: sagaId });
        return existing;
      }
    }

    const saga = {
      sagaId, correlationId: sagaId, environment: env, fleetId, connectorId,
      estimatedKwh: Number(estimatedKwh), priority: Boolean(priority), amount: null,
      status: 'STARTED', failureReason: null, steps: [], createdAt: now(), updatedAt: now(),
    };
    try {
      await store.create(saga);
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') return store.get(sagaId);
      throw e;
    }
    logger.info('saga_started', { correlation_id: sagaId, fleet_id: fleetId, connector_id: connectorId, estimated_kwh: estimatedKwh, priority });

    const completed = [];

    // ---- Paso 1: Reserva ----
    try {
      await clients.reservation.reserve({ sagaId, connectorId, fleetId, priority }, sagaId);
      completed.push('RESERVE_CONNECTOR');
      addStep(saga, 'RESERVE_CONNECTOR', 'SUCCEEDED', `conector ${connectorId} -> RESERVED`);
      await store.save(saga);
    } catch (err) {
      addStep(saga, 'RESERVE_CONNECTOR', 'FAILED', `${err.code}: ${err.message}`);
      saga.status = 'FAILED';
      saga.failureReason = `${err.code}: ${err.message}`;
      await store.save(saga);
      logger.warn('saga_failed', { correlation_id: sagaId, step: 'RESERVE_CONNECTOR', error: err.message, code: err.code });
      return saga;
    }

    // ---- Paso 2: Cobro ----
    try {
      const res = await clients.billing.charge({ sagaId, fleetId, estimatedKwh, priority }, sagaId);
      saga.amount = res?.charge?.amount ?? null;
      completed.push('CHARGE_WALLET');
      addStep(saga, 'CHARGE_WALLET', 'SUCCEEDED', `cobro ${saga.amount} COP`);
      await store.save(saga);
    } catch (err) {
      addStep(saga, 'CHARGE_WALLET', 'FAILED', `${err.code}: ${err.message}`);
      logger.warn('saga_step_failed', { correlation_id: sagaId, step: 'CHARGE_WALLET', error: err.message, code: err.code });
      return compensate(saga, completed, `${err.code}: ${err.message}`);
    }

    // ---- Paso 3: Activación física ----
    try {
      await clients.dispatch.start({ sagaId, connectorId }, sagaId);
      completed.push('ACTIVATE_CHARGER');
      addStep(saga, 'ACTIVATE_CHARGER', 'SUCCEEDED', 'flujo eléctrico iniciado');
    } catch (err) {
      addStep(saga, 'ACTIVATE_CHARGER', 'FAILED', `${err.code}: ${err.message}`);
      logger.error('saga_step_failed', { correlation_id: sagaId, step: 'ACTIVATE_CHARGER', error: err.message, code: err.code });
      return compensate(saga, completed, `${err.code}: ${err.message}`);
    }

    // Confirmación (no es paso compensable): conector RESERVED -> CHARGING
    try {
      await clients.reservation.markCharging(sagaId);
      addStep(saga, 'MARK_CONNECTOR_CHARGING', 'SUCCEEDED', `conector ${connectorId} -> CHARGING`);
    } catch (err) {
      addStep(saga, 'MARK_CONNECTOR_CHARGING', 'WARNING', err.message);
    }
    saga.status = 'COMPLETED';
    await store.save(saga);
    logger.info('saga_completed', { correlation_id: sagaId, amount: saga.amount });
    return saga;
  }

  async function stop(sagaId) {
    const saga = await store.get(sagaId);
    if (!saga) throw new Error(`No existe la SAGA ${sagaId}`);
    if (saga.status !== 'COMPLETED') return saga;
    await clients.dispatch.stop(sagaId);
    await clients.reservation.complete(sagaId);
    addStep(saga, 'STOP_CHARGING', 'SUCCEEDED', 'sesión finalizada, conector -> AVAILABLE');
    saga.status = 'FINISHED';
    await store.save(saga);
    logger.info('charging_stopped', { correlation_id: sagaId });
    return saga;
  }

  return { start, stop, compensate };
}

function summarize(r) {
  if (!r || typeof r !== 'object') return r;
  const { refunded, released, alreadyCompensated, nothingToRefund, nothingToRelease } = r;
  return { refunded, released, alreadyCompensated, nothingToRefund, nothingToRelease };
}
