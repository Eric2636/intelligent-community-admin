import assert from 'node:assert/strict';
import test from 'node:test';
import type Koa from 'koa';
import { HttpError } from '../src/http-error';
import { errorHandler } from '../src/middleware/error-handler';

function context() {
  return {
    method: 'GET',
    path: '/api/notifications',
    app: { emit: () => {} },
  } as unknown as Koa.Context;
}

test('shared error handler preserves explicit HttpError status and message', async () => {
  const ctx = context();

  await errorHandler(ctx, async () => {
    throw new HttpError(404, '通知不存在');
  });

  assert.equal(ctx.status, 404);
  assert.deepEqual(ctx.body, { statusCode: 404, message: '通知不存在' });
});

test('shared error handler never exposes a generic Prisma error message or stack', async (t) => {
  const secret = 'Prisma P2002 duplicate token=private-value';
  const logged: unknown[][] = [];
  t.mock.method(console, 'error', (...args: unknown[]) => {
    logged.push(args);
  });
  const ctx = context();

  await errorHandler(ctx, async () => {
    throw new Error(secret);
  });

  assert.equal(ctx.status, 500);
  assert.deepEqual(ctx.body, { statusCode: 500, message: 'Internal Server Error' });
  assert.doesNotMatch(JSON.stringify(ctx.body), /private-value|P2002|Prisma/);
  assert.equal(logged.length, 1);
  assert.doesNotMatch(JSON.stringify(logged), /private-value|P2002/);
});
