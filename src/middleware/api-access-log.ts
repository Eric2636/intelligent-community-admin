import { randomUUID } from 'node:crypto';
import Koa = require('koa');
import { prisma } from '../lib/prisma';
import { apiEndpointService, normalizeRoutePattern, sourceForRoutePattern } from '../modules/api-log/api-endpoint.service';
import { redactPath, safeErrorSummary, safeRequestSnapshot } from '../modules/api-log/api-log-redaction';

type LogDb = {
  apiRequestLog: { create(args: { data: Record<string, unknown> }): Promise<unknown> };
};

type EndpointLookup = Pick<typeof apiEndpointService, 'getConfig'>;

function clientIp(ctx: Koa.Context) {
  const peer = ctx.req.socket?.remoteAddress || '';
  const trustedPeers = (process.env.TRUST_PROXY_IPS || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (process.env.TRUST_PROXY === 'true' && trustedPeers.includes(peer)) {
    const forwarded = ctx.get('x-forwarded-for').split(',').map((part) => part.trim()).filter(Boolean);
    if (forwarded[0]) return forwarded[0].slice(0, 64);
  }
  return (ctx.req.socket?.remoteAddress || ctx.request.ip || '').slice(0, 64) || null;
}

function configuredPublicOrigin() {
  const raw = process.env.PUBLIC_API_ORIGIN?.trim().replace(/\/+$/, '');
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function requestOrigin(ctx: Koa.Context) {
  const configured = configuredPublicOrigin();
  if (configured) return configured;

  const peer = ctx.req.socket?.remoteAddress || '';
  const trustedPeers = (process.env.TRUST_PROXY_IPS || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (process.env.TRUST_PROXY === 'true' && trustedPeers.includes(peer)) {
    const protocol = ctx.get('x-forwarded-proto').split(',')[0]?.trim().toLowerCase();
    const host = ctx.get('x-forwarded-host').split(',')[0]?.trim();
    if ((protocol === 'http' || protocol === 'https') && host && !/[\s/\\]/.test(host)) return `${protocol}://${host}`;
  }
  return `${ctx.protocol}://${ctx.host}`;
}

export function requestUrlForLog(ctx: Koa.Context) {
  return `${requestOrigin(ctx)}${redactPath(ctx.originalUrl || ctx.url || ctx.path)}`;
}

function routePatternFor(ctx: Koa.Context) {
  const matched = (ctx as Koa.Context & { _matchedRoute?: unknown })._matchedRoute;
  if (typeof matched === 'string' || matched instanceof RegExp) {
    try { return normalizeRoutePattern(matched); } catch { /* fall through */ }
  }
  return 'UNMATCHED';
}

function actorIds(ctx: Koa.Context) {
  const user = ctx.state.user as { userId?: string } | undefined;
  const admin = ctx.state.admin as { adminId?: string; id?: string } | undefined;
  return { userId: user?.userId ?? null, adminId: admin?.adminId ?? admin?.id ?? null };
}

function businessCode(body: unknown) {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).businessCode ?? (body as Record<string, unknown>).statusCode ?? (body as Record<string, unknown>).code;
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function createApiAccessLogMiddleware(dependencies: {
  db?: LogDb;
  endpointService?: EndpointLookup;
  clock?: () => number;
  logger?: { error(event: string, metadata?: Record<string, unknown>): void };
} = {}) {
  const db = dependencies.db ?? (prisma as unknown as LogDb);
  const endpointService = dependencies.endpointService ?? apiEndpointService;
  const clock = dependencies.clock ?? (() => performance.now());
  const logger = dependencies.logger ?? { error: (event: string, metadata?: Record<string, unknown>) => console.error(`[${event}]`, metadata) };
  return async function apiAccessLog(ctx: Koa.Context, next: Koa.Next) {
    const started = clock();
    let thrown: unknown;
    try {
      await next();
    } catch (error) {
      thrown = error;
      throw error;
    } finally {
      const durationMs = Math.max(0, Math.round(clock() - started));
      const method = ctx.method.toUpperCase();
      const routePattern = routePatternFor(ctx);
      const source = sourceForRoutePattern(routePattern);
      const { userId, adminId } = actorIds(ctx);
      let endpointId: string | null = null;
      let logEnabled = true;
      try {
        const config = await endpointService.getConfig(method, routePattern);
        endpointId = config.id;
        logEnabled = config.logEnabled;
      } catch {
        logEnabled = true;
      }
      const status = ctx.status || (thrown ? 500 : 200);
      const data = {
        requestId: randomUUID(), endpointId, source, method, routePattern, requestUrl: requestUrlForLog(ctx),
        ip: clientIp(ctx), userId, adminId, httpStatus: status, durationMs,
      };
      const handled = ctx.state.handledError as { name?: unknown; code?: unknown } | undefined;
      const error = status >= 400
        ? {
            errorCode: thrown instanceof Error ? thrown.name : typeof handled?.code === 'string' ? handled.code : typeof handled?.name === 'string' ? handled.name : `HTTP_${status}`,
            errorSummary: safeErrorSummary(thrown ?? handled ?? `HTTP ${status}`),
            requestSnapshot: safeRequestSnapshot({
              params: ctx.params,
              query: ctx.query,
              body: (ctx.request as (Koa.Request & { body?: unknown }) | undefined)?.body,
            }),
          }
        : { errorCode: null, errorSummary: null, requestSnapshot: null };
      // Back-office calls are always retained for operational traceability;
      // the per-endpoint switch controls ordinary mini-program traffic only.
      if ((source === 'ADMIN' || logEnabled) && status < 400) {
        try { await db.apiRequestLog.create({ data: { ...data, businessCode: businessCode(ctx.body), ...error } }); }
        catch (error) { try { logger.error('api_request_log_persist_failed', { method, routePattern, status, error: safeErrorSummary(error) }); } catch { /* no-op */ } }
      } else if (status >= 400) {
        try { await db.apiRequestLog.create({ data: { ...data, businessCode: null, ...error } }); }
        catch (error) { try { logger.error('api_request_log_persist_failed', { method, routePattern, status, error: safeErrorSummary(error) }); } catch { /* no-op */ } }
      }
    }
  };
}

export const apiAccessLog = createApiAccessLogMiddleware();
