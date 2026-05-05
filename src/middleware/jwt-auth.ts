import jwt from 'jsonwebtoken';
import Koa = require('koa');
import { prisma } from '../lib/prisma';

export type AuthedUser = { userId: string; openid: string };

export async function jwtAuth(ctx: Koa.Context, next: Koa.Next) {
  const auth = ctx.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
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
  const token = auth.slice(7).trim();
  const secret = process.env.JWT_SECRET;
  const debugInfo =
    process.env.NODE_ENV === 'production'
      ? null
      : {
          tokenLen: token.length,
          tokenHead: token.slice(0, 24),
          secretLen: secret ? secret.length : 0,
        };
  if (!secret) {
    ctx.status = 500;
    ctx.body = { statusCode: 500, message: 'JWT_SECRET 未配置' };
    return;
  }
  try {
    const payload = jwt.verify(token, secret) as { sub: string; openid: string };
    ctx.state.user = { userId: payload.sub, openid: payload.openid };
  } catch (err) {
    const errName = err instanceof Error ? err.name : 'Error';
    const errMsg = err instanceof Error ? err.message : String(err);
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[jwtAuth] 401 token_invalid', ctx.method, ctx.path, errName, errMsg);
    }
    ctx.status = 401;
    ctx.body = {
      statusCode: 401,
      message: 'Unauthorized',
      reason: 'token_invalid',
      hint:
        errName === 'TokenExpiredError'
          ? 'token 已过期，请清缓存并重新登录'
          : errMsg.includes('invalid signature')
            ? 'JWT 签名校验失败：常与 JWT_SECRET 变更或环境不一致有关；请确认 .env 与后端进程一致后清缓存重新登录'
            : 'token 无效；请清缓存并重新登录',
      detail: errName,
      // 仅开发环境返回更具体信息，便于定位：invalid signature / jwt malformed / invalid token 等
      ...(process.env.NODE_ENV === 'production' ? {} : { debugMessage: errMsg, debugInfo }),
    };
    return;
  }

  if (!['GET', 'HEAD', 'OPTIONS'].includes(ctx.method)) {
    const user = await prisma.user.findUnique({
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
