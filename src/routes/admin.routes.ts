import Router from '@koa/router';
import { parseMultipartForm } from '../lib/multipart-form';
import { adminAuth, requireSuperAdmin } from '../middleware/admin-auth';
import {
  AdminContentQueryDto,
  AdminCreateContentDto,
  AdminListQueryDto,
  AdminLoginDto,
  AdminChangeMyPasswordDto,
  AdminSystemLogQueryDto,
  AdminUpdateContentDto,
  BatchUpdateContentStateDto,
  CreateAdminUserDto,
  UpdateAdminUserDto,
  UpdateContentStateDto,
  UpdateUserEnabledDto,
} from '../modules/admin/admin.dto';
import { AdminService } from '../modules/admin/admin.service';
import { MiniApiErrorLogQueryDto } from '../modules/client-log/client-log.dto';
import { ClientLogService } from '../modules/client-log/client-log.service';
import { UpdateModuleTabEnabledDto } from '../modules/settings/settings.dto';
import { SettingsService } from '../modules/settings/settings.service';
import { CosCredentialsDto } from '../modules/upload/upload.dto';
import { UploadService } from '../modules/upload/upload.service';
import { parseDto } from '../validate';
import { jsonBody } from './json-body';

const contentTypes = new Set(['errands', 'posts', 'items', 'tasks']);
const uploadService = new UploadService();
const uploadMaxBytes = Number(process.env.UPLOAD_MAX_BYTES || String(100 * 1024 * 1024));

function pageOf(q: { page?: number; pageSize?: number }) {
  return {
    page: q.page ?? 1,
    pageSize: q.pageSize ?? 20,
  };
}

