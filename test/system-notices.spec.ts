import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import Router from '@koa/router';
import jwt from 'jsonwebtoken';
import { parseDto } from '../src/validate';
import { CreateSystemNoticeDto } from '../src/modules/notification/system-notice.dto';
import {
  publishSystemNotice,
  type SystemNoticeDatabase,
} from '../src/modules/notification/system-notice.service';
import { registerAdminSystemNoticeRoute } from '../src/routes/admin-system-notice.routes';
import { errorHandler } from '../src/middleware/error-handler';
import { openApiDocument } from '../src/swagger/openapi';

type UserRow = { id: string; enabled: boolean };
type NoticeRow = Record<string, unknown> & { recipientId: string; dedupeKey: string };

function createFakeDatabase(
  users: UserRow[],
  options: { failCreateManyAt?: number; existing?: NoticeRow[] } = {},
) {
  let failedCreateMany = false;
  const state = {
    notifications: [...(options.existing ?? [])],
    logs: [] as Array<Record<string, unknown>>,
    findCalls: [] as Array<Record<string, unknown>>,
    createManyCalls: [] as Array<Record<string, unknown>>,
    transactionOptions: undefined as Record<string, unknown> | undefined,
    publications: [] as Array<{
      id: string;
      adminId: string;
      payloadHash: string;
      recipientCount: number;
      createdAt: Date;
    }>,
  };

  const database = {
    async $transaction<T>(
      work: (tx: any) => Promise<T>,
      transactionOptions?: Record<string, unknown>,
    ) {
      state.transactionOptions = transactionOptions;
      const snapshot = structuredClone(state);
      try {
        return await work({
          systemNoticePublication: {
            create: async ({ data }: any) => {
              if (state.publications.some((row) => row.id === data.id)) {
                throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
              }
              const row = { ...data, recipientCount: 0, createdAt: new Date() };
              state.publications.push(row);
              return row;
            },
            update: async ({ where, data }: any) => {
              const row = state.publications.find((item) => item.id === where.id);
              assert.ok(row);
              Object.assign(row, data);
              return row;
            },
          },
          user: {
            findMany: async (args: any) => {
              state.findCalls.push(args);
              const cursorId = args.cursor?.id as string | undefined;
              const ordered = users
                .filter((row) => row.enabled === true)
                .sort((a, b) => a.id.localeCompare(b.id));
              const start = cursorId
                ? Math.max(0, ordered.findIndex((row) => row.id === cursorId) + (args.skip ?? 0))
                : 0;
              return ordered.slice(start, start + args.take).map(({ id }) => ({ id }));
            },
          },
          notification: {
            createMany: async (args: any) => {
              state.createManyCalls.push(args);
              if (
                options.failCreateManyAt &&
                state.createManyCalls.length === options.failCreateManyAt &&
                !failedCreateMany
              ) {
                failedCreateMany = true;
                throw new Error('createMany failed');
              }
              let count = 0;
              for (const row of args.data as NoticeRow[]) {
                const duplicate = state.notifications.some(
                  (item) =>
                    item.recipientId === row.recipientId &&
                    item.dedupeKey === row.dedupeKey,
                );
                if (!duplicate) {
                  state.notifications.push(row);
                  count += 1;
                }
              }
              return { count };
            },
          },
          adminSystemLog: {
            create: async ({ data }: any) => {
              state.logs.push(data);
              return data;
            },
          },
        });
      } catch (error) {
        state.notifications = snapshot.notifications;
        state.logs = snapshot.logs;
        state.findCalls = snapshot.findCalls;
        state.createManyCalls = snapshot.createManyCalls;
        state.publications = snapshot.publications;
        throw error;
      }
    },
    systemNoticePublication: {
      findUnique: async ({ where }: any) =>
        state.publications.find((row) => row.id === where.id) ?? null,
    },
  };
  return { database: database as SystemNoticeDatabase, state };
}

