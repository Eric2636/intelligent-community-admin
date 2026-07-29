import 'reflect-metadata';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import Router from '@koa/router';
import Koa = require('koa');
import { HttpError } from '../src/http-error';
import { errorHandler } from '../src/middleware/error-handler';
import * as jwtAuthModule from '../src/middleware/jwt-auth';
import { jwtAuth } from '../src/middleware/jwt-auth';
import type { NotificationTransaction } from '../src/modules/notification/notification.service';
import { createRouter } from '../src/routes';
import { registerNotificationRoutes } from '../src/routes/notification.routes';
import { openApiDocument } from '../src/swagger/openapi';

type RouteLayer = {
  path: string;
  methods: string[];
  stack: Array<(ctx: Koa.Context, next: Koa.Next) => Promise<void>>;
};

type NotificationRow = {
  id: string;
  recipientId: string;
  actorId: string | null;
  type: string;
  bizType: string;
  bizId: string | null;
  title: string;
  content: string;
  dedupeKey: string;
  readAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
};

function findRoute(router: Router, method: string, path: string): RouteLayer {
  const layer = router.stack.find((candidate) => candidate.path === path && candidate.methods.includes(method));
  assert.ok(layer, `${method} ${path} must be registered`);
  return layer as unknown as RouteLayer;
}

function matches(row: NotificationRow, where: Record<string, unknown>) {
  return Object.entries(where).every(([key, value]) => row[key as keyof NotificationRow] === value);
}

function createFakeDatabase(seed: NotificationRow[]) {
  const rows = seed.map((row) => ({ ...row }));
  return {
    rows,
    notification: {
      findMany: async (args: {
        where: Record<string, unknown>;
        skip: number;
        take: number;
      }) =>
        rows
          .filter((row) => matches(row, args.where))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
          .slice(args.skip, args.skip + args.take),
      count: async (args: { where: Record<string, unknown> }) =>
        rows.filter((row) => matches(row, args.where)).length,
      updateMany: async (args: {
        where: Record<string, unknown>;
        data: Partial<NotificationRow>;
      }) => {
        let count = 0;
        for (const row of rows) {
          if (!matches(row, args.where)) continue;
          Object.assign(row, args.data);
          count += 1;
        }
        return { count };
      },
    },
  };
}

function row(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'notification-1',
    recipientId: 'user-a',
    actorId: 'actor-a',
    type: 'forum.reply',
    bizType: 'forum',
    bizId: 'post-1',
    title: '帖子有新回复',
    content: '有人回复了你的帖子',
    dedupeKey: 'forum-reply:reply-1',
    readAt: null,
    deletedAt: null,
    createdAt: new Date('2026-07-26T10:00:00.000Z'),
    ...overrides,
  };
}

test('jwt auth exposes a dependency-injected middleware factory for real route tests', () => {
  const authModule = jwtAuthModule as unknown as { createJwtAuth?: unknown };
  assert.equal(typeof authModule.createJwtAuth, 'function');
});

async function withNotificationApp(
  database: NotificationTransaction,
  run: (
    request: (
      method: string,
      path: string,
      token?: string,
    ) => Promise<{ status: number; body: Record<string, unknown> }>,
  ) => Promise<void>,
) {
  const authModule = jwtAuthModule as unknown as {
    createJwtAuth: (dependencies: {
      verifyToken: (token: string) => { sub: string; openid: string };
      findUser: (userId: string) => Promise<{ enabled: boolean } | null>;
    }) => Koa.Middleware;
  };
  const auth = authModule.createJwtAuth({
    verifyToken: (token) => {
      if (token !== 'valid-token') throw new Error('invalid test token');
      return { sub: 'user-a', openid: 'openid-a' };
    },
    findUser: async (userId) => (userId === 'user-a' ? { enabled: true } : null),
  });
  const router = new Router();
  registerNotificationRoutes(router, database, auth);
  const app = new Koa();
  // Koa's normal app.use() performs a generator-function package check that is
  // incompatible with the repository's tsx loader version. Pushing the exact
  // middleware functions into Koa's public stack still exercises callback(),
  // router.routes(), auth and handlers without replacing production packages.
  app.middleware.push(errorHandler, router.routes(), router.allowedMethods());
  const callback = app.callback();
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'route-test-secret';

  try {
    await run(async (method, path, token) => {
      return new Promise((resolve, reject) => {
        const request = new PassThrough() as PassThrough & {
          url: string;
          method: string;
          headers: Record<string, string>;
          socket: { remoteAddress: string };
        };
        request.url = path;
        request.method = method;
        request.headers = token ? { authorization: `Bearer ${token}` } : {};
        request.socket = { remoteAddress: '127.0.0.1' };
        request.end();

        const response = new PassThrough() as PassThrough & {
          statusCode: number;
          setHeader: (name: string, value: unknown) => void;
          getHeader: (name: string) => unknown;
          getHeaders: () => Record<string, unknown>;
          removeHeader: (name: string) => void;
        };
        const headers = new Map<string, unknown>();
        const chunks: Buffer[] = [];
        response.statusCode = 200;
        response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
        response.getHeader = (name) => headers.get(name.toLowerCase());
        response.getHeaders = () => Object.fromEntries(headers);
        response.removeHeader = (name) => headers.delete(name.toLowerCase());
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('finish', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: response.statusCode,
            body: (text ? JSON.parse(text) : {}) as Record<string, unknown>,
          });
        });
        callback(request as never, response as never);
      });
    });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
}