export function registerAdminRoutes(
  router: Router,
  adminService: AdminService,
  settingsService: SettingsService,
  clientLogService: ClientLogService,
) {
  router.get('/api/admin/auth/captcha', async (ctx) => {
    const data = await adminService.createLoginCaptcha();
    ctx.body = { code: 200, data };
  });

  router.post('/api/admin/auth/login', async (ctx) => {
    const dto = await parseDto(AdminLoginDto, jsonBody(ctx));
    // 登录安全：错误次数 / 验证码 / 30 分钟锁定（一次性扩展字段返回）
    const res = await adminService.loginWithSecurity({
      username: dto.username,
      password: dto.password,
      captchaId: dto.captchaId,
      captchaCode: dto.captchaCode,
      ip: ctx.ip,
    });
    if (!res.ok) {
      ctx.status = res.statusCode;
      ctx.body = res.body;
      return;
    }
    ctx.body = { code: 200, data: res.data };
  });

  router.post('/api/admin/auth/refresh', async (ctx) => {
    const body = jsonBody(ctx) as { refreshToken?: string };
    ctx.body = { code: 200, data: await adminService.refreshToken(body.refreshToken || '') };
  });

  router.get('/api/admin/auth/me', adminAuth, async (ctx) => {
    ctx.body = { code: 200, data: await adminService.getMe(ctx.state.admin.adminId) };
  });

  router.post('/api/admin/auth/change-password', adminAuth, async (ctx) => {
    const dto = await parseDto(AdminChangeMyPasswordDto, jsonBody(ctx));
    ctx.body = { code: 200, data: await adminService.changeMyPassword(ctx.state.admin.adminId, dto.password) };
  });

  router.get('/api/admin/system-logs', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const q = await parseDto(AdminSystemLogQueryDto, ctx.query);
    ctx.body = {
      code: 200,
      data: await adminService.listSystemLogs({ ...pageOf(q), keyword: q.keyword, action: q.action }),
    };
  });

  router.get('/api/admin/mini-api-error-logs', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const q = await parseDto(MiniApiErrorLogQueryDto, ctx.query);
    ctx.body = {
      code: 200,
      data: await clientLogService.listMiniApiErrorLogs({
        ...pageOf(q),
        keyword: q.keyword,
        method: q.method,
        statusCode: q.statusCode,
      }),
    };
  });

  router.get('/api/admin/users', adminAuth, async (ctx) => {
    const q = await parseDto(AdminListQueryDto, ctx.query);
    ctx.body = {
      code: 200,
      data: await adminService.listUsers({ ...pageOf(q), keyword: q.keyword }),
    };
  });

  router.patch('/api/admin/users/:userId/enabled', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const userId = String((ctx.params as { userId?: string }).userId || '').trim();
    const dto = await parseDto(UpdateUserEnabledDto, jsonBody(ctx));
    await adminService.writeSystemLog({
      adminId: ctx.state.admin.adminId,
      adminUsername: ctx.state.admin.username,
      ip: ctx.ip,
      action: 'USER_ENABLED_UPDATE',
      detail: { userId, enabled: dto.enabled, reason: dto.reason ?? '' },
    });
    ctx.body = {
      code: 200,
      data: await adminService.updateUserEnabled({
        userId,
        enabled: dto.enabled,
        reason: dto.reason,
      }),
    };
  });

  router.get('/api/admin/users/:userId', adminAuth, async (ctx) => {
    const userId = String((ctx.params as { userId?: string }).userId || '').trim();
    const data = await adminService.getUserDetail(userId);
    if (!data) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '用户不存在' };
      return;
    }
    ctx.body = { code: 200, data };
  });

  router.get('/api/admin/users-mini', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const idsRaw = String((ctx.query as any)?.ids || '').trim();
    const ids = idsRaw ? idsRaw.split(',').map((x) => x.trim()).filter(Boolean) : [];
    ctx.body = { code: 200, data: await adminService.listUsersMiniByIds({ ids }) };
  });

  router.get('/api/admin/admin-users', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const q = await parseDto(AdminListQueryDto, ctx.query);
    ctx.body = {
      code: 200,
      data: await adminService.listAdmins({ ...pageOf(q), keyword: q.keyword }),
    };
  });

  router.post('/api/admin/admin-users', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const dto = await parseDto(CreateAdminUserDto, jsonBody(ctx));
    await adminService.writeSystemLog({
      adminId: ctx.state.admin.adminId,
      adminUsername: ctx.state.admin.username,
      ip: ctx.ip,
      action: 'ADMIN_CREATE',
      detail: { username: dto.username, type: dto.type ?? 'OFFICIAL', orgName: dto.orgName ?? '' },
    });
    ctx.body = {
      code: 200,
      data: await adminService.createAdmin({
        username: dto.username,
        password: dto.password,
        type: dto.type,
        orgName: dto.orgName,
        boundUserId: dto.boundUserId,
      }),
    };
  });

  router.patch('/api/admin/admin-users/:adminId', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const adminId = String((ctx.params as { adminId?: string }).adminId || '').trim();
    const dto = await parseDto(UpdateAdminUserDto, jsonBody(ctx));
    await adminService.writeSystemLog({
      adminId: ctx.state.admin.adminId,
      adminUsername: ctx.state.admin.username,
      ip: ctx.ip,
      action: 'ADMIN_UPDATE',
      detail: { adminId, enabled: dto.enabled, type: dto.type, orgName: dto.orgName, boundUserId: dto.boundUserId },
    });
    ctx.body = {
      code: 200,
      data: await adminService.updateAdmin(ctx.state.admin.adminId, adminId, {
        password: dto.password,
        enabled: dto.enabled,
        type: dto.type,
        orgName: dto.orgName,
        boundUserId: dto.boundUserId,
      }),
    };
  });

  router.delete('/api/admin/admin-users/:adminId', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const adminId = String((ctx.params as { adminId?: string }).adminId || '').trim();
    await adminService.writeSystemLog({
      adminId: ctx.state.admin.adminId,
      adminUsername: ctx.state.admin.username,
      ip: ctx.ip,
      action: 'ADMIN_DELETE',
      detail: { adminId },
    });
    ctx.body = {
      code: 200,
      data: await adminService.deleteAdmin(ctx.state.admin.adminId, adminId),
    };
  });

  router.post('/api/admin/admin-users/:adminId/reset-password', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const adminId = String((ctx.params as { adminId?: string }).adminId || '').trim();
    await adminService.writeSystemLog({
      adminId: ctx.state.admin.adminId,
      adminUsername: ctx.state.admin.username,
      ip: ctx.ip,
      action: 'ADMIN_RESET_PASSWORD',
      detail: { adminId },
    });
    ctx.body = {
      code: 200,
      data: await adminService.superAdminResetRandomPassword(ctx.state.admin.adminId, adminId),
    };
  });

  router.post('/api/admin/admin-users/:adminId/unlock-login', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const adminId = String((ctx.params as { adminId?: string }).adminId || '').trim();
    await adminService.writeSystemLog({
      adminId: ctx.state.admin.adminId,
      adminUsername: ctx.state.admin.username,
      ip: ctx.ip,
      action: 'ADMIN_UNLOCK_LOGIN',
      detail: { adminId },
    });
    ctx.body = { code: 200, data: await adminService.superAdminUnlockAdminLogin(adminId) };
  });

  router.get('/api/admin/contents/:type', adminAuth, async (ctx) => {
    const type = String((ctx.params as { type?: string }).type || '').trim();
    if (!contentTypes.has(type)) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '内容类型不存在' };
      return;
    }
    const q = await parseDto(AdminContentQueryDto, ctx.query);
    ctx.body = {
      code: 200,
      data: await adminService.listContent(type as 'errands' | 'posts' | 'items' | 'tasks', {
        ...pageOf(q),
        keyword: q.keyword,
        visibility: q.visibility,
      }),
    };
  });

  router.get('/api/admin/contents/:type/:id', adminAuth, async (ctx) => {
    const type = String((ctx.params as { type?: string }).type || '').trim();
    const id = String((ctx.params as { id?: string }).id || '').trim();
    if (!contentTypes.has(type)) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '内容类型不存在' };
      return;
    }
    const data = await adminService.getContentDetail(type as 'errands' | 'posts' | 'items' | 'tasks', id);
    if (!data) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '内容不存在' };
      return;
    }
    ctx.body = { code: 200, data };
  });

  router.post('/api/admin/contents/:type', adminAuth, async (ctx) => {
    const type = String((ctx.params as { type?: string }).type || '').trim();
    if (!contentTypes.has(type)) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '内容类型不存在' };
      return;
    }
    const dto = await parseDto(AdminCreateContentDto, jsonBody(ctx));
    ctx.body = {
      code: 200,
      data: await adminService.createContent(
        type as 'errands' | 'posts' | 'items' | 'tasks',
        dto,
        ctx.state.admin,
      ),
    };
  });

  router.patch('/api/admin/contents/:type/:id', adminAuth, async (ctx) => {
    const type = String((ctx.params as { type?: string }).type || '').trim();
    const id = String((ctx.params as { id?: string }).id || '').trim();
    if (!contentTypes.has(type)) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '内容类型不存在' };
      return;
    }
    const dto = await parseDto(AdminUpdateContentDto, jsonBody(ctx));
    ctx.body = {
      code: 200,
      data: await adminService.updateContentFields(
        type as 'errands' | 'posts' | 'items' | 'tasks',
        id,
        dto,
        ctx.state.admin,
      ),
    };
  });

  router.delete('/api/admin/contents/:type/:id', adminAuth, async (ctx) => {
    const type = String((ctx.params as { type?: string }).type || '').trim();
    const id = String((ctx.params as { id?: string }).id || '').trim();
    if (!contentTypes.has(type)) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '内容类型不存在' };
      return;
    }
    ctx.body = {
      code: 200,
      data: await adminService.deleteContent(
        type as 'errands' | 'posts' | 'items' | 'tasks',
        id,
        ctx.state.admin,
      ),
    };
  });

  router.patch('/api/admin/contents/:type/:id/state', adminAuth, async (ctx) => {
    const type = String((ctx.params as { type?: string }).type || '').trim();
    const id = String((ctx.params as { id?: string }).id || '').trim();
    if (!contentTypes.has(type)) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '内容类型不存在' };
      return;
    }
    const dto = await parseDto(UpdateContentStateDto, jsonBody(ctx));
    ctx.body = {
      code: 200,
      data: await adminService.updateContentState(
        type as 'errands' | 'posts' | 'items' | 'tasks',
        id,
        {
          visibility: dto.visibility,
          pinned: dto.pinned,
        },
        ctx.state.admin,
      ),
    };
  });

  router.patch('/api/admin/contents/:type/state/batch', adminAuth, async (ctx) => {
    const type = String((ctx.params as { type?: string }).type || '').trim();
    if (!contentTypes.has(type)) {
      ctx.status = 404;
      ctx.body = { statusCode: 404, message: '内容类型不存在' };
      return;
    }
    const dto = await parseDto(BatchUpdateContentStateDto, jsonBody(ctx));
    ctx.body = {
      code: 200,
      data: await adminService.batchUpdateContentState(
        type as 'errands' | 'posts' | 'items' | 'tasks',
        dto.ids,
        {
          visibility: dto.visibility,
          pinned: dto.pinned,
        },
        ctx.state.admin,
      ),
    };
  });

  router.post('/api/admin/upload/cos/credentials', adminAuth, async (ctx) => {
    const dto = await parseDto(CosCredentialsDto, jsonBody(ctx));
    ctx.body = {
      code: 200,
      data: await uploadService.getStsCredentials({
        userId: ctx.state.admin.adminId,
        module: dto.module,
        type: dto.type,
      }),
    };
  });

  router.post('/api/admin/upload/media', adminAuth, async (ctx) => {
    const form = await parseMultipartForm(ctx.req, ctx.headers['content-type'] || '', {
      maxBytes: uploadMaxBytes,
    });
    const file = form.files.find((x) => x.fieldName === 'file') || form.files[0];
    if (!file) {
      ctx.status = 400;
      ctx.body = { statusCode: 400, message: '缺少上传文件' };
      return;
    }
    ctx.body = {
      code: 200,
      data: await uploadService.uploadMedia({
        userId: ctx.state.admin.adminId,
        module: form.fields.module,
        type: form.fields.type,
        filename: file.filename,
        contentType: file.contentType,
        buffer: file.buffer,
      }),
    };
  });

  router.get('/api/admin/app-settings/module-entry-tabs', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    ctx.body = { code: 200, data: await settingsService.listModuleEntryTabsForAdmin() };
  });

  router.patch('/api/admin/app-settings/module-entry-tabs/:key', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const key = String((ctx.params as { key?: string }).key || '').trim();
    const dto = await parseDto(UpdateModuleTabEnabledDto, jsonBody(ctx));
    ctx.body = { code: 200, data: await settingsService.setModuleTabEnabled(key, dto.enabled) };
  });
}
