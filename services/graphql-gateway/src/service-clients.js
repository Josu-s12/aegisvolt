// Clientes HTTP hacia los microservicios. Propagan el x-correlation-id (= sagaId).
export class ServiceError extends Error {
  constructor(service, status, body) {
    super(body?.message || `${service} respondió ${status}`);
    this.service = service;
    this.status = status;
    this.code = body?.error || 'SERVICE_ERROR';
    this.body = body;
    // 4xx = error de negocio (no se reintenta); 5xx/red = transitorio
    this.retryable = !status || status >= 500;
  }
}

const TIMEOUT_MS = Number(process.env.SERVICE_TIMEOUT_MS || 5000);

async function call(service, baseUrl, method, path, { body, correlationId } = {}) {
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(correlationId ? { 'x-correlation-id': correlationId } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new ServiceError(service, 0, { error: 'UNREACHABLE', message: `${service} no responde: ${e.message}` });
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ServiceError(service, res.status, data);
  return data;
}

export function createClients({
  reservationUrl = process.env.RESERVATION_URL || 'http://localhost:4001',
  billingUrl = process.env.BILLING_URL || 'http://localhost:4002',
  dispatchUrl = process.env.DISPATCH_URL || 'http://localhost:4003',
} = {}) {
  const R = (m, p, o) => call('station-reservation-service', reservationUrl, m, p, o);
  const B = (m, p, o) => call('billing-wallet-service', billingUrl, m, p, o);
  const D = (m, p, o) => call('energy-dispatch-service', dispatchUrl, m, p, o);
  return {
    reservation: {
      health: () => R('GET', '/health'),
      stations: () => R('GET', '/stations'),
      connectors: () => R('GET', '/connectors'),
      reserve: (b, correlationId) => R('POST', '/reservations', { body: b, correlationId }),
      release: (sagaId, reason) => R('POST', `/reservations/${sagaId}/release`, { body: { reason }, correlationId: sagaId }),
      markCharging: (sagaId) => R('POST', `/reservations/${sagaId}/charging`, { correlationId: sagaId }),
      complete: (sagaId) => R('POST', `/reservations/${sagaId}/complete`, { correlationId: sagaId }),
    },
    billing: {
      health: () => B('GET', '/health'),
      wallets: () => B('GET', '/wallets'),
      wallet: (id) => B('GET', `/wallets/${id}`),
      topUp: (id, amount) => B('POST', `/wallets/${id}/topup`, { body: { amount } }),
      quote: (kwh, priority) => B('GET', `/quote?kwh=${kwh}&priority=${Boolean(priority)}`),
      charge: (b, correlationId) => B('POST', '/charges', { body: b, correlationId }),
      refund: (sagaId, reason) => B('POST', `/charges/${sagaId}/refund`, { body: { reason }, correlationId: sagaId }),
    },
    dispatch: {
      health: () => D('GET', '/health'),
      start: (b, correlationId) => D('POST', '/sessions', { body: b, correlationId }),
      stop: (sagaId) => D('POST', `/sessions/${sagaId}/stop`, { correlationId: sagaId }),
      telemetry: (cid, limit) => D('GET', `/telemetry/${cid}?limit=${limit}`),
    },
  };
}