test('strict DTO trims plain text, supports Unicode, and rejects extras, blanks, markup-only text and schema overflow', async () => {
  const parsed = await parseDto(CreateSystemNoticeDto, {
    title: '  停水通知 😀  ',
    content: '  明日 9 点恢复  ',
    clientRequestId: 'notice_request_001',
  });
  assert.deepEqual({ title: parsed.title, content: parsed.content, clientRequestId: parsed.clientRequestId }, {
    title: '停水通知 😀',
    content: '明日 9 点恢复',
    clientRequestId: 'notice_request_001',
  });
  await assert.rejects(
    parseDto(CreateSystemNoticeDto, {
      title: '通知',
      content: '内容',
      clientRequestId: 'notice_request_001',
      target: 'all',
    }),
    /should not exist/,
  );
  for (const input of [
    { title: ' ', content: '内容', clientRequestId: 'notice_request_001' },
    { title: '通知', content: '\n\t', clientRequestId: 'notice_request_001' },
    { title: '<script>alert(1)</script>', content: '内容', clientRequestId: 'notice_request_001' },
  ]) {
    await assert.rejects(parseDto(CreateSystemNoticeDto, input), /不能为空|有效文本/);
  }
  await assert.rejects(
    parseDto(CreateSystemNoticeDto, {
      title: '😀'.repeat(192),
      content: '内容',
      clientRequestId: 'notice_request_001',
    }),
    /191/,
  );
  await assert.rejects(
    parseDto(CreateSystemNoticeDto, {
      title: '通知',
      content: '😀'.repeat(16_384),
      clientRequestId: 'notice_request_001',
    }),
    /65535/,
  );
  for (const clientRequestId of ['short', 'invalid request id', 'a'.repeat(65)]) {
    await assert.rejects(
      parseDto(CreateSystemNoticeDto, { title: '通知', content: '内容', clientRequestId }),
      /clientRequestId|请求标识/,
    );
  }
});

test('publishes zero-recipient notice and writes one atomic safe admin log', async () => {
  const fake = createFakeDatabase([]);
  const result = await publishSystemNotice(fake.database, {
    title: ' <b>维护</b> ',
    content: '请勿点击<script>secret()</script>链接',
    adminId: 'admin-1',
    adminUsername: 'root',
    ip: '127.0.0.1',
    clientRequestId: 'notice_request_001',
  });

  assert.equal(result.noticeId, 'notice_request_001');
  assert.equal(result.recipientCount, 0);
  assert.equal(fake.state.notifications.length, 0);
  assert.equal(fake.state.logs.length, 1);
  assert.deepEqual(fake.state.logs[0], {
    adminId: 'admin-1',
    adminUsername: 'root',
    ip: '127.0.0.1',
    action: 'SYSTEM_NOTICE_PUBLISH',
    detail: {
      noticeId: result.noticeId,
      titleSummary: '维护',
      recipientCount: 0,
    },
  });
});

for (const total of [501, 1001]) {
  test(`publishes ${total} enabled recipients in stable 500-user cursor batches`, async () => {
    const users = Array.from({ length: total }, (_, index) => ({
      id: `user-${String(index).padStart(4, '0')}`,
      enabled: true,
    }));
    users.splice(2, 0, { id: 'disabled-user', enabled: false });
    const fake = createFakeDatabase(users);
    const result = await publishSystemNotice(fake.database, {
      title: '系统通知',
      content: '纯文本内容',
      adminId: 'admin-1',
      adminUsername: 'root',
      ip: '::1',
      clientRequestId: `notice_request_${total}`,
    });

    assert.equal(result.recipientCount, total);
    assert.deepEqual(
      fake.state.createManyCalls.map((call: any) => call.data.length),
      total === 501 ? [500, 1] : [500, 500, 1],
    );
    assert.ok(fake.state.findCalls.every((call: any) => call.take === 500));
    assert.ok(fake.state.findCalls.every((call: any) => call.where.enabled === true));
    assert.ok(fake.state.findCalls.every((call: any) => call.orderBy.id === 'asc'));
    assert.ok(!fake.state.notifications.some((row) => row.recipientId === 'disabled-user'));
    assert.ok(fake.state.createManyCalls.every((call: any) => call.skipDuplicates === true));
    assert.ok(
      Number(fake.state.transactionOptions?.timeout) >= 60_000,
      'large broadcasts need an explicit interactive transaction timeout',
    );
    for (const row of fake.state.notifications) {
      assert.deepEqual(row, {
        recipientId: row.recipientId,
        actorId: null,
        type: 'SYSTEM_NOTICE',
        bizType: 'system',
        bizId: result.noticeId,
        title: '系统通知',
        content: '纯文本内容',
        dedupeKey: `system:${result.noticeId}`,
      });
    }
  });
}

test('counts only newly inserted recipients when dedupe skips an existing recipient', async () => {
  const noticeId = 'notice_request_dedupe';
  const fake = createFakeDatabase(
    [
      { id: 'user-a', enabled: true },
      { id: 'user-b', enabled: true },
    ],
    {
      existing: [{ recipientId: 'user-a', dedupeKey: `system:${noticeId}` }],
    },
  );
  const result = await publishSystemNotice(
    fake.database,
    {
      title: '通知',
      content: '内容',
      adminId: 'admin-1',
      adminUsername: 'root',
      ip: 'unknown',
      clientRequestId: noticeId,
    },
  );
  assert.equal(result.recipientCount, 1);
  assert.equal((fake.state.logs[0]?.detail as any).recipientCount, 1);
});