test('real Koa callback requests traverse jwt auth and match static routes before parameters', async () => {
  const database = createFakeDatabase([
    row(),
    row({ id: 'other', recipientId: 'user-b', dedupeKey: 'other' }),
  ]);

  await withNotificationApp(database as unknown as NotificationTransaction, async (request) => {
    const guest = await request('GET', '/api/notifications');
    assert.equal(guest.status, 401);
    assert.equal(guest.body.reason, 'missing_bearer');

    const list = await request('GET', '/api/notifications?page=1&pageSize=20', 'valid-token');
    assert.equal(list.status, 200);
    assert.deepEqual((list.body.data as { list: Array<{ id: string }> }).list.map((item) => item.id), [
      'notification-1',
    ]);

    const unread = await request('GET', '/api/notifications/unread-count', 'valid-token');
    assert.equal(unread.status, 200);
    assert.deepEqual(unread.body, { code: 200, data: { count: 1 } });

    const badPage = await request('GET', '/api/notifications?page=0', 'valid-token');
    assert.equal(badPage.status, 400);
    assert.match(String(badPage.body.message), /页码/);

    const readAll = await request('PATCH', '/api/notifications/read-all', 'valid-token');
    assert.equal(readAll.status, 200);
    assert.deepEqual(readAll.body, { code: 200, data: {} });
    assert.ok(database.rows.find((item) => item.id === 'notification-1')?.readAt);
    assert.equal(database.rows.find((item) => item.id === 'other')?.readAt, null);

    const otherRead = await request('PATCH', '/api/notifications/other/read', 'valid-token');
    assert.equal(otherRead.status, 404);
    assert.deepEqual(otherRead.body, { statusCode: 404, message: '通知不存在' });
  });
});

test('real notification route maps generic database errors to a non-sensitive 500 response', async (t) => {
  const secret = 'Prisma P2024 database-url=mysql://private';
  t.mock.method(console, 'error', () => {});
  const database = {
    notification: {
      count: async () => {
        throw new Error(secret);
      },
    },
  };

  await withNotificationApp(database as unknown as NotificationTransaction, async (request) => {
    const response = await request('GET', '/api/notifications/unread-count', 'valid-token');
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { statusCode: 500, message: 'Internal Server Error' });
    assert.doesNotMatch(JSON.stringify(response.body), /P2024|database-url|private/);
  });
});

async function runHandler(
  route: RouteLayer,
  ctx: Partial<Koa.Context> & {
    state: { user: { userId: string; openid: string } };
  },
) {
  await route.stack[1](ctx as Koa.Context, async () => {});
}

async function runMappedHandler(route: RouteLayer, ctx: Partial<Koa.Context>) {
  const mappedCtx = {
    app: { emit: () => {} },
    ...ctx,
  } as unknown as Koa.Context;
  await errorHandler(mappedCtx, () => route.stack[1](mappedCtx, async () => {}));
  return mappedCtx;
}

test('notification API registers every protected route with static routes before :id routes', () => {
  const router = createRouter();
  const expected = [
    ['GET', '/api/notifications'],
    ['GET', '/api/notifications/unread-count'],
    ['PATCH', '/api/notifications/read-all'],
    ['PATCH', '/api/notifications/:id/read'],
    ['DELETE', '/api/notifications/:id'],
  ] as const;

  for (const [method, path] of expected) {
    assert.equal(findRoute(router, method, path).stack[0], jwtAuth);
  }

  const unreadIndex = router.stack.findIndex((layer) => layer.path === '/api/notifications/unread-count');
  const readAllIndex = router.stack.findIndex((layer) => layer.path === '/api/notifications/read-all');
  const readOneIndex = router.stack.findIndex((layer) => layer.path === '/api/notifications/:id/read');
  const deleteOneIndex = router.stack.findIndex((layer) => layer.path === '/api/notifications/:id');
  assert.ok(unreadIndex < readOneIndex);
  assert.ok(readAllIndex < readOneIndex);
  assert.ok(unreadIndex < deleteOneIndex);
  assert.ok(readAllIndex < deleteOneIndex);
});

