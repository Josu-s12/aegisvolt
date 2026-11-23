import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { AWS_ENDPOINT_URL, AWS_REGION } from './config.js';

export function awsClientConfig() {
  const cfg = { region: AWS_REGION };
  if (AWS_ENDPOINT_URL) {
    cfg.endpoint = AWS_ENDPOINT_URL;
    // Floci acepta cualquier credencial no vacía
    if (!process.env.AWS_ACCESS_KEY_ID) {
      cfg.credentials = { accessKeyId: 'test', secretAccessKey: 'test' };
    }
  }
  return cfg;
}

let _ddb;
export function ddb() {
  if (!_ddb) {
    _ddb = DynamoDBDocumentClient.from(new DynamoDBClient(awsClientConfig()), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }
  return _ddb;
}

// Una TransactWriteItems falla completa (atomicidad local del servicio). Esta función
// dice si la falla fue porque alguna ConditionExpression no se cumplió.
export function isConditionalFailure(err) {
  if (!err) return false;
  if (err.name === 'ConditionalCheckFailedException') return true;
  if (err.name === 'TransactionCanceledException') {
    const reasons = err.CancellationReasons || [];
    return reasons.length === 0 || reasons.some((r) => r && r.Code === 'ConditionalCheckFailed');
  }
  return false;
}
