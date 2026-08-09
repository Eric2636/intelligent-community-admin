import { randomBytes } from 'node:crypto';
import type { Prisma, TaskStatus } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { HttpError } from '../../http-error';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import {
  invalidateForumPostListCache,
  invalidateForumPostRepliesCache,
  invalidateMallItemDetailCache,
  invalidateMallItemsListCache,
  invalidatePendingTasksListCache,
  getRedisClient,
} from '../../lib/redis-cache';
import { MallCategoryService } from '../mall/mall-category.service';
import { MallCommentService } from '../mall/mall-comment.service';
import {
  assertMallItemHasContact,
  normalizeLegacyContact,
  normalizePhoneContact,
  normalizePhoneIsWechat,
  normalizeWechatContact,
} from '../mall/mall-contact';
import { jsonImages } from '../mall/mall.serialize';
import { avatarOrDefault } from '../user/default-avatar';
import { resolveEffectiveUserTags } from '../user/user-identity';
import { lockUsersForProfileSnapshot } from '../user/user-profile-sync';
import { runAdminContentMutation } from './admin-content-mutation';
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
import { AdminSessionReplacedError, openAdminSession } from './admin-session';
import type { AdminCreateContentDto, AdminUpdateContentDto } from './admin.dto';

type AdminTokenPayload = {
  sub: string;
  username: string;
  role: 'ADMIN' | 'SUPERADMIN';
  typ: 'access' | 'refresh';
  sessionVersion: number;
};

type AdminLoginFailureBody = {
  statusCode: number;
  message: string;
  needCaptcha?: boolean;
  lockUntil?: number | null;
  failCount?: number;
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

export const DEFAULT_SUPER_ADMIN_ORG_NAME = '平台管理员';

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
    sessionVersion: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.AdminUserSelect;
}

function mapAdmin(row: Prisma.AdminUserGetPayload<{ select: ReturnType<typeof adminSelect> }>) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    type: row.type,
    orgName: row.orgName,
    boundUserId: row.boundUserId,
    enabled: row.enabled,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : '',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const MAX_POST_IMAGES = 9;
const MAX_POST_VIDEOS = 2;
const MAX_TASK_IMAGES = 9;
const MAX_TASK_VIDEOS = 2;

const FORUM_POST_TYPE_SET = new Set(['NORMAL', 'ANNOUNCEMENT']);
const ADMIN_ANNOUNCEMENT_AUTHOR_ID = '__admin_announcement__';

function jsonMedia(arr: string[]): Prisma.InputJsonValue {
  return arr as unknown as Prisma.InputJsonValue;
}

function parseForumPostType(raw: string | undefined): 'NORMAL' | 'ANNOUNCEMENT' {
  const value = String(raw || 'NORMAL').trim();
  return FORUM_POST_TYPE_SET.has(value) ? (value as 'NORMAL' | 'ANNOUNCEMENT') : 'NORMAL';
}

function parseAnnouncementValidUntil(raw: string | undefined, postType: 'NORMAL' | 'ANNOUNCEMENT') {
  if (postType !== 'ANNOUNCEMENT') return null;
  const value = String(raw || '').trim();
  if (!value) throw new HttpError(400, '公告请选择过期时间');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, '公告过期时间无效');
  if (date.getTime() <= Date.now()) throw new HttpError(400, '公告过期时间必须晚于当前时间');
  return date;
}

export async function updateAdminTaskContentCas(
  tx: Prisma.TransactionClient,
  params: {
    id: string;
    publisherId: string;
    status: string;
    version: number;
    data: Prisma.TaskUpdateInput;
  },
) {
  const transition = await tx.task.updateMany({
    where: {
      id: params.id,
      publisherId: params.publisherId,
      status: params.status as TaskStatus,
      version: params.version,
      ...contentNotDeleted,
    },
    data: {
      ...params.data,
      version: { increment: 1 },
    },
  });
  if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
  const row = await tx.task.findUnique({ where: { id: params.id } });
  if (!row) throw new HttpError(404, '内容不存在');
  return row;
}

export class AdminService {
  private readonly mallComments = new MallCommentService();
  private readonly mallCategories = new MallCategoryService();

