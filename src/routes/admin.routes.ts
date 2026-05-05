import Router from '@koa/router';
import { adminAuth, requireSuperAdmin } from '../middleware/admin-auth';
import {
  AdminContentQueryDto,
  AdminListQueryDto,
  AdminLoginDto,
  BatchUpdateContentStateDto,
  CreateAdminUserDto,
  UpdateAdminUserDto,
  UpdateContentStateDto,
  UpdateUserEnabledDto,
} from '../modules/admin/admin.dto';
import { AdminService } from '../modules/admin/admin.service';
import { parseDto } from '../validate';
import { jsonBody } from './json-body';

const contentTypes = new Set(['errands', 'posts', 'items', 'tasks']);

function pageOf(q: { page?: number; pageSize?: number }) {
  return {
    page: q.page ?? 1,
    pageSize: q.pageSize ?? 20,
  };
}

export function registerAdminRoutes(router: Router, adminService: AdminService) {
  router.post('/api/admin/auth/login', async (ctx) => {
    const dto = await parseDto(AdminLoginDto, jsonBody(ctx));
    ctx.body = { code: 200, data: await adminService.login(dto.username, dto.password) };
  });

  router.get('/api/admin/auth/me', adminAuth, async (ctx) => {
    ctx.body = { code: 200, data: await adminService.getMe(ctx.state.admin.adminId) };
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
    ctx.body = {
      code: 200,
      data: await adminService.createAdmin({
        username: dto.username,
        password: dto.password,
        type: dto.type,
        orgName: dto.orgName,
      }),
    };
  });

  router.patch('/api/admin/admin-users/:adminId', adminAuth, async (ctx) => {
    if (!requireSuperAdmin(ctx)) return;
    const adminId = String((ctx.params as { adminId?: string }).adminId || '').trim();
    const dto = await parseDto(UpdateAdminUserDto, jsonBody(ctx));
    ctx.body = {
      code: 200,
      data: await adminService.updateAdmin(ctx.state.admin.adminId, adminId, {
        password: dto.password,
        enabled: dto.enabled,
        type: dto.type,
        orgName: dto.orgName,
      }),
    };
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
      data: await adminService.updateContentState(type as 'errands' | 'posts' | 'items' | 'tasks', id, {
        visibility: dto.visibility,
        pinned: dto.pinned,
      }),
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
      data: await adminService.batchUpdateContentState(type as 'errands' | 'posts' | 'items' | 'tasks', dto.ids, {
        visibility: dto.visibility,
        pinned: dto.pinned,
      }),
    };
  });
}
