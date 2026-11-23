// Registro (log) de la SAGA del orquestador. Tabla: aegisvolt-sagas-<env>
//   pk = SAGA#<sagaId>, sk = META
// Es la "memoria" del orquestador: qué pasos se ejecutaron y cuáles se compensaron.
// Prefect la audita para detectar SAGAs huérfanas o con compensación fallida.
import { GetCommand, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ddb } from '../../shared/aws.js';
import { TABLES } from '../../shared/config.js';

export function createDynamoSagaStore() {
  return {
    async get(sagaId) {
      const res = await ddb().send(new GetCommand({ TableName: TABLES.sagas, Key: { pk: `SAGA#${sagaId}`, sk: 'META' } }));
      return res.Item || null;
    },
    async create(saga) {
      // attribute_not_exists -> si dos requests llegan con el mismo requestId solo uno crea la SAGA
      await ddb().send(new PutCommand({
        TableName: TABLES.sagas, Item: { pk: `SAGA#${saga.sagaId}`, sk: 'META', ...saga },
        ConditionExpression: 'attribute_not_exists(pk)',
      }));
      return saga;
    },
    async save(saga) {
      await ddb().send(new PutCommand({ TableName: TABLES.sagas, Item: { pk: `SAGA#${saga.sagaId}`, sk: 'META', ...saga } }));
      return saga;
    },
    async list({ limit = 25, status } = {}) {
      const items = [];
      let ExclusiveStartKey;
      do {
        const res = await ddb().send(new ScanCommand({ TableName: TABLES.sagas, ExclusiveStartKey }));
        items.push(...(res.Items || []));
        ExclusiveStartKey = res.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items
        .filter((i) => !status || i.status === status)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
  };
}

// Implementación en memoria para unit tests
export function createMemorySagaStore() {
  const m = new Map();
  return {
    async get(id) { return m.get(id) ? structuredClone(m.get(id)) : null; },
    async create(s) {
      if (m.has(s.sagaId)) { const e = new Error('exists'); e.name = 'ConditionalCheckFailedException'; throw e; }
      m.set(s.sagaId, structuredClone(s)); return s;
    },
    async save(s) { m.set(s.sagaId, structuredClone(s)); return s; },
    async list() { return [...m.values()]; },
  };
}
