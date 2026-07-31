import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Router from '@koa/router';
import type Koa from 'koa';
import { prisma } from '../src/lib/prisma';
import { adminAuth } from '../src/middleware/admin-auth';
import { jwtAuth } from '../src/middleware/jwt-auth';
import {
  CreateFeedbackDto,
  normalizeAdminFeedbackQuery,
  normalizeFeedback,
} from '../src/modules/feedback/feedback.dto';
import { FeedbackService } from '../src/modules/feedback/feedback.service';
import { createRouter } from '../src/routes';
import { registerFeedbackRoutes } from '../src/routes/feedback.routes';
import { openApiDocument } from '../src/swagger/openapi';
import { parseDto } from '../src/validate';

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

test('feedback DTO accepts only trimmed content between 1 and 500 characters', async () => {
  assert.deepEqual(normalizeFeedback({ content: ' 建议 ' }), { content: '建议' });
  assert.throws(() => normalizeFeedback({ content: '   ' }), /请输入反馈内容/);
  assert.throws(() => normalizeFeedback({ content: 'a'.repeat(501) }), /500个字符/);
  assert.equal(normalizeFeedback({ content: '😀'.repeat(250) }).content, '😀'.repeat(250));
  assert.equal(normalizeFeedback({ content: '😀'.repeat(500) }).content, '😀'.repeat(500));
  assert.throws(() => normalizeFeedback({ content: '😀'.repeat(501) }), /500个字符/);
  assert.equal(normalizeFeedback({ content: 'e\u0301'.repeat(250) }).content, 'e\u0301'.repeat(250));
  assert.throws(() => normalizeFeedback({ content: 'e\u0301'.repeat(251) }), /500个字符/);

  const parsed = await parseDto(CreateFeedbackDto, { content: ' 反馈 ' });
  assert.equal(parsed.content, '反馈');
  assert.deepEqual(Object.keys(parsed), ['content']);
  assert.equal(
    (await parseDto(CreateFeedbackDto, { content: '😀'.repeat(500) })).content,
    '😀'.repeat(500),
  );
  await assert.rejects(
    parseDto(CreateFeedbackDto, { content: '😀'.repeat(501) }),
    /500个字符/,
  );
  assert.equal(
    (await parseDto(CreateFeedbackDto, { content: '\u2764\uFE0F'.repeat(250) })).content,
    '\u2764\uFE0F'.repeat(250),
  );
  await assert.rejects(
    parseDto(CreateFeedbackDto, { content: '\u2764\uFE0F'.repeat(251) }),
    /500个字符/,
  );
  await assert.rejects(parseDto(CreateFeedbackDto, { content: '建议', userId: 'forged-user' }), /should not exist/);
  await assert.rejects(parseDto(CreateFeedbackDto, { content: '建议', image: 'https://example.com/x.png' }), /should not exist/);
});

test('feedback service persists authenticated user id and normalized content only', async () => {
  const calls: unknown[] = [];
  const database = {
    feedback: {
      create: async (args: unknown) => {
        calls.push(args);
        return { id: 'feedback-1', createdAt: new Date('2026-07-26T00:00:00.000Z') };
      },
    },
  };
  const service = new FeedbackService(database as typeof prisma);

  const result = await service.create({
    userId: 'authenticated-user',
    dto: { content: '  希望增加夜间模式  ' },
  });

  assert.deepEqual(calls, [
    {
      data: {
        userId: 'authenticated-user',
        content: '希望增加夜间模式',
      },
      select: { id: true, createdAt: true },
    },
  ]);
  assert.deepEqual(result, {
    id: 'feedback-1',
    createdAt: '2026-07-26T00:00:00.000Z',
  });
});

