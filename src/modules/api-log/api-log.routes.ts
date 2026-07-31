import Router from '@koa/router';
import { adminAuth, requireSuperAdmin } from '../../middleware/admin-auth';
import { jsonBody } from '../../routes/json-body';
import { apiEndpointService } from './api-endpoint.service';
import { redactPath } from './api-log-redaction';
import { ApiLogService, parseApiLogFilters } from './api-log.service';

export function registerApiLogRoutes(router: Router, service = new ApiLogService()) {
  router.get('/api/admin/api-endpoints', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    ctx.body = { code: 200, data: await service.listEndpoints({ page: Number(ctx.query.page), pageSize: Number(ctx.query.pageSize), keyword: String(ctx.query.keyword || ''), source: String(ctx.query.source || '') }) };
  });
  router.patch('/api/admin/api-endpoints/:id', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const body = jsonBody(ctx) as { description?: unknown; logEnabled?: unknown };
    if (!body || typeof body !== 'object' || Array.isArray(body)) { ctx.throw(400, '请求体必须为对象'); return; }
    if ('description' in body && typeof body.description !== 'string') { ctx.throw(400, 'description 必须为字符串'); return; }
    if ('logEnabled' in body && typeof body.logEnabled !== 'boolean') { ctx.throw(400, 'logEnabled 必须为布尔值'); return; }
    const patch = { ...(typeof body.description === 'string' ? { description: body.description } : {}), ...(typeof body.logEnabled === 'boolean' ? { logEnabled: body.logEnabled } : {}) };
    const id = String((ctx.params as { id?: string }).id || '');
    const endpoint = await service.updateEndpoint(id, patch, { adminId: ctx.state.admin.adminId, adminUsername: ctx.state.admin.username, ip: ctx.ip, requestUrl: `${ctx.protocol}://${ctx.host}${redactPath(ctx.originalUrl || ctx.url || ctx.path)}` });
    apiEndpointService.invalidate(endpoint.method, endpoint.routePattern);
    ctx.body = { code: 200, data: endpoint };
  });
  router.get('/api/admin/api-access-logs', adminAuth, async (ctx) => { if (!requireSuperAdmin(ctx)) return; ctx.body = { code: 200, data: await service.listRequests(parseApiLogFilters(ctx.query as Record<string, unknown>)) }; });
  router.get('/api/admin/api-error-logs', adminAuth, async (ctx) => { if (!requireSuperAdmin(ctx)) return; ctx.body = { code: 200, data: await service.listRequests(parseApiLogFilters(ctx.query as Record<string, unknown>)) }; });
  router.get('/api/admin/api-access-logs/export', adminAuth, async (ctx) => { if (!requireSuperAdmin(ctx)) return; ctx.type = 'text/csv; charset=utf-8'; ctx.set('Content-Disposition', 'attachment; filename="api-request-logs.csv"'); ctx.body = await service.exportRequests(parseApiLogFilters(ctx.query as Record<string, unknown>)); });
  router.get('/api/admin/api-error-logs/export', adminAuth, async (ctx) => { if (!requireSuperAdmin(ctx)) return; ctx.type = 'text/csv; charset=utf-8'; ctx.set('Content-Disposition', 'attachment; filename="api-request-logs.csv"'); ctx.body = await service.exportRequests(parseApiLogFilters(ctx.query as Record<string, unknown>)); });
}
