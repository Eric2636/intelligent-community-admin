import Koa = require('koa');
import { HttpError } from '../http-error';

export async function errorHandler(ctx: Koa.Context, next: Koa.Next) {
  try {
    await next();
  } catch (err) {
    if (err instanceof HttpError) {
      ctx.status = err.status;
      ctx.body = { statusCode: err.status, message: err.message };
      return;
    }
    ctx.status = 500;
    ctx.body = {
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Internal Server Error',
    };
    ctx.app.emit('error', err, ctx);
  }
}
