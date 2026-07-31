import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { HttpError } from '../src/http-error';
import {
  MAX_NOTIFICATION_PAGE,
  NotificationListQueryDto,
  normalizeNotificationPagination,
} from '../src/modules/notification/notification.dto';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notify,
  softDeleteNotification,
} from '../src/modules/notification/notification.service';
import { parseDto } from '../src/validate';

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

function matchesWhere(row: NotificationRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'readAt' || key === 'deletedAt') return row[key] === value;
    return row[key as keyof NotificationRow] === value;
  });
}

function createFakeTransaction(seed: NotificationRow[] = []) {
  const rows = seed.map((row) => ({ ...row }));
  const calls = {
    upsert: [] as Array<Record<string, unknown>>,
    findMany: [] as Array<Record<string, unknown>>,
    count: [] as Array<Record<string, unknown>>,
    updateMany: [] as Array<Record<string, unknown>>,
  };
  let sequence = rows.length;
  const notification = {
    async upsert(args: Record<string, unknown>) {
      calls.upsert.push(args);
      const where = args.where as {
        recipientId_dedupeKey?: { recipientId: string; dedupeKey: string };
      };
      assert.ok(
        where.recipientId_dedupeKey,
        'notification upsert must use the recipientId_dedupeKey database conflict target',
      );
      const existing = rows.find(
        (row) =>
          row.recipientId === where.recipientId_dedupeKey?.recipientId &&
          row.dedupeKey === where.recipientId_dedupeKey.dedupeKey,
      );
      if (existing) return { ...existing };
      const create = args.create as Omit<NotificationRow, 'id' | 'readAt' | 'deletedAt' | 'createdAt'>;
      const created: NotificationRow = {
        ...create,
        actorId: create.actorId ?? null,
        bizId: create.bizId ?? null,
        id: `notification-${++sequence}`,
        readAt: null,
        deletedAt: null,
        createdAt: new Date(`2026-07-26T00:00:${String(sequence).padStart(2, '0')}.000Z`),
      };
      rows.push(created);
      return { ...created };
    },
    async findMany(args: Record<string, unknown>) {
      calls.findMany.push(args);
      const where = args.where as Record<string, unknown>;
      const skip = args.skip as number;
      const take = args.take as number;
      return rows
        .filter((row) => matchesWhere(row, where))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id))
        .slice(skip, skip + take)
        .map((row) => ({ ...row }));
    },
    async count(args: Record<string, unknown>) {
      calls.count.push(args);
      const where = args.where as Record<string, unknown>;
      return rows.filter((row) => matchesWhere(row, where)).length;
    },
    async updateMany(args: Record<string, unknown>) {
      calls.updateMany.push(args);
      const where = args.where as Record<string, unknown>;
      const data = args.data as Partial<NotificationRow>;
      let count = 0;
      for (const row of rows) {
        if (!matchesWhere(row, where)) continue;
        Object.assign(row, data);
        count += 1;
      }
      return { count };
    },
  };
  return {
    tx: { notification },
    rows,
    calls,
  };
}

function notificationRow(overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: 'notification-1',
    recipientId: 'user-a',
    actorId: 'user-b',
    type: 'FORUM_POST_REPLY',
    bizType: 'forum',
    bizId: 'post-1',
    title: '帖子有新回复',
    content: '回复摘要',
    dedupeKey: 'forum:reply:reply-1:recipient:user-a',
    readAt: null,
    deletedAt: null,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    ...overrides,
  };
}

test('notification schema supports dedupe, unread and soft delete', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const model = schema.slice(schema.indexOf('model Notification'), schema.indexOf('model AdminUser'));

  assert.match(model, /model Notification\s+\{/);
  assert.match(model, /id\s+String\s+@id @default\(cuid\(\)\)/);
  assert.match(model, /recipientId\s+String\s*$/m);
  assert.match(model, /actorId\s+String\?\s*$/m);
  assert.match(model, /type\s+String\s+@db\.VarChar\(48\)/);
  assert.match(model, /bizType\s+String\s+@db\.VarChar\(32\)/);
  assert.match(model, /bizId\s+String\?\s+@db\.VarChar\(191\)/);
  assert.match(model, /title\s+String\s+@db\.VarChar\(191\)/);
  assert.match(model, /content\s+String\s+@db\.Text/);
  assert.match(model, /dedupeKey\s+String\s+@db\.VarChar\(255\)/);
  assert.doesNotMatch(model, /dedupeKey\s+String[^\n]*@unique/);
  assert.match(model, /readAt\s+DateTime\?/);
  assert.match(model, /deletedAt\s+DateTime\?/);
  assert.match(model, /createdAt\s+DateTime\s+@default\(now\(\)\)/);
  assert.match(model, /@@unique\(\[recipientId, dedupeKey\]\)/);
  assert.match(model, /@@index\(\[recipientId, deletedAt, createdAt\]\)/);
  assert.match(model, /@@index\(\[recipientId, readAt, deletedAt\]\)/);
  assert.match(model, /@@index\(\[bizType, bizId\]\)/);
  assert.match(model, /@@map\("notifications"\)/);
});

