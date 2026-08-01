import { Prisma } from '@prisma/client';
import Koa = require('koa');
import { prisma } from '../lib/prisma';
import { redactPath, safeRequestSnapshot } from '../modules/api-log/api-log-redaction';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXCLUDED_PREFIXES = ['/api/admin/auth/login', '/api/admin/auth/refresh', '/api/admin/upload/'];
const DEDICATED_AUDIT_ROUTES = new Set([
  '/api/admin/users/:userId/enabled',
  '/api/admin/admin-users',
  '/api/admin/admin-users/:adminId',
  '/api/admin/admin-users/:adminId/reset-password',
  '/api/admin/admin-users/:adminId/unlock-login',
  '/api/admin/api-endpoints/:id',
  '/api/admin/system-notices',
  '/api/admin/contents/:type/:id/state',
  '/api/admin/contents/:type/state/batch',
  '/api/admin/database/backup-settings',
  '/api/admin/database/backup-jobs',
]);

function routePattern(ctx: Koa.Context) {
  const matched = (ctx as Koa.Context & { _matchedRoute?: unknown })._matchedRoute;
  return typeof matched === 'string' ? matched : ctx.path;
}

/** Audits every successful admin data mutation not already covered by a business-specific audit event. */
export async function adminMutationAudit(ctx: Koa.Context, next: Koa.Next) {
  await next();
  const admin = ctx.state.admin as { adminId?: string; username?: string } | undefined;
  const pattern = routePattern(ctx);
  if (!admin?.adminId || !admin.username || !ctx.path.startsWith('/api/admin/') || !MUTATING_METHODS.has(ctx.method) || ctx.status >= 400) return;
  if (EXCLUDED_PREFIXES.some((prefix) => ctx.path.startsWith(prefix)) || DEDICATED_AUDIT_ROUTES.has(pattern)) return;

  try {
    await prisma.adminSystemLog.create({
      data: {
        adminId: admin.adminId,
        adminUsername: admin.username,
        ip: ctx.ip || 'unknown',
        action: 'ADMIN_DATA_MUTATION',
        detail: {
          method: ctx.method,
          routePattern: pattern,
          requestUrl: `${ctx.protocol}://${ctx.host}${redactPath(ctx.originalUrl || ctx.url || ctx.path)}`,
          request: safeRequestSnapshot({
            params: ctx.params,
            query: ctx.query,
            body: (ctx.request as Koa.Request & { body?: unknown }).body,
          }) as Prisma.InputJsonValue,
        } as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    // Auditing must not turn a successful administrative mutation into a failure.
    console.error('[admin_mutation_audit_persist_failed]', error instanceof Error ? error.message : error);
  }
}
