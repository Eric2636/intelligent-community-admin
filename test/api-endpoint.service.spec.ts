import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Router from '@koa/router';
import {
  ApiEndpointService,
  apiEndpointService,
  extractRegisteredApiEndpoints,
  normalizeRoutePattern,
  syncRegisteredApiEndpoints,
} from '../src/modules/api-log/api-endpoint.service';
import { createRouter } from '../src/routes';

type EndpointRow = {
  id: string;
  source: string;
  method: string;
  routePattern: string;
  description: string | null;
  logEnabled: boolean;
};

function endpointKey(method: string, routePattern: string) {
  return JSON.stringify([method, routePattern]);
}

function createFakeDatabase(initial: EndpointRow[] = []) {
  const rows = new Map(initial.map((row) => [endpointKey(row.method, row.routePattern), { ...row }]));
  const upsertCalls: Array<Record<string, unknown>> = [];
  const findUniqueCalls: Array<Record<string, unknown>> = [];

  return {
    rows,
    upsertCalls,
    findUniqueCalls,
    db: {
      apiEndpoint: {
        upsert: async (args: {
          where: { method_routePattern: { method: string; routePattern: string } };
          create: Omit<EndpointRow, 'id' | 'description'>;
          update: Partial<EndpointRow>;
        }) => {
          upsertCalls.push(args as unknown as Record<string, unknown>);
          const key = endpointKey(
            args.where.method_routePattern.method,
            args.where.method_routePattern.routePattern,
          );
          const existing = rows.get(key);
          if (existing) {
            const updated = { ...existing, ...args.update };
            rows.set(key, updated);
            return { ...updated };
          }
          const created: EndpointRow = {
            id: `endpoint-${rows.size + 1}`,
            description: null,
            ...args.create,
          };
          rows.set(key, created);
          return { ...created };
        },
        findUnique: async (args: {
          where: { method_routePattern: { method: string; routePattern: string } };
        }) => {
          findUniqueCalls.push(args as unknown as Record<string, unknown>);
          const { method, routePattern } = args.where.method_routePattern;
          return rows.get(endpointKey(method, routePattern)) ?? null;
        },
      },
    },
  };
}

test('extracts strings, explicit HEAD, regex, expanded arrays and multiple methods without aliases', () => {
  const router = new Router();
  router.get('/api/tasks/:taskId', () => undefined);
  router.get('/api/tasks/:taskId', () => undefined);
  router.options('/api/tasks/:taskId', () => undefined);
  router.head('/api/head-only', () => undefined);
  router.get(/^\/api\/items\/(\d+)$/gi, () => undefined);
  router.get(['/api/array-a', '/api/array-b'], () => undefined);
  router.register('/api/multi', ['GET', 'POST'], () => undefined);
  router.use('/api/no-http-method', () => undefined);
  router.get('/api/admin', () => undefined);
  router.get('/api/admin/users/:userId', () => undefined);
  router.get('/api/administrator', () => undefined);

  assert.deepEqual(extractRegisteredApiEndpoints(router), [
    { method: 'GET', routePattern: '/api/tasks/:taskId', source: 'MINI' },
    { method: 'OPTIONS', routePattern: '/api/tasks/:taskId', source: 'MINI' },
    { method: 'HEAD', routePattern: '/api/head-only', source: 'MINI' },
    {
      method: 'GET',
      routePattern: 'REGEXP:^\\/api\\/items\\/(\\d+)$/gi',
      source: 'MINI',
    },
    { method: 'GET', routePattern: '/api/array-a', source: 'MINI' },
    { method: 'GET', routePattern: '/api/array-b', source: 'MINI' },
    { method: 'GET', routePattern: '/api/multi', source: 'MINI' },
    { method: 'POST', routePattern: '/api/multi', source: 'MINI' },
    { method: 'GET', routePattern: '/api/admin', source: 'ADMIN' },
    { method: 'GET', routePattern: '/api/admin/users/:userId', source: 'ADMIN' },
    { method: 'GET', routePattern: '/api/administrator', source: 'MINI' },
  ]);
  assert.equal(normalizeRoutePattern(/abc/mig), 'REGEXP:abc/gim');
});

