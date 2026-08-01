import assert from 'node:assert/strict';
import test from 'node:test';
import { AdminSessionReplacedError } from '../src/modules/admin/admin-session';
import { createAdminAuth } from '../src/middleware/admin-auth';
import { errorHandler } from '../src/middleware/error-handler';

type SessionPayload = {
  sub: string;
  username: string;
  role: 'ADMIN' | 'SUPERADMIN';
  typ: 'access';
  sessionVersion?: number;
};

function context() {
  return {
    headers: { authorization: 'Bearer token' },
    state: {},
    status: 200,
    body: undefined as unknown,
  } as any;
}

function middleware(payload: SessionPayload, state: { enabled: boolean; sessionVersion: number } | null) {
  return createAdminAuth({
    verifyToken: () => payload,
    findAdminSession: async () => state,
  });
}

test('the current admin session version is authorized', async () => {
  const ctx = context();
  let nextCalls = 0;

  await middleware(
    { sub: 'admin-a', username: 'alice', role: 'ADMIN', typ: 'access', sessionVersion: 4 },
    { enabled: true, sessionVersion: 4 },
  )(ctx, async () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.deepEqual(ctx.state.admin, { adminId: 'admin-a', username: 'alice', role: 'ADMIN' });
});

test('an older admin session is rejected with a stable replaced reason', async () => {
  const ctx = context();

  await middleware(
    { sub: 'admin-a', username: 'alice', role: 'ADMIN', typ: 'access', sessionVersion: 3 },
    { enabled: true, sessionVersion: 4 },
  )(ctx, async () => assert.fail('stale sessions must not reach the route'));

  assert.equal(ctx.status, 401);
  assert.deepEqual(ctx.body, {
    statusCode: 401,
    message: '账号已在其他设备登录，请重新登录',
    reason: 'session_replaced',
  });
});

test('a token issued before session versioning is rejected after migration', async () => {
  const ctx = context();

  await middleware(
    { sub: 'admin-a', username: 'alice', role: 'ADMIN', typ: 'access' },
    { enabled: true, sessionVersion: 1 },
  )(ctx, async () => assert.fail('legacy tokens must not reach the route'));

  assert.equal(ctx.status, 401);
  assert.equal((ctx.body as any).reason, 'session_replaced');
});

test('a disabled administrator is rejected before the route executes', async () => {
  const ctx = context();

  await middleware(
    { sub: 'admin-a', username: 'alice', role: 'ADMIN', typ: 'access', sessionVersion: 4 },
    { enabled: false, sessionVersion: 4 },
  )(ctx, async () => assert.fail('disabled accounts must not reach the route'));

  assert.equal(ctx.status, 401);
  assert.deepEqual(ctx.body, {
    statusCode: 401,
    message: '管理员账号已停用，请重新登录',
    reason: 'account_disabled',
  });
});

test('the shared error handler preserves the session replaced reason for refresh failures', async () => {
  const ctx = {
    method: 'POST',
    path: '/api/admin/auth/refresh',
    app: { emit: () => {} },
  } as any;

  await errorHandler(ctx, async () => {
    throw new AdminSessionReplacedError();
  });

  assert.equal(ctx.status, 401);
  assert.deepEqual(ctx.body, {
    statusCode: 401,
    message: '账号已在其他设备登录，请重新登录',
    reason: 'session_replaced',
  });
});