test('createMany failure rolls back notifications and the admin log', async () => {
  const fake = createFakeDatabase(
    Array.from({ length: 501 }, (_, index) => ({
      id: `user-${String(index).padStart(4, '0')}`,
      enabled: true,
    })),
    { failCreateManyAt: 2 },
  );
  await assert.rejects(
    publishSystemNotice(fake.database, {
      title: '通知',
      content: '内容',
      adminId: 'admin-1',
      adminUsername: 'root',
      ip: '127.0.0.1',
      clientRequestId: 'notice_request_rollback',
    }),
    /createMany failed/,
  );
  assert.equal(fake.state.notifications.length, 0);
  assert.equal(fake.state.logs.length, 0);
});

async function requestSystemNotice(role: 'ADMIN' | 'SUPERADMIN', body: unknown) {
  process.env.ADMIN_JWT_SECRET = 'system-notice-test-secret';
  const router = new Router();
  let calls = 0;
  registerAdminSystemNoticeRoute(router, async (_input) => {
    calls += 1;
    return { noticeId: 'notice-1', recipientCount: 3 };
  });
  const layer = router.stack.find(
    (candidate) =>
      candidate.path === '/api/admin/system-notices' &&
      candidate.methods.includes('POST'),
  );
  assert.ok(layer);
  const token = jwt.sign(
    { sub: 'admin-1', username: 'operator', role, typ: 'access' },
    process.env.ADMIN_JWT_SECRET,
  );
  const ctx: any = {
    headers: { authorization: `Bearer ${token}` },
    state: {},
    request: { body },
    ip: '127.0.0.1',
    status: 404,
    body: undefined,
  };
  const stack = layer.stack as Array<(ctx: any, next: () => Promise<void>) => Promise<void>>;
  const dispatch = async (index: number): Promise<void> => {
    const middleware = stack[index];
    if (middleware) await middleware(ctx, () => dispatch(index + 1));
  };
  await errorHandler(ctx, () => dispatch(0));
  return {
    response: { status: ctx.status === 404 && ctx.body ? 200 : ctx.status },
    payload: ctx.body,
    calls,
  };
}

test('admin system notice route returns 403 for normal admin before publishing', async () => {
  const result = await requestSystemNotice('ADMIN', { title: '通知', content: '内容' });
  assert.equal(result.response.status, 403);
  assert.equal(result.calls, 0);
});

test('super admin route validates strict DTO and returns notice result', async () => {
  const invalid = await requestSystemNotice('SUPERADMIN', {
    title: '通知',
    content: '内容',
    clientRequestId: 'notice_request_001',
    recipientId: 'forged',
  });
  assert.equal(invalid.response.status, 400);
  assert.equal(invalid.calls, 0);

  const valid = await requestSystemNotice('SUPERADMIN', {
    title: ' 通知 ',
    content: ' 内容 ',
    clientRequestId: 'notice_request_001',
  });
  assert.equal(valid.response.status, 200);
  assert.deepEqual(valid.payload, {
    code: 200,
    data: { noticeId: 'notice-1', recipientCount: 3 },
  });
  assert.equal(valid.calls, 1);
});

test('response-lost retry returns the committed publication without sending or logging twice', async () => {
  const fake = createFakeDatabase([{ id: 'user-a', enabled: true }]);
  const input = {
    title: '通知',
    content: '内容',
    clientRequestId: 'notice_request_retry',
    adminId: 'admin-1',
    adminUsername: 'root',
    ip: '127.0.0.1',
  };
  const first = await publishSystemNotice(fake.database, input);
  const retried = await publishSystemNotice(fake.database, input);
  assert.deepEqual(retried, first);
  assert.equal(fake.state.notifications.length, 1);
  assert.equal(fake.state.logs.length, 1);
});

