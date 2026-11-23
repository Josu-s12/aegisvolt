import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isConditionalFailure } from '../../shared/aws.js';

test('detecta fallas condicionales de DynamoDB', () => {
  assert.equal(isConditionalFailure({ name: 'ConditionalCheckFailedException' }), true);
  assert.equal(isConditionalFailure({ name: 'TransactionCanceledException', CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }] }), true);
  assert.equal(isConditionalFailure({ name: 'ThrottlingException' }), false);
});