test('unsupported or overlong route patterns fail explicitly and are counted safely by sync', async () => {
  const unsupported = new Router();
  unsupported.get('/api/unsupported', () => undefined);
  (unsupported.stack[0] as unknown as { path: unknown }).path = { custom: true };
  assert.throws(
    () => extractRegisteredApiEndpoints(unsupported),
    /unsupported api route pattern/,
  );

  const tooLong = new Router();
  tooLong.get(`/api/${'x'.repeat(509)}`, () => undefined);
  const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
  const result = await syncRegisteredApiEndpoints(tooLong, {
    db: createFakeDatabase().db,
    logger: { error: (event, metadata) => events.push({ event, metadata }) },
  });

  assert.deepEqual(result, { ok: false, discovered: 0, synced: 0, failed: 1 });
  assert.deepEqual(events, [
    {
      event: 'api_endpoint_discovery_failed',
      metadata: { layerIndex: 0, method: 'GET', reason: 'route_pattern_too_long' },
    },
  ]);
});

test('anchored regex routes infer admin and mini sources from their literal API prefix', () => {
  const router = new Router();
  router.get(/^\/api\/admin\/users\/(\d+)$/, () => undefined);
  router.get(/^\/api\/items\/(\d+)$/, () => undefined);
  router.get(/^\/api\/administrator\/(\d+)$/, () => undefined);

  assert.deepEqual(extractRegisteredApiEndpoints(router), [
    {
      method: 'GET',
      routePattern: 'REGEXP:^\\/api\\/admin\\/users\\/(\\d+)$/',
      source: 'ADMIN',
    },
    {
      method: 'GET',
      routePattern: 'REGEXP:^\\/api\\/items\\/(\\d+)$/',
      source: 'MINI',
    },
    {
      method: 'GET',
      routePattern: 'REGEXP:^\\/api\\/administrator\\/(\\d+)$/',
      source: 'MINI',
    },
  ]);
});

test('unanchored or dynamic-prefix regex routes fail discovery instead of defaulting to mini', async () => {
  const router = new Router();
  router.get(/\/api\/admin\/users\/(\d+)/, () => undefined);
  router.post(/^\/api\/(admin|items)\/(\d+)$/, () => undefined);
  const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];

  assert.throws(
    () => extractRegisteredApiEndpoints(router),
    /cannot infer api source from regexp route/,
  );
  const result = await syncRegisteredApiEndpoints(router, {
    db: createFakeDatabase().db,
    logger: { error: (event, metadata) => events.push({ event, metadata }) },
  });

  assert.deepEqual(result, { ok: false, discovered: 0, synced: 0, failed: 2 });
  assert.deepEqual(events, [
    {
      event: 'api_endpoint_discovery_failed',
      metadata: { layerIndex: 0, method: 'GET', reason: 'ambiguous_regexp_source' },
    },
    {
      event: 'api_endpoint_discovery_failed',
      metadata: { layerIndex: 1, method: 'POST', reason: 'ambiguous_regexp_source' },
    },
  ]);
});

test('extracts each real parameterized route once and preserves static-before-parameter route order', () => {
  const router = createRouter();
  const endpoints = extractRegisteredApiEndpoints(router);

  assert.equal(
    endpoints.filter(
      (endpoint) =>
        endpoint.method === 'GET' && endpoint.routePattern === '/api/tasks/:taskId',
    ).length,
    1,
  );
  assert.ok(
    endpoints.findIndex(
      (endpoint) => endpoint.method === 'GET' && endpoint.routePattern === '/api/items/my',
    ) <
      endpoints.findIndex(
        (endpoint) =>
          endpoint.method === 'GET' && endpoint.routePattern === '/api/items/:itemId',
      ),
  );
  assert.ok(
    endpoints.findIndex(
      (endpoint) => endpoint.method === 'GET' && endpoint.routePattern === '/api/orders/my',
    ) <
      endpoints.findIndex(
        (endpoint) =>
          endpoint.method === 'GET' && endpoint.routePattern === '/api/orders/:orderId',
      ),
  );
});

