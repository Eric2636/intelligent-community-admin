import Koa = require('koa');
import { HttpError } from '../http-error';

export async function errorHandler(ctx: Koa.Context, next: Koa.Next) {
  try {
    await next();
  } catch (err) {
    // Koa creates state for real requests, but keeping this defensive also makes
    // the handler safe for minimal contexts used by middleware callers/tests.
    (ctx.state ??= {}).handledError = err;
    try { ctx.app?.emit('error', err, ctx); } catch { /* observers must not alter the response */ }
    const koaStatus = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : undefined;
    const expose = Boolean((err as { expose?: unknown })?.expose);
    if (err instanceof HttpError || (koaStatus && koaStatus >= 400 && koaStatus < 500)) {
      const status = err instanceof HttpError ? err.status : koaStatus!;
      const message = err instanceof HttpError || expose ? (err as Error).message : 'Bad Request';
      ctx.status = status;
      ctx.body = {
        statusCode: status,
        message,
        ...(err instanceof HttpError && err.reason ? { reason: err.reason } : {}),
      };
      return;
    }
    console.error('[api-error]', {
      name: err instanceof Error ? err.name : 'UnknownError',
      method: ctx.method,
      path: ctx.path,
      status: 500,
    });
    ctx.status = 500;
    ctx.body = {
      statusCode: 500,
      message: 'Internal Server Error',
    };
  }
}