test('POST /api/feedbacks requires jwt auth and uses only state user id', async () => {
  const calls: unknown[] = [];
  const service = {
    create: async (params: unknown) => {
      calls.push(params);
      return { id: 'feedback-1' };
    },
  };
  const router = new Router();
  registerFeedbackRoutes(router, service as FeedbackService);
  const route = findRoute(router, 'POST', '/api/feedbacks');

  assert.equal(route.stack[0], jwtAuth);
  const ctx = {
    request: { body: { content: '  有效建议  ' } },
    state: { user: { userId: 'state-user', openid: 'openid' } },
  } as unknown as Koa.Context;
  await route.stack[1](ctx, async () => {});

  assert.equal(calls.length, 1);
  const call = calls[0] as { userId: string; dto: CreateFeedbackDto };
  assert.equal(call.userId, 'state-user');
  assert.equal(call.dto.content, '有效建议');
  assert.deepEqual(Object.keys(call.dto), ['content']);
  assert.deepEqual(ctx.body, { code: 200, data: { id: 'feedback-1' } });
  assert.equal(findRoute(createRouter(), 'POST', '/api/feedbacks').stack[0], jwtAuth);
});

test('admin feedback query validates pagination, identity and date range', () => {
  assert.deepEqual(
    normalizeAdminFeedbackQuery({
      page: '2',
      pageSize: '12',
      keyword: '  停车  ',
      identity: 'OWNER',
      startAt: '2026-07-01T00:00:00.000Z',
      endAt: '2026-07-29T23:59:59.999Z',
    }),
    {
      page: 2,
      pageSize: 12,
      keyword: '停车',
      identity: 'OWNER',
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: new Date('2026-07-29T23:59:59.999Z'),
    },
  );
  assert.throws(() => normalizeAdminFeedbackQuery({ page: '0' }), /页码/);
  assert.throws(() => normalizeAdminFeedbackQuery({ pageSize: '101' }), /每页/);
  assert.throws(() => normalizeAdminFeedbackQuery({ identity: 'UNKNOWN' }), /用户身份/);
  assert.throws(
    () => normalizeAdminFeedbackQuery({ startAt: '2026-07-30', endAt: '2026-07-29' }),
    /时间范围/,
  );
});

