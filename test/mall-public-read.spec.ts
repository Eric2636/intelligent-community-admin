import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import Router from '@koa/router';
import jwt from 'jsonwebtoken';
import type Koa from 'koa';
import { HttpError } from '../src/http-error';
import { prisma } from '../src/lib/prisma';
import { jwtAuth, optionalJwtAuth } from '../src/middleware/jwt-auth';
import { MallCommentService } from '../src/modules/mall/mall-comment.service';
import { MallItemService } from '../src/modules/mall/mall-item.service';
import { registerMallRoutes } from '../src/routes/mall.routes';

type RouteLayer = {
  path: string;
  methods: string[];
  stack: Array<(ctx: Koa.Context, next: Koa.Next) => Promise<void>>;
};

function findRoute(router: Router, method: string, path: string): RouteLayer {
  const layer = router.stack.find((candidate) => candidate.path === path && candidate.methods.includes(method));
  assert.ok(layer, `${method} ${path} must be registered`);
  return layer as unknown as RouteLayer;
}

function createContext(authorization?: string): Koa.Context {
  return {
    headers: authorization === undefined ? {} : { authorization },
    method: 'GET',
    path: '/api/items/item-1',
    state: {},
    query: {},
    params: { itemId: 'item-1' },
  } as unknown as Koa.Context;
}

async function runMiddleware(middleware: RouteLayer['stack'][number], ctx: Koa.Context) {
  let nextCalls = 0;
  await middleware(ctx, async () => {
    nextCalls += 1;
  });
  return nextCalls;
}

type AsyncMethod = (...args: never[]) => Promise<unknown>;

function stubMethod(
  t: { after: (restore: () => void) => void },
  target: object,
  methodName: string,
  implementation: AsyncMethod,
) {
  const methods = target as Record<string, AsyncMethod>;
  const original = methods[methodName];
  let calls = 0;
  methods[methodName] = async (...args: never[]) => {
    calls += 1;
    return implementation(...args);
  };
  t.after(() => {
    methods[methodName] = original;
  });
  return { callCount: () => calls };
}

function disableRedisForTest(t: { after: (restore: () => void) => void }) {
  const previous = process.env.REDIS_ENABLED;
  process.env.REDIS_ENABLED = '0';
  t.after(() => {
    if (previous === undefined) delete process.env.REDIS_ENABLED;
    else process.env.REDIS_ENABLED = previous;
  });
}

const offlineItem = {
  id: 'item-1',
  categoryId: 'flea',
  title: 'offline item',
  price: '1',
  unit: '元',
  desc: '',
  contact: null,
  locationName: null,
  locationAddress: null,
  latitude: null,
  longitude: null,
  mainImages: null,
  subImages: null,
  videos: null,
  images: null,
  publisherId: 'publisher-1',
  publisherName: 'publisher',
  publisherAvatar: null,
  visibility: 'OFFLINE',
  pinned: false,
  deletedAt: null,
  createdAt: new Date('2026-07-26T00:00:00.000Z'),
  updatedAt: new Date('2026-07-26T00:00:00.000Z'),
};

const commentRow = {
  id: 'comment-1',
  itemId: 'item-1',
  userId: 'commenter-1',
  parentId: null,
  replyToAuthorName: null,
  replyToUserId: null,
  authorName: 'commenter',
  authorAvatar: null,
  content: 'hello',
  images: null,
  createdAt: new Date('2026-07-26T00:00:00.000Z'),
};

test('mall public reads use optional auth while writes and personal reads keep required auth', () => {
  const router = new Router();
  registerMallRoutes(router, {} as never);

  const publicReads = [
    ['GET', '/api/categories'],
    ['GET', '/api/items'],
    ['GET', '/api/items/:itemId'],
    ['GET', '/api/items/:itemId/comments'],
  ];
  for (const [method, path] of publicReads) {
    assert.equal(findRoute(router, method, path).stack[0], optionalJwtAuth, `${method} ${path} must allow guests`);
  }

  const privateRoutes = [
    ['GET', '/api/items/my'],
    ['GET', '/api/items/my-favorites'],
    ['POST', '/api/items'],
    ['POST', '/api/items/:itemId/favorite'],
    ['DELETE', '/api/items/:itemId/favorite'],
    ['POST', '/api/orders'],
    ['GET', '/api/orders/my'],
    ['GET', '/api/orders/:orderId'],
    ['PATCH', '/api/orders/:orderId'],
    ['POST', '/api/items/:itemId/comments'],
    ['DELETE', '/api/items/:itemId/comments/:commentId'],
    ['POST', '/api/items/:itemId/comments/:commentId/like'],
    ['DELETE', '/api/items/:itemId/comments/:commentId/like'],
  ];
  for (const [method, path] of privateRoutes) {
    assert.equal(findRoute(router, method, path).stack[0], jwtAuth, `${method} ${path} must require login`);
  }
});

