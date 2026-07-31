import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { HttpError } from '../src/http-error';
import { CreateMallOrderDto } from '../src/modules/mall/mall.dto';
import { MallOrderService } from '../src/modules/mall/mall-order.service';
import { openApiDocument } from '../src/swagger/openapi';
import { parseDto } from '../src/validate';

type OrderRow = {
  id: string;
  itemId: string;
  itemTitle: string;
  itemPrice: string | null;
  itemUnit: string;
  sellerId: string;
  sellerName: string | null;
  sellerAvatar: string | null;
  buyerId: string;
  buyerName: string | null;
  buyerAvatar: string | null;
  contact: string | null;
  clientRequestId: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type NotificationRow = {
  recipientId: string;
  actorId?: string;
  type: string;
  bizType: string;
  bizId?: string;
  title: string;
  content: string;
  dedupeKey: string;
};

type FakeState = {
  orders: OrderRow[];
  notifications: NotificationRow[];
};

function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-1',
    itemId: 'item-1',
    itemTitle: '<b>二手桌</b>',
    itemPrice: '100',
    itemUnit: '元',
    sellerId: 'seller-1',
    sellerName: '卖家',
    sellerAvatar: null,
    buyerId: 'buyer-1',
    buyerName: '买家',
    buyerAvatar: null,
    contact: '13800000000',
    clientRequestId: 'request_1234567890',
    status: 'pending',
    version: 0,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    ...overrides,
  };
}

function cloneState(state: FakeState): FakeState {
  return {
    orders: state.orders.map((row) => ({ ...row })),
    notifications: state.notifications.map((row) => ({ ...row })),
  };
}

function matches(row: OrderRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => row[key as keyof OrderRow] === expected);
}

function createFakeDatabase(options: {
  orders?: OrderRow[];
  failNotification?: boolean;
  forceConflict?: boolean;
  itemTitle?: string;
}) {
  let committed: FakeState = {
    orders: (options.orders ?? []).map((row) => ({ ...row })),
    notifications: [],
  };
  const updateManyCalls: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];

  function txFor(draft: FakeState) {
    return {
      $queryRaw: async () => [],
      mallItem: {
        findFirst: async () => ({
          id: 'item-1',
          title: options.itemTitle ?? '<script>bad()</script>二手桌',
          price: '100',
          unit: '元',
          publisherId: 'seller-1',
          contact: '13800000000',
        }),
      },
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => ({
          name: where.id === 'seller-1' ? '卖家' : '买家',
          avatar: null,
        }),
      },
      mallOrder: {
        findUnique: async ({ where }: { where: Record<string, unknown> }) => {
          if (typeof where.id === 'string') {
            return draft.orders.find((row) => row.id === where.id) ?? null;
          }
          const compound = where.buyerId_clientRequestId as
            | { buyerId: string; clientRequestId: string }
            | undefined;
          return compound
            ? draft.orders.find(
                (row) =>
                  row.buyerId === compound.buyerId &&
                  row.clientRequestId === compound.clientRequestId,
              ) ?? null
            : null;
        },
        findMany: async () => [],
        upsert: async ({
          where,
          create,
        }: {
          where: {
            buyerId_clientRequestId: { buyerId: string; clientRequestId: string };
          };
          create: Record<string, unknown>;
          update: Record<string, never>;
        }) => {
          const compound = where.buyerId_clientRequestId;
          const existing = draft.orders.find(
            (row) =>
              row.buyerId === compound.buyerId &&
              row.clientRequestId === compound.clientRequestId,
          );
          if (existing) return existing;
          const created = order({
            id: `order-${draft.orders.length + 1}`,
            ...create,
            version: Number(create.version ?? 0),
          } as Partial<OrderRow>);
          draft.orders.push(created);
          return created;
        },
        updateMany: async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updateManyCalls.push({ where, data });
          if (options.forceConflict) return { count: 0 };
          const rows = draft.orders.filter((row) => matches(row, where));
          for (const row of rows) {
            row.status = String(data.status);
            if (
              data.version &&
              typeof data.version === 'object' &&
              'increment' in data.version
            ) {
              row.version += Number((data.version as { increment: number }).increment);
            }
            row.updatedAt = new Date();
          }
          return { count: rows.length };
        },
      },
      notification: {
        upsert: async ({ create }: { create: NotificationRow }) => {
          if (options.failNotification) throw new Error('notification write failed');
          const existing = draft.notifications.find(
            (row) =>
              row.recipientId === create.recipientId &&
              row.dedupeKey === create.dedupeKey,
          );
          if (existing) return existing;
          draft.notifications.push({ ...create });
          return create;
        },
      },
    };
  }

  const database = {
    mallOrder: {
      findMany: async () => [],
      findUnique: async ({ where }: { where: Record<string, unknown> }) =>
        committed.orders.find((row) => row.id === where.id) ?? null,
    },
    $transaction: async <T>(callback: (tx: ReturnType<typeof txFor>) => Promise<T>) => {
      const draft = cloneState(committed);
      const result = await callback(txFor(draft));
      committed = draft;
      return result;
    },
  };

  return {
    database,
    get state() {
      return committed;
    },
    updateManyCalls,
  };
}

