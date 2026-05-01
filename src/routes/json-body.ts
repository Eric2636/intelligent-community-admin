import type Koa from 'koa';

export function jsonBody(ctx: Koa.Context): unknown {
  return (ctx.request as unknown as { body?: unknown }).body;
}