test('notification migration creates a new indexed table without destructive legacy changes', async () => {
  const migration = await readFile(
    new URL(
      '../prisma/migrations/20260726130000_add_notification_center/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );

  assert.match(migration, /CREATE TABLE `notifications`/);
  assert.match(migration, /`id` VARCHAR\(191\) NOT NULL/);
  assert.match(migration, /`recipientId` VARCHAR\(191\) NOT NULL/);
  assert.match(migration, /`actorId` VARCHAR\(191\) NULL/);
  assert.match(migration, /`type` VARCHAR\(48\) NOT NULL/);
  assert.match(migration, /`bizType` VARCHAR\(32\) NOT NULL/);
  assert.match(migration, /`bizId` VARCHAR\(191\) NULL/);
  assert.match(migration, /`title` VARCHAR\(191\) NOT NULL/);
  assert.match(migration, /`content` TEXT NOT NULL/);
  assert.match(migration, /`dedupeKey` VARCHAR\(255\) NOT NULL/);
  assert.match(migration, /`readAt` DATETIME\(3\) NULL/);
  assert.match(migration, /`deletedAt` DATETIME\(3\) NULL/);
  assert.match(migration, /`createdAt` DATETIME\(3\) NOT NULL DEFAULT CURRENT_TIMESTAMP\(3\)/);
  assert.match(
    migration,
    /UNIQUE INDEX `notifications_recipientId_dedupeKey_key`\(`recipientId`, `dedupeKey`\)/,
  );
  assert.doesNotMatch(migration, /UNIQUE INDEX `notifications_dedupeKey_key`/);
  assert.match(
    migration,
    /INDEX `notifications_recipientId_deletedAt_createdAt_idx`\(`recipientId`, `deletedAt`, `createdAt`\)/,
  );
  assert.match(
    migration,
    /INDEX `notifications_recipientId_readAt_deletedAt_idx`\(`recipientId`, `readAt`, `deletedAt`\)/,
  );
  assert.match(
    migration,
    /INDEX `notifications_bizType_bizId_idx`\(`bizType`, `bizId`\)/,
  );
  assert.match(migration, /PRIMARY KEY \(`id`\)/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|RENAME|TRUNCATE)\b/i);
});

test('notification list DTO applies defaults and rejects unsafe pagination', async () => {
  assert.deepEqual(normalizeNotificationPagination({}), { page: 1, pageSize: 20 });
  assert.deepEqual(normalizeNotificationPagination({ page: 3, pageSize: 50 }), {
    page: 3,
    pageSize: 50,
  });
  assert.deepEqual(
    normalizeNotificationPagination({ page: MAX_NOTIFICATION_PAGE, pageSize: 50 }),
    { page: MAX_NOTIFICATION_PAGE, pageSize: 50 },
  );
  assert.throws(() => normalizeNotificationPagination({ page: 0, pageSize: 20 }), /页码/);
  assert.throws(() => normalizeNotificationPagination({ page: 1.5, pageSize: 20 }), /页码/);
  assert.throws(
    () => normalizeNotificationPagination({ page: MAX_NOTIFICATION_PAGE + 1, pageSize: 1 }),
    /页码/,
  );
  assert.throws(
    () => normalizeNotificationPagination({ page: Number.MAX_SAFE_INTEGER + 1, pageSize: 1 }),
    /页码/,
  );
  assert.throws(() => normalizeNotificationPagination({ page: 1, pageSize: 51 }), /每页/);

  const defaults = await parseDto(NotificationListQueryDto, {});
  assert.equal(defaults.page, 1);
  assert.equal(defaults.pageSize, 20);
  const parsed = await parseDto(NotificationListQueryDto, { page: '2', pageSize: '10' });
  assert.deepEqual({ page: parsed.page, pageSize: parsed.pageSize }, { page: 2, pageSize: 10 });
  await assert.rejects(parseDto(NotificationListQueryDto, { page: '0' }), /页码/);
  await assert.rejects(
    parseDto(NotificationListQueryDto, { page: String(MAX_NOTIFICATION_PAGE + 1) }),
    /页码/,
  );
  await assert.rejects(parseDto(NotificationListQueryDto, { pageSize: '51' }), /每页/);
  await assert.rejects(parseDto(NotificationListQueryDto, { page: '1.5' }), /整数/);
  await assert.rejects(parseDto(NotificationListQueryDto, { unexpected: 'value' }), /should not exist/);
});

test('notify suppresses self notifications before touching the database', async () => {
  const fake = createFakeTransaction();

  const result = await notify(fake.tx as never, {
    recipientId: 'same-user',
    actorId: 'same-user',
    type: 'FORUM_POST_REPLY',
    bizType: 'forum',
    bizId: 'post-1',
    title: '',
    content: '回复摘要',
    dedupeKey: 'forum:reply:reply-1:recipient:same-user',
  });

  assert.equal(result, null);
  assert.equal(fake.calls.upsert.length, 0);
});

test('self notification suppression ignores an otherwise invalid payload without touching Prisma', async () => {
  const fake = createFakeTransaction();

  const result = await notify(fake.tx as never, {
    recipientId: 'same-user',
    actorId: 'same-user',
    type: '',
    bizType: 'unsupported',
    bizId: 'b'.repeat(192),
    title: '题'.repeat(192),
    content: '',
    dedupeKey: 'd'.repeat(256),
  } as never);

  assert.equal(result, null);
  assert.equal(fake.calls.upsert.length, 0);
});

test('non-string recipient or actor values are never mistaken for a self notification', async () => {
  const invalidIdentities = [
    { recipientId: 7, actorId: 7 },
    { recipientId: 'user-a', actorId: 7 },
    { recipientId: null, actorId: null },
  ];

  for (const identity of invalidIdentities) {
    const fake = createFakeTransaction();
    await assert.rejects(
      notify(fake.tx as never, {
        ...identity,
        type: 'SYSTEM_NOTICE',
        bizType: 'system',
        bizId: 'notice-1',
        title: '系统通知',
        content: '通知内容',
        dedupeKey: 'system:notice:notice-1',
      } as never),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
    assert.equal(fake.calls.upsert.length, 0);
  }
});

test('empty self-notification identities are rejected before suppression', async () => {
  const fake = createFakeTransaction();

  await assert.rejects(
    notify(fake.tx as never, {
      recipientId: '',
      actorId: '',
      type: '',
      bizType: 'forum',
      title: '',
      content: '',
      dedupeKey: '',
    }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.equal(fake.calls.upsert.length, 0);
});

test('whitespace or padded self-notification identities are rejected rather than normalized', async () => {
  for (const identity of ['   ', ' user-a ']) {
    const fake = createFakeTransaction();
    await assert.rejects(
      notify(fake.tx as never, {
        recipientId: identity,
        actorId: identity,
        type: '',
        bizType: 'forum',
        title: '',
        content: '',
        dedupeKey: '',
      }),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
    assert.equal(fake.calls.upsert.length, 0);
  }
});

test('matching overlong self-notification identities are rejected before suppression', async () => {
  const fake = createFakeTransaction();
  const overlongId = 'u'.repeat(192);

  await assert.rejects(
    notify(fake.tx as never, {
      recipientId: overlongId,
      actorId: overlongId,
      type: '',
      bizType: 'forum',
      title: '',
      content: '',
      dedupeKey: '',
    }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.equal(fake.calls.upsert.length, 0);
});

test('notify uses the recipient-scoped database upsert target for idempotency', async () => {
  const fake = createFakeTransaction();
  const input = {
    recipientId: 'user-a',
    actorId: 'user-b',
    type: 'FORUM_POST_REPLY',
    bizType: 'forum' as const,
    bizId: 'post-1',
    title: '帖子有新回复',
    content: '回复摘要',
    dedupeKey: 'forum:reply:reply-1:recipient:user-a',
  };

  const first = await notify(fake.tx as never, input);
  const second = await notify(fake.tx as never, input);

  assert.equal(fake.rows.length, 1);
  assert.equal(first?.id, second?.id);
  assert.equal(fake.calls.upsert.length, 2);
  assert.deepEqual(fake.calls.upsert[0], {
    where: {
      recipientId_dedupeKey: {
        recipientId: input.recipientId,
        dedupeKey: input.dedupeKey,
      },
    },
    create: input,
    update: {},
  });
});

test('the same readable business dedupe key creates one notification per recipient', async () => {
  const fake = createFakeTransaction();
  const shared = {
    actorId: 'system-admin',
    type: 'SYSTEM_NOTICE',
    bizType: 'system' as const,
    bizId: 'notice-1',
    title: '系统通知',
    content: '通知内容',
    dedupeKey: 'system:notice:notice-1',
  };

  await notify(fake.tx as never, { ...shared, recipientId: 'user-a' });
  await notify(fake.tx as never, { ...shared, recipientId: 'user-b' });
  await notify(fake.tx as never, { ...shared, recipientId: 'user-a' });

  assert.equal(fake.rows.length, 2);
  assert.deepEqual(
    fake.rows.map((row) => row.recipientId).sort(),
    ['user-a', 'user-b'],
  );
});

test('notify rejects empty or overlong persisted fields before calling Prisma', async () => {
  const base = {
    recipientId: 'user-a',
    actorId: 'user-b',
    type: 'FORUM_POST_REPLY',
    bizType: 'forum' as const,
    bizId: 'post-1',
    title: '帖子有新回复',
    content: '回复摘要',
    dedupeKey: 'forum:reply:reply-1',
  };
  const invalidInputs = [
    { ...base, recipientId: '' },
    { ...base, actorId: 'a'.repeat(192) },
    { ...base, type: '' },
    { ...base, type: 'T'.repeat(49) },
    { ...base, bizType: 'unsupported' },
    { ...base, bizId: 'b'.repeat(192) },
    { ...base, title: '' },
    { ...base, title: '题'.repeat(192) },
    { ...base, content: '' },
    { ...base, content: '😀'.repeat(16_384) },
    { ...base, dedupeKey: '' },
    { ...base, dedupeKey: 'd'.repeat(256) },
  ];

  for (const input of invalidInputs) {
    const fake = createFakeTransaction();
    await assert.rejects(notify(fake.tx as never, input as never), HttpError);
    assert.equal(fake.calls.upsert.length, 0);
  }
});

test('list returns an empty first page with stable pagination metadata', async () => {
  const fake = createFakeTransaction();

  const result = await listNotifications(fake.tx as never, {
    recipientId: 'user-a',
    page: 1,
    pageSize: 20,
  });

  assert.deepEqual(result, { list: [], total: 0, page: 1, pageSize: 20 });
});

test('list returns only the recipient non-deleted rows in stable newest-first pages', async () => {
  const fake = createFakeTransaction([
    notificationRow({ id: 'old', createdAt: new Date('2026-07-26T00:00:00.000Z') }),
    notificationRow({
      id: 'new',
      dedupeKey: 'new',
      createdAt: new Date('2026-07-26T02:00:00.000Z'),
    }),
    notificationRow({
      id: 'deleted',
      dedupeKey: 'deleted',
      deletedAt: new Date('2026-07-26T03:00:00.000Z'),
    }),
    notificationRow({ id: 'other', recipientId: 'user-b', dedupeKey: 'other' }),
  ]);

  const result = await listNotifications(fake.tx as never, {
    recipientId: 'user-a',
    page: 1,
    pageSize: 1,
  });

  assert.equal(result.total, 2);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 1);
  assert.deepEqual(result.list.map((row) => row.id), ['new']);
  assert.equal(result.list[0]?.createdAt, '2026-07-26T02:00:00.000Z');
  assert.deepEqual(fake.calls.findMany[0], {
    where: { recipientId: 'user-a', deletedAt: null },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: 0,
    take: 1,
  });
});

test('list defensively rejects a page beyond the database-safe maximum', async () => {
  const fake = createFakeTransaction();

  await assert.rejects(
    listNotifications(fake.tx as never, {
      recipientId: 'user-a',
      page: MAX_NOTIFICATION_PAGE + 1,
      pageSize: 50,
    }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  assert.equal(fake.calls.findMany.length, 0);
  assert.equal(fake.calls.count.length, 0);
});

test('list accepts the maximum page without exceeding the documented safe offset', async () => {
  const fake = createFakeTransaction();

  const result = await listNotifications(fake.tx as never, {
    recipientId: 'user-a',
    page: MAX_NOTIFICATION_PAGE,
    pageSize: 50,
  });

  assert.equal(result.page, MAX_NOTIFICATION_PAGE);
  assert.equal(fake.calls.findMany[0]?.skip, 1_000_000);
  assert.equal(Number.isSafeInteger(fake.calls.findMany[0]?.skip), true);
});

test('unread count excludes read, deleted and other users notifications', async () => {
  const fake = createFakeTransaction([
    notificationRow({ id: 'unread' }),
    notificationRow({ id: 'read', dedupeKey: 'read', readAt: new Date() }),
    notificationRow({ id: 'deleted', dedupeKey: 'deleted', deletedAt: new Date() }),
    notificationRow({ id: 'other', recipientId: 'user-b', dedupeKey: 'other' }),
  ]);

  assert.equal(await getUnreadNotificationCount(fake.tx as never, 'user-a'), 1);
  assert.deepEqual(fake.calls.count[0], {
    where: { recipientId: 'user-a', readAt: null, deletedAt: null },
  });
});

test('mark read is idempotent and cannot mutate another recipient notification', async () => {
  const fake = createFakeTransaction([
    notificationRow({ id: 'mine' }),
    notificationRow({ id: 'theirs', recipientId: 'user-b', dedupeKey: 'theirs' }),
  ]);
  const firstReadAt = new Date('2026-07-26T04:00:00.000Z');
  const secondReadAt = new Date('2026-07-26T05:00:00.000Z');

  await markNotificationRead(fake.tx as never, {
    recipientId: 'user-a',
    notificationId: 'mine',
    now: firstReadAt,
  });
  await markNotificationRead(fake.tx as never, {
    recipientId: 'user-a',
    notificationId: 'mine',
    now: secondReadAt,
  });

  assert.equal(fake.rows.find((row) => row.id === 'mine')?.readAt, firstReadAt);
  await assert.rejects(
    markNotificationRead(fake.tx as never, {
      recipientId: 'user-a',
      notificationId: 'theirs',
      now: firstReadAt,
    }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.equal(fake.rows.find((row) => row.id === 'theirs')?.readAt, null);
});

test('mark read treats a soft-deleted notification as not found', async () => {
  const fake = createFakeTransaction([
    notificationRow({ id: 'deleted', deletedAt: new Date('2026-07-26T03:00:00.000Z') }),
  ]);

  await assert.rejects(
    markNotificationRead(fake.tx as never, {
      recipientId: 'user-a',
      notificationId: 'deleted',
    }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.notEqual(fake.rows[0]?.readAt, undefined);
  assert.equal(fake.rows[0]?.readAt, null);
});

test('mark all read changes only the recipient visible unread rows', async () => {
  const fake = createFakeTransaction([
    notificationRow({ id: 'mine' }),
    notificationRow({ id: 'already-read', dedupeKey: 'read', readAt: new Date('2026-07-25') }),
    notificationRow({ id: 'deleted', dedupeKey: 'deleted', deletedAt: new Date('2026-07-25') }),
    notificationRow({ id: 'other', recipientId: 'user-b', dedupeKey: 'other' }),
  ]);
  const now = new Date('2026-07-26T06:00:00.000Z');

  const result = await markAllNotificationsRead(fake.tx as never, { recipientId: 'user-a', now });

  assert.deepEqual(result, { count: 1 });
  assert.equal(fake.rows.find((row) => row.id === 'mine')?.readAt, now);
  assert.equal(fake.rows.find((row) => row.id === 'deleted')?.readAt, null);
  assert.equal(fake.rows.find((row) => row.id === 'other')?.readAt, null);
});

test('soft delete never physically deletes and is isolated to the recipient', async () => {
  const fake = createFakeTransaction([
    notificationRow({ id: 'mine' }),
    notificationRow({ id: 'theirs', recipientId: 'user-b', dedupeKey: 'theirs' }),
  ]);
  const now = new Date('2026-07-26T07:00:00.000Z');

  await softDeleteNotification(fake.tx as never, {
    recipientId: 'user-a',
    notificationId: 'mine',
    now,
  });

  assert.equal(fake.rows.length, 2);
  assert.equal(fake.rows.find((row) => row.id === 'mine')?.deletedAt, now);
  await assert.rejects(
    softDeleteNotification(fake.tx as never, {
      recipientId: 'user-a',
      notificationId: 'theirs',
      now,
    }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.equal(fake.rows.find((row) => row.id === 'theirs')?.deletedAt, null);
  assert.equal(await getUnreadNotificationCount(fake.tx as never, 'user-a'), 0);

  await assert.rejects(
    softDeleteNotification(fake.tx as never, {
      recipientId: 'user-a',
      notificationId: 'mine',
      now,
    }),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});