async function expectHttpError(
  action: () => Promise<unknown>,
  status: number,
  message: RegExp,
) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.status, status);
    assert.match(error.message, message);
    return true;
  });
}

test('buyer order creation notifies seller in the same transaction without sensitive details', async () => {
  const fake = createFakeDatabase({});
  const service = new MallOrderService(fake.database as never);

  const result = await service.createOrder({
    buyerId: 'buyer-1',
    itemId: 'item-1',
    buyerContact: '  买家微信 buyer_001  ',
    clientRequestId: 'request_1234567890',
  });

  assert.equal(result.orderId, 'order-1');
  assert.equal(fake.state.orders.length, 1);
  assert.deepEqual(fake.state.notifications, [
    {
      recipientId: 'seller-1',
      actorId: 'buyer-1',
      type: 'MALL_ORDER_CREATED',
      bizType: 'mall',
      bizId: 'order-1',
      title: '二手桌',
      content: '买家已下单，请及时处理',
      dedupeKey: 'mall:order-1:MALL_ORDER_CREATED:0:recipient:seller-1',
    },
  ]);
  const serialized = JSON.stringify(fake.state.notifications[0]);
  assert.doesNotMatch(serialized, /buyer_001|13800000000|100|元/);
  assert.doesNotMatch(serialized, /<script>|<b>/);
});

test('notification failure rolls back order creation', async () => {
  const fake = createFakeDatabase({ failNotification: true });
  const service = new MallOrderService(fake.database as never);

  await assert.rejects(
    service.createOrder({
      buyerId: 'buyer-1',
      itemId: 'item-1',
      clientRequestId: 'request_1234567890',
    }),
    /notification write failed/,
  );
  assert.equal(fake.state.orders.length, 0);
  assert.equal(fake.state.notifications.length, 0);
});

test('order notification titles suppress nested and cross-closed dangerous markup bodies', async () => {
  const fake = createFakeDatabase({
    itemTitle: '安全前<script><style>hidden</script>LEAK</style>安全后',
  });
  const service = new MallOrderService(fake.database as never);

  await service.createOrder({
    buyerId: 'buyer-1',
    itemId: 'item-1',
    clientRequestId: 'request_1234567890',
  });

  assert.equal(fake.state.notifications[0]?.title, '安全前安全后');
});

for (const scenario of [
  {
    name: 'buyer cancellation notifies seller',
    actorId: 'buyer-1',
    status: 'cancelled' as const,
    recipientId: 'seller-1',
    type: 'MALL_ORDER_CANCELLED',
    content: '买家已取消订单',
  },
  {
    name: 'seller cancellation notifies buyer',
    actorId: 'seller-1',
    status: 'cancelled' as const,
    recipientId: 'buyer-1',
    type: 'MALL_ORDER_CANCELLED',
    content: '卖家已取消订单',
  },
  {
    name: 'seller completion notifies buyer',
    actorId: 'seller-1',
    status: 'completed' as const,
    recipientId: 'buyer-1',
    type: 'MALL_ORDER_STATUS_CHANGED',
    content: '卖家已将订单标记为完成',
  },
]) {
  test(scenario.name, async () => {
    const fake = createFakeDatabase({ orders: [order()] });
    const service = new MallOrderService(fake.database as never);

    const result = await service.updateOrderStatus({
      userId: scenario.actorId,
      orderId: 'order-1',
      status: scenario.status,
    });

    assert.equal(result.status, scenario.status);
    assert.equal(fake.state.orders[0]?.version, 1);
    assert.equal(fake.state.notifications.length, 1);
    assert.deepEqual(fake.state.notifications[0], {
      recipientId: scenario.recipientId,
      actorId: scenario.actorId,
      type: scenario.type,
      bizType: 'mall',
      bizId: 'order-1',
      title: '二手桌',
      content: scenario.content,
      dedupeKey: `mall:order-1:${scenario.type}:1:recipient:${scenario.recipientId}`,
    });
    assert.notEqual(fake.state.notifications[0]?.recipientId, scenario.actorId);
    assert.deepEqual(fake.updateManyCalls[0]?.where, {
      id: 'order-1',
      status: 'pending',
      version: 0,
      sellerId: 'seller-1',
      buyerId: 'buyer-1',
    });
    assert.deepEqual(fake.updateManyCalls[0]?.data, {
      status: scenario.status,
      version: { increment: 1 },
    });
  });
}