test('notification API rejects a guest before invoking its handler', async () => {
  const database = createFakeDatabase([row()]);
  const router = new Router();
  registerNotificationRoutes(router, database as unknown as NotificationTransaction);
  const route = findRoute(router, 'GET', '/api/notifications');
  const ctx = {
    headers: {},
    method: 'GET',
    path: '/api/notifications',
    state: {},
  } as unknown as Koa.Context;
  let handlerCalled = false;

  await route.stack[0](ctx, async () => {
    handlerCalled = true;
    await route.stack[1](ctx, async () => {});
  });

  assert.equal(handlerCalled, false);
  assert.equal(ctx.status, 401);
  assert.equal((ctx.body as { reason: string }).reason, 'missing_bearer');
});

test('list and unread handlers use only the authenticated recipient and exclude deleted rows', async () => {
  const database = createFakeDatabase([
    row(),
    row({ id: 'deleted', dedupeKey: 'deleted', deletedAt: new Date('2026-07-26T11:00:00.000Z') }),
    row({ id: 'other', recipientId: 'user-b', dedupeKey: 'other' }),
  ]);
  const router = new Router();
  registerNotificationRoutes(router, database as unknown as NotificationTransaction);
  const baseCtx = {
    state: { user: { userId: 'user-a', openid: 'openid-a' } },
  };
  const listCtx = { ...baseCtx, query: { page: '1', pageSize: '20' } };
  const unreadCtx = { ...baseCtx };

  await runHandler(findRoute(router, 'GET', '/api/notifications'), listCtx);
  await runHandler(findRoute(router, 'GET', '/api/notifications/unread-count'), unreadCtx);

  assert.deepEqual(listCtx.body, {
    code: 200,
    data: {
      list: [
        {
          id: 'notification-1',
          recipientId: 'user-a',
          actorId: 'actor-a',
          type: 'forum.reply',
          bizType: 'forum',
          bizId: 'post-1',
          title: '帖子有新回复',
          content: '有人回复了你的帖子',
          readAt: null,
          createdAt: '2026-07-26T10:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    },
  });
  assert.deepEqual(unreadCtx.body, { code: 200, data: { count: 1 } });
});

test('bad notification pagination maps to a 400 response and does not query the database', async () => {
  let queried = false;
  const database = {
    notification: {
      findMany: async () => {
        queried = true;
        return [];
      },
      count: async () => {
        queried = true;
        return 0;
      },
    },
  };
  const router = new Router();
  registerNotificationRoutes(router, database as unknown as NotificationTransaction);
  const ctx = await runMappedHandler(findRoute(router, 'GET', '/api/notifications'), {
    query: { page: '0' },
    state: { user: { userId: 'user-a', openid: 'openid-a' } },
  });

  assert.equal(ctx.status, 400);
  assert.match((ctx.body as { message: string }).message, /页码/);
  assert.equal(queried, false);
});

test('read-all, read-one and delete handlers mutate only the authenticated recipient', async () => {
  const database = createFakeDatabase([
    row(),
    row({ id: 'other', recipientId: 'user-b', dedupeKey: 'other' }),
  ]);
  const router = new Router();
  registerNotificationRoutes(router, database as unknown as NotificationTransaction);
  const authed = { state: { user: { userId: 'user-a', openid: 'openid-a' } } };

  const readCtx = { ...authed, params: { id: 'notification-1' } };
  await runHandler(findRoute(router, 'PATCH', '/api/notifications/:id/read'), readCtx);
  assert.deepEqual(readCtx.body, { code: 200, data: {} });
  assert.ok(database.rows.find((item) => item.id === 'notification-1')?.readAt);

  database.rows[0]!.readAt = null;
  const readAllCtx = { ...authed };
  await runHandler(findRoute(router, 'PATCH', '/api/notifications/read-all'), readAllCtx);
  assert.deepEqual(readAllCtx.body, { code: 200, data: {} });
  assert.equal(database.rows.find((item) => item.id === 'other')?.readAt, null);

  const deleteCtx = { ...authed, params: { id: 'notification-1' } };
  await runHandler(findRoute(router, 'DELETE', '/api/notifications/:id'), deleteCtx);
  assert.deepEqual(deleteCtx.body, { code: 200, data: {} });
  assert.ok(database.rows.find((item) => item.id === 'notification-1')?.deletedAt);
  assert.equal(database.rows.length, 2, 'DELETE must be a soft delete');
});

test('reading or deleting another recipient notification maps to an indistinguishable 404', async () => {
  const database = createFakeDatabase([
    row({ id: 'other', recipientId: 'user-b', dedupeKey: 'other' }),
  ]);
  const router = new Router();
  registerNotificationRoutes(router, database as unknown as NotificationTransaction);
  const state = { user: { userId: 'user-a', openid: 'openid-a' } };

  for (const [method, path] of [
    ['PATCH', '/api/notifications/:id/read'],
    ['DELETE', '/api/notifications/:id'],
  ] as const) {
    const ctx = await runMappedHandler(findRoute(router, method, path), {
      params: { id: 'other' },
      state,
    });
    assert.equal(ctx.status, 404);
    assert.deepEqual(ctx.body, { statusCode: 404, message: '通知不存在' });
  }
});

test('notification OpenAPI documents pagination, security, enum fields and soft delete', () => {
  const document = openApiDocument as {
    components: { schemas: Record<string, unknown> };
    paths: Record<string, Record<string, unknown>>;
  };
  const item = document.components.schemas.NotificationItem as {
    required: string[];
    properties: Record<string, { type?: string; format?: string; enum?: string[]; nullable?: boolean }>;
  };
  assert.deepEqual(item.properties.bizType.enum, ['forum', 'task', 'mall', 'system']);
  assert.deepEqual(item.required, [
    'id',
    'recipientId',
    'actorId',
    'type',
    'bizType',
    'bizId',
    'title',
    'content',
    'readAt',
    'createdAt',
  ]);
  assert.deepEqual(item.properties.readAt, {
    type: 'string',
    format: 'date-time',
    nullable: true,
  });
  assert.deepEqual(item.properties.createdAt, { type: 'string', format: 'date-time' });

  const list = document.paths['/api/notifications']?.get as {
    security: Array<Record<string, unknown>>;
    parameters: Array<{ name: string; schema: Record<string, unknown> }>;
    responses: Record<string, { content: Record<string, { schema: unknown }> }>;
  };
  assert.deepEqual(list.security, [{ bearerAuth: [] }]);
  assert.deepEqual(
    list.parameters.map((parameter) => [parameter.name, parameter.schema]),
    [
      ['page', { type: 'integer', minimum: 1, maximum: 20001, default: 1 }],
      ['pageSize', { type: 'integer', minimum: 1, maximum: 50, default: 20 }],
    ],
  );
  assert.deepEqual(list.responses['200']?.content['application/json']?.schema, {
    $ref: '#/components/schemas/NotificationListResponse',
  });
  assert.deepEqual(
    (document.components.schemas.NotificationListResponse as { required: string[] }).required,
    ['code', 'data'],
  );
  assert.deepEqual(
    (document.components.schemas.NotificationListData as { required: string[] }).required,
    ['list', 'total', 'page', 'pageSize'],
  );

  for (const [path, method] of [
    ['/api/notifications/unread-count', 'get'],
    ['/api/notifications/read-all', 'patch'],
    ['/api/notifications/{id}/read', 'patch'],
    ['/api/notifications/{id}', 'delete'],
  ] as const) {
    const operation = document.paths[path]?.[method] as {
      security: Array<Record<string, unknown>>;
      description?: string;
    };
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
    if (method === 'delete') assert.match(operation.description ?? '', /软删除/);
  }

  assert.deepEqual(
    (
      document.paths['/api/notifications/unread-count']?.get as {
        responses: Record<string, { content: Record<string, { schema: unknown }> }>;
      }
    ).responses['200']?.content['application/json']?.schema,
    { $ref: '#/components/schemas/NotificationCountResponse' },
  );
  assert.deepEqual(
    (
      document.paths['/api/notifications/read-all']?.patch as {
        responses: Record<string, { content: Record<string, { schema: unknown }> }>;
      }
    ).responses['200']?.content['application/json']?.schema,
    { $ref: '#/components/schemas/EmptySuccessResponse' },
  );
  for (const [path, method] of [
    ['/api/notifications/{id}/read', 'patch'],
    ['/api/notifications/{id}', 'delete'],
  ] as const) {
    const operation = document.paths[path]?.[method] as {
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    };
    assert.deepEqual(operation.responses['200']?.content['application/json']?.schema, {
      $ref: '#/components/schemas/EmptySuccessResponse',
    });
  }
});

test('route handlers preserve HttpError status for the shared error mapper', async () => {
  const router = new Router();
  registerNotificationRoutes(router, {
    notification: {
      updateMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
  } as unknown as NotificationTransaction);
  const ctx = await runMappedHandler(findRoute(router, 'PATCH', '/api/notifications/:id/read'), {
    params: { id: 'missing' },
    state: { user: { userId: 'user-a', openid: 'openid-a' } },
  });

  assert.equal(ctx.status, 404);
  assert.ok(new HttpError(404, '通知不存在') instanceof HttpError);
});
