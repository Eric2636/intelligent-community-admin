import assert from 'node:assert/strict';
import test from 'node:test';
import type Koa from 'koa';
import { createApiAccessLogMiddleware } from '../src/middleware/api-access-log';

function context(overrides: Record<string, unknown> = {}) {
  const created: Record<string, unknown>[] = [];
  return {
    method: 'GET',
    path: '/api/items',
    url: '/api/items?token=abc',
    originalUrl: '/api/items?token=abc',
    protocol: 'http',
    host: '127.0.0.1:3000',
    status: 200,
    body: { statusCode: 200 },
    state: {},
    headers: { authorization: '' },
    get: () => '',
    req: { socket: { remoteAddress: '127.0.0.1' } },
    ...overrides,
    created,
  } as unknown as Koa.Context & { created: Record<string, unknown>[] };
}

function deps() {
  const requests: Record<string, unknown>[] = [];
  return {
    requests,
    db: {
      apiRequestLog: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          requests.push(data);
        },
      },
    },
    endpointService: {
      getConfig: async () => ({
        id: 'ep1',
        source: 'MINI' as const,
        method: 'GET',
        routePattern: '/api/items',
        description: null,
        logEnabled: true,
      }),
    },
    clock: (() => {
      let value = 0;
      return () => ++value;
    })(),
  };
}

test('writes one successful unified request log with a full redacted URL', async () => {
  const d = deps();
  const ctx = context();

  await createApiAccessLogMiddleware(d)(ctx, async () => {});

  assert.equal(d.requests.length, 1);
  assert.match(String(d.requests[0].requestId), /^[a-z0-9-]{16,64}$/i);
  assert.equal(d.requests[0].requestUrl, 'http://127.0.0.1:3000/api/items?token=%5BREDACTED%5D');
  assert.equal(d.requests[0].httpStatus, 200);
  assert.equal(d.requests[0].errorSummary, null);
  assert.equal(d.requests[0].requestSnapshot, null);
});

test('writes one 401 unified request log without an authenticated actor', async () => {
  const d = deps();
  const ctx = context({ status: 401 });

  await createApiAccessLogMiddleware(d)(ctx, async () => { ctx.status = 401; });

  assert.equal(d.requests.length, 1);
  assert.equal(d.requests[0].httpStatus, 401);
  assert.equal(d.requests[0].adminId, null);
  assert.equal(d.requests[0].userId, null);
  assert.equal(d.requests[0].errorCode, 'HTTP_401');
  assert.deepEqual(d.requests[0].requestSnapshot, { params: null, query: null, body: null });
});

test('uses configured public origin instead of a caller supplied host', async () => {
  const previousOrigin = process.env.PUBLIC_API_ORIGIN;
  process.env.PUBLIC_API_ORIGIN = 'https://lllhjh.asia';
  try {
    const d = deps();
    const ctx = context({ host: 'attacker.example' });
    await createApiAccessLogMiddleware(d)(ctx, async () => {});
    assert.equal(d.requests[0].requestUrl, 'https://lllhjh.asia/api/items?token=%5BREDACTED%5D');
  } finally {
    if (previousOrigin === undefined) delete process.env.PUBLIC_API_ORIGIN;
    else process.env.PUBLIC_API_ORIGIN = previousOrigin;
  }
});
