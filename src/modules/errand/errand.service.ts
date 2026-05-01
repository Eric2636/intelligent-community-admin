import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import {
  cacheAsideJson,
  errandRepliesDataCacheKey,
  ERRAND_REPLIES_TTL_SEC,
  invalidateErrandRepliesCache,
} from '../../lib/redis-cache';

function mapStatus(s: string) {
  if (s === 'PENDING_TAKE') return 'pending_take';
  if (s === 'IN_PROGRESS') return 'in_progress';
  if (s === 'COMPLETED') return 'completed';
  return 'pending_take';
}

function statusTextFrom(s: string) {
  if (s === 'pending_take') return '待领取';
  if (s === 'in_progress') return '进行中';
  if (s === 'completed') return '已完成';
  return '待领取';
}

/** 与云开发版 parseRewardYuan 一致：正数、上限 99999 */
function parseRewardYuan(raw: string): { value: string } | { error: string } {
  const s = String(raw ?? '').trim();
  if (!s) return { error: '请输入佣金（元）' };
  const n = parseFloat(s);
  if (Number.isNaN(n) || n <= 0) return { error: '请输入有效佣金（元）' };
  if (n > 99999) return { error: '佣金金额过大' };
  return { value: String(n) };
}

export class ErrandService {
  private async getUserDisplayName(userId: string) {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return row?.name ?? '邻居';
  }

  async listErrands(params: {
    userId: string;
    page: number;
    pageSize: number;
    keyword?: string;
    orderBy?: 'time' | 'hot';
  }) {
    const { userId, page, pageSize, keyword } = params;
    const skip = (page - 1) * pageSize;

    const k = keyword && keyword.trim() ? keyword.trim() : '';
    const textFilter: Prisma.ErrandWhereInput = k
      ? { OR: [{ title: { contains: k } }, { content: { contains: k } }] }
      : {};

    const pinnedWhere: Prisma.ErrandWhereInput = { pinned: true, ...textFilter };
    const listWhere: Prisma.ErrandWhereInput = { pinned: false, ...textFilter };

    const orderBy =
      params.orderBy === 'hot'
        ? [{ replyCount: 'desc' as const }, { likeCount: 'desc' as const }, { createdAt: 'desc' as const }]
        : [{ createdAt: 'desc' as const }];

    const [pinnedRows, total, listRows] = await Promise.all([
      prisma.errand.findMany({
        where: pinnedWhere,
        orderBy: [{ createdAt: 'desc' }],
      }),
      prisma.errand.count({ where: listWhere }),
      prisma.errand.findMany({
        where: listWhere,
        orderBy,
        skip,
        take: pageSize,
      }),
    ]);

    const uniqueIds = [...new Set([...pinnedRows, ...listRows].map((r) => r.id))];
    const [liked, favorited] =
      uniqueIds.length === 0
        ? [[], []]
        : await Promise.all([
            prisma.errandLike.findMany({
              where: { userId, errandId: { in: uniqueIds } },
              select: { errandId: true },
            }),
            prisma.errandFavorite.findMany({
              where: { userId, errandId: { in: uniqueIds } },
              select: { errandId: true },
            }),
          ]);
    const likedSet = new Set(liked.map((x) => x.errandId));
    const favSet = new Set(favorited.map((x) => x.errandId));

    const mapOne = (e: (typeof pinnedRows)[number]) =>
      this.mapErrand(e, userId, likedSet.has(e.id), favSet.has(e.id));

    return {
      pinned: pinnedRows.map(mapOne),
      list: listRows.map(mapOne),
      total,
    };
  }

