import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import {
  invalidateMallItemDetailCache,
  invalidateMallItemsListCache,
  invalidatePendingTasksListCache,
} from '../../lib/redis-cache';
import { MallCommentService } from '../mall/mall-comment.service';

type AdminTokenPayload = {
  sub: string;
  username: string;
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

export class AdminService {
  private readonly mallComments = new MallCommentService();
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
      prisma.errand.count({ where: { authorId: userId } }),
      prisma.forumPost.count({ where: { authorId: userId } }),
      prisma.mallItem.count({ where: { publisherId: userId } }),
      prisma.task.count({ where: { publisherId: userId } }),
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
  }) {
    const username = params.username.trim();
    if (!username) throw new HttpError(400, '用户名不能为空');
    const passwordHash = await bcrypt.hash(params.password, 10);
    const type = params.type || 'OFFICIAL';
    const orgName = params.orgName?.trim() || '';
    if (type === 'THIRD_PARTY' && !orgName) {
      throw new HttpError(400, '第三方管理员请填写所属单位');
    }
    try {
      const row = await prisma.adminUser.create({
        data: {
          username,
          passwordHash,
          role: 'ADMIN',
          type,
          orgName: type === 'OFFICIAL' ? null : orgName,
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
    params: { password?: string; enabled?: boolean; type?: 'OFFICIAL' | 'THIRD_PARTY'; orgName?: string },
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

    const nextType = params.type ?? target.type;
    const nextOrgName =
      params.orgName === undefined ? (target.orgName ?? '') : (params.orgName?.trim() || '');
    if (nextType === 'THIRD_PARTY' && !nextOrgName) {
      throw new HttpError(400, '第三方管理员请填写所属单位');
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
      },
      select: adminSelect(),
    });
    return mapAdmin(row);
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
  ) {
    const data = {
      ...(params.visibility ? { visibility: params.visibility } : {}),
      ...(params.pinned === undefined ? {} : { pinned: params.pinned }),
    };
    if (Object.keys(data).length === 0) throw new HttpError(400, '没有可更新的字段');
    if (type === 'errands') return prisma.errand.update({ where: { id }, data });
    if (type === 'posts') return prisma.forumPost.update({ where: { id }, data });
    if (type === 'items') {
      const row = await prisma.mallItem.update({ where: { id }, data });
      await Promise.all([invalidateMallItemsListCache(), invalidateMallItemDetailCache(id)]);
      return row;
    }
    const row = await prisma.task.update({ where: { id }, data });
    await invalidatePendingTasksListCache();
    return row;
  }

  async getContentDetail(type: 'errands' | 'posts' | 'items' | 'tasks', id: string) {
    const contentId = id.trim();
    if (!contentId) throw new HttpError(400, 'id 不能为空');

    if (type === 'errands') {
      const row = await prisma.errand.findUnique({ where: { id: contentId } });
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
      const row = await prisma.forumPost.findUnique({ where: { id: contentId } });
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
      const row = await prisma.mallItem.findUnique({ where: { id: contentId } });
      if (!row) return null;
      const comments = await this.mallComments.listItemComments({ itemId: contentId, userId: '__admin__' });
      return { ...row, comments };
    }

    return prisma.task.findUnique({ where: { id: contentId } });
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
  ) {
    const contentIds = (ids || []).map((x) => String(x).trim()).filter(Boolean);
    if (contentIds.length === 0) throw new HttpError(400, 'ids 不能为空');
    if (contentIds.length > 200) throw new HttpError(400, '一次最多批量操作 200 条');

    const data = {
      ...(params.visibility ? { visibility: params.visibility } : {}),
      ...(params.pinned === undefined ? {} : { pinned: params.pinned }),
    };
    if (Object.keys(data).length === 0) throw new HttpError(400, '没有可更新的字段');

    if (type === 'errands') {
      return prisma.errand.updateMany({ where: { id: { in: contentIds } }, data });
    }
    if (type === 'posts') {
      return prisma.forumPost.updateMany({ where: { id: { in: contentIds } }, data });
    }
    if (type === 'items') {
      const result = await prisma.mallItem.updateMany({ where: { id: { in: contentIds } }, data });
      await Promise.all([
        invalidateMallItemsListCache(),
        ...contentIds.map((id) => invalidateMallItemDetailCache(id)),
      ]);
      return result;
    }
    const result = await prisma.task.updateMany({ where: { id: { in: contentIds } }, data });
    await invalidatePendingTasksListCache();
    return result;
  }

  private pageArgs(params: { page: number; pageSize: number }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    return { skip: (page - 1) * pageSize, take: pageSize };
  }

  private visibilityWhere(visibility?: 'ONLINE' | 'OFFLINE') {
    return visibility ? { visibility } : {};
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
}