test('buyer cannot complete an order and an unrelated user cannot mutate it', async () => {
  for (const [userId, status, expectedStatus, message] of [
    ['buyer-1', 'completed', 403, /仅卖家/],
    ['stranger', 'cancelled', 403, /无权限/],
  ] as const) {
    const fake = createFakeDatabase({ orders: [order()] });
    const service = new MallOrderService(fake.database as never);
    await expectHttpError(
      () =>
        service.updateOrderStatus({
          userId,
          orderId: 'order-1',
          status,
        }),
      expectedStatus,
      message,
    );
    assert.equal(fake.state.orders[0]?.status, 'pending');
    assert.equal(fake.state.notifications.length, 0);
  }
});

for (const terminalStatus of ['completed', 'cancelled']) {
  test(`${terminalStatus} order rejects every further transition`, async () => {
    for (const actorId of ['buyer-1', 'seller-1']) {
      for (const target of ['completed', 'cancelled'] as const) {
        const fake = createFakeDatabase({ orders: [order({ status: terminalStatus, version: 4 })] });
        const service = new MallOrderService(fake.database as never);
        await expectHttpError(
          () => service.updateOrderStatus({ userId: actorId, orderId: 'order-1', status: target }),
          409,
          /状态已变化/,
        );
        assert.equal(fake.state.notifications.length, 0);
      }
    }
  });
}

test('a concurrent loser receives 409 and cannot write a duplicate notification', async () => {
  const fake = createFakeDatabase({ orders: [order()], forceConflict: true });
  const service = new MallOrderService(fake.database as never);

  await expectHttpError(
    () =>
      service.updateOrderStatus({
        userId: 'seller-1',
        orderId: 'order-1',
        status: 'completed',
      }),
    409,
    /刷新后重试/,
  );
  assert.equal(fake.state.orders[0]?.version, 0);
  assert.equal(fake.state.notifications.length, 0);
});

test('two real concurrent status requests cross the same read barrier and exactly one CAS wins', async () => {
  const shared = {
    order: order(),
    notifications: [] as NotificationRow[],
  };
  let initialReads = 0;
  let releaseReads!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const tx = {
    mallOrder: {
      findUnique: async () => {
        if (shared.order.version === 0 && initialReads < 2) {
          initialReads += 1;
          if (initialReads === 2) releaseReads();
          await bothRead;
          return { ...shared.order };
        }
        return { ...shared.order };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: { status: string; version: { increment: number } };
      }) => {
        if (!matches(shared.order, where)) return { count: 0 };
        shared.order.status = data.status;
        shared.order.version += data.version.increment;
        return { count: 1 };
      },
    },
    notification: {
      upsert: async ({ create }: { create: NotificationRow }) => {
        const existing = shared.notifications.find(
          (row) =>
            row.recipientId === create.recipientId &&
            row.dedupeKey === create.dedupeKey,
        );
        if (existing) return existing;
        shared.notifications.push({ ...create });
        return create;
      },
    },
  };
  const database = {
    mallOrder: {
      findMany: async () => [],
      findUnique: async () => ({ ...shared.order }),
    },
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
  };
  const service = new MallOrderService(database as never);

  const settled = await Promise.allSettled([
    service.updateOrderStatus({
      userId: 'seller-1',
      orderId: 'order-1',
      status: 'completed',
    }),
    service.updateOrderStatus({
      userId: 'seller-1',
      orderId: 'order-1',
      status: 'cancelled',
    }),
  ]);

  assert.equal(settled.filter((result) => result.status === 'fulfilled').length, 1);
  const loser = settled.find((result) => result.status === 'rejected');
  assert.ok(loser && loser.status === 'rejected');
  assert.ok(loser.reason instanceof HttpError);
  assert.equal(loser.reason.status, 409);
  assert.equal(shared.order.version, 1);
  assert.equal(shared.notifications.length, 1);
});

test('repeating an already applied intent cannot advance version or duplicate notification', async () => {
  const fake = createFakeDatabase({ orders: [order({ version: 7 })] });
  const service = new MallOrderService(fake.database as never);

  await service.updateOrderStatus({
    userId: 'seller-1',
    orderId: 'order-1',
    status: 'completed',
  });
  await expectHttpError(
    () =>
      service.updateOrderStatus({
        userId: 'seller-1',
        orderId: 'order-1',
        status: 'completed',
      }),
    409,
    /状态已变化/,
  );

  assert.equal(fake.state.orders[0]?.version, 8);
  assert.equal(fake.state.notifications.length, 1);
  assert.match(fake.state.notifications[0]?.dedupeKey ?? '', /:8:recipient:buyer-1$/);
});

