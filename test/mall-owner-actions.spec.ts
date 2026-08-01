import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import Router from '@koa/router';
import type Koa from 'koa';
import { HttpError } from '../src/http-error';
import { prisma } from '../src/lib/prisma';
import { jwtAuth } from '../src/middleware/jwt-auth';
import { MallItemService } from '../src/modules/mall/mall-item.service';
import { registerMallRoutes } from '../src/routes/mall.routes';

type AsyncMethod = (...args: never[]) => Promise<unknown>;

function stubMethod(
  t: { after: (restore: () => void) => void },
  target: object,
  methodName: string,
  implementation: AsyncMethod,
) {
  const methods = target as Record<string, AsyncMethod>;
  const original = methods[methodName];
  methods[methodName] = implementation;
  t.after(() => {
    methods[methodName] = original;
  });
}

function disableRedisForTest(t: { after: (restore: () => void) => void }) {
  const previous = process.env.REDIS_ENABLED;
  process.env.REDIS_ENABLED = '0';
  t.after(() => {
    if (previous === undefined) delete process.env.REDIS_ENABLED;
    else process.env.REDIS_ENABLED = previous;
  });
}

const row = {
  id: 'item-1',
  categoryId: 'flea',
  title: '旧标题',
  price: '10',
  unit: '元',
  desc: '旧描述',
  contact: null,
  locationName: null,
  locationAddress: null,
  latitude: null,
  longitude: null,
  mainImages: null,
  subImages: null,
  videos: null,
  images: null,
  publisherId: 'owner-1',
  publisherName: '业主',
  publisherAvatar: null,
  adminLabel: null,
  visibility: 'ONLINE',
  pinned: false,
  deletedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
};

test('mall owner mutation routes require jwt and use the authenticated user id', async () => {
  const calls: unknown[] = [];
  const service = {
    updateItem: async (params: unknown) => { calls.push(['update', params]); return row; },
    setItemVisibility: async (params: unknown) => { calls.push(['visibility', params]); return row; },
    deleteItem: async (params: unknown) => { calls.push(['delete', params]); return { id: row.id }; },
  };
  const router = new Router();
  registerMallRoutes(router, service as never);
  const cases = [
    ['PATCH', '/api/items/:itemId'],
    ['PATCH', '/api/items/:itemId/visibility'],
    ['DELETE', '/api/items/:itemId'],
  ] as const;

  for (const [method, path] of cases) {
    const layer = router.stack.find((candidate) => candidate.path === path && candidate.methods.includes(method));
    assert.ok(layer, `${method} ${path} must be registered`);
    assert.equal(layer.stack[0], jwtAuth);
    const ctx = {
      state: { user: { userId: 'owner-1', openid: 'openid' } },
      params: { itemId: row.id },
      request: { body: method === 'DELETE' ? undefined : method === 'PATCH' && path.endsWith('visibility') ? { visibility: 'OFFLINE' } : { title: '新标题' } },
    } as unknown as Koa.Context;
    await layer.stack[1](ctx, async () => {});
    assert.equal((ctx.body as { code: number }).code, 200);
  }

  assert.equal(calls.length, 3);
  assert.equal((calls[0] as any)[0], 'update');
  assert.equal((calls[0] as any)[1].userId, 'owner-1');
  assert.equal((calls[0] as any)[1].itemId, 'item-1');
  assert.equal((calls[0] as any)[1].dto.title, '新标题');
  assert.deepEqual(calls[1], [
    'visibility',
    { userId: 'owner-1', itemId: 'item-1', visibility: 'OFFLINE' },
  ]);
  assert.deepEqual(calls[2], ['delete', { userId: 'owner-1', itemId: 'item-1' }]);
});

test('only the publisher can change visibility', async (t) => {
  disableRedisForTest(t);
  stubMethod(t, prisma.mallItem, 'findFirst', async () => row);
  const service = new MallItemService();

  await assert.rejects(
    (service as any).setItemVisibility({ userId: 'other-user', itemId: row.id, visibility: 'OFFLINE' }),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );
});

test('publisher visibility and delete mutations persist state and return server summaries', async (t) => {
  disableRedisForTest(t);
  const updates: unknown[] = [];
  stubMethod(t, prisma.mallItem, 'findFirst', async () => row);
  stubMethod(t, prisma.mallItem, 'update', async (...args: never[]) => {
    const input = args[0] as { data: Record<string, unknown> };
    updates.push(input.data);
    return { ...row, ...input.data, updatedAt: new Date('2026-08-01T01:00:00.000Z') };
  });
  const service = new MallItemService();

  const hidden = await (service as any).setItemVisibility({
    userId: row.publisherId,
    itemId: row.id,
    visibility: 'OFFLINE',
  });
  assert.equal(hidden.visibility, 'OFFLINE');

  const deleted = await (service as any).deleteItem({ userId: row.publisherId, itemId: row.id });
  assert.deepEqual(deleted, { id: row.id, _id: row.id });
  assert.equal(updates.length, 2);
  assert.deepEqual(updates[0], { visibility: 'OFFLINE' });
  assert.ok((updates[1] as { deletedAt?: unknown }).deletedAt instanceof Date);
});

test('publisher can edit existing fields without changing ownership or workflow state', async (t) => {
  disableRedisForTest(t);
  let updateData: Record<string, unknown> | undefined;
  stubMethod(t, prisma.mallItem, 'findFirst', async () => row);
  stubMethod(t, prisma.mallItem, 'update', async (...args: never[]) => {
    const input = args[0] as { data: Record<string, unknown> };
    updateData = input.data;
    return { ...row, ...input.data, updatedAt: new Date('2026-08-01T01:00:00.000Z') };
  });
  const service = new MallItemService();

  const updated = await (service as any).updateItem({
    userId: row.publisherId,
    itemId: row.id,
    dto: { title: ' 新标题 ', desc: ' 新描述 ' },
  });

  assert.equal(updated.title, '新标题');
  assert.equal(updated.desc, '新描述');
  assert.equal(updateData?.publisherId, undefined);
  assert.equal(updateData?.visibility, undefined);
  assert.equal(updateData?.deletedAt, undefined);
});
