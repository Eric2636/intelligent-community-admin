import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { ErrandStatus, Prisma, TaskStatus } from '@prisma/client';
import { HttpError } from '../../http-error';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import {
  invalidateErrandListCache,
  invalidateErrandRepliesCache,
  invalidateForumPostListCache,
  invalidateForumPostRepliesCache,
  invalidateMallItemDetailCache,
  invalidateMallItemsListCache,
  invalidatePendingTasksListCache,
} from '../../lib/redis-cache';
import { getRedisClient } from '../../lib/redis-cache';
import type { AdminCreateContentDto, AdminUpdateContentDto } from './admin.dto';
import { MallCommentService } from '../mall/mall-comment.service';
import { MALL_CATEGORIES } from '../mall/mall.constants';
import { jsonImages } from '../mall/mall.serialize';
import {
  createCaptcha,
  getIpLockUntil,
  markLoginFailed,
  shouldRequireCaptcha,
  verifyCaptcha,
  clearLoginFailState,
  clearIpLock,
  setAdminLastIp,
  getAdminLastIp,
} from './admin-login-security';

type AdminTokenPayload = {
  sub: string;
  username: string;
  role: 'ADMIN' | 'SUPERADMIN';
};

function randomAdminPassword(length = 14): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let s = '';
  for (let i = 0; i < length; i++) {
    s += alphabet[bytes[i]! % alphabet.length];
  }
  return s;
}

export type AdminOperator = {
  adminId: string;
  role: 'ADMIN' | 'SUPERADMIN';
};

function adminJwtSecret() {
  return process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET;
}

