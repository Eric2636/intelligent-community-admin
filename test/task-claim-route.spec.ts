import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRouter } from '../src/routes';

test('registers the task claim endpoint used by the mini program', () => {
  const router = createRouter();
  const hasTaskClaimRoute = router.stack.some((layer) => {
    return layer.path === '/api/tasks/:taskId/claim' && layer.methods.includes('POST');
  });

  assert.equal(hasTaskClaimRoute, true);
});

test('registers task completion endpoints used by the mini program', () => {
  const router = createRouter();

  assert.equal(
    router.stack.some((layer) => layer.path === '/api/tasks/:taskId/submit-complete' && layer.methods.includes('POST')),
    true,
  );
  assert.equal(
    router.stack.some(
      (layer) => layer.path === '/api/tasks/:taskId/confirm-complete' && layer.methods.includes('POST'),
    ),
    true,
  );
});