test('startup sync defaults new endpoints on and preserves existing descriptions and switches', async () => {
  const existing: EndpointRow = {
    id: 'existing',
    source: 'MINI',
    method: 'GET',
    routePattern: '/api/admin/users',
    description: '管理员填写的用户列表说明',
    logEnabled: false,
  };
  const fake = createFakeDatabase([existing]);
  const router = new Router();
  router.get('/api/admin/users', () => undefined);
  router.post('/api/tasks', () => undefined);

  const first = await syncRegisteredApiEndpoints(router, { db: fake.db });
  const second = await syncRegisteredApiEndpoints(router, { db: fake.db });

  assert.deepEqual(first, { ok: true, discovered: 2, synced: 2, failed: 0 });
  assert.deepEqual(second, { ok: true, discovered: 2, synced: 2, failed: 0 });
  assert.deepEqual(fake.rows.get(endpointKey('GET', '/api/admin/users')), {
    ...existing,
    source: 'ADMIN',
  });
  assert.equal(fake.rows.get(endpointKey('POST', '/api/tasks'))?.logEnabled, true);
  for (const call of fake.upsertCalls) {
    const update = call.update as Record<string, unknown>;
    assert.deepEqual(Object.keys(update), ['source']);
    assert.equal('description' in update, false);
    assert.equal('logEnabled' in update, false);
  }
});

test('startup sync reports database failure safely instead of throwing', async () => {
  const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
  const router = new Router();
  router.get('/api/health', () => undefined);
  const result = await syncRegisteredApiEndpoints(router, {
    db: {
      apiEndpoint: {
        upsert: async () => {
          throw new Error('DATABASE_URL=mysql://secret:password@example/private');
        },
        findUnique: async () => null,
      },
    },
    logger: {
      error: (event, metadata) => events.push({ event, metadata }),
    },
  });

  assert.deepEqual(result, { ok: false, discovered: 1, synced: 0, failed: 1 });
  assert.deepEqual(events, [
    {
      event: 'api_endpoint_sync_failed',
      metadata: { method: 'GET', routePattern: '/api/health', source: 'MINI' },
    },
  ]);
  assert.equal(JSON.stringify(events).includes('secret'), false);
});

test('startup sync uses bounded concurrency, awaits every endpoint, and keeps stable counts', async () => {
  const router = new Router();
  for (let index = 0; index < 23; index += 1) {
    router.get(`/api/concurrency/${index}`, () => undefined);
  }
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const result = await syncRegisteredApiEndpoints(router, {
    maxConcurrency: 4,
    db: {
      apiEndpoint: {
        findUnique: async () => null,
        upsert: async (args) => {
          const call = calls;
          calls += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, call % 3));
          active -= 1;
          if (call % 5 === 0) throw new Error('expected fake failure');
          return {
            id: `row-${call}`,
            description: null,
            ...args.create,
          };
        },
      },
    },
    logger: { error: () => undefined },
  });

  assert.equal(calls, 23);
  assert.ok(maxActive > 1);
  assert.ok(maxActive <= 4);
  assert.deepEqual(result, { ok: false, discovered: 23, synced: 18, failed: 5 });
});