function adminSelect() {
  return {
    id: true,
    username: true,
    role: true,
    type: true,
    orgName: true,
    boundUserId: true,
    enabled: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.AdminUserSelect;
}

function mapAdmin(row: Prisma.AdminUserGetPayload<{ select: ReturnType<typeof adminSelect> }>) {
  return {
    ...row,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const MAX_ERRAND_IMAGES = 9;
const MAX_ERRAND_VIDEOS = 2;
const MAX_POST_IMAGES = 9;
const MAX_POST_VIDEOS = 2;
const MAX_TASK_IMAGES = 9;
const MAX_TASK_VIDEOS = 2;

const ERRAND_STATUS_SET = new Set<ErrandStatus>(['PENDING_TAKE', 'IN_PROGRESS', 'COMPLETED']);
const TASK_STATUS_SET = new Set<TaskStatus>([
  'DRAFT',
  'PENDING_TAKE',
  'IN_PROGRESS',
  'PENDING_CONFIRM',
  'COMPLETED',
  'CANCELLED',
]);

function jsonMedia(arr: string[]): Prisma.InputJsonValue {
  return arr as unknown as Prisma.InputJsonValue;
}

function parseRewardYuan(raw: string): { value: string } | { error: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { error: '请输入佣金（元）' };
  const n = parseFloat(s);
  if (Number.isNaN(n) || n <= 0) return { error: '请输入有效佣金（元）' };
  if (n > 99999) return { error: '佣金金额过大' };
  return { value: String(n) };
}

export class AdminService {
  private readonly mallComments = new MallCommentService();

  async writeSystemLog(params: {
    adminId: string;
    adminUsername: string;
    ip: string;
    action: string;
    detail?: unknown;
  }) {
    const adminId = String(params.adminId || '').trim();
    const adminUsername = String(params.adminUsername || '').trim();
    const ip = String(params.ip || '').trim() || 'unknown';
    const action = String(params.action || '').trim();
    if (!adminId || !adminUsername || !action) return;
    await prisma.adminSystemLog.create({
      data: {
        adminId,
        adminUsername,
        ip,
        action,
        detail: params.detail as any,
      },
    });
  }

  async listSystemLogs(params: { page: number; pageSize: number; keyword?: string; action?: string }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const keyword = params.keyword?.trim();
    const action = params.action?.trim();

    const where: Prisma.AdminSystemLogWhereInput = {
      ...(action ? { action } : {}),
      ...(keyword
        ? {
            OR: [
              { adminUsername: { contains: keyword } },
              { ip: { contains: keyword } },
              { action: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.adminSystemLog.count({ where }),
      prisma.adminSystemLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      list: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async createLoginCaptcha() {
    const r = getRedisClient();
    return createCaptcha(r);
  }

  async loginWithSecurity(params: {
    username: string;
    password: string;
    captchaId?: string;
    captchaCode?: string;
    ip?: string;
  }): Promise<
    | { ok: true; data: { token: string; expiresIn: string; admin: ReturnType<typeof mapAdmin> } }
    | { ok: false; statusCode: number; body: any }
  > {
    const username = String(params.username || '').trim();
    const password = String(params.password || '').trim();
    const ip = String(params.ip || '').trim() || 'unknown';
    if (!username || !password) {
      return { ok: false, statusCode: 400, body: { statusCode: 400, message: '用户名或密码不能为空' } };
    }

    const r = getRedisClient();
    const adminForId = await prisma.adminUser.findUnique({ where: { username }, select: { id: true } });
    const adminId = adminForId?.id ?? '';
    if (adminId) await setAdminLastIp(r, adminId, ip);
    try {
      const lockUntil = await getIpLockUntil(r, ip);
      if (lockUntil) {
        return {
          ok: false,
          statusCode: 429,
          body: { statusCode: 429, message: '该 IP 登录失败次数过多，请稍后再试', lockUntil },
        };
      }

      const needCaptcha = await shouldRequireCaptcha(r, username, ip);
      if (needCaptcha) {
        const ok = await verifyCaptcha(r, params.captchaId || '', params.captchaCode || '');
        if (!ok) {
          return {
            ok: false,
            statusCode: 400,
            body: { statusCode: 400, message: '验证码错误', needCaptcha: true },
          };
        }
      }

      // 复用原登录逻辑
      const data = await this.login(username, password);
      if (data?.admin?.id) {
        await this.writeSystemLog({
          adminId: data.admin.id,
          adminUsername: data.admin.username,
          ip,
          action: 'LOGIN',
          detail: { username },
        });
      }
      await clearLoginFailState(r, username, ip);
      return { ok: true, data };
    } catch (e) {
      // 仅处理“用户名或密码错误”这类失败；其他异常按原错误抛出
      const msg = e instanceof HttpError ? e.message : '';
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 401 && msg.includes('用户名或密码错误')) {
        const { count, locked, lockUntil } = await markLoginFailed(r, username, ip);
        const needCaptcha = true;
        if (locked) {
          return {
            ok: false,
            statusCode: 429,
            body: { statusCode: 429, message: '该 IP 登录失败次数过多，请稍后再试', needCaptcha, lockUntil, failCount: count },
          };
        }
        return {
          ok: false,
          statusCode: 401,
          body: { statusCode: 401, message: '用户名或密码错误', needCaptcha, failCount: count },
        };
      }
      throw e;
    }
  }

  async superAdminUnlockAdminLogin(adminIdRaw: string) {
    const id = String(adminIdRaw || '').trim();
    if (!id) throw new HttpError(400, 'adminId 不能为空');
    const r = getRedisClient();
    const ip = await getAdminLastIp(r, id);
    if (!ip) throw new HttpError(400, '未找到该管理员最近登录 IP，请让其再尝试登录一次后重试解锁');
    await clearIpLock(r, ip);
    return { id, ip };
  }

  async ensureDefaultSuperAdmin() {
    const exists = await prisma.adminUser.findFirst({ where: { role: 'SUPERADMIN' } });
    if (exists) return;

    const username = process.env.SUPER_ADMIN_USERNAME || 'admin';
    const password = process.env.SUPER_ADMIN_PASSWORD || 'admin123456';
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.adminUser.create({
      data: {
        username,
        passwordHash,
        role: 'SUPERADMIN',
        type: 'OFFICIAL',
        orgName: '平台',
        enabled: true,
      },
    });
    console.log(`[admin] default super admin created: ${username}`);
  }

  async login(usernameRaw: string, password: string) {
    const username = usernameRaw.trim();
    const admin = await prisma.adminUser.findUnique({ where: { username } });
    if (!admin) throw new HttpError(401, '用户名或密码错误');
    if (!admin.enabled) throw new HttpError(403, '管理员账号已停用');

    const ok = await bcrypt.compare(password, admin.passwordHash);
    if (!ok) throw new HttpError(401, '用户名或密码错误');

    const secret = adminJwtSecret();
    if (!secret) throw new HttpError(500, '后端未配置 ADMIN_JWT_SECRET 或 JWT_SECRET');

    const expiresIn = process.env.ADMIN_JWT_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '7d';
    const payload: AdminTokenPayload = {
      sub: admin.id,
      username: admin.username,
      role: admin.role,
    };
    const signOpts: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };
    const token = jwt.sign(payload, secret, signOpts);
    const updated = await prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
      select: adminSelect(),
    });

    return { token, expiresIn, admin: mapAdmin(updated) };
  }

  async getMe(adminId: string) {
    const admin = await prisma.adminUser.findUnique({ where: { id: adminId }, select: adminSelect() });
    if (!admin) throw new HttpError(404, '管理员不存在');
    return mapAdmin(admin);
  }

  async changeMyPassword(adminId: string, passwordRaw: string) {
    const password = String(passwordRaw || '').trim();
    if (password.length < 6) throw new HttpError(400, '密码至少 6 位');
    const exists = await prisma.adminUser.findUnique({ where: { id: adminId }, select: { id: true } });
    if (!exists) throw new HttpError(404, '管理员不存在');
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash }, select: { id: true } });
    return { ok: true };
  }

  async listUsers(params: { page: number; pageSize: number; keyword?: string }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const keyword = params.keyword?.trim();
    const where: Prisma.UserWhereInput = keyword
      ? { OR: [{ name: { contains: keyword } }, { openid: { contains: keyword } }] }
      : {};

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          openid: true,
          phoneNumber: true,
          name: true,
          avatar: true,
          gender: true,
          enabled: true,
          disabledAt: true,
          disabledReason: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return {
      total,
      list: rows.map((row) => ({
        ...row,
        disabledAt: row.disabledAt ? row.disabledAt.toISOString() : '',
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  async updateUserEnabled(params: { userId: string; enabled: boolean; reason?: string }) {
    const id = params.userId.trim();
    if (!id) throw new HttpError(400, 'userId 不能为空');
    const row = await prisma.user.update({
      where: { id },
      data: params.enabled
        ? { enabled: true, disabledAt: null, disabledReason: null }
        : { enabled: false, disabledAt: new Date(), disabledReason: params.reason?.trim() || null },
      select: {
        id: true,
        enabled: true,
        disabledAt: true,
        disabledReason: true,
      },
    });
    return {
      ...row,
      disabledAt: row.disabledAt ? row.disabledAt.toISOString() : '',
    };
  }

  async getUserDetail(userIdRaw: string) {
    const userId = userIdRaw.trim();
    if (!userId) throw new HttpError(400, 'userId 不能为空');

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        openid: true,
        phoneNumber: true,
        name: true,
        avatar: true,
        gender: true,
        birth: true,
        address: true,
        photos: true,
        brief: true,
        enabled: true,
        disabledAt: true,
        disabledReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) return null;

    const [errands, posts, items, tasks] = await Promise.all([
      prisma.errand.count({ where: { authorId: userId, ...contentNotDeleted } }),
      prisma.forumPost.count({ where: { authorId: userId, ...contentNotDeleted } }),
      prisma.mallItem.count({ where: { publisherId: userId, ...contentNotDeleted } }),
      prisma.task.count({ where: { publisherId: userId, ...contentNotDeleted } }),
    ]);

    return {
      user: {
        ...user,
        disabledAt: user.disabledAt ? user.disabledAt.toISOString() : '',
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      stats: { errands, posts, items, tasks },
    };
  }

  async listUsersMiniByIds(params: { ids: string[] }) {
    const ids = (params.ids || []).map((x) => String(x).trim()).filter(Boolean);
    if (ids.length === 0) return [];
    if (ids.length > 200) throw new HttpError(400, '一次最多查询 200 个用户');
    const rows = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, openid: true },
    });
    return rows.map((r) => ({ id: r.id, name: r.name ?? '', openid: r.openid }));
  }

  async listAdmins(params: { page: number; pageSize: number; keyword?: string }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const keyword = params.keyword?.trim();
    const where: Prisma.AdminUserWhereInput = keyword ? { username: { contains: keyword } } : {};
    const [total, rows] = await Promise.all([
      prisma.adminUser.count({ where }),
      prisma.adminUser.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: adminSelect(),
      }),
    ]);
    return { total, list: rows.map(mapAdmin) };
  }

  async createAdmin(params: {
    username: string;
    password: string;
    type?: 'OFFICIAL' | 'THIRD_PARTY';
    orgName?: string;
    boundUserId?: string;
  }) {
    const username = params.username.trim();
    if (!username) throw new HttpError(400, '用户名不能为空');
    const passwordHash = await bcrypt.hash(params.password, 10);
    const type = params.type || 'OFFICIAL';
    const orgName = params.orgName?.trim() || '';
    if (type === 'THIRD_PARTY' && !orgName) {
      throw new HttpError(400, '第三方管理员请填写所属单位');
    }
    let boundUserId: string | null = null;
    if (params.boundUserId != null && params.boundUserId.trim() !== '') {
      const uid = params.boundUserId.trim();
      const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true } });
      if (!u) throw new HttpError(400, '绑定的小程序用户不存在');
      const occupied = await prisma.adminUser.findFirst({ where: { boundUserId: uid }, select: { id: true } });
      if (occupied) throw new HttpError(400, '该小程序用户已被其他管理员绑定');
      boundUserId = uid;
    }
    try {
      const row = await prisma.adminUser.create({
        data: {
          username,
          passwordHash,
          role: 'ADMIN',
          type,
          orgName: type === 'OFFICIAL' ? null : orgName,
          boundUserId,
          enabled: true,
        },
        select: adminSelect(),
      });
      return mapAdmin(row);
    } catch {
      throw new HttpError(400, '管理员用户名已存在');
    }
  }

  async updateAdmin(
    operatorId: string,
    adminId: string,
    params: {
      password?: string;
      enabled?: boolean;
      type?: 'OFFICIAL' | 'THIRD_PARTY';
      orgName?: string;
      boundUserId?: string;
    },
  ) {
    const id = adminId.trim();
    if (!id) throw new HttpError(400, 'adminId 不能为空');
    if (id === operatorId && params.enabled === false) {
      throw new HttpError(400, '不能停用当前登录账号');
    }

    const target = await prisma.adminUser.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, '管理员不存在');
    if (target.role === 'SUPERADMIN' && params.enabled === false) {
      throw new HttpError(400, '不能停用超级管理员');
    }
    if (params.password && id !== operatorId) {
      throw new HttpError(403, '仅能修改自己的登录密码');
    }

    const nextType = params.type ?? target.type;
    const nextOrgName =
      params.orgName === undefined ? (target.orgName ?? '') : (params.orgName?.trim() || '');
    if (nextType === 'THIRD_PARTY' && !nextOrgName) {
      throw new HttpError(400, '第三方管理员请填写所属单位');
    }

    let nextBound: string | null | undefined = undefined;
    if (params.boundUserId !== undefined) {
      const raw = params.boundUserId.trim();
      if (!raw) {
        nextBound = null;
      } else {
        const u = await prisma.user.findUnique({ where: { id: raw }, select: { id: true } });
        if (!u) throw new HttpError(400, '绑定的小程序用户不存在');
        const occupied = await prisma.adminUser.findFirst({
          where: { boundUserId: raw, id: { not: id } },
          select: { id: true },
        });
        if (occupied) throw new HttpError(400, '该小程序用户已被其他管理员绑定');
        nextBound = raw;
      }
    }

    const row = await prisma.adminUser.update({
      where: { id },
      data: {
        ...(params.password ? { passwordHash: await bcrypt.hash(params.password, 10) } : {}),
        ...(params.enabled === undefined ? {} : { enabled: params.enabled }),
        ...(params.type ? { type: params.type } : {}),
        ...(params.orgName === undefined && nextType !== 'OFFICIAL'
          ? {}
          : { orgName: nextType === 'OFFICIAL' ? null : nextOrgName }),
        ...(nextBound === undefined ? {} : { boundUserId: nextBound }),
      },
      select: adminSelect(),
    });
    return mapAdmin(row);
  }

  /** 超级管理员将其他普通管理员的登录密码重置为随机字符串（接口一次性返回明文）。 */
  async superAdminResetRandomPassword(operatorId: string, targetAdminId: string) {
    const id = targetAdminId.trim();
    if (!id) throw new HttpError(400, 'adminId 不能为空');
    if (id === operatorId) {
      throw new HttpError(400, '请使用「修改密码」设置您自己的登录密码');
    }
    const target = await prisma.adminUser.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, '管理员不存在');
    if (target.role === 'SUPERADMIN') {
      throw new HttpError(400, '不能重置超级管理员密码');
    }
    const plain = randomAdminPassword(14);
    const passwordHash = await bcrypt.hash(plain, 10);
    await prisma.adminUser.update({
      where: { id },
      data: { passwordHash },
      select: { id: true },
    });
    return { password: plain, username: target.username };
  }

  async deleteAdmin(operatorId: string, adminId: string) {
    const id = adminId.trim();
    if (!id) throw new HttpError(400, 'adminId 不能为空');
    if (id === operatorId) throw new HttpError(400, '不能删除当前登录账号');
    const target = await prisma.adminUser.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, '管理员不存在');
    if (target.role === 'SUPERADMIN') throw new HttpError(400, '不能删除超级管理员');
    await prisma.adminUser.delete({ where: { id } });
    return { id };
  }

  async listContent(
    type: 'errands' | 'posts' | 'items' | 'tasks',
    params: { page: number; pageSize: number; keyword?: string; visibility?: 'ONLINE' | 'OFFLINE' },
  ) {
    if (type === 'errands') return this.listErrands(params);
    if (type === 'posts') return this.listPosts(params);
    if (type === 'items') return this.listItems(params);
    return this.listTasks(params);
  }

  async updateContentState(
    type: 'errands' | 'posts' | 'items' | 'tasks',
    id: string,
    params: { visibility?: 'ONLINE' | 'OFFLINE'; pinned?: boolean },
    operator: AdminOperator,
  ) {
    const data = {
      ...(params.visibility ? { visibility: params.visibility } : {}),
      ...(params.pinned === undefined ? {} : { pinned: params.pinned }),
    };
    if (Object.keys(data).length === 0) throw new HttpError(400, '没有可更新的字段');
    if (type === 'errands') {
      const row = await prisma.errand.findFirst({
        where: { id, ...contentNotDeleted },
        select: { authorId: true },
      });
      if (!row) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, row.authorId);
      const updated = await prisma.errand.update({ where: { id }, data });
      await invalidateErrandListCache();
      return updated;
    }
    if (type === 'posts') {
      const row = await prisma.forumPost.findFirst({
        where: { id, ...contentNotDeleted },
        select: { authorId: true },
      });
      if (!row) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, row.authorId);
      const updated = await prisma.forumPost.update({ where: { id }, data });
      await invalidateForumPostListCache();
      return updated;
    }
    if (type === 'items') {
      const row = await prisma.mallItem.findFirst({
        where: { id, ...contentNotDeleted },
        select: { publisherId: true },
      });
      if (!row) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, row.publisherId);
      const updated = await prisma.mallItem.update({ where: { id }, data });
      await Promise.all([invalidateMallItemsListCache(), invalidateMallItemDetailCache(id)]);
      return updated;
    }
    const row = await prisma.task.findFirst({
      where: { id, ...contentNotDeleted },
      select: { publisherId: true },
    });
    if (!row) throw new HttpError(404, '内容不存在');
    await this.assertCanModifyContent(operator, type, row.publisherId);
    const updated = await prisma.task.update({ where: { id }, data });
    await invalidatePendingTasksListCache();
    return updated;
  }

  async getContentDetail(type: 'errands' | 'posts' | 'items' | 'tasks', id: string) {
    const contentId = id.trim();
    if (!contentId) throw new HttpError(400, 'id 不能为空');

    if (type === 'errands') {
      const row = await prisma.errand.findFirst({ where: { id: contentId, ...contentNotDeleted } });
      if (!row) return null;
      const replies = await prisma.errandReply.findMany({
        where: { errandId: contentId },
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
      return {
        ...row,
        statusText: this.errandStatusTextFrom(row.status),
        replies: replies.map((r) => ({
          id: r.id,
          _id: r.id,
          authorName: r.authorName ?? '',
          content: r.content,
          createdAt: r.createdAt.toISOString(),
          createTime: r.createdAt.toISOString(),
        })),
      };
    }

    if (type === 'posts') {
      const row = await prisma.forumPost.findFirst({ where: { id: contentId, ...contentNotDeleted } });
      if (!row) return null;
      const replies = await prisma.forumReply.findMany({
        where: { postId: contentId },
        orderBy: { createdAt: 'asc' },
        take: 300,
      });

      const replyIds = replies.map((r) => r.id);
      const reactionAgg =
        replyIds.length === 0
          ? []
          : await prisma.forumReplyReaction.groupBy({
              by: ['replyId', 'emoji'],
              where: { replyId: { in: replyIds } },
              _count: { _all: true },
            });
      const reactionMap = new Map<string, Record<string, number>>();
      for (const g of reactionAgg) {
        if (!reactionMap.has(g.replyId)) reactionMap.set(g.replyId, {});
        reactionMap.get(g.replyId)![g.emoji] = g._count._all;
      }

      type Node = {
        id: string;
        parentReplyId: string | null;
        children: Node[];
      };
      const nodes = new Map<string, Node>();
      for (const r of replies) nodes.set(r.id, { id: r.id, parentReplyId: r.parentReplyId, children: [] });
      const roots: Node[] = [];
      for (const r of replies) {
        const node = nodes.get(r.id)!;
        if (!r.parentReplyId) roots.push(node);
        else {
          const p = nodes.get(r.parentReplyId);
          if (p) p.children.push(node);
          else roots.push(node);
        }
      }

      const flatIds: string[] = [];
      const walk = (n: Node, depth: number) => {
        flatIds.push(`${n.id}::${depth}`);
        for (const c of n.children) walk(c, depth + 1);
      };
      for (const rt of roots) walk(rt, 0);
      const depthMap = new Map<string, number>();
      for (const x of flatIds) {
        const [rid, d] = x.split('::');
        depthMap.set(rid, Number(d));
      }

      return {
        ...row,
        replies: replies.map((r) => ({
          id: r.id,
          _id: r.id,
          postId: r.postId,
          parentReplyId: r.parentReplyId,
          replyToAuthorName: r.replyToAuthorName ?? '',
          authorId: r.authorId,
          authorName: r.authorName ?? '',
          content: r.content,
          images: Array.isArray(r.images) ? r.images : r.images ?? [],
          videos: Array.isArray(r.videos) ? r.videos : r.videos ?? [],
          likeCount: r.likeCount ?? 0,
          favoriteCount: r.favoriteCount ?? 0,
          reactionCounts: reactionMap.get(r.id) ?? {},
          createdAt: r.createdAt.toISOString(),
          createTime: r.createdAt.toISOString(),
          depth: depthMap.get(r.id) ?? 0,
        })),
      };
    }

    if (type === 'items') {
      const row = await prisma.mallItem.findFirst({ where: { id: contentId, ...contentNotDeleted } });
      if (!row) return null;
      const comments = await this.mallComments.listItemComments({ itemId: contentId, userId: '__admin__' });
      return { ...row, comments };
    }

    return prisma.task.findFirst({ where: { id: contentId, ...contentNotDeleted } });
  }

  private errandStatusTextFrom(raw: string) {
    const s = String(raw || '').trim();
    if (s === 'PENDING_TAKE' || s === 'pending_take') return '待领取';
    if (s === 'IN_PROGRESS' || s === 'in_progress') return '进行中';
    if (s === 'COMPLETED' || s === 'completed') return '已完成';
    return '';
  }

  async batchUpdateContentState(
    type: 'errands' | 'posts' | 'items' | 'tasks',
    ids: string[],
    params: { visibility?: 'ONLINE' | 'OFFLINE'; pinned?: boolean },
    operator: AdminOperator,
  ) {
    const contentIds = (ids || []).map((x) => String(x).trim()).filter(Boolean);
    if (contentIds.length === 0) throw new HttpError(400, 'ids 不能为空');
    if (contentIds.length > 200) throw new HttpError(400, '一次最多批量操作 200 条');

    const data = {
      ...(params.visibility ? { visibility: params.visibility } : {}),
      ...(params.pinned === undefined ? {} : { pinned: params.pinned }),
    };
    if (Object.keys(data).length === 0) throw new HttpError(400, '没有可更新的字段');

    if (operator.role !== 'SUPERADMIN') {
      const admin = await prisma.adminUser.findUnique({
        where: { id: operator.adminId },
        select: { boundUserId: true },
      });
      const bound = admin?.boundUserId?.trim();
      if (!bound) throw new HttpError(403, '未绑定小程序用户，无法批量操作');
      if (type === 'errands') {
        const bad = await prisma.errand.count({
          where: { id: { in: contentIds }, ...contentNotDeleted, authorId: { not: bound } },
        });
        if (bad > 0) throw new HttpError(403, '批量操作中包含非本人发布的内容');
      } else if (type === 'posts') {
        const bad = await prisma.forumPost.count({
          where: { id: { in: contentIds }, ...contentNotDeleted, authorId: { not: bound } },
        });
        if (bad > 0) throw new HttpError(403, '批量操作中包含非本人发布的内容');
      } else if (type === 'items') {
        const bad = await prisma.mallItem.count({
          where: { id: { in: contentIds }, ...contentNotDeleted, publisherId: { not: bound } },
        });
        if (bad > 0) throw new HttpError(403, '批量操作中包含非本人发布的内容');
      } else {
        const bad = await prisma.task.count({
          where: { id: { in: contentIds }, ...contentNotDeleted, publisherId: { not: bound } },
        });
        if (bad > 0) throw new HttpError(403, '批量操作中包含非本人发布的内容');
      }
    }

    if (type === 'errands') {
      const result = await prisma.errand.updateMany({ where: { id: { in: contentIds }, ...contentNotDeleted }, data });
      await invalidateErrandListCache();
      return result;
    }
    if (type === 'posts') {
      const result = await prisma.forumPost.updateMany({ where: { id: { in: contentIds }, ...contentNotDeleted }, data });
      await invalidateForumPostListCache();
      return result;
    }
    if (type === 'items') {
      const result = await prisma.mallItem.updateMany({
        where: { id: { in: contentIds }, ...contentNotDeleted },
        data,
      });
      await Promise.all([
        invalidateMallItemsListCache(),
        ...contentIds.map((id) => invalidateMallItemDetailCache(id)),
      ]);
      return result;
    }
    const result = await prisma.task.updateMany({
      where: { id: { in: contentIds }, ...contentNotDeleted },
      data,
    });
    await invalidatePendingTasksListCache();
    return result;
  }

  private pageArgs(params: { page: number; pageSize: number }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    return { skip: (page - 1) * pageSize, take: pageSize };
  }

  private visibilityWhere(visibility?: 'ONLINE' | 'OFFLINE') {
    return {
      ...contentNotDeleted,
      ...(visibility ? { visibility } : {}),
    };
  }

  private async listErrands(params: { page: number; pageSize: number; keyword?: string; visibility?: 'ONLINE' | 'OFFLINE' }) {
    const keyword = params.keyword?.trim();
    const where: Prisma.ErrandWhereInput = {
      ...this.visibilityWhere(params.visibility),
      ...(keyword ? { OR: [{ title: { contains: keyword } }, { content: { contains: keyword } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.errand.count({ where }),
      prisma.errand.findMany({ where, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], ...this.pageArgs(params) }),
    ]);
    return { total, list: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  }

  private async listPosts(params: { page: number; pageSize: number; keyword?: string; visibility?: 'ONLINE' | 'OFFLINE' }) {
    const keyword = params.keyword?.trim();
    const where: Prisma.ForumPostWhereInput = {
      ...this.visibilityWhere(params.visibility),
      ...(keyword ? { OR: [{ title: { contains: keyword } }, { content: { contains: keyword } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.forumPost.count({ where }),
      prisma.forumPost.findMany({ where, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], ...this.pageArgs(params) }),
    ]);
    return { total, list: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  }

  private async listItems(params: { page: number; pageSize: number; keyword?: string; visibility?: 'ONLINE' | 'OFFLINE' }) {
    const keyword = params.keyword?.trim();
    const where: Prisma.MallItemWhereInput = {
      ...this.visibilityWhere(params.visibility),
      ...(keyword ? { OR: [{ title: { contains: keyword } }, { desc: { contains: keyword } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.mallItem.count({ where }),
      prisma.mallItem.findMany({ where, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], ...this.pageArgs(params) }),
    ]);
    return { total, list: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })) };
  }

  private async listTasks(params: { page: number; pageSize: number; keyword?: string; visibility?: 'ONLINE' | 'OFFLINE' }) {
    const keyword = params.keyword?.trim();
    const where: Prisma.TaskWhereInput = {
      ...this.visibilityWhere(params.visibility),
      ...(keyword ? { OR: [{ title: { contains: keyword } }, { desc: { contains: keyword } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({ where, orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }], ...this.pageArgs(params) }),
    ]);
    return { total, list: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) };
  }

  private contentOwnerUserId(
    type: 'errands' | 'posts' | 'items' | 'tasks',
    row: { authorId?: string | null; publisherId?: string | null },
  ): string {
    if (type === 'items' || type === 'tasks') return String(row.publisherId ?? '');
    return String(row.authorId ?? '');
  }

  private async assertCanModifyContent(
    operator: AdminOperator,
    type: 'errands' | 'posts' | 'items' | 'tasks',
    ownerUserId: string,
  ) {
    if (operator.role === 'SUPERADMIN') return;
    const admin = await prisma.adminUser.findUnique({
      where: { id: operator.adminId },
      select: { boundUserId: true },
    });
    const bound = admin?.boundUserId?.trim();
    if (!bound) {
      throw new HttpError(403, '未绑定小程序用户，无法操作他人发布的内容');
    }
    if (!ownerUserId || ownerUserId !== bound) {
      throw new HttpError(403, '只能操作本人绑定用户所发布的内容');
    }
  }

  private async resolveActorUserIdForAdmin(
    actorUserId: string | undefined | null,
    operator: AdminOperator,
  ): Promise<string> {
    if (operator.role === 'SUPERADMIN') return this.resolveActorUserId(actorUserId);
    const admin = await prisma.adminUser.findUnique({
      where: { id: operator.adminId },
      select: { boundUserId: true },
    });
    const bound = admin?.boundUserId?.trim();
    if (!bound) {
      throw new HttpError(403, '未绑定小程序用户，无法发布内容，请联系超级管理员绑定用户');
    }
    const want = actorUserId?.trim();
    if (want && want !== bound) {
      throw new HttpError(403, '只能以本人绑定的小程序用户身份发布');
    }
    const u = await prisma.user.findUnique({ where: { id: bound }, select: { id: true } });
    if (!u) throw new HttpError(400, '管理员绑定的用户不存在，请重新绑定');
    return bound;
  }

  private async assertNonSuperCannotTransferPublisher(
    operator: AdminOperator,
    dtoActorUserId?: string,
  ) {
    if (operator.role === 'SUPERADMIN' || dtoActorUserId === undefined) return;
    const want = dtoActorUserId.trim();
    const admin = await prisma.adminUser.findUnique({
      where: { id: operator.adminId },
      select: { boundUserId: true },
    });
    const bound = admin?.boundUserId?.trim();
    if (!bound || want !== bound) {
      throw new HttpError(403, '不能将发布者改为其他用户');
    }
  }

  private async resolveActorUserId(actorUserId?: string | null) {
    const trimmed = actorUserId?.trim();
    if (trimmed) {
      const u = await prisma.user.findUnique({ where: { id: trimmed }, select: { id: true } });
      if (!u) throw new HttpError(400, '指定的小程序用户不存在');
      return trimmed;
    }
    const envId = process.env.ADMIN_CONTENT_DEFAULT_USER_ID?.trim();
    if (envId) {
      const u = await prisma.user.findUnique({ where: { id: envId }, select: { id: true } });
      if (!u) throw new HttpError(500, 'ADMIN_CONTENT_DEFAULT_USER_ID 对应用户不存在');
      return envId;
    }
    const first = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!first) throw new HttpError(400, '库中无小程序用户，请在请求中传入 actorUserId（发布者用户 id）');
    return first.id;
  }

  private assertMallCategoryId(categoryIdRaw: string) {
    const categoryId = categoryIdRaw.trim();
    if (!categoryId) throw new HttpError(400, 'categoryId 不能为空');
    const ok = MALL_CATEGORIES.some((c) => c.id === categoryId);
    if (!ok) {
      throw new HttpError(400, `categoryId 无效，可选：${MALL_CATEGORIES.map((c) => c.id).join(', ')}`);
    }
    return categoryId;
  }

  async createContent(
    type: 'errands' | 'posts' | 'items' | 'tasks',
    dto: AdminCreateContentDto,
    operator: AdminOperator,
  ) {
    const actorId = await this.resolveActorUserIdForAdmin(dto.actorUserId, operator);
    const vis = dto.visibility ?? 'ONLINE';
    const pin = dto.pinned ?? false;
    const op = await prisma.adminUser.findUnique({
      where: { id: operator.adminId },
      select: { orgName: true },
    });
    const adminLabel = op?.orgName?.trim() || '网站管理员';

    if (type === 'errands') {
      const title = (dto.title || '').trim();
      const content = (dto.content || '').trim();
      if (!title) throw new HttpError(400, '请输入标题');
      if (!content) throw new HttpError(400, '请输入内容');
      const rewardParsed = parseRewardYuan(dto.reward || '');
      if ('error' in rewardParsed) throw new HttpError(400, rewardParsed.error);
      const author = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
      const images = parseStrictMediaUrlList(dto.images, MAX_ERRAND_IMAGES, 'image', 'images');
      const videos = parseStrictMediaUrlList(dto.videos, MAX_ERRAND_VIDEOS, 'video', 'videos');
      const row = await prisma.errand.create({
        data: {
          title,
          content,
          reward: rewardParsed.value,
          status: 'PENDING_TAKE',
          authorId: actorId,
          authorName: author?.name ?? '',
          adminLabel,
          createdByAdminId: operator.adminId,
          images: images.length ? jsonMedia(images) : undefined,
          videos: videos.length ? jsonMedia(videos) : undefined,
          visibility: vis,
          pinned: pin,
        },
      });
      await invalidateErrandListCache();
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      };
    }

    if (type === 'posts') {
      const title = (dto.title || '').trim();
      const content = (dto.content || '').trim();
      const images = parseStrictMediaUrlList(dto.images, MAX_POST_IMAGES, 'image', 'images');
      const videos = parseStrictMediaUrlList(dto.videos, MAX_POST_VIDEOS, 'video', 'videos');
      if (!title) throw new HttpError(400, '请输入标题');
      if (!content && images.length === 0 && videos.length === 0) {
        throw new HttpError(400, '请输入内容或添加图片/视频');
      }
      const author = await prisma.user.findUnique({
        where: { id: actorId },
        select: { name: true, avatar: true },
      });
      const row = await prisma.forumPost.create({
        data: {
          title,
          content,
          images: images.length ? jsonMedia(images) : undefined,
          videos: videos.length ? jsonMedia(videos) : undefined,
          authorId: actorId,
          authorName: author?.name ?? '',
          authorAvatar: author?.avatar ?? null,
          adminLabel,
          createdByAdminId: operator.adminId,
          visibility: vis,
          pinned: pin,
        },
      });
      await invalidateForumPostListCache();
      return { ...row, createdAt: row.createdAt.toISOString() };
    }

    if (type === 'items') {
      const categoryId = this.assertMallCategoryId(dto.categoryId || '');
      const title = (dto.title || '').trim();
      const desc = (dto.desc || '').trim();
      if (!title) throw new HttpError(400, '请输入标题');
      if (!desc) throw new HttpError(400, '请输入描述');
      const legacyImages = parseStrictMediaUrlList(dto.images, 9, 'image', 'images');
      const mainImages = parseStrictMediaUrlList(dto.mainImages, 1, 'image', 'mainImages');
      const subImages = parseStrictMediaUrlList(dto.subImages, 6, 'image', 'subImages');
      const videos = parseStrictMediaUrlList(dto.videos, 2, 'video', 'videos');
      const normalizedMainImages = mainImages.length ? mainImages : legacyImages.slice(0, 1);
      const normalizedSubImages = mainImages.length ? subImages : legacyImages.slice(1, 6);
      if (normalizedMainImages.length + normalizedSubImages.length > 6) {
        throw new HttpError(400, '图片最多 6 张（主图+副图合计）');
      }
      const row = await prisma.mallItem.create({
        data: {
          categoryId,
          title,
          price: dto.price?.trim() || null,
          unit: (dto.unit?.trim() || '元').slice(0, 16),
          desc,
          contact: dto.contact?.trim() || null,
          mainImages: normalizedMainImages.length ? jsonImages(normalizedMainImages) : undefined,
          subImages: normalizedSubImages.length ? jsonImages(normalizedSubImages) : undefined,
          videos: videos.length ? jsonImages(videos) : undefined,
          images: legacyImages.length ? jsonImages(legacyImages) : undefined,
          publisherId: actorId,
          adminLabel,
          createdByAdminId: operator.adminId,
          visibility: vis,
          pinned: pin,
        },
      });
      await invalidateMallItemsListCache();
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }

    const title = (dto.title || '').trim();
    const desc = (dto.desc || '').trim();
    const reward = (dto.reward || '').trim();
    const location = (dto.location || '').trim();
    if (!title) throw new HttpError(400, 'title 不能为空');
    if (!reward) throw new HttpError(400, 'reward 不能为空');
    const images = parseStrictMediaUrlList(dto.images, MAX_TASK_IMAGES, 'image', 'images');
    const videos = parseStrictMediaUrlList(dto.videos, MAX_TASK_VIDEOS, 'video', 'videos');
    if (!desc && images.length === 0 && videos.length === 0) {
      throw new HttpError(400, 'desc 与图片/视频至少填一项');
    }
    const publisher = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const row = await prisma.task.create({
      data: {
        title,
        desc,
        reward,
        location: location || '',
        images,
        videos,
        status: 'PENDING_TAKE',
        publisherId: actorId,
        publisherName: publisher?.name ?? '',
        adminLabel,
        createdByAdminId: operator.adminId,
        visibility: vis,
        pinned: pin,
      },
    });
    await invalidatePendingTasksListCache();
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    };
  }

  async updateContentFields(
    type: 'errands' | 'posts' | 'items' | 'tasks',
    idRaw: string,
    dto: AdminUpdateContentDto,
    operator: AdminOperator,
  ) {
    const id = idRaw.trim();
    if (!id) throw new HttpError(400, 'id 不能为空');

    const touched =
      dto.actorUserId !== undefined ||
      dto.title !== undefined ||
      dto.content !== undefined ||
      dto.desc !== undefined ||
      dto.reward !== undefined ||
      dto.location !== undefined ||
      dto.categoryId !== undefined ||
      dto.price !== undefined ||
      dto.unit !== undefined ||
      dto.contact !== undefined ||
      dto.visibility !== undefined ||
      dto.pinned !== undefined ||
      dto.status !== undefined ||
      dto.images !== undefined ||
      dto.videos !== undefined ||
      dto.mainImages !== undefined ||
      dto.subImages !== undefined;
    if (!touched) throw new HttpError(400, '没有可更新的字段');

    await this.assertNonSuperCannotTransferPublisher(operator, dto.actorUserId);

    if (type === 'errands') {
      const existing = await prisma.errand.findFirst({ where: { id, ...contentNotDeleted } });
      if (!existing) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, this.contentOwnerUserId(type, existing));
      const data: Prisma.ErrandUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title.trim();
      if (dto.content !== undefined) data.content = dto.content.trim();
      if (dto.reward !== undefined) {
        const rewardParsed = parseRewardYuan(dto.reward);
        if ('error' in rewardParsed) throw new HttpError(400, rewardParsed.error);
        data.reward = rewardParsed.value;
      }
      if (dto.visibility !== undefined) data.visibility = dto.visibility;
      if (dto.pinned !== undefined) data.pinned = dto.pinned;
      if (dto.images !== undefined) {
        const images = parseStrictMediaUrlList(dto.images, MAX_ERRAND_IMAGES, 'image', 'images');
        data.images = jsonMedia(images);
      }
      if (dto.videos !== undefined) {
        const videos = parseStrictMediaUrlList(dto.videos, MAX_ERRAND_VIDEOS, 'video', 'videos');
        data.videos = jsonMedia(videos);
      }
      if (dto.status !== undefined) {
        const st = dto.status.trim() as ErrandStatus;
        if (!ERRAND_STATUS_SET.has(st)) throw new HttpError(400, '无效的跑腿状态');
        data.status = st;
        if (st === 'PENDING_TAKE' && existing.status !== 'PENDING_TAKE') {
          data.claimerId = null;
          data.claimerName = null;
          data.claimedAt = null;
        }
      }
      if (dto.actorUserId !== undefined) {
        const aid = await this.resolveActorUserId(dto.actorUserId);
        const author = await prisma.user.findUnique({ where: { id: aid }, select: { name: true } });
        data.authorId = aid;
        data.authorName = author?.name ?? '';
      }
      const row = await prisma.errand.update({ where: { id }, data });
      await Promise.all([invalidateErrandListCache(), invalidateErrandRepliesCache(id)]);
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      };
    }

    if (type === 'posts') {
      const existing = await prisma.forumPost.findFirst({ where: { id, ...contentNotDeleted } });
      if (!existing) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, this.contentOwnerUserId(type, existing));
      const data: Prisma.ForumPostUpdateInput = {};
      if (dto.title !== undefined) data.title = dto.title.trim();
      if (dto.content !== undefined) data.content = dto.content.trim();
      if (dto.visibility !== undefined) data.visibility = dto.visibility;
      if (dto.pinned !== undefined) data.pinned = dto.pinned;
      if (dto.images !== undefined) {
        const images = parseStrictMediaUrlList(dto.images, MAX_POST_IMAGES, 'image', 'images');
        data.images = jsonMedia(images);
      }
      if (dto.videos !== undefined) {
        const videos = parseStrictMediaUrlList(dto.videos, MAX_POST_VIDEOS, 'video', 'videos');
        data.videos = jsonMedia(videos);
      }
      if (dto.actorUserId !== undefined) {
        const aid = await this.resolveActorUserId(dto.actorUserId);
        const author = await prisma.user.findUnique({
          where: { id: aid },
          select: { name: true, avatar: true },
        });
        data.authorId = aid;
        data.authorName = author?.name ?? '';
        data.authorAvatar = author?.avatar ?? null;
      }
      const row = await prisma.forumPost.update({ where: { id }, data });
      await Promise.all([invalidateForumPostListCache(), invalidateForumPostRepliesCache(id)]);
      return { ...row, createdAt: row.createdAt.toISOString() };
    }

    if (type === 'items') {
      const existing = await prisma.mallItem.findFirst({ where: { id, ...contentNotDeleted } });
      if (!existing) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, this.contentOwnerUserId(type, existing));
      const data: Prisma.MallItemUpdateInput = {};
      if (dto.categoryId !== undefined) data.categoryId = this.assertMallCategoryId(dto.categoryId);
      if (dto.title !== undefined) data.title = dto.title.trim();
      if (dto.desc !== undefined) data.desc = dto.desc.trim();
      if (dto.price !== undefined) data.price = dto.price.trim() || null;
      if (dto.unit !== undefined) data.unit = (dto.unit.trim() || '元').slice(0, 16);
      if (dto.contact !== undefined) data.contact = dto.contact.trim() || null;
      if (dto.visibility !== undefined) data.visibility = dto.visibility;
      if (dto.pinned !== undefined) data.pinned = dto.pinned;
      if (dto.actorUserId !== undefined) {
        const aid = await this.resolveActorUserId(dto.actorUserId);
        data.publisherId = aid;
      }
      if (dto.images !== undefined || dto.mainImages !== undefined || dto.subImages !== undefined) {
        const legacyImages = parseStrictMediaUrlList(
          dto.images !== undefined ? dto.images : [],
          9,
          'image',
          'images',
        );
        const mainImages = parseStrictMediaUrlList(
          dto.mainImages !== undefined ? dto.mainImages : [],
          1,
          'image',
          'mainImages',
        );
        const subImages = parseStrictMediaUrlList(
          dto.subImages !== undefined ? dto.subImages : [],
          6,
          'image',
          'subImages',
        );
        let normMain: string[];
        let normSub: string[];
        if (dto.mainImages !== undefined || dto.subImages !== undefined) {
          normMain = mainImages.length ? mainImages : legacyImages.slice(0, 1);
          normSub = subImages.length ? subImages : legacyImages.slice(1, 6);
        } else {
          const curMain = Array.isArray(existing.mainImages)
            ? (existing.mainImages as string[])
            : [];
          const curSub = Array.isArray(existing.subImages) ? (existing.subImages as string[]) : [];
          const curLegacy = Array.isArray(existing.images) ? (existing.images as string[]) : [];
          const baseMain = curMain.length ? curMain : curLegacy.slice(0, 1);
          const baseSub = curSub.length ? curSub : curLegacy.slice(1, 6);
          normMain = legacyImages.length ? legacyImages.slice(0, 1) : baseMain;
          normSub = legacyImages.length > 1 ? legacyImages.slice(1, 6) : baseSub;
        }
        if (normMain.length + normSub.length > 6) throw new HttpError(400, '图片最多 6 张（主图+副图合计）');
        data.mainImages = normMain.length ? jsonImages(normMain) : [];
        data.subImages = normSub.length ? jsonImages(normSub) : [];
        if (dto.images !== undefined) data.images = legacyImages.length ? jsonImages(legacyImages) : [];
      }
      if (dto.videos !== undefined) {
        const videos = parseStrictMediaUrlList(dto.videos, 2, 'video', 'videos');
        data.videos = videos.length ? jsonImages(videos) : [];
      }
      const row = await prisma.mallItem.update({ where: { id }, data });
      await Promise.all([invalidateMallItemsListCache(), invalidateMallItemDetailCache(id)]);
      return {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    }

    const existing = await prisma.task.findFirst({ where: { id, ...contentNotDeleted } });
    if (!existing) throw new HttpError(404, '内容不存在');
    await this.assertCanModifyContent(operator, type, this.contentOwnerUserId(type, existing));
    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.desc !== undefined) data.desc = dto.desc.trim();
    if (dto.reward !== undefined) data.reward = dto.reward.trim();
    if (dto.location !== undefined) data.location = dto.location.trim();
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    if (dto.pinned !== undefined) data.pinned = dto.pinned;
    if (dto.images !== undefined) {
      data.images = parseStrictMediaUrlList(dto.images, MAX_TASK_IMAGES, 'image', 'images');
    }
    if (dto.videos !== undefined) {
      data.videos = parseStrictMediaUrlList(dto.videos, MAX_TASK_VIDEOS, 'video', 'videos');
    }
    if (dto.status !== undefined) {
      const st = dto.status.trim() as TaskStatus;
      if (!TASK_STATUS_SET.has(st)) throw new HttpError(400, '无效的任务状态');
      data.status = st;
    }
    if (dto.actorUserId !== undefined) {
      const aid = await this.resolveActorUserId(dto.actorUserId);
      const publisher = await prisma.user.findUnique({ where: { id: aid }, select: { name: true } });
      data.publisherId = aid;
      data.publisherName = publisher?.name ?? '';
    }
    const row = await prisma.task.update({ where: { id }, data });
    await invalidatePendingTasksListCache();
    return {
      ...row,
      createdAt: row.createdAt.toISOString(),
      claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    };
  }

  async deleteContent(
    type: 'errands' | 'posts' | 'items' | 'tasks',
    idRaw: string,
    operator: AdminOperator,
  ) {
    const id = idRaw.trim();
    if (!id) throw new HttpError(400, 'id 不能为空');
    const now = new Date();

    if (type === 'errands') {
      const row = await prisma.errand.findFirst({ where: { id, ...contentNotDeleted } });
      if (!row) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, row.authorId);
      await prisma.errand.update({ where: { id }, data: { deletedAt: now } });
      await Promise.all([invalidateErrandListCache(), invalidateErrandRepliesCache(id)]);
      return { id };
    }

    if (type === 'posts') {
      const row = await prisma.forumPost.findFirst({ where: { id, ...contentNotDeleted } });
      if (!row) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, row.authorId);
      await prisma.forumPost.update({ where: { id }, data: { deletedAt: now } });
      await Promise.all([invalidateForumPostListCache(), invalidateForumPostRepliesCache(id)]);
      return { id };
    }

    if (type === 'items') {
      const row = await prisma.mallItem.findFirst({ where: { id, ...contentNotDeleted } });
      if (!row) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, row.publisherId);
      await prisma.mallItem.update({ where: { id }, data: { deletedAt: now } });
      await Promise.all([invalidateMallItemsListCache(), invalidateMallItemDetailCache(id)]);
      return { id };
    }

    const row = await prisma.task.findFirst({ where: { id, ...contentNotDeleted } });
    if (!row) throw new HttpError(404, '内容不存在');
    await this.assertCanModifyContent(operator, type, row.publisherId);
    await prisma.task.update({ where: { id }, data: { deletedAt: now } });
    await invalidatePendingTasksListCache();
    return { id };
  }
}
