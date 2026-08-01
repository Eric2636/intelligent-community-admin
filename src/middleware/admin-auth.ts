import jwt from 'jsonwebtoken';
import Koa = require('koa');
import { prisma } from '../lib/prisma';

export type AuthedAdmin = {
  adminId: string;
  username: string;
  role: 'ADMIN' | 'SUPERADMIN';
};

type AdminTokenPayload = {
  sub: string;
  username: string;
  role: 'ADMIN' | 'SUPERADMIN';
  typ?: 'access' | 'refresh';
  sessionVersion?: number;
};

export type AdminAuthDependencies = {
  verifyToken?: (token: string, secret: string) => AdminTokenPayload;
  findAdminSession?: (
    adminId: string,
  ) => Promise<{ enabled: boolean; sessionVersion: number } | null>;
};

function adminJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
}

function rejectAdminAuth(
  ctx: Koa.Context,
  reason: 'missing_bearer' | 'token_invalid' | 'session_replaced' | 'account_disabled' | 'account_missing',
  message = 'Unauthorized',
) {
  ctx.status = 401;
  ctx.body = { statusCode: 401, message, reason };
}

export function createAdminAuth(dependencies: AdminAuthDependencies = {}) {
  return async function adminAuthMiddleware(ctx: Koa.Context, next: Koa.Next) {
    const auth = ctx.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      rejectAdminAuth(ctx, 'missing_bearer');
      return;
    }

    const secret = adminJwtSecret();
    if (!secret) {
      ctx.status = 500;
      ctx.body = { statusCode: 500, message: 'ADMIN_JWT_SECRET 或 JWT_SECRET 未配置' };
      return;
    }

    let payload: AdminTokenPayload;
    try {
      payload = dependencies.verifyToken
        ? dependencies.verifyToken(auth.slice(7).trim(), secret)
        : (jwt.verify(auth.slice(7).trim(), secret) as AdminTokenPayload);
    } catch {
      rejectAdminAuth(ctx, 'token_invalid');
      return;
    }

    if (payload.typ && payload.typ !== 'access') {
      rejectAdminAuth(ctx, 'token_invalid');
      return;
    }

    const admin = dependencies.findAdminSession
      ? await dependencies.findAdminSession(payload.sub)
      : await prisma.adminUser.findUnique({
          where: { id: payload.sub },
          select: { enabled: true, sessionVersion: true },
        });
    if (!admin) {
      rejectAdminAuth(ctx, 'account_missing', '管理员账号不存在，请重新登录');
      return;
    }
    if (!admin.enabled) {
      rejectAdminAuth(ctx, 'account_disabled', '管理员账号已停用，请重新登录');
      return;
    }
    if (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion !== admin.sessionVersion) {
      rejectAdminAuth(ctx, 'session_replaced', '账号已在其他设备登录，请重新登录');
      return;
    }

    ctx.state.admin = {
      adminId: payload.sub,
      username: payload.username,
      role: payload.role,
    } satisfies AuthedAdmin;

    await next();
  };
}

export const adminAuth = createAdminAuth();

export function requireSuperAdmin(ctx: Koa.Context) {
  if (ctx.state.admin?.role !== 'SUPERADMIN') {
    ctx.status = 403;
    ctx.body = { statusCode: 403, message: '仅超级管理员可操作' };
    return false;
  }
  return true;
}