test('configuration cache uses normalized method and exact binary route pattern for 30 seconds', async () => {
  const fake = createFakeDatabase([
    {
      id: 'upper',
      source: 'MINI',
      method: 'GET',
      routePattern: '/api/Case',
      description: 'upper',
      logEnabled: false,
    },
    {
      id: 'lower',
      source: 'MINI',
      method: 'GET',
      routePattern: '/api/case',
      description: 'lower',
      logEnabled: true,
    },
  ]);
  let now = 1_000;
  const service = new ApiEndpointService({
    db: fake.db,
    clock: () => now,
  });

  assert.equal((await service.getConfig('get', '/api/Case')).logEnabled, false);
  assert.equal((await service.getConfig('GET', '/api/Case')).description, 'upper');
  assert.equal(fake.findUniqueCalls.length, 1);
  assert.equal((await service.getConfig('GET', '/api/case')).description, 'lower');
  assert.equal(fake.findUniqueCalls.length, 2);

  now += 29_999;
  await service.getConfig('GET', '/api/Case');
  assert.equal(fake.findUniqueCalls.length, 2);
  now += 1;
  await service.getConfig('GET', '/api/Case');
  assert.equal(fake.findUniqueCalls.length, 3);
});

test('configuration cache coalesces concurrent cold and expired reads and starts TTL after I/O', async () => {
  let now = 1_000;
  let findCalls = 0;
  let releaseRead: (() => void) | undefined;
  const readGate = () =>
    new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
  let currentGate = readGate();
  const service = new ApiEndpointService({
    clock: () => now,
    db: {
      apiEndpoint: {
        findUnique: async () => {
          findCalls += 1;
          await currentGate;
          now += 5_000;
          return {
            id: 'endpoint',
            source: 'MINI',
            method: 'GET',
            routePattern: '/api/coalesced',
            description: null,
            logEnabled: false,
          };
        },
        upsert: async () => {
          throw new Error('not expected');
        },
      },
    },
  });

  const coldReads = Array.from({ length: 12 }, () =>
    service.getConfig('GET', '/api/coalesced'),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(findCalls, 1);
  releaseRead?.();
  await Promise.all(coldReads);

  now = 35_999;
  await service.getConfig('GET', '/api/coalesced');
  assert.equal(findCalls, 1);
  now = 36_000;
  currentGate = readGate();
  const expiredReads = Array.from({ length: 12 }, () =>
    service.getConfig('GET', '/api/coalesced'),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(findCalls, 2);
  releaseRead?.();
  await Promise.all(expiredReads);
});

test('configuration cache coalesces missing endpoint creation into one find and one upsert', async () => {
  let findCalls = 0;
  let upsertCalls = 0;
  let releaseUpsert: (() => void) | undefined;
  const service = new ApiEndpointService({
    db: {
      apiEndpoint: {
        findUnique: async () => {
          findCalls += 1;
          return null;
        },
        upsert: async (args) => {
          upsertCalls += 1;
          await new Promise<void>((resolve) => {
            releaseUpsert = resolve;
          });
          return { id: 'new-endpoint', description: null, ...args.create };
        },
      },
    },
  });

  const reads = Array.from({ length: 20 }, () =>
    service.getConfig('post', '/api/new-concurrent'),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(findCalls, 1);
  assert.equal(upsertCalls, 1);
  releaseUpsert?.();
  const values = await Promise.all(reads);
  assert.ok(values.every((value) => value.id === 'new-endpoint' && value.logEnabled));
});

test('configuration cache creates missing endpoints enabled by default and supports exact/all invalidation', async () => {
  const fake = createFakeDatabase();
  const service = new ApiEndpointService({ db: fake.db });

  const missing = await service.getConfig('post', '/api/admin/new-route');
  assert.equal(missing.logEnabled, true);
  assert.equal(missing.source, 'ADMIN');
  assert.equal(fake.rows.get(endpointKey('POST', '/api/admin/new-route'))?.logEnabled, true);

  await service.getConfig('POST', '/api/admin/new-route');
  assert.equal(fake.findUniqueCalls.length, 1);
  service.invalidate('post', '/api/admin/new-route');
  await service.getConfig('POST', '/api/admin/new-route');
  assert.equal(fake.findUniqueCalls.length, 2);

  await service.getConfig('GET', '/api/other');
  service.invalidateAll();
  await service.getConfig('POST', '/api/admin/new-route');
  await service.getConfig('GET', '/api/other');
  assert.equal(fake.findUniqueCalls.length, 5);
});

test('configuration database failure falls back to enabled without leaking errors', async () => {
  const events: Array<{ event: string; metadata?: Record<string, unknown> }> = [];
  const service = new ApiEndpointService({
    db: {
      apiEndpoint: {
        findUnique: async () => {
          throw new Error('password=hunter2');
        },
        upsert: async () => {
          throw new Error('password=hunter2');
        },
      },
    },
    logger: {
      error: (event, metadata) => events.push({ event, metadata }),
    },
  });

  const config = await service.getConfig('patch', '/api/admin/settings');

  assert.deepEqual(config, {
    id: null,
    source: 'ADMIN',
    method: 'PATCH',
    routePattern: '/api/admin/settings',
    description: null,
    logEnabled: true,
  });
  assert.deepEqual(events, [
    {
      event: 'api_endpoint_config_read_failed',
      metadata: {
        method: 'PATCH',
        routePattern: '/api/admin/settings',
        source: 'ADMIN',
      },
    },
  ]);
  assert.equal(JSON.stringify(events).includes('hunter2'), false);
});

test('concurrent configuration failures share one fallback and a later call retries', async () => {
  let findCalls = 0;
  let releaseFailure: (() => void) | undefined;
  const events: string[] = [];
  const service = new ApiEndpointService({
    db: {
      apiEndpoint: {
        findUnique: async () => {
          findCalls += 1;
          await new Promise<void>((resolve) => {
            releaseFailure = resolve;
          });
          throw new Error('database secret');
        },
        upsert: async () => {
          throw new Error('not expected');
        },
      },
    },
    logger: { error: (event) => events.push(event) },
  });

  const reads = Array.from({ length: 10 }, () =>
    service.getConfig('GET', '/api/failing'),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(findCalls, 1);
  releaseFailure?.();
  const values = await Promise.all(reads);
  assert.ok(values.every((value) => value.logEnabled && value.id === null));
  assert.equal(events.length, 1);

  const retry = service.getConfig('GET', '/api/failing');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(findCalls, 2);
  releaseFailure?.();
  await retry;
  assert.equal(events.length, 2);
});

test('the exported process service is shared so invalidation by one consumer affects another', async () => {
  assert.ok(apiEndpointService instanceof ApiEndpointService);
  const fake = createFakeDatabase([
    {
      id: 'shared',
      source: 'MINI',
      method: 'GET',
      routePattern: '/api/shared',
      description: null,
      logEnabled: true,
    },
  ]);
  const shared = new ApiEndpointService({ db: fake.db });
  const middlewareConsumer = shared;
  const adminConsumer = shared;

  await middlewareConsumer.getConfig('GET', '/api/shared');
  await middlewareConsumer.getConfig('GET', '/api/shared');
  assert.equal(fake.findUniqueCalls.length, 1);
  adminConsumer.invalidate('GET', '/api/shared');
  await middlewareConsumer.getConfig('GET', '/api/shared');
  assert.equal(fake.findUniqueCalls.length, 2);
});

test('main starts listening before fire-and-observe endpoint sync without adding router side effects', async () => {
  const [mainSource, routesSource] = await Promise.all([
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/routes/index.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(
    mainSource,
    /app\.listen\([\s\S]*?Listening on[\s\S]*?void syncRegisteredApiEndpoints\(router\)/,
  );
  assert.doesNotMatch(
    mainSource,
    /const router = createRouter\(\);\s+await syncRegisteredApiEndpoints\(router\);/,
  );
  assert.doesNotMatch(routesSource, /syncRegisteredApiEndpoints|apiEndpoint\.(?:upsert|create)/);
});