test('concurrent requests crossing the same publication barrier converge on one committed result', async () => {
  let transactionCalls = 0;
  let logCount = 0;
  let publication:
    | { id: string; adminId: string; payloadHash: string; recipientCount: number }
    | undefined;
  let releaseFirst!: () => void;
  let firstEntered!: () => void;
  let firstCommitted!: () => void;
  const releasePromise = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const enteredPromise = new Promise<void>((resolve) => {
    firstEntered = resolve;
  });
  const committedPromise = new Promise<void>((resolve) => {
    firstCommitted = resolve;
  });
  const database = {
    async $transaction(work: (tx: any) => Promise<any>) {
      transactionCalls += 1;
      if (transactionCalls === 2) {
        await committedPromise;
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const local = { recipientCount: 0 };
      const result = await work({
        systemNoticePublication: {
          create: async ({ data }: any) => {
            publication = { ...data, recipientCount: 0 };
            firstEntered();
          },
          update: async ({ data }: any) => {
            local.recipientCount = data.recipientCount;
            Object.assign(publication!, data);
          },
        },
        user: {
          findMany: async () => {
            await releasePromise;
            return [];
          },
        },
        notification: { createMany: async () => ({ count: 0 }) },
        adminSystemLog: {
          create: async () => {
            logCount += 1;
          },
        },
      });
      publication!.recipientCount = local.recipientCount;
      firstCommitted();
      return result;
    },
    systemNoticePublication: {
      findUnique: async () => {
        await committedPromise;
        return publication ?? null;
      },
    },
  };
  const input = {
    title: '并发通知',
    content: '内容',
    clientRequestId: 'notice_request_concurrent',
    adminId: 'admin-1',
    adminUsername: 'root',
    ip: '127.0.0.1',
  };

  const first = publishSystemNotice(database as SystemNoticeDatabase, input);
  await enteredPromise;
  const second = publishSystemNotice(database as SystemNoticeDatabase, input);
  releaseFirst();
  assert.deepEqual(await Promise.all([first, second]), [
    { noticeId: input.clientRequestId, recipientCount: 0 },
    { noticeId: input.clientRequestId, recipientCount: 0 },
  ]);
  assert.equal(logCount, 1);
});

test('reusing a request id with changed payload or another admin returns 409', async () => {
  const fake = createFakeDatabase([{ id: 'user-a', enabled: true }]);
  const base = {
    title: '通知',
    content: '内容',
    clientRequestId: 'notice_request_conflict',
    adminId: 'admin-1',
    adminUsername: 'root',
    ip: '127.0.0.1',
  };
  await publishSystemNotice(fake.database, base);
  await assert.rejects(
    publishSystemNotice(fake.database, { ...base, content: '修改后内容' }),
    (error: any) => error?.status === 409,
  );
  await assert.rejects(
    publishSystemNotice(fake.database, { ...base, adminId: 'admin-2' }),
    (error: any) => error?.status === 409,
  );
});

test('a rolled-back first attempt does not consume the request id and a retry succeeds', async () => {
  const fake = createFakeDatabase([{ id: 'user-a', enabled: true }], { failCreateManyAt: 1 });
  const input = {
    title: '通知',
    content: '内容',
    clientRequestId: 'notice_request_after_rollback',
    adminId: 'admin-1',
    adminUsername: 'root',
    ip: '127.0.0.1',
  };
  await assert.rejects(publishSystemNotice(fake.database, input), /createMany failed/);
  assert.equal(fake.state.publications.length, 0);
  const result = await publishSystemNotice(fake.database, input);
  assert.equal(result.recipientCount, 1);
});

test('Prisma schema and notification migration define the publication idempotency anchor exactly once', async () => {
  const { readFile } = await import('node:fs/promises');
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const migration = await readFile(
    new URL('../prisma/migrations/20260726130000_add_notification_center/migration.sql', import.meta.url),
    'utf8',
  );
  assert.match(schema, /model SystemNoticePublication\s*\{/);
  assert.match(schema, /id\s+String\s+@id/);
  assert.match(schema, /payloadHash\s+String/);
  assert.match(schema, /recipientCount\s+Int\s+@default\(0\)/);
  assert.equal((migration.match(/CREATE TABLE `system_notice_publications`/g) || []).length, 1);
  assert.match(migration, /`id` VARCHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
  assert.match(migration, /`payloadHash` CHAR\(64\) NOT NULL/);
});

test('OpenAPI documents the strict super-admin system notice contract and all outcomes', () => {
  const operation = (openApiDocument.paths as any)['/api/admin/system-notices']?.post;
  assert.ok(operation);
  assert.deepEqual(operation.security, [{ adminBearerAuth: [] }]);
  assert.match(
    (openApiDocument.components.securitySchemes as any).adminBearerAuth.description,
    /管理端/,
  );
  assert.match(operation.description, /超级管理员/);
  const schema = operation.requestBody.content['application/json'].schema;
  assert.equal(schema.$ref, '#/components/schemas/CreateSystemNoticeBody');
  const body = (openApiDocument.components.schemas as any).CreateSystemNoticeBody;
  assert.equal(body.additionalProperties, false);
  assert.deepEqual(body.required, ['title', 'content', 'clientRequestId']);
  assert.deepEqual(body.properties.clientRequestId, {
    type: 'string',
    minLength: 16,
    maxLength: 64,
    pattern: '^[A-Za-z0-9_-]+$',
  });
  const response = (openApiDocument.components.schemas as any).PublishSystemNoticeResponse;
  assert.deepEqual(response.required, ['code', 'data']);
  assert.deepEqual(response.properties.data.required, ['noticeId', 'recipientCount']);
  assert.deepEqual(Object.keys(operation.responses).sort(), ['200', '400', '401', '403', '409', '500']);
});