  async writeSystemLog(params: {
    adminId: string;
    adminUsername: string;
    ip: string;
    action: string;
    moduleKey?: string;
    detail?: Prisma.InputJsonValue;
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
        moduleKey: params.moduleKey?.trim() || null,
        detail: params.detail,
      },
    });
  }

  async listSystemLogs(params: { page: number; pageSize: number; keyword?: string; action?: string }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const keyword = params.keyword?.trim();
    const action = params.action?.trim();

    const where: Prisma.AdminSystemLogWhereInput = {
      // Historical page-view records are intentionally excluded: an audit log
      // should describe a state-changing administrative action, not navigation.
      ...(action ? { action } : { action: { not: 'ADMIN_MODULE_VIEW' } }),
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
    requestUrl?: string;
  }): Promise<
    | {
        ok: true;
        data: {
          token: string;
          accessToken: string;
          refreshToken: string;
          expiresIn: string;
          refreshExpiresIn: string;
          admin: ReturnType<typeof mapAdmin>;
        };
      }
    | { ok: false; statusCode: number; body: AdminLoginFailureBody }
  > {
    const username = String(params.username || '').trim();
    const password = String(params.password || '').trim();
    const ip = String(params.ip || '').trim() || 'unknown';
    if (!username || !password) {
      return {
        ok: false,
        statusCode: 400,
        body: { statusCode: 400, message: '用户名或密码不能为空' },
      };
    }

    const r = getRedisClient();
    const adminForId = await prisma.adminUser.findUnique({
      where: { username },
      select: { id: true },
    });
    const adminId = adminForId?.id ?? '';
    if (adminId) await setAdminLastIp(r, adminId, ip);
    try {
      const lockUntil = await getIpLockUntil(r, ip);
      if (lockUntil) {
        return {
          ok: false,
          statusCode: 429,
          body: {
            statusCode: 429,
            message: '该 IP 登录失败次数过多，请稍后再试',
            lockUntil,
          },
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
          detail: { username, ...(params.requestUrl ? { requestUrl: params.requestUrl } : {}) },
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
            body: {
              statusCode: 429,
              message: '该 IP 登录失败次数过多，请稍后再试',
              needCaptcha,
              lockUntil,
              failCount: count,
            },
          };
        }
        return {
          ok: false,
          statusCode: 401,
          body: {
            statusCode: 401,
            message: '用户名或密码错误',
            needCaptcha,
            failCount: count,
          },
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
    const exists = await prisma.adminUser.findFirst({
      where: { role: 'SUPERADMIN' },
    });
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
        orgName: DEFAULT_SUPER_ADMIN_ORG_NAME,
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

    const expiresIn = process.env.ADMIN_JWT_EXPIRES_IN || '3h';
    const refreshExpiresIn = process.env.ADMIN_REFRESH_JWT_EXPIRES_IN || '3h';
    const session = await openAdminSession(prisma.adminUser, admin.id);
    const basePayload = {
      sub: admin.id,
      username: admin.username,
      role: admin.role,
      sessionVersion: session.sessionVersion,
    } satisfies Omit<AdminTokenPayload, 'typ'>;
    const signOpts: SignOptions = {
      expiresIn: expiresIn as SignOptions['expiresIn'],
    };
    const refreshSignOpts: SignOptions = {
      expiresIn: refreshExpiresIn as SignOptions['expiresIn'],
    };
    const token = jwt.sign({ ...basePayload, typ: 'access' }, secret, signOpts);
    const refreshToken = jwt.sign({ ...basePayload, typ: 'refresh' }, secret, refreshSignOpts);
    const updated = await prisma.adminUser.findUnique({
      where: { id: admin.id },
      select: adminSelect(),
    });
    if (!updated) throw new HttpError(404, '管理员不存在');

    return {
      token,
      accessToken: token,
      refreshToken,
      expiresIn,
      refreshExpiresIn,
      admin: mapAdmin(updated),
    };
  }

  async refreshToken(refreshTokenRaw: string) {
    const refreshToken = String(refreshTokenRaw || '').trim();
    if (!refreshToken) throw new HttpError(401, 'refreshToken 不能为空');

    const secret = adminJwtSecret();
    if (!secret) throw new HttpError(500, '后端未配置 ADMIN_JWT_SECRET 或 JWT_SECRET');

    let payload: AdminTokenPayload;
    try {
      payload = jwt.verify(refreshToken, secret) as AdminTokenPayload;
    } catch {
      throw new HttpError(401, 'refreshToken 无效或已过期');
    }
    if (payload.typ !== 'refresh') throw new HttpError(401, 'refreshToken 类型错误');

    const admin = await prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: adminSelect(),
    });
    if (!admin) throw new HttpError(404, '管理员不存在');
    if (!admin.enabled) throw new HttpError(403, '管理员账号已停用');
    if (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion !== admin.sessionVersion) {
      throw new AdminSessionReplacedError();
    }

    const expiresIn = process.env.ADMIN_JWT_EXPIRES_IN || '3h';
    const accessPayload: AdminTokenPayload = {
      sub: admin.id,
      username: admin.username,
      role: admin.role,
      typ: 'access',
      sessionVersion: admin.sessionVersion,
    };
    const token = jwt.sign(accessPayload, secret, {
      expiresIn: expiresIn as SignOptions['expiresIn'],
    });
    return { token, accessToken: token, expiresIn, admin: mapAdmin(admin) };
  }

  async getMe(adminId: string) {
    const admin = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: adminSelect(),
    });
    if (!admin) throw new HttpError(404, '管理员不存在');
    return mapAdmin(admin);
  }

  async changeMyPassword(adminId: string, passwordRaw: string) {
    const password = String(passwordRaw || '').trim();
    if (password.length < 6) throw new HttpError(400, '密码至少 6 位');
    const exists = await prisma.adminUser.findUnique({
      where: { id: adminId },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, '管理员不存在');
    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.adminUser.update({
      where: { id: adminId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: { id: true },
    });
    return { ok: true };
  }

  async listUsers(params: { page: number; pageSize: number; keyword?: string }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const keyword = params.keyword?.trim();
    const where: Prisma.UserWhereInput = keyword
      ? {
          OR: [{ name: { contains: keyword } }, { openid: { contains: keyword } }],
        }
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
          identityType: true,
          gender: true,
          householdNo: true,
          enabled: true,
          disabledAt: true,
          disabledReason: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const tags = await resolveEffectiveUserTags(prisma, rows.map((row) => row.id));

    return {
      total,
      list: rows.map((row) => {
        const { identityType: _identityType, ...user } = row;
        const tag = tags.get(row.id) ?? { label: '', type: '' };
        return {
          ...user,
          userTagLabel: tag.label,
          userTagType: tag.type,
          disabledAt: row.disabledAt ? row.disabledAt.toISOString() : '',
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        };
      }),
    };
  }

  async updateUserEnabled(params: { userId: string; enabled: boolean; reason?: string }) {
    const id = params.userId.trim();
    if (!id) throw new HttpError(400, 'userId 不能为空');
    const row = await prisma.user.update({
      where: { id },
      data: params.enabled
        ? { enabled: true, disabledAt: null, disabledReason: null }
        : {
            enabled: false,
            disabledAt: new Date(),
            disabledReason: params.reason?.trim() || null,
          },
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
        householdNo: true,
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

    const [posts, items, tasks] = await Promise.all([
      prisma.forumPost.count({
        where: { authorId: userId, ...contentNotDeleted },
      }),
      prisma.mallItem.count({
        where: { publisherId: userId, ...contentNotDeleted },
      }),
      prisma.task.count({
        where: { publisherId: userId, ...contentNotDeleted },
      }),
    ]);

    return {
      user: {
        ...user,
        disabledAt: user.disabledAt ? user.disabledAt.toISOString() : '',
        createdAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      },
      stats: { posts, items, tasks },
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
    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? '',
      openid: r.openid,
    }));
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
      const u = await prisma.user.findUnique({
        where: { id: uid },
        select: { id: true },
      });
      if (!u) throw new HttpError(400, '绑定的小程序用户不存在');
      const occupied = await prisma.adminUser.findFirst({
        where: { boundUserId: uid },
        select: { id: true },
      });
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
    const shouldInvalidateSession = Boolean(params.password) || (target.enabled && params.enabled === false);

    const nextType = params.type ?? target.type;
    const nextOrgName = params.orgName === undefined ? (target.orgName ?? '') : params.orgName?.trim() || '';
    if (nextType === 'THIRD_PARTY' && !nextOrgName) {
      throw new HttpError(400, '第三方管理员请填写所属单位');
    }

    let nextBound: string | null | undefined = undefined;
    if (params.boundUserId !== undefined) {
      const raw = params.boundUserId.trim();
      if (!raw) {
        nextBound = null;
      } else {
        const u = await prisma.user.findUnique({
          where: { id: raw },
          select: { id: true },
        });
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
        ...(shouldInvalidateSession ? { sessionVersion: { increment: 1 } } : {}),
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
      data: { passwordHash, sessionVersion: { increment: 1 } },
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
    type: 'posts' | 'items' | 'tasks',
    params: {
      page: number;
      pageSize: number;
      keyword?: string;
      visibility?: 'ONLINE' | 'OFFLINE';
      authorKeyword?: string;
    },
  ) {
    if (type === 'posts') return this.listPosts(params);
    if (type === 'items') return this.listItems(params);
    return this.listTasks(params);
  }

  async updateContentState(
    type: 'posts' | 'items' | 'tasks',
    id: string,
    params: { visibility?: 'ONLINE' | 'OFFLINE'; pinned?: boolean },
    operator: AdminOperator,
  ) {
    const data = {
      ...(params.visibility ? { visibility: params.visibility } : {}),
      ...(params.pinned === undefined ? {} : { pinned: params.pinned }),
    };
    if (Object.keys(data).length === 0) throw new HttpError(400, '没有可更新的字段');
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

  async getContentDetail(type: 'posts' | 'items' | 'tasks', id: string) {
    const contentId = id.trim();
    if (!contentId) throw new HttpError(400, 'id 不能为空');

    if (type === 'posts') {
      const row = await prisma.forumPost.findFirst({
        where: { id: contentId, ...contentNotDeleted },
      });
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
      for (const r of replies)
        nodes.set(r.id, {
          id: r.id,
          parentReplyId: r.parentReplyId,
          children: [],
        });
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
        authorAvatar: avatarOrDefault(row.authorAvatar),
        replies: replies.map((r) => ({
          id: r.id,
          _id: r.id,
          postId: r.postId,
          parentReplyId: r.parentReplyId,
          replyToAuthorName: r.replyToAuthorName ?? '',
          authorId: r.authorId,
          authorName: r.authorName ?? '',
          authorAvatar: avatarOrDefault(r.authorAvatar),
          content: r.content,
          images: Array.isArray(r.images) ? r.images : (r.images ?? []),
          videos: Array.isArray(r.videos) ? r.videos : (r.videos ?? []),
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
      const row = await prisma.mallItem.findFirst({
        where: { id: contentId, ...contentNotDeleted },
      });
      if (!row) return null;
      const comments = await this.mallComments.listItemComments({
        itemId: contentId,
        userId: '__admin__',
      });
      return {
        ...row,
        publisherAvatar: avatarOrDefault(row.publisherAvatar),
        comments,
      };
    }

    const row = await prisma.task.findFirst({
      where: { id: contentId, ...contentNotDeleted },
    });
    if (!row) return null;
    return {
      ...row,
      publisherAvatar: avatarOrDefault(row.publisherAvatar),
      takerAvatar: avatarOrDefault(row.takerAvatar),
    };
  }

  async batchUpdateContentState(
    type: 'posts' | 'items' | 'tasks',
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
      if (type === 'posts') {
        const bad = await prisma.forumPost.count({
          where: {
            id: { in: contentIds },
            ...contentNotDeleted,
            authorId: { not: bound },
          },
        });
        if (bad > 0) throw new HttpError(403, '批量操作中包含非本人发布的内容');
      } else if (type === 'items') {
        const bad = await prisma.mallItem.count({
          where: {
            id: { in: contentIds },
            ...contentNotDeleted,
            publisherId: { not: bound },
          },
        });
        if (bad > 0) throw new HttpError(403, '批量操作中包含非本人发布的内容');
      } else {
        const bad = await prisma.task.count({
          where: {
            id: { in: contentIds },
            ...contentNotDeleted,
            publisherId: { not: bound },
          },
        });
        if (bad > 0) throw new HttpError(403, '批量操作中包含非本人发布的内容');
      }
    }

    if (type === 'posts') {
      const result = await prisma.forumPost.updateMany({
        where: { id: { in: contentIds }, ...contentNotDeleted },
        data,
      });
      await invalidateForumPostListCache();
      return result;
    }
    if (type === 'items') {
      const result = await prisma.mallItem.updateMany({
        where: { id: { in: contentIds }, ...contentNotDeleted },
        data,
      });
      await Promise.all([invalidateMallItemsListCache(), ...contentIds.map((id) => invalidateMallItemDetailCache(id))]);
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

  private async listPosts(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    visibility?: 'ONLINE' | 'OFFLINE';
    authorKeyword?: string;
  }) {
    const keyword = params.keyword?.trim();
    const authorKeyword = params.authorKeyword?.trim();
    const authorIds = authorKeyword
      ? (await prisma.user.findMany({
          where: { OR: [{ id: { contains: authorKeyword } }, { name: { contains: authorKeyword } }] },
          select: { id: true },
          take: 500,
        })).map((user) => user.id)
      : [];
    const where: Prisma.ForumPostWhereInput = {
      ...this.visibilityWhere(params.visibility),
      ...(authorKeyword ? { authorId: { in: authorIds } } : {}),
      ...(keyword
        ? {
            OR: [{ title: { contains: keyword } }, { content: { contains: keyword } }],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.forumPost.count({ where }),
      prisma.forumPost.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        ...this.pageArgs(params),
      }),
    ]);
    return {
      total,
      list: rows.map((row) => ({
        ...row,
        authorAvatar: avatarOrDefault(row.authorAvatar),
        createdAt: row.createdAt.toISOString(),
        validUntil: row.validUntil ? row.validUntil.toISOString() : null,
      })),
    };
  }

  private async listItems(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    visibility?: 'ONLINE' | 'OFFLINE';
  }) {
    const keyword = params.keyword?.trim();
    const where: Prisma.MallItemWhereInput = {
      ...this.visibilityWhere(params.visibility),
      ...(keyword
        ? {
            OR: [{ title: { contains: keyword } }, { desc: { contains: keyword } }],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.mallItem.count({ where }),
      prisma.mallItem.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        ...this.pageArgs(params),
      }),
    ]);
    return {
      total,
      list: rows.map((row) => ({
        ...row,
        publisherAvatar: avatarOrDefault(row.publisherAvatar),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  private async listTasks(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    visibility?: 'ONLINE' | 'OFFLINE';
  }) {
    const keyword = params.keyword?.trim();
    const where: Prisma.TaskWhereInput = {
      ...this.visibilityWhere(params.visibility),
      ...(keyword
        ? {
            OR: [{ title: { contains: keyword } }, { desc: { contains: keyword } }],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        ...this.pageArgs(params),
      }),
    ]);
    return {
      total,
      list: rows.map((row) => ({
        ...row,
        publisherAvatar: avatarOrDefault(row.publisherAvatar),
        takerAvatar: avatarOrDefault(row.takerAvatar),
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  private contentOwnerUserId(
    type: 'posts' | 'items' | 'tasks',
    row: { authorId?: string | null; publisherId?: string | null },
  ): string {
    if (type === 'items' || type === 'tasks') return String(row.publisherId ?? '');
    return String(row.authorId ?? '');
  }

  private async assertCanModifyContent(
    operator: AdminOperator,
    type: 'posts' | 'items' | 'tasks',
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
    const admin = await prisma.adminUser.findUnique({
      where: { id: operator.adminId },
      select: { boundUserId: true, enabled: true },
    });
    if (!admin?.enabled) throw new HttpError(403, '管理员账号不可用，无法发布内容');
    const bound = admin?.boundUserId?.trim();
    if (!bound) {
      throw new HttpError(403, '未绑定小程序用户，无法发布内容，请联系超级管理员绑定用户');
    }
    const want = actorUserId?.trim();
    if (want && want !== bound) {
      throw new HttpError(403, '只能以本人绑定的小程序用户身份发布');
    }
    const u = await prisma.user.findUnique({
      where: { id: bound },
      select: { id: true, enabled: true },
    });
    if (!u) throw new HttpError(400, '管理员绑定的用户不存在，请重新绑定');
    if (!u.enabled) throw new HttpError(403, '管理员绑定的小程序用户已被冻结，无法发布内容');
    return bound;
  }

  private async assertNonSuperCannotTransferPublisher(operator: AdminOperator, dtoActorUserId?: string) {
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
      const u = await prisma.user.findUnique({
        where: { id: trimmed },
        select: { id: true },
      });
      if (!u) throw new HttpError(400, '指定的小程序用户不存在');
      return trimmed;
    }
    const envId = process.env.ADMIN_CONTENT_DEFAULT_USER_ID?.trim();
    if (envId) {
      const u = await prisma.user.findUnique({
        where: { id: envId },
        select: { id: true },
      });
      if (!u) throw new HttpError(500, 'ADMIN_CONTENT_DEFAULT_USER_ID 对应用户不存在');
      return envId;
    }
    const first = await prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!first) throw new HttpError(400, '库中无小程序用户，请在请求中传入 actorUserId（发布者用户 id）');
    return first.id;
  }

  private assertMallCategoryId(categoryIdRaw: string) {
    return this.mallCategories.assertEnabledCategoryId(categoryIdRaw);
  }

  async createContent(
    type: 'posts' | 'items' | 'tasks',
    dto: AdminCreateContentDto,
    operator: AdminOperator,
  ) {
    const postType = type === 'posts' ? parseForumPostType(dto.postType) : 'NORMAL';
    const actorId = postType === 'ANNOUNCEMENT' ? '' : await this.resolveActorUserIdForAdmin(dto.actorUserId, operator);
    const vis = dto.visibility ?? 'ONLINE';
    const pin = dto.pinned ?? false;
    return runAdminContentMutation(prisma, async (tx) => {
      if (actorId) await lockUsersForProfileSnapshot(tx, [actorId]);
      if (type === 'posts') {
        const title = (dto.title || '').trim();
        const content = (dto.content || '').trim();
        const validUntil = parseAnnouncementValidUntil(dto.validUntil, postType);
        const images = parseStrictMediaUrlList(dto.images, MAX_POST_IMAGES, 'image', 'images');
        const videos = parseStrictMediaUrlList(dto.videos, MAX_POST_VIDEOS, 'video', 'videos');
        if (!title) throw new HttpError(400, '请输入标题');
        if (!content && images.length === 0 && videos.length === 0) {
          throw new HttpError(400, '请输入内容或添加图片/视频');
        }
        const author = actorId
          ? await tx.user.findUnique({ where: { id: actorId }, select: { name: true, avatar: true } })
          : null;
        const row = await tx.forumPost.create({
          data: {
            title,
            content,
            images: images.length ? jsonMedia(images) : undefined,
            videos: videos.length ? jsonMedia(videos) : undefined,
            // 公告由后台管理员直接发布，不对应任意真实小程序用户。
            authorId: actorId || ADMIN_ANNOUNCEMENT_AUTHOR_ID,
            authorName: author?.name ?? (postType === 'ANNOUNCEMENT' ? '系统公告' : ''),
            authorAvatar: author?.avatar ?? null,
            createdByAdminId: operator.adminId,
            postType,
            validUntil,
            visibility: vis,
            pinned: pin,
          },
        });
        return {
          result: {
            ...row,
            createdAt: row.createdAt.toISOString(),
            validUntil: row.validUntil ? row.validUntil.toISOString() : null,
          },
          invalidations: [{ kind: 'forum-list' }],
        };
      }

      if (type === 'items') {
        const categoryId = await this.assertMallCategoryId(dto.categoryId || '');
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
        const wechatContact = normalizeWechatContact(dto.wechatContact);
        const phoneContact = normalizePhoneContact(dto.phoneContact);
        const phoneIsWechat = normalizePhoneIsWechat(dto.phoneIsWechat, phoneContact);
        const legacyContact = normalizeLegacyContact(dto.contact);
        assertMallItemHasContact({ wechatContact, phoneContact, legacyContact });
        const publisher = await tx.user.findUnique({
          where: { id: actorId },
          select: { name: true, avatar: true },
        });
        const row = await tx.mallItem.create({
          data: {
            categoryId,
            title,
            price: dto.price?.trim() || null,
            unit: (dto.unit?.trim() || '元').slice(0, 16),
            desc,
            wechatContact,
            phoneContact,
            phoneIsWechat,
            contact: wechatContact || phoneContact ? null : legacyContact,
            locationName: dto.locationName?.trim() || null,
            locationAddress: dto.locationAddress?.trim() || null,
            latitude: Number.isFinite(dto.latitude) ? dto.latitude : null,
            longitude: Number.isFinite(dto.longitude) ? dto.longitude : null,
            mainImages: normalizedMainImages.length ? jsonImages(normalizedMainImages) : undefined,
            subImages: normalizedSubImages.length ? jsonImages(normalizedSubImages) : undefined,
            videos: videos.length ? jsonImages(videos) : undefined,
            images: legacyImages.length ? jsonImages(legacyImages) : undefined,
            publisherId: actorId,
            publisherName: publisher?.name ?? '',
            publisherAvatar: publisher?.avatar ?? null,
            createdByAdminId: operator.adminId,
            visibility: vis,
            pinned: pin,
          },
        });
        return {
          result: {
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
          invalidations: [{ kind: 'mall-list' }],
        };
      }

      const title = (dto.title || '').trim();
      const desc = (dto.desc || '').trim();
      const reward = (dto.reward || '').trim();
      const location = (dto.location || '').trim();
      if (!title) throw new HttpError(400, 'title 不能为空');
      if (reward && (Number.isNaN(Number(reward)) || Number(reward) < 0)) {
        throw new HttpError(400, '感谢金金额无效');
      }
      const images = parseStrictMediaUrlList(dto.images, MAX_TASK_IMAGES, 'image', 'images');
      const videos = parseStrictMediaUrlList(dto.videos, MAX_TASK_VIDEOS, 'video', 'videos');
      if (!desc && images.length === 0 && videos.length === 0) {
        throw new HttpError(400, 'desc 与图片/视频至少填一项');
      }
      const publisher = await tx.user.findUnique({
        where: { id: actorId },
        select: { name: true, avatar: true },
      });
      const row = await tx.task.create({
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
          publisherAvatar: publisher?.avatar ?? null,
          createdByAdminId: operator.adminId,
          visibility: vis,
          pinned: pin,
        },
      });
      return {
        result: {
          ...row,
          createdAt: row.createdAt.toISOString(),
          claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
          completedAt: row.completedAt ? row.completedAt.toISOString() : null,
          confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
        },
        invalidations: [{ kind: 'task-list' }],
      };
    });
  }

  async updateContentFields(
    type: 'posts' | 'items' | 'tasks',
    idRaw: string,
    dto: AdminUpdateContentDto,
    operator: AdminOperator,
  ) {
    const id = idRaw.trim();
    if (!id) throw new HttpError(400, 'id 不能为空');
    if (type === 'tasks' && dto.status !== undefined) {
      throw new HttpError(400, '任务状态不能通过内容编辑修改');
    }

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
      dto.wechatContact !== undefined ||
      dto.phoneContact !== undefined ||
      dto.visibility !== undefined ||
      dto.pinned !== undefined ||
      dto.postType !== undefined ||
      dto.validUntil !== undefined ||
      dto.status !== undefined ||
      dto.images !== undefined ||
      dto.videos !== undefined ||
      dto.mainImages !== undefined ||
      dto.subImages !== undefined;
    if (!touched) throw new HttpError(400, '没有可更新的字段');

    await this.assertNonSuperCannotTransferPublisher(operator, dto.actorUserId);
    const actorId = dto.actorUserId !== undefined ? await this.resolveActorUserId(dto.actorUserId) : null;

    return runAdminContentMutation(prisma, async (tx) => {
      if (actorId) await lockUsersForProfileSnapshot(tx, [actorId]);
      if (type === 'posts') {
        const existing = await tx.forumPost.findFirst({
          where: { id, ...contentNotDeleted },
        });
        if (!existing) throw new HttpError(404, '内容不存在');
        await this.assertCanModifyContent(operator, type, this.contentOwnerUserId(type, existing));
        const data: Prisma.ForumPostUpdateInput = {};
        if (dto.title !== undefined) data.title = dto.title.trim();
        if (dto.content !== undefined) data.content = dto.content.trim();
        if (dto.visibility !== undefined) data.visibility = dto.visibility;
        if (dto.pinned !== undefined) data.pinned = dto.pinned;
        if (dto.postType !== undefined || dto.validUntil !== undefined) {
          const nextPostType =
            dto.postType !== undefined
              ? parseForumPostType(dto.postType)
              : (existing.postType as 'NORMAL' | 'ANNOUNCEMENT');
          data.postType = nextPostType;
          data.validUntil =
            nextPostType === 'ANNOUNCEMENT'
              ? parseAnnouncementValidUntil(dto.validUntil ?? existing.validUntil?.toISOString(), nextPostType)
              : null;
        }
        if (dto.images !== undefined) {
          const images = parseStrictMediaUrlList(dto.images, MAX_POST_IMAGES, 'image', 'images');
          data.images = jsonMedia(images);
        }
        if (dto.videos !== undefined) {
          const videos = parseStrictMediaUrlList(dto.videos, MAX_POST_VIDEOS, 'video', 'videos');
          data.videos = jsonMedia(videos);
        }
        if (dto.actorUserId !== undefined) {
          const author = await tx.user.findUnique({
            where: { id: actorId! },
            select: { name: true, avatar: true },
          });
          data.authorId = actorId!;
          data.authorName = author?.name ?? '';
          data.authorAvatar = author?.avatar ?? null;
        }
        const row = await tx.forumPost.update({ where: { id }, data });
        return {
          result: {
            ...row,
            createdAt: row.createdAt.toISOString(),
            validUntil: row.validUntil ? row.validUntil.toISOString() : null,
          },
          invalidations: [
            { kind: 'forum-list' },
            { kind: 'forum-replies', id },
          ],
        };
      }

      if (type === 'items') {
        const existing = await tx.mallItem.findFirst({
          where: { id, ...contentNotDeleted },
        });
        if (!existing) throw new HttpError(404, '内容不存在');
        await this.assertCanModifyContent(operator, type, this.contentOwnerUserId(type, existing));
        const data: Prisma.MallItemUpdateInput = {};
        if (dto.categoryId !== undefined) data.categoryId = await this.assertMallCategoryId(dto.categoryId);
        if (dto.title !== undefined) data.title = dto.title.trim();
        if (dto.desc !== undefined) data.desc = dto.desc.trim();
        if (dto.price !== undefined) data.price = dto.price.trim() || null;
        if (dto.unit !== undefined) data.unit = (dto.unit.trim() || '元').slice(0, 16);
        const hasStructuredContactUpdate = dto.wechatContact !== undefined || dto.phoneContact !== undefined || dto.phoneIsWechat !== undefined;
        if (hasStructuredContactUpdate) {
          const wechatContact = dto.wechatContact === undefined
            ? existing.wechatContact
            : normalizeWechatContact(dto.wechatContact);
          const phoneContact = dto.phoneContact === undefined
            ? existing.phoneContact
            : normalizePhoneContact(dto.phoneContact);
          const phoneIsWechat = normalizePhoneIsWechat(
            dto.phoneIsWechat === undefined ? existing.phoneIsWechat : dto.phoneIsWechat,
            phoneContact,
          );
          const legacyContact = normalizeLegacyContact(existing.contact);
          assertMallItemHasContact({ wechatContact, phoneContact, legacyContact });
          data.wechatContact = wechatContact;
          data.phoneContact = phoneContact;
          data.phoneIsWechat = phoneIsWechat;
          if (wechatContact || phoneContact) data.contact = null;
        }
        if (dto.contact !== undefined && !hasStructuredContactUpdate) data.contact = normalizeLegacyContact(dto.contact);
        if (dto.locationName !== undefined) data.locationName = dto.locationName.trim() || null;
        if (dto.locationAddress !== undefined) data.locationAddress = dto.locationAddress.trim() || null;
        if (dto.latitude !== undefined) data.latitude = Number.isFinite(dto.latitude) ? dto.latitude : null;
        if (dto.longitude !== undefined) data.longitude = Number.isFinite(dto.longitude) ? dto.longitude : null;
        if (dto.visibility !== undefined) data.visibility = dto.visibility;
        if (dto.pinned !== undefined) data.pinned = dto.pinned;
        if (dto.actorUserId !== undefined) {
          const publisher = await tx.user.findUnique({
            where: { id: actorId! },
            select: { name: true, avatar: true },
          });
          data.publisherId = actorId!;
          data.publisherName = publisher?.name ?? '';
          data.publisherAvatar = publisher?.avatar ?? null;
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
            const curMain = Array.isArray(existing.mainImages) ? (existing.mainImages as string[]) : [];
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
        const row = await tx.mallItem.update({ where: { id }, data });
        return {
          result: {
            ...row,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          },
          invalidations: [
            { kind: 'mall-list' },
            { kind: 'mall-item', id },
          ],
        };
      }

      const existing = await tx.task.findFirst({
        where: { id, ...contentNotDeleted },
      });
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
      if (dto.actorUserId !== undefined) {
        const publisher = await tx.user.findUnique({
          where: { id: actorId! },
          select: { name: true, avatar: true },
        });
        data.publisherId = actorId!;
        data.publisherName = publisher?.name ?? '';
        data.publisherAvatar = publisher?.avatar ?? null;
      }
      const row = await updateAdminTaskContentCas(tx, {
        id,
        publisherId: existing.publisherId,
        status: existing.status,
        version: existing.version,
        data,
      });
      return {
        result: {
          ...row,
          createdAt: row.createdAt.toISOString(),
          claimedAt: row.claimedAt ? row.claimedAt.toISOString() : null,
          completedAt: row.completedAt ? row.completedAt.toISOString() : null,
          confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
        },
        invalidations: [{ kind: 'task-list' }],
      };
    });
  }

  async deleteContent(type: 'posts' | 'items' | 'tasks', idRaw: string, operator: AdminOperator) {
    const id = idRaw.trim();
    if (!id) throw new HttpError(400, 'id 不能为空');
    const now = new Date();

    if (type === 'posts') {
      const row = await prisma.forumPost.findFirst({
        where: { id, ...contentNotDeleted },
      });
      if (!row) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, row.authorId);
      await prisma.forumPost.update({
        where: { id },
        data: { deletedAt: now },
      });
      await Promise.all([invalidateForumPostListCache(), invalidateForumPostRepliesCache(id)]);
      return { id };
    }

    if (type === 'items') {
      const row = await prisma.mallItem.findFirst({
        where: { id, ...contentNotDeleted },
      });
      if (!row) throw new HttpError(404, '内容不存在');
      await this.assertCanModifyContent(operator, type, row.publisherId);
      await prisma.mallItem.update({ where: { id }, data: { deletedAt: now } });
      await Promise.all([invalidateMallItemsListCache(), invalidateMallItemDetailCache(id)]);
      return { id };
    }

    const row = await prisma.task.findFirst({
      where: { id, ...contentNotDeleted },
    });
    if (!row) throw new HttpError(404, '内容不存在');
    await this.assertCanModifyContent(operator, type, row.publisherId);
    await prisma.task.update({ where: { id }, data: { deletedAt: now } });
    await invalidatePendingTasksListCache();
    return { id };
  }
}