test('notification failure rolls back status and version changes', async () => {
  const fake = createFakeDatabase({ orders: [order()], failNotification: true });
  const service = new MallOrderService(fake.database as never);

  await assert.rejects(
    service.updateOrderStatus({
      userId: 'seller-1',
      orderId: 'order-1',
      status: 'completed',
    }),
    /notification write failed/,
  );
  assert.equal(fake.state.orders[0]?.status, 'pending');
  assert.equal(fake.state.orders[0]?.version, 0);
  assert.equal(fake.state.notifications.length, 0);
});

test('order creation trusts only the database item and normalizes buyer contact', async () => {
  const fake = createFakeDatabase({});
  const service = new MallOrderService(fake.database as never);

  await service.createOrder({
    buyerId: 'buyer-1',
    itemId: 'item-1',
    clientRequestId: 'request_1234567890',
    buyerContact: '  buyer_wechat  ',
    sellerId: 'attacker',
    itemTitle: '伪造标题',
    itemPrice: '0.01',
    itemUnit: '免费',
  } as never);

  assert.deepEqual(
    {
      sellerId: fake.state.orders[0]?.sellerId,
      itemTitle: fake.state.orders[0]?.itemTitle,
      itemPrice: fake.state.orders[0]?.itemPrice,
      itemUnit: fake.state.orders[0]?.itemUnit,
      contact: fake.state.orders[0]?.contact,
    },
    {
      sellerId: 'seller-1',
      itemTitle: '<script>bad()</script>二手桌',
      itemPrice: '100',
      itemUnit: '元',
      contact: 'buyer_wechat',
    },
  );
  assert.equal(fake.state.notifications[0]?.title, '二手桌');
});

test('same buyer and request key create exactly one order and one notification', async () => {
  const fake = createFakeDatabase({});
  const service = new MallOrderService(fake.database as never);
  const input = {
    buyerId: 'buyer-1',
    itemId: 'item-1',
    clientRequestId: 'request_1234567890',
    buyerContact: 'buyer_wechat',
  };

  const first = await service.createOrder(input);
  const second = await service.createOrder(input);

  assert.deepEqual(second, first);
  assert.equal(fake.state.orders.length, 1);
  assert.equal(fake.state.notifications.length, 1);
});

test('two concurrent creates crossing the same preflight barrier converge on one compound upsert', async () => {
  const shared: FakeState = { orders: [], notifications: [] };
  let preflightReads = 0;
  let release!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    release = resolve;
  });
  const findByWhere = (where: Record<string, unknown>) => {
    const compound = where.buyerId_clientRequestId as
      | { buyerId: string; clientRequestId: string }
      | undefined;
    return compound
      ? shared.orders.find(
          (row) =>
            row.buyerId === compound.buyerId &&
            row.clientRequestId === compound.clientRequestId,
        ) ?? null
      : null;
  };
  const tx = {
    $queryRaw: async () => [],
    mallItem: {
      findFirst: async () => ({
        id: 'item-1',
        title: '二手桌',
        price: '100',
        unit: '元',
        publisherId: 'seller-1',
      }),
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        name: where.id,
        avatar: null,
      }),
    },
    mallOrder: {
      findUnique: async ({ where }: { where: Record<string, unknown> }) => {
        preflightReads += 1;
        if (preflightReads === 2) release();
        await bothRead;
        return findByWhere(where);
      },
      upsert: async ({
        where,
        create,
      }: {
        where: Record<string, unknown>;
        create: Record<string, unknown>;
      }) => {
        const existing = findByWhere(where);
        if (existing) return existing;
        const created = order({
          id: 'order-shared',
          ...create,
          version: 0,
        } as Partial<OrderRow>);
        shared.orders.push(created);
        return created;
      },
    },
    notification: {
      upsert: async ({ create }: { create: NotificationRow }) => {
        const existing = shared.notifications.find(
          (row) =>
            row.recipientId === create.recipientId &&
            row.dedupeKey === create.dedupeKey,
        );
        if (existing) return existing;
        shared.notifications.push({ ...create });
        return create;
      },
    },
  };
  const database = {
    mallOrder: {
      findMany: async () => [],
      findUnique: async () => null,
    },
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
  };
  const service = new MallOrderService(database as never);
  const input = {
    buyerId: 'buyer-1',
    itemId: 'item-1',
    clientRequestId: 'request_1234567890',
  };

  const results = await Promise.all([service.createOrder(input), service.createOrder(input)]);

  assert.deepEqual(results, [
    { orderId: 'order-shared' },
    { orderId: 'order-shared' },
  ]);
  assert.equal(shared.orders.length, 1);
  assert.equal(shared.notifications.length, 1);
});

