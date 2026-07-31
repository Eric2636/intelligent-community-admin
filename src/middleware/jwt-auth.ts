import jwt from 'jsonwebtoken';
import Koa = require('koa');
import { prisma } from '../lib/prisma';

export type AuthedUser = { userId: string; openid: string };
type JwtPayload = { sub?: string; openid?: string };

export type JwtAuthDependencies = {
  verifyToken?: (token: string, secret: string) => JwtPayload;
  findUser?: (userId: string) => Promise<{ enabled: boolean } | null>;
};

type AuthResult =
  | { user: AuthedUser }
  | { reason: 'missing_bearer' }
  | { reason: 'token_invalid'; errorName: string; errorMessage: string }
  | { reason: 'server_misconfigured' };

function parseAuthUser(
  ctx: Koa.Context,
  verifyToken: NonNullable<JwtAuthDependencies['verifyToken']> = (token, secret) =>
    jwt.verify(token, secret) as JwtPayload,
): AuthResult {
  const auth = ctx.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    return { reason: 'missing_bearer' };
  }
  const token = auth.slice(7).trim();
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    return { reason: 'server_misconfigured' };
  }
  if (!token) {
    return { reason: 'token_invalid', errorName: 'JsonWebTokenError', errorMessage: 'jwt must be provided' };
  }
  try {
    const payload = verifyToken(token, secret);
    if (!payload.sub || !payload.openid) {
      return { reason: 'token_invalid', errorName: 'JsonWebTokenError', errorMessage: 'invalid payload' };
    }
    return { user: { userId: payload.sub, openid: payload.openid } };
  } catch (err) {
    return {
      reason: 'token_invalid',
      errorName: err instanceof Error ? err.name : 'Error',
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function optionalJwtAuth(ctx: Koa.Context, next: Koa.Next) {
  const result = parseAuthUser(ctx);
  if ('user' in result) {
    ctx.state.user = result.user;
    await next();
    return;
  }
  ctx.state.user = undefined;
  if (result.reason === 'server_misconfigured') {
    ctx.status = 500;
    ctx.body = { statusCode: 500, message: 'JWT_SECRET 未配置' };
    return;
  }
  await next();
}

async function requiredJwtAuth(
  ctx: Koa.Context,
  next: Koa.Next,
  dependencies: JwtAuthDependencies,
) {
  const result = parseAuthUser(ctx, dependencies.verifyToken);
  if ('reason' in result && result.reason === 'server_misconfigured') {
    ctx.status = 500;
    ctx.body = { statusCode: 500, message: 'JWT_SECRET 未配置' };
    return;
  }
  if ('reason' in result && result.reason === 'missing_bearer') {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[jwtAuth] 401 missing_bearer', ctx.method, ctx.path);
    }
    ctx.status = 401;
    ctx.body = {
      statusCode: 401,
      message: 'Unauthorized',
      reason: 'missing_bearer',
      hint: '请求头需包含 Authorization: Bearer <登录返回的 token>',
    };
    return;
  }
  if ('reason' in result) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[jwtAuth] 401 token_invalid', ctx.method, ctx.path, result.errorName, result.errorMessage);
    }
    ctx.status = 401;
    ctx.body = {
      statusCode: 401,
      message: 'Unauthorized',
      reason: 'token_invalid',
      hint:
        result.errorName === 'TokenExpiredError'
          ? 'token 已过期，请清缓存并重新登录'
          : result.errorMessage.includes('invalid signature')
            ? 'JWT 签名校验失败：常与 JWT_SECRET 变更或环境不一致有关；请确认 .env 与后端进程一致后清缓存重新登录'
            : 'token 无效；请清缓存并重新登录',
      detail: result.errorName,
      ...(process.env.NODE_ENV === 'production' ? {} : { debugMessage: result.errorMessage }),
    };
    return;
  }
  ctx.state.user = result.user;

  if (!['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)) {
    const user = dependencies.findUser
      ? await dependencies.findUser(ctx.state.user.userId)
      : await prisma.user.findUnique({
          where: { id: ctx.state.user.userId },
          select: { enabled: true },
        });
    if (!user) {
      ctx.status = 401;
      ctx.body = { statusCode: 401, message: '用户不存在' };
      return;
    }
    if (!user.enabled) {
      ctx.status = 403;
      ctx.body = { statusCode: 403, message: '账号已被冻结，暂不能进行发布、评论、点赞等操作' };
      return;
    }
  }

  // 注意：业务处理里的异常应交给 errorHandler 返回 4xx/5xx，不应被当作鉴权失败吞掉
  await next();
}

export function createJwtAuth(dependencies: JwtAuthDependencies = {}) {
  return async (ctx: Koa.Context, next: Koa.Next) => {
    await requiredJwtAuth(ctx, next, dependencies);
  };
}

export async function jwtAuth(ctx: Koa.Context, next: Koa.Next) {
  await requiredJwtAuth(ctx, next, {});
}