  async getErrandDetail(params: { userId: string; errandId: string }) {
    const { userId } = params;
    const id = String(params.errandId || '').trim();
    if (!id) throw new HttpError(400, 'errandId 不能为空');

    const row = await prisma.$transaction(async (tx) => {
      const exists = await tx.errand.findUnique({ where: { id } });
      if (!exists) return null;
      await tx.errand.update({ where: { id }, data: { viewCount: { increment: 1 } } });
      return tx.errand.findUnique({ where: { id } });
    });
    if (!row) throw new HttpError(404, '跑腿不存在');

    const replyKey = await errandRepliesDataCacheKey(id);
    const [repliesRaw, liked, favorited] = await Promise.all([
      cacheAsideJson(replyKey, ERRAND_REPLIES_TTL_SEC, async () =>
        prisma.errandReply.findMany({
          where: { errandId: id },
          orderBy: { createdAt: 'desc' },
        }),
      ),
      prisma.errandLike.findUnique({
        where: { errandId_userId: { errandId: id, userId } },
        select: { id: true },
      }),
      prisma.errandFavorite.findUnique({
        where: { errandId_userId: { errandId: id, userId } },
        select: { id: true },
      }),
    ]);

    const replies = repliesRaw.map((r) => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as string),
    }));

    const detail = this.mapErrand(row, userId, Boolean(liked), Boolean(favorited));
    return {
      ...detail,
      replies: replies.map((r) => ({
        _id: r.id,
        id: r.id,
        authorName: r.authorName ?? '',
        content: r.content,
        createdAt: r.createdAt.toISOString(),
        createTime: r.createdAt.toISOString(),
      })),
    };
  }

  async publishErrand(params: { userId: string; title: string; content: string; reward: string }) {
    const title = String(params.title || '').trim();
    const content = String(params.content || '').trim();
    const rewardRaw = String(params.reward || '').trim();
    if (!title) throw new HttpError(400, '请输入跑腿标题');
    if (!content) throw new HttpError(400, '请输入跑腿内容');
    const rewardParsed = parseRewardYuan(rewardRaw);
    if ('error' in rewardParsed) throw new HttpError(400, rewardParsed.error);

    const authorName = await this.getUserDisplayName(params.userId);
    const row = await prisma.errand.create({
      data: {
        title,
        content,
        reward: rewardParsed.value,
        status: 'PENDING_TAKE',
        authorId: params.userId,
        authorName,
        images: [],
        videos: [],
      },
    });
    return this.mapErrand(row, params.userId, false, false);
  }

  async claimErrand(params: { userId: string; errandId: string; claimerName?: string }) {
    const id = String(params.errandId || '').trim();
    if (!id) throw new HttpError(400, 'errandId 不能为空');

    return prisma.$transaction(async (tx) => {
      const row = await tx.errand.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, '跑腿不存在');
      if (row.authorId === params.userId) throw new HttpError(400, '不能领取自己发布的跑腿');
      if (row.status !== 'PENDING_TAKE') throw new HttpError(400, '该跑腿已被领取或已结束');

      const claimerName =
        (params.claimerName && String(params.claimerName).trim()) || (await this.getUserDisplayName(params.userId));

      const updated = await tx.errand.update({
        where: { id },
        data: {
          status: 'IN_PROGRESS',
          claimerId: params.userId,
          claimerName,
          claimedAt: new Date(),
        },
      });
      return this.mapErrand(updated, params.userId, false, false);
    });
  }

  async completeErrand(params: { userId: string; errandId: string }) {
    const id = String(params.errandId || '').trim();
    if (!id) throw new HttpError(400, 'errandId 不能为空');

    const row = await prisma.errand.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, '跑腿不存在');
    if (row.authorId !== params.userId) throw new HttpError(403, '仅发布者可确认完成');
    if (row.status !== 'IN_PROGRESS') throw new HttpError(400, '该跑腿当前不可确认完成');

    const updated = await prisma.errand.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    return this.mapErrand(updated, params.userId, false, false);
  }

  async publishReply(params: { userId: string; errandId: string; content: string }) {
    const id = String(params.errandId || '').trim();
    const content = String(params.content || '').trim();
    if (!id) throw new HttpError(400, 'errandId 不能为空');
    if (!content) throw new HttpError(400, '请输入回复');

    const errand = await prisma.errand.findUnique({ where: { id } });
    if (!errand) throw new HttpError(404, '跑腿不存在');

    const authorName = await this.getUserDisplayName(params.userId);
    const row = await prisma.errandReply.create({
      data: { errandId: id, authorId: params.userId, authorName, content },
    });
    await prisma.errand.update({ where: { id }, data: { replyCount: { increment: 1 } } });
    await invalidateErrandRepliesCache(id);
    return {
      _id: row.id,
      id: row.id,
      authorName: row.authorName ?? '',
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      createTime: row.createdAt.toISOString(),
    };
  }

  async like(params: { userId: string; errandId: string }) {
    const id = String(params.errandId || '').trim();
    if (!id) throw new HttpError(400, 'errandId 不能为空');
    try {
      await prisma.errandLike.create({ data: { errandId: id, userId: params.userId } });
      const updated = await prisma.errand.update({ where: { id }, data: { likeCount: { increment: 1 } } });
      return { likeCount: updated.likeCount };
    } catch {
      // 已点赞：直接返回当前计数
      const row = await prisma.errand.findUnique({ where: { id }, select: { likeCount: true } });
      return { likeCount: row?.likeCount ?? 0 };
    }
  }

  async unlike(params: { userId: string; errandId: string }) {
    const id = String(params.errandId || '').trim();
    if (!id) throw new HttpError(400, 'errandId 不能为空');
    try {
      await prisma.errandLike.delete({ where: { errandId_userId: { errandId: id, userId: params.userId } } });
      const updated = await prisma.errand.update({
        where: { id },
        data: { likeCount: { decrement: 1 } },
      });
      return { likeCount: Math.max(0, updated.likeCount) };
    } catch {
      const row = await prisma.errand.findUnique({ where: { id }, select: { likeCount: true } });
      return { likeCount: row?.likeCount ?? 0 };
    }
  }

  async favorite(params: { userId: string; errandId: string }) {
    const id = String(params.errandId || '').trim();
    if (!id) throw new HttpError(400, 'errandId 不能为空');
    try {
      await prisma.errandFavorite.create({ data: { errandId: id, userId: params.userId } });
    } catch {
      // ignore duplicate
    }
    return { ok: true };
  }

  async unfavorite(params: { userId: string; errandId: string }) {
    const id = String(params.errandId || '').trim();
    if (!id) throw new HttpError(400, 'errandId 不能为空');
    try {
      await prisma.errandFavorite.delete({ where: { errandId_userId: { errandId: id, userId: params.userId } } });
    } catch {
      // ignore
    }
    return { ok: true };
  }

  async getMyErrands(params: { userId: string; role?: 'published' | 'claimed' }) {
    const role = params.role || 'published';
    const where =
      role === 'claimed' ? { claimerId: params.userId } : { authorId: params.userId };
    const rows = await prisma.errand.findMany({ where, orderBy: { createdAt: 'desc' } });

    const ids = rows.map((r) => r.id);
    const [liked, favorited] = await Promise.all([
      prisma.errandLike.findMany({ where: { userId: params.userId, errandId: { in: ids } }, select: { errandId: true } }),
      prisma.errandFavorite.findMany({
        where: { userId: params.userId, errandId: { in: ids } },
        select: { errandId: true },
      }),
    ]);
    const likedSet = new Set(liked.map((x) => x.errandId));
    const favSet = new Set(favorited.map((x) => x.errandId));

    return rows.map((e) => this.mapErrand(e, params.userId, likedSet.has(e.id), favSet.has(e.id)));
  }

  private mapErrand(
    e: {
      id: string;
      title: string;
      content: string;
      images: unknown;
      videos: unknown;
      reward: string | null;
      status: string;
      authorId: string;
      authorName: string | null;
      claimerId: string | null;
      claimerName: string | null;
      pinned?: boolean;
      viewCount?: number;
      likeCount: number;
      replyCount: number;
      createdAt: Date;
      claimedAt: Date | null;
      completedAt: Date | null;
    },
    userId: string,
    isLiked: boolean,
    isFavorited: boolean,
  ) {
    const status = mapStatus(e.status);
    const canClaim = status === 'pending_take' && e.authorId !== userId;
    const canComplete = status === 'in_progress' && e.authorId === userId;
    return {
      _id: e.id,
      id: e.id,
      title: e.title,
      content: e.content,
      images: Array.isArray(e.images) ? e.images : e.images ?? [],
      videos: Array.isArray(e.videos) ? e.videos : e.videos ?? [],
      reward: e.reward ?? '0',
      pinned: Boolean(e.pinned),
      status,
      statusText: statusTextFrom(status),
      authorId: e.authorId,
      authorName: e.authorName ?? '',
      claimerId: e.claimerId ?? '',
      claimerName: e.claimerName ?? '',
      viewCount: e.viewCount ?? 0,
      likeCount: e.likeCount ?? 0,
      replyCount: e.replyCount ?? 0,
      isLiked,
      isFavorited,
      isAuthor: e.authorId === userId,
      canClaim,
      canComplete,
      createdAt: e.createdAt.toISOString(),
      createTime: e.createdAt.toISOString(),
      claimedAt: e.claimedAt ? e.claimedAt.toISOString() : '',
      completedAt: e.completedAt ? e.completedAt.toISOString() : '',
    };
  }
}