test('same buyer and request key with changed request is rejected with 409', async () => {
  const fake = createFakeDatabase({});
  const service = new MallOrderService(fake.database as never);
  await service.createOrder({
    buyerId: 'buyer-1',
    itemId: 'item-1',
    clientRequestId: 'request_1234567890',
    buyerContact: 'buyer_wechat',
  });

  await expectHttpError(
    () =>
      service.createOrder({
        buyerId: 'buyer-1',
        itemId: 'item-1',
        clientRequestId: 'request_1234567890',
        buyerContact: 'changed_contact',
      }),
    409,
    /幂等键/,
  );
  assert.equal(fake.state.orders.length, 1);
  assert.equal(fake.state.notifications.length, 1);
});

test('different buyers may reuse the same client request key', async () => {
  const fake = createFakeDatabase({});
  const service = new MallOrderService(fake.database as never);
  for (const buyerId of ['buyer-1', 'buyer-2']) {
    await service.createOrder({
      buyerId,
      itemId: 'item-1',
      clientRequestId: 'request_1234567890',
    });
  }
  assert.equal(fake.state.orders.length, 2);
  assert.equal(fake.state.notifications.length, 2);
});

test('create order DTO requires a valid request key and rejects forged item snapshot fields', async () => {
  await assert.rejects(parseDto(CreateMallOrderDto, { itemId: 'item-1' }), /clientRequestId/);
  await assert.rejects(
    parseDto(CreateMallOrderDto, {
      itemId: 'item-1',
      clientRequestId: 'short',
    }),
    /clientRequestId/,
  );
  await assert.rejects(
    parseDto(CreateMallOrderDto, {
      itemId: 'item-1',
      clientRequestId: 'request_1234567890',
      sellerId: 'attacker',
    }),
    /should not exist/,
  );
  await assert.rejects(
    parseDto(CreateMallOrderDto, {
      itemId: 'item-1',
      clientRequestId: 'request_1234567890',
      buyerContact: '   ',
    }),
    /buyerContact/,
  );
});

test('schema and pending notification migration add MallOrder version exactly once', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20260726130000_add_notification_center/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const model = schema.match(/model MallOrder \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(model, /\n\s+version\s+Int\s+@default\(0\)/);
  assert.match(model, /\n\s+clientRequestId\s+String\s+@db\.VarChar\(64\)/);
  assert.match(model, /@@unique\(\[buyerId, clientRequestId\]\)/);
  assert.equal(
    (migration.match(/ALTER TABLE `mall_orders` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0;/g) ?? [])
      .length,
    1,
  );
  assert.match(migration, /ADD COLUMN `clientRequestId` VARCHAR\(64\) NULL/);
  assert.match(
    migration,
    /UPDATE `mall_orders`\s+SET `clientRequestId` = CONCAT\('legacy_', LEFT\(SHA2\(`id`, 256\), 56\)\)/,
  );
  assert.doesNotMatch(migration, /CONCAT\('legacy:', `id`\)/);
  assert.match(migration, /MODIFY `clientRequestId` VARCHAR\(64\) NOT NULL/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX `mall_orders_buyerId_clientRequestId_key` ON `mall_orders`\(`buyerId`, `clientRequestId`\)/,
  );
});

test('admin routes expose no MallOrder mutation bypass', async () => {
  const adminRoutes = await readFile(new URL('../src/routes/admin.routes.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(adminRoutes, /\.mallOrder\.(?:update|updateMany|delete|deleteMany|create)/);
  assert.doesNotMatch(adminRoutes, /\/api\/admin\/(?:mall-)?orders/);
});

test('OpenAPI documents create idempotency and order conflict responses', () => {
  const createSchema =
    openApiDocument.components.schemas.CreateMallOrderBody as {
      required?: string[];
      additionalProperties?: boolean;
      properties?: Record<string, unknown>;
    };
  assert.deepEqual(createSchema.required, ['itemId', 'clientRequestId']);
  assert.equal(createSchema.additionalProperties, false);
  assert.ok(createSchema.properties?.buyerContact);
  for (const operation of [
    openApiDocument.paths['/api/orders']?.post,
    openApiDocument.paths['/api/orders/{orderId}']?.patch,
  ]) {
    assert.ok(operation?.responses?.['409']);
  }
});
