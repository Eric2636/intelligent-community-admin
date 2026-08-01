import Router from '@koa/router';
import { BackupFrequency } from '@prisma/client';
import Koa = require('koa');
import { adminAuth, requireSuperAdmin } from '../../middleware/admin-auth';
import { jsonBody } from '../../routes/json-body';
import { DatabaseService } from './database.service';

function auditActor(ctx: Koa.Context) {
  return {
    adminId: ctx.state.admin.adminId,
    adminUsername: ctx.state.admin.username,
    ip: ctx.ip || 'unknown',
    requestUrl: `${ctx.protocol}://${ctx.host}${ctx.originalUrl || ctx.url || ctx.path}`,
  };
}

export function registerDatabaseRoutes(router: Router, service = new DatabaseService()) {
  router.get('/api/admin/database/backup-settings', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    ctx.body = { code: 200, data: await service.getBackupSetting() };
  });
  router.patch('/api/admin/database/backup-settings', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const body = jsonBody(ctx) as Record<string, unknown>;
    ctx.body = { code: 200, data: await service.updateBackupSetting({
      enabled: body.enabled === true,
      frequency: String(body.frequency || '') as BackupFrequency,
      minute: Number(body.minute),
      dailyHour: Number(body.dailyHour),
    }, auditActor(ctx)) };
  });
  router.post('/api/admin/database/backup-jobs', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    ctx.body = { code: 200, data: await service.createManualBackup(auditActor(ctx)) };
  });
  router.get('/api/admin/database/backup-overview', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    ctx.body = { code: 200, data: await service.getBackupOverview() };
  });
  router.get('/api/admin/database/backup-jobs', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    ctx.body = { code: 200, data: await service.listBackupJobs(Number(ctx.query.page), Number(ctx.query.pageSize)) };
  });
  router.get('/api/admin/database/tables', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    ctx.body = { code: 200, data: await service.listTables(String(ctx.query.keyword || '')) };
  });
  router.get('/api/admin/database/tables/:tableName', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    ctx.body = { code: 200, data: await service.getTableStructure(String(ctx.params.tableName || '')) };
  });
}
