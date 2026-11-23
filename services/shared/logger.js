// Logger estructurado en JSON.
// Cada línea lleva: timestamp, level, service, environment, version, track y
// correlation_id (= sagaId en el flujo de reserva). Se escribe a stdout y, si
// CLOUDWATCH_LOGS_ENABLED=true, también se envía a CloudWatch Logs al grupo
// /aegisvolt/<ambiente>/<servicio> (creado por Terraform).
import os from 'node:os';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { APP_ENV, APP_TRACK, APP_VERSION, logGroupName } from './config.js';
import { awsClientConfig } from './aws.js';

const CW_ENABLED = process.env.CLOUDWATCH_LOGS_ENABLED === 'true';
const FLUSH_MS = Number(process.env.CLOUDWATCH_FLUSH_MS || 2000);

class CloudWatchShipper {
  constructor(service) {
    this.client = new CloudWatchLogsClient(awsClientConfig());
    this.group = logGroupName(service);
    this.stream = `${os.hostname()}-${new Date().toISOString().slice(0, 10)}-${process.pid}`;
    this.buffer = [];
    this.ready = null;
    this.timer = setInterval(() => this.flush().catch(() => {}), FLUSH_MS);
    this.timer.unref();
  }

  async ensureStream() {
    if (!this.ready) {
      this.ready = (async () => {
        try {
          await this.client.send(new CreateLogGroupCommand({ logGroupName: this.group }));
        } catch (e) {
          if (e.name !== 'ResourceAlreadyExistsException') throw e;
        }
        try {
          await this.client.send(
            new CreateLogStreamCommand({ logGroupName: this.group, logStreamName: this.stream }),
          );
        } catch (e) {
          if (e.name !== 'ResourceAlreadyExistsException') throw e;
        }
      })().catch((e) => {
        this.ready = null;
        throw e;
      });
    }
    return this.ready;
  }

  push(line) {
    this.buffer.push({ timestamp: Date.now(), message: line });
    if (this.buffer.length >= 50) this.flush().catch(() => {});
  }

  async flush() {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0, this.buffer.length);
    try {
      await this.ensureStream();
      await this.client.send(
        new PutLogEventsCommand({ logGroupName: this.group, logStreamName: this.stream, logEvents: events }),
      );
    } catch (e) {
      process.stderr.write(`[logger] no se pudo enviar a CloudWatch: ${e.name}: ${e.message}\n`);
    }
  }
}

export function createLogger(service) {
  const shipper = CW_ENABLED ? new CloudWatchShipper(service) : null;

  function write(level, message, fields = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      environment: APP_ENV,
      version: APP_VERSION,
      track: APP_TRACK,
      correlation_id: fields.correlation_id || fields.correlationId || null,
      message,
      ...fields,
    };
    delete entry.correlationId;
    const line = JSON.stringify(entry);
    if (process.env.LOG_SILENT !== 'true') process.stdout.write(line + '\n');
    if (shipper) shipper.push(line);
    return entry;
  }

  return {
    info: (msg, f) => write('INFO', msg, f),
    warn: (msg, f) => write('WARN', msg, f),
    error: (msg, f) => write('ERROR', msg, f),
    flush: () => (shipper ? shipper.flush() : Promise.resolve()),
  };
}
