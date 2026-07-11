import jwt from 'jsonwebtoken';
import Koa = require('koa');

export type AuthedAdmin = {
  adminId: string;
  username: string;
  role: 'ADMIN' | 'SUPERADMIN';
};

function adminJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
}

export async function adminAuth(ctx: Koa.Context, next: Koa.Next) {
  const auth = ctx.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    ctx.status = 401;
    ctx.body = { statusCode: 401, message: 'Unauthorized', reason: 'missing_bearer' };
    return;
  }

  const secret = adminJwtSecret();
  if (!secret) {
    ctx.status = 500;
    ctx.body = { statusCode: 500, message: 'ADMIN_JWT_SECRET 或 JWT_SECRET 未配置' };
    return;
  }

  try {
    const payload = jwt.verify(auth.slice(7).trim(), secret) as {
      sub: string;
      username: string;
      role: 'ADMIN' | 'SUPERADMIN';
      typ?: 'access' | 'refresh';
    };
    if (payload.typ && payload.typ !== 'access') {
      ctx.status = 401;
      ctx.body = { statusCode: 401, message: 'Unauthorized', reason: 'token_invalid' };
      return;
    }
    ctx.state.admin = {
      adminId: payload.sub,
      username: payload.username,
      role: payload.role,
    } satisfies AuthedAdmin;
  } catch {
    ctx.status = 401;
    ctx.body = { statusCode: 401, message: 'Unauthorized', reason: 'token_invalid' };
    return;
  }

  await next();
}

export function requireSuperAdmin(ctx: Koa.Context) {
  if (ctx.state.admin?.role !== 'SUPERADMIN') {
    ctx.status = 403;
    ctx.body = { statusCode: 403, message: '仅超级管理员可操作' };
    return false;
  }
  return true;
}
