// Fábrica de apps Express con lo transversal: correlation-id, logs de request,
// /health para Kubernetes y manejo uniforme de errores de dominio.
import crypto from 'node:crypto';
import express from 'express';
import { APP_ENV, APP_TRACK, APP_VERSION } from './config.js';

export class DomainError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createApp(service, logger) {
  const app = express();
  app.use(express.json());

  // Propagación del correlation_id (= sagaId) entre servicios por el header x-correlation-id
  app.use((req, res, next) => {
    req.correlationId = req.get('x-correlation-id') || crypto.randomUUID();
    res.set('x-correlation-id', req.correlationId);
    const start = Date.now();
    res.on('finish', () => {
      if (req.path === '/health') return;
      const level = res.statusCode >= 500 ? 'error' : 'info';
      logger[level]('http_request', {
        correlation_id: req.correlationId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Date.now() - start,
      });
    });
    next();
  });

  // Health check usado por readiness/liveness probes y por el análisis Canary.
  // FAIL_HEALTH=true permite demostrar el rollback automático del canary.
  app.get('/health', (req, res) => {
    const body = { status: 'UP', service, environment: APP_ENV, version: APP_VERSION, track: APP_TRACK };
    if (process.env.FAIL_HEALTH === 'true') {
      logger.error('health_check_failed', { reason: 'FAIL_HEALTH=true (canary defectuoso simulado)' });
      return res.status(500).json({ ...body, status: 'DOWN' });
    }
    res.json(body);
  });

  return app;
}

export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof DomainError) {
      const log = err.status >= 500 ? logger.error : logger.warn;
      log('domain_error', { correlation_id: req.correlationId, code: err.code, error: err.message, ...err.details });
      return res.status(err.status).json({ error: err.code, message: err.message, ...err.details });
    }
    logger.error('unhandled_error', { correlation_id: req.correlationId, error: err.message, stack: err.stack });
    res.status(500).json({ error: 'INTERNAL_ERROR', message: err.message });
  };
}

// Envuelve handlers async para que los errores lleguen al errorHandler
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function listen(app, port, logger, service) {
  const server = app.listen(port, () => logger.info('service_started', { port, service }));
  const shutdown = async () => {
    logger.info('service_stopping', { service });
    await logger.flush();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}
