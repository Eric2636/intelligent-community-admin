import assert from 'node:assert/strict';
import test from 'node:test';
import type Koa from 'koa';
import { createApiAccessLogMiddleware } from '../src/middleware/api-access-log';

function context(overrides: Record<string, unknown> = {}) {
  const created: Record<string, unknown>[] = [];
  return {
    method: 'GET', path: '/api/items', url: '/api/items?token=abc', originalUrl: '/api/items?token=abc',
    protocol: 'http', host: '127.0.0.1:3000',
    status: 200, body: { statusCode: 200 }, state: {}, headers: { authorization: '' },
    get(name: string) { return name === 'x-forwarded-for' ? '' : ''; },
    req: { socket: { remoteAddress: '127.0.0.1' } },
    ...overrides, created,
  } as unknown as Koa.Context & { created: Record<string, unknown>[] };
}

function deps(rows: { enabled?: boolean } = {}) {
  const requests: Record<string, unknown>[] = [];
  return {
    requests,
    db: { apiRequestLog: { create: async ({ data }: { data: Record<string, unknown> }) => { requests.push(data); } } },
    endpointService: { getConfig: async () => ({ id: 'ep1', source: 'MINI' as const, method: 'GET', routePattern: '/api/items', description: null, logEnabled: rows.enabled ?? true }) },
    clock: (() => { let n = 0; return () => ++n; })(),
  };
}

test('writes access log for successful response when enabled', async () => {
  const d = deps(); const ctx = context();
  await createApiAccessLogMiddleware(d)(ctx, async () => {});
  assert.equal(d.requests.length, 1);
  assert.equal(d.requests[0].requestUrl, 'http://127.0.0.1:3000/api/items?token=%5BREDACTED%5D');
});

test('disabled endpoint skips ordinary access log', async () => {
  const d = deps({ enabled: false }); const ctx = context();
  await createApiAccessLogMiddleware(d)(ctx, async () => {});
  assert.equal(d.requests.length, 0);
});

test('500 writes error log even when ordinary logging disabled', async () => {
  const d = deps({ enabled: false }); const ctx = context({ status: 500 });
  await createApiAccessLogMiddleware(d)(ctx, async () => { ctx.status = 500; });
  assert.equal(d.requests.length, 1);
  assert.equal(d.requests[0].httpStatus, 500);
});

test('400 writes a sanitized error snapshot and no ordinary access log', async () => {
  const d = deps({ enabled: false });
  const ctx = context({
    status: 400,
    params: { id: 'task-1' },
    query: { token: 'x' },
    request: { body: { title: 'x', password: 'p' } },
  });
  await createApiAccessLogMiddleware(d)(ctx, async () => { ctx.status = 400; });

  assert.equal(d.requests.length, 1);
  assert.deepEqual(d.requests[0].requestSnapshot, {
    params: { id: 'task-1' },
    query: { token: '[REDACTED]' },
    body: { title: 'x', password: '[REDACTED]' },
  });
});

test('log persistence failure does not alter response', async () => {
  const errors: string[] = [];
  const ctx = context({ status: 200, body: { statusCode: 200, message: 'ok' } });
  const middleware = createApiAccessLogMiddleware({
    ...deps(),
    db: { apiRequestLog: { create: async () => { throw new Error('db down'); } } },
    logger: { error: (event) => errors.push(event) },
  });
  await middleware(ctx, async () => { ctx.status = 200; });
  assert.equal(ctx.status, 200); assert.deepEqual(ctx.body, { statusCode: 200, message: 'ok' }); assert.deepEqual(errors, ['api_request_log_persist_failed']);
});