test('optional auth treats missing, empty, expired, and invalid-signature tokens as guests', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'mall-public-read-test-secret';
  try {
    const expired = jwt.sign({ sub: 'expired-user', openid: 'expired-openid' }, process.env.JWT_SECRET, {
      expiresIn: -1,
    });
    const invalidSignature = jwt.sign({ sub: 'wrong-user', openid: 'wrong-openid' }, 'different-secret');

    for (const authorization of [undefined, 'Bearer ', `Bearer ${expired}`, `Bearer ${invalidSignature}`]) {
      const ctx = createContext(authorization);
      assert.equal(await runMiddleware(optionalJwtAuth, ctx), 1);
      assert.equal(ctx.state.user, undefined);
      assert.notEqual(ctx.status, 401);
    }
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('optional auth preserves a valid user for personalized public reads', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'mall-public-read-test-secret';
  try {
    const token = jwt.sign({ sub: 'valid-user', openid: 'valid-openid' }, process.env.JWT_SECRET);
    const ctx = createContext(`Bearer ${token}`);

    assert.equal(await runMiddleware(optionalJwtAuth, ctx), 1);
    assert.deepEqual(ctx.state.user, { userId: 'valid-user', openid: 'valid-openid' });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('optional auth returns 500 instead of hiding a missing JWT_SECRET', async () => {
  const previousSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;
  try {
    const ctx = createContext('Bearer syntactically-present-token');

    assert.equal(await runMiddleware(optionalJwtAuth, ctx), 0);
    assert.equal(ctx.status, 500);
    assert.deepEqual(ctx.body, { statusCode: 500, message: 'JWT_SECRET 未配置' });
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('required auth preserves missing-header and empty-bearer failure reasons', async () => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'mall-public-read-test-secret';
  try {
    const missingCtx = createContext();
    await runMiddleware(jwtAuth, missingCtx);
    assert.equal((missingCtx.body as { reason?: string }).reason, 'missing_bearer');

    const emptyCtx = createContext('Bearer ');
    await runMiddleware(jwtAuth, emptyCtx);
    assert.equal((emptyCtx.body as { reason?: string }).reason, 'token_invalid');
  } finally {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  }
});

test('public list, detail and comments pass userId only when optional auth resolved a valid user', async () => {
  const listCalls: unknown[] = [];
  const detailCalls: unknown[] = [];
  const commentCalls: unknown[] = [];
  const service = {
    listItems: async (params: unknown) => {
      listCalls.push(params);
      return [];
    },
    getItemDetail: async (params: unknown) => {
      detailCalls.push(params);
      return {};
    },
    listItemComments: async (params: unknown) => {
      commentCalls.push(params);
      return [];
    },
  };
  const router = new Router();
  registerMallRoutes(router, service as never);

  for (const userId of [undefined, 'valid-user']) {
    const state = userId ? { user: { userId, openid: 'openid' } } : {};
    const listCtx = { ...createContext(), path: '/api/items', params: {}, state };
    await findRoute(router, 'GET', '/api/items').stack[1](listCtx, async () => {});

    const detailCtx = { ...createContext(), state };
    await findRoute(router, 'GET', '/api/items/:itemId').stack[1](detailCtx, async () => {});

    const commentsCtx = { ...createContext(), state };
    await findRoute(router, 'GET', '/api/items/:itemId/comments').stack[1](commentsCtx, async () => {});
  }

  assert.deepEqual(listCalls, [
    { categoryId: undefined, keyword: undefined, orderBy: undefined, userId: undefined },
    { categoryId: undefined, keyword: undefined, orderBy: undefined, userId: 'valid-user' },
  ]);
  assert.deepEqual(detailCalls, [
    { itemId: 'item-1', userId: undefined },
    { itemId: 'item-1', userId: 'valid-user' },
  ]);
  assert.deepEqual(commentCalls, [
    { itemId: 'item-1', userId: undefined },
    { itemId: 'item-1', userId: 'valid-user' },
  ]);
});

test('offline item detail is hidden from guests but visible to its publisher', async (t) => {
  disableRedisForTest(t);
  stubMethod(t, prisma.mallItem, 'findFirst', async () => offlineItem);
  const favoriteLookup = stubMethod(t, prisma.mallItemFavorite, 'findUnique', async () => null);
  const service = new MallItemService();

  await assert.rejects(
    service.getItemDetail({ itemId: offlineItem.id }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.equal(favoriteLookup.callCount(), 0, 'guest detail must not query favorites');

  const detail = await service.getItemDetail({ itemId: offlineItem.id, userId: offlineItem.publisherId });
  assert.equal(detail.id, offlineItem.id);
  assert.equal(detail.isFavorited, false);
  assert.equal(favoriteLookup.callCount(), 1);
});

test('mall list overlays favorites only for a logged-in user and guests skip the personalized query', async (t) => {
  disableRedisForTest(t);
  stubMethod(t, prisma.mallItem, 'findMany', async () => [{ ...offlineItem, visibility: 'ONLINE' }]);
  const favoritesLookup = stubMethod(t, prisma.mallItemFavorite, 'findMany', async () => [
    { itemId: offlineItem.id },
  ]);
  const service = new MallItemService();

  const guestItems = await service.listItems({});
  assert.equal(guestItems[0]?.isFavorited, false);
  assert.equal(favoritesLookup.callCount(), 0, 'guest list must not query user favorites');

  const authedItems = await service.listItems({ userId: 'valid-user' });
  assert.equal(authedItems[0]?.isFavorited, true);
  assert.equal(favoritesLookup.callCount(), 1);
});

test('offline item comments are hidden from guests but visible to its publisher', async (t) => {
  stubMethod(t, prisma.mallItem, 'findFirst', async () => offlineItem);
  const commentsLookup = stubMethod(t, prisma.mallItemComment, 'findMany', async () => [commentRow]);
  stubMethod(t, prisma.mallItemCommentLike, 'groupBy', async () => []);
  stubMethod(t, prisma.mallItemCommentLike, 'findMany', async () => []);
  const service = new MallCommentService();

  await assert.rejects(
    service.listItemComments({ itemId: offlineItem.id }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.equal(commentsLookup.callCount(), 0, 'hidden item must be rejected before comments are queried');

  const comments = await service.listItemComments({
    itemId: offlineItem.id,
    userId: offlineItem.publisherId,
  });
  assert.equal(comments.length, 1);
});

test('guest comments never query personalized likes and serialize liked=false', async (t) => {
  stubMethod(t, prisma.mallItem, 'findFirst', async () => ({ ...offlineItem, visibility: 'ONLINE' }));
  stubMethod(t, prisma.mallItemComment, 'findMany', async () => [commentRow]);
  stubMethod(t, prisma.mallItemCommentLike, 'groupBy', async () => []);
  const myLikesLookup = stubMethod(t, prisma.mallItemCommentLike, 'findMany', async () => {
    throw new Error('guest must not query personalized likes');
  });
  const service = new MallCommentService();

  const comments = await service.listItemComments({ itemId: offlineItem.id });
  assert.equal(comments[0]?.liked, false);
  assert.equal(myLikesLookup.callCount(), 0);
});

test('static mall personal routes are registered before matching parameter routes', () => {
  const router = new Router();
  registerMallRoutes(router, {} as never);
  const routeIndex = (method: string, path: string) =>
    router.stack.findIndex((layer) => layer.path === path && layer.methods.includes(method));

  assert.ok(routeIndex('GET', '/api/items/my') < routeIndex('GET', '/api/items/:itemId'));
  assert.ok(routeIndex('GET', '/api/items/my-favorites') < routeIndex('GET', '/api/items/:itemId'));
  assert.ok(routeIndex('GET', '/api/orders/my') < routeIndex('GET', '/api/orders/:orderId'));
});