test('feedback admin list filters by nickname/content, identity and time and returns safe user cards', async () => {
  const feedbackCalls: Array<{ method: string; args: unknown }> = [];
  let userCall = 0;
  const database = {
    user: {
      findMany: async (args: unknown) => {
        userCall += 1;
        if (userCall === 1) return [{ id: 'owner-a' }, { id: 'owner-b' }];
        if (userCall === 2) return [{ id: 'owner-a' }];
        return [
          { id: 'owner-a', name: '王女士', avatar: '', identityType: 'OWNER' },
          { id: 'owner-b', name: null, avatar: null, identityType: 'OWNER' },
        ];
      },
    },
    feedback: {
      count: async (args: unknown) => {
        feedbackCalls.push({ method: 'count', args });
        return 2;
      },
      findMany: async (args: unknown) => {
        feedbackCalls.push({ method: 'findMany', args });
        return [
          {
            id: 'feedback-2',
            userId: 'owner-b',
            content: '建议增加停车位',
            createdAt: new Date('2026-07-29T02:00:00.000Z'),
          },
          {
            id: 'feedback-1',
            userId: 'owner-a',
            content: '门禁维护建议',
            createdAt: new Date('2026-07-28T02:00:00.000Z'),
          },
        ];
      },
    },
  };
  const service = new FeedbackService(database as typeof prisma);

  const result = await service.listAdmin({
    page: 2,
    pageSize: 10,
    keyword: '停车',
    identity: 'OWNER',
    startAt: new Date('2026-07-01T00:00:00.000Z'),
    endAt: new Date('2026-07-29T23:59:59.999Z'),
  });

  assert.equal(feedbackCalls.length, 2);
  assert.deepEqual(feedbackCalls[1], {
    method: 'findMany',
    args: {
      where: {
        AND: [
          { userId: { in: ['owner-a', 'owner-b'] } },
          {
            OR: [
              { content: { contains: '停车' } },
              { userId: { in: ['owner-a'] } },
            ],
          },
          {
            createdAt: {
              gte: new Date('2026-07-01T00:00:00.000Z'),
              lte: new Date('2026-07-29T23:59:59.999Z'),
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      skip: 10,
      take: 10,
      select: { id: true, userId: true, content: true, createdAt: true },
    },
  });
  assert.equal(result.total, 2);
  assert.equal(result.list[0].nickname, '微信用户');
  assert.equal(result.list[0].avatar, '/static/avatar1.png');
  assert.equal(result.list[0].identityLabel, '业主');
  assert.equal(result.list[0].createdAt, '2026-07-29T02:00:00.000Z');
  assert.deepEqual(Object.keys(result.list[0]).sort(), [
    'avatar',
    'content',
    'createdAt',
    'id',
    'identity',
    'identityLabel',
    'nickname',
    'userId',
  ]);
});

test('GET /api/admin/feedbacks is available to both admin roles through admin authentication', async () => {
  const calls: unknown[] = [];
  const service = {
    listAdmin: async (params: unknown) => {
      calls.push(params);
      return { total: 0, list: [] };
    },
  };
  const router = new Router();
  registerFeedbackRoutes(router, service as FeedbackService);
  const route = findRoute(router, 'GET', '/api/admin/feedbacks');

  assert.equal(route.stack[0], adminAuth);
  for (const role of ['ADMIN', 'SUPERADMIN'] as const) {
    const ctx = {
      query: { page: '1', pageSize: '20' },
      state: { admin: { adminId: `${role}-1`, username: role, role } },
    } as unknown as Koa.Context;
    await route.stack[1](ctx, async () => {});
    assert.deepEqual(ctx.body, { code: 200, data: { total: 0, list: [] } });
  }
  assert.equal(calls.length, 2);
  assert.equal(findRoute(createRouter(), 'GET', '/api/admin/feedbacks').stack[0], adminAuth);
});

test('feedback migration creates only the minimal feedback table and indexes', async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
    readFile(
      new URL('../prisma/migrations/20260726120000_simplify_feedback/migration.sql', import.meta.url),
      'utf8',
    ),
  ]);
  const feedbackModel = schema.slice(schema.indexOf('model Feedback'), schema.indexOf('model AdminUser'));

  assert.match(feedbackModel, /content\s+String\s+@db\.Text/);
  assert.match(feedbackModel, /@@index\(\[userId, createdAt\]\)/);
  assert.match(feedbackModel, /@@index\(\[createdAt\]\)/);
  assert.match(feedbackModel, /@@map\("feedbacks"\)/);
  assert.equal((migration.match(/CREATE TABLE/gi) || []).length, 1);
  assert.match(migration, /CREATE TABLE `feedbacks`/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE|upload|image/i);
});

test('OpenAPI documents authenticated content-only feedback submission', () => {
  const document = openApiDocument as {
    components: { schemas: Record<string, unknown> };
    paths: Record<string, Record<string, unknown>>;
  };
  const schema = document.components.schemas.CreateFeedbackBody as {
    description: string;
    required: string[];
    properties: Record<string, unknown>;
  };
  const operation = document.paths['/api/feedbacks']?.post as {
    security: Array<Record<string, unknown>>;
  };

  assert.deepEqual(schema.required, ['content']);
  assert.deepEqual(Object.keys(schema.properties), ['content']);
  assert.match(schema.description, /500 Unicode code points/);
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  const adminOperation = document.paths['/api/admin/feedbacks']?.get as {
    security: Array<Record<string, unknown>>;
    parameters: Array<{ name: string }>;
  };
  assert.deepEqual(adminOperation.security, [{ bearerAuth: [] }]);
  assert.deepEqual(
    adminOperation.parameters.map((parameter) => parameter.name),
    ['page', 'pageSize', 'keyword', 'identity', 'startAt', 'endAt'],
  );
});
