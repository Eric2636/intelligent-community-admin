import type { ForumReply, Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import {
  cacheAsideJson,
  FORUM_POST_REPLIES_TTL_SEC,
  FORUM_POST_LIST_TTL_SEC,
  forumPostListCacheKey,
  forumPostRepliesDataCacheKey,
  invalidateForumPostListCache,
  invalidateForumPostRepliesCache,
} from '../../lib/redis-cache';
import { isAllowedReplyEmoji } from './forum-reply-emoji';

const MAX_POST_IMAGES = 9;
const MAX_POST_VIDEOS = 2;
const MAX_REPLY_IMAGES = 6;
const MAX_REPLY_VIDEOS = 2;

function jsonMedia(arr: string[]): Prisma.InputJsonValue {
  return arr as unknown as Prisma.InputJsonValue;
}

export class ForumService {
  private async getUserDisplayName(userId: string) {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, avatar: true } });
    return { name: row?.name ?? '邻居', avatar: row?.avatar ?? '' };
  }

  private reviveForumReplyRows(rows: ForumReply[]): ForumReply[] {
    return rows.map((r) => ({
      ...r,
      createdAt:
        r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as string),
    }));
  }

  private reviveForumPostRows<T extends { createdAt: Date }>(rows: T[]): T[] {
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as string),
    }));
  }

  async listPosts(params: {
    userId: string;
    page: number;
    pageSize: number;
    keyword?: string;
    orderBy?: 'time' | 'hot';
  }) {
    const { userId, page, pageSize, keyword } = params;
    const skip = (page - 1) * pageSize;

    const k = keyword && keyword.trim() ? keyword.trim() : '';
    const textFilter: Prisma.ForumPostWhereInput = k ? { title: { contains: k } } : {};

    const visibleWhere: Prisma.ForumPostWhereInput = { visibility: 'ONLINE', ...contentNotDeleted, ...textFilter };
    const pinnedWhere: Prisma.ForumPostWhereInput = { pinned: true, ...visibleWhere };
    const listWhere: Prisma.ForumPostWhereInput = { pinned: false, ...visibleWhere };

    const orderBy =
      params.orderBy === 'hot'
        ? [{ replyCount: 'desc' as const }, { createdAt: 'desc' as const }]
        : [{ createdAt: 'desc' as const }];

    const cacheKey = await forumPostListCacheKey(page, pageSize, k, params.orderBy || 'time');
    const cached = await cacheAsideJson(cacheKey, FORUM_POST_LIST_TTL_SEC, async () => {
      const [pinnedRows, total, listRows] = await Promise.all([
        prisma.forumPost.findMany({
          where: pinnedWhere,
          orderBy: [{ createdAt: 'desc' }],
        }),
        prisma.forumPost.count({ where: listWhere }),
        prisma.forumPost.findMany({
          where: listWhere,
          orderBy,
          skip,
          take: pageSize,
        }),
      ]);
      return { pinnedRows, total, listRows };
    });

    const pinnedRows = this.reviveForumPostRows(cached.pinnedRows);
    const listRows = this.reviveForumPostRows(cached.listRows);
    const total = cached.total;

    const uniqueIds = [...new Set([...pinnedRows, ...listRows].map((r) => r.id))];
    const [liked, favorited] =
      uniqueIds.length === 0
        ? [[], []]
        : await Promise.all([
            prisma.forumPostLike.findMany({
              where: { userId, postId: { in: uniqueIds } },
              select: { postId: true },
            }),
            prisma.forumPostFavorite.findMany({
              where: { userId, postId: { in: uniqueIds } },
              select: { postId: true },
            }),
          ]);
    const likedSet = new Set(liked.map((x) => x.postId));
    const favSet = new Set(favorited.map((x) => x.postId));

    const mapOne = (p: (typeof pinnedRows)[number]) => this.mapPostListItem(p, userId, likedSet.has(p.id), favSet.has(p.id));

    return {
      pinned: pinnedRows.map(mapOne),
      list: listRows.map(mapOne),
      total,
    };
  }

  async getPostDetail(params: { userId: string; postId: string }) {
    const { userId } = params;
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');

    const row = await prisma.$transaction(async (tx) => {
      const exists = await tx.forumPost.findFirst({ where: { id, visibility: 'ONLINE', ...contentNotDeleted } });
      if (!exists) return null;
      await tx.forumPost.update({ where: { id }, data: { viewCount: { increment: 1 } } });
      return tx.forumPost.findUnique({ where: { id } });
    });
    if (!row) throw new HttpError(404, '帖子不存在');

    const replyKey = await forumPostRepliesDataCacheKey(id);
    const [replyRowsRaw, liked, favorited] = await Promise.all([
      cacheAsideJson(replyKey, FORUM_POST_REPLIES_TTL_SEC, async () =>
        prisma.forumReply.findMany({
          where: { postId: id },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      prisma.forumPostLike.findUnique({
        where: { postId_userId: { postId: id, userId } },
        select: { id: true },
      }),
      prisma.forumPostFavorite.findUnique({
        where: { postId_userId: { postId: id, userId } },
        select: { id: true },
      }),
    ]);

    const replyRows = this.reviveForumReplyRows(replyRowsRaw);
    const detail = this.mapPostDetail(row, userId, Boolean(liked), Boolean(favorited));
    return {
      ...detail,
      replies: await this.buildFlatRepliesWithMeta(userId, replyRows),
    };
  }

  async deletePost(params: { userId: string; postId: string }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');

    const post = await prisma.forumPost.findFirst({ where: { id, visibility: 'ONLINE', ...contentNotDeleted } });
    if (!post) throw new HttpError(404, '帖子不存在');
    if (post.authorId !== params.userId) throw new HttpError(403, '仅能删除自己的帖子');

    await prisma.forumPost.update({ where: { id }, data: { deletedAt: new Date() } });
    await Promise.all([invalidateForumPostListCache(), invalidateForumPostRepliesCache(id)]);
    return {};
  }

  async deleteReply(params: { userId: string; postId: string; replyId: string }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');

    await prisma.$transaction(async (tx) => {
      const reply = await tx.forumReply.findUnique({ where: { id: replyId } });
      if (!reply) throw new HttpError(404, '回复不存在');
      if (reply.postId !== postId) throw new HttpError(400, '回复不属于该帖子');
      if (reply.authorId !== params.userId) throw new HttpError(403, '仅能删除自己的回复');

      await tx.forumReply.delete({ where: { id: replyId } });
      const cnt = await tx.forumReply.count({ where: { postId } });
      await tx.forumPost.update({ where: { id: postId }, data: { replyCount: cnt } });
    });

    await invalidateForumPostRepliesCache(postId);
    return {};
  }

  async publishPost(params: {
    userId: string;
    title: string;
    content: string;
    images?: string[];
    videos?: string[];
  }) {
    const title = String(params.title || '').trim();
    const content = String(params.content || '').trim();
    const images = parseStrictMediaUrlList(params.images, MAX_POST_IMAGES, 'image', 'images');
    const videos = parseStrictMediaUrlList(params.videos, MAX_POST_VIDEOS, 'video', 'videos');
    if (!title) throw new HttpError(400, '请输入标题');
    if (!content && images.length === 0 && videos.length === 0) {
      throw new HttpError(400, '请输入内容或添加图片/视频');
    }

    const { name: authorName, avatar: authorAvatar } = await this.getUserDisplayName(params.userId);
    const row = await prisma.forumPost.create({
      data: {
        title,
        content,
        images: jsonMedia(images),
        videos: jsonMedia(videos),
        authorId: params.userId,
        authorName,
        authorAvatar: authorAvatar || null,
      },
    });
    await invalidateForumPostListCache();
    return this.mapPostDetail(row, params.userId, false, false);
  }

  async publishReply(params: {
    userId: string;
    postId: string;
    parentReplyId?: string;
    content: string;
    images?: string[];
    videos?: string[];
  }) {
    const id = String(params.postId || '').trim();
    const content = String(params.content || '').trim();
    const images = parseStrictMediaUrlList(params.images, MAX_REPLY_IMAGES, 'image', 'images');
    const videos = parseStrictMediaUrlList(params.videos, MAX_REPLY_VIDEOS, 'video', 'videos');
    if (!id) throw new HttpError(400, 'postId 不能为空');
    if (!content && images.length === 0 && videos.length === 0) {
      throw new HttpError(400, '请输入回复或添加图片/视频');
    }

    const post = await prisma.forumPost.findFirst({ where: { id, visibility: 'ONLINE', ...contentNotDeleted } });
    if (!post) throw new HttpError(404, '帖子不存在');

    const parentReplyId: string | null = params.parentReplyId?.trim() || null;
    let replyToAuthorName: string | null = null;
    if (parentReplyId) {
      const parent = await prisma.forumReply.findFirst({
        where: { id: parentReplyId, postId: id },
      });
      if (!parent) throw new HttpError(400, '要回复的评论不存在');
      replyToAuthorName = parent.authorName ?? '邻居';
    }

    let displayDepth = 0;
    {
      let pid: string | null = parentReplyId;
      while (pid) {
        displayDepth++;
        const p = await prisma.forumReply.findUnique({
          where: { id: pid },
          select: { parentReplyId: true, postId: true },
        });
        if (!p || p.postId !== id) break;
        pid = p.parentReplyId;
      }
    }

    const { name: authorName, avatar: authorAvatar } = await this.getUserDisplayName(params.userId);
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.forumReply.create({
        data: {
          postId: id,
          parentReplyId,
          replyToAuthorName,
          authorId: params.userId,
          authorName,
          content,
          images: jsonMedia(images),
          videos: jsonMedia(videos),
        },
      });
      await tx.forumPost.update({ where: { id }, data: { replyCount: { increment: 1 } } });
      return r;
    });

    await Promise.all([invalidateForumPostListCache(), invalidateForumPostRepliesCache(id)]);

    return {
      _id: row.id,
      id: row.id,
      postId: row.postId,
      parentReplyId: row.parentReplyId,
      replyToAuthorName: row.replyToAuthorName,
      authorId: row.authorId,
      authorName: row.authorName ?? '',
      authorAvatar,
      isAuthor: true,
      content: row.content,
      images: Array.isArray(row.images) ? row.images : row.images ?? [],
      videos: Array.isArray(row.videos) ? row.videos : row.videos ?? [],
      likeCount: row.likeCount,
      isLiked: false,
      favoriteCount: row.favoriteCount,
      isFavorited: false,
      reactionCounts: {} as Record<string, number>,
      reactionList: [] as { emoji: string; count: number }[],
      myReaction: '',
      createdAt: row.createdAt.toISOString(),
      createTime: row.createdAt.toISOString(),
      depth: displayDepth,
    };
  }

  async likeReply(params: { userId: string; postId: string; replyId: string }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({ where: { id: replyId, postId } });
    if (!reply) throw new HttpError(404, '评论不存在');
    try {
      await prisma.forumReplyLike.create({ data: { replyId, userId: params.userId } });
      const updated = await prisma.forumReply.update({
        where: { id: replyId },
        data: { likeCount: { increment: 1 } },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isLiked: true, likeCount: updated.likeCount };
    } catch {
      const row = await prisma.forumReply.findUnique({ where: { id: replyId }, select: { likeCount: true } });
      await invalidateForumPostRepliesCache(postId);
      return { isLiked: true, likeCount: row?.likeCount ?? 0 };
    }
  }

  async unlikeReply(params: { userId: string; postId: string; replyId: string }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({ where: { id: replyId, postId } });
    if (!reply) throw new HttpError(404, '评论不存在');
    try {
      await prisma.forumReplyLike.delete({
        where: { replyId_userId: { replyId, userId: params.userId } },
      });
      const updated = await prisma.forumReply.update({
        where: { id: replyId },
        data: { likeCount: { decrement: 1 } },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isLiked: false, likeCount: Math.max(0, updated.likeCount) };
    } catch {
      const row = await prisma.forumReply.findUnique({ where: { id: replyId }, select: { likeCount: true } });
      await invalidateForumPostRepliesCache(postId);
      return { isLiked: false, likeCount: row?.likeCount ?? 0 };
    }
  }

  async favoriteReply(params: { userId: string; postId: string; replyId: string }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({ where: { id: replyId, postId } });
    if (!reply) throw new HttpError(404, '评论不存在');
    try {
      await prisma.forumReplyFavorite.create({ data: { replyId, userId: params.userId } });
      const updated = await prisma.forumReply.update({
        where: { id: replyId },
        data: { favoriteCount: { increment: 1 } },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isFavorited: true, favoriteCount: updated.favoriteCount };
    } catch {
      const row = await prisma.forumReply.findUnique({ where: { id: replyId }, select: { favoriteCount: true } });
      await invalidateForumPostRepliesCache(postId);
      return { isFavorited: true, favoriteCount: row?.favoriteCount ?? 0 };
    }
  }

  async unfavoriteReply(params: { userId: string; postId: string; replyId: string }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({ where: { id: replyId, postId } });
    if (!reply) throw new HttpError(404, '评论不存在');
    try {
      await prisma.forumReplyFavorite.delete({
        where: { replyId_userId: { replyId, userId: params.userId } },
      });
      const updated = await prisma.forumReply.update({
        where: { id: replyId },
        data: { favoriteCount: { decrement: 1 } },
      });
      const fc = Math.max(0, updated.favoriteCount);
      if (fc !== updated.favoriteCount) {
        await prisma.forumReply.update({ where: { id: replyId }, data: { favoriteCount: fc } });
      }
      await invalidateForumPostRepliesCache(postId);
      return { isFavorited: false, favoriteCount: fc };
    } catch {
      const row = await prisma.forumReply.findUnique({ where: { id: replyId }, select: { favoriteCount: true } });
      await invalidateForumPostRepliesCache(postId);
      return { isFavorited: false, favoriteCount: row?.favoriteCount ?? 0 };
    }
  }

  async setReplyReaction(params: { userId: string; postId: string; replyId: string; emoji: string | undefined }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({ where: { id: replyId, postId } });
    if (!reply) throw new HttpError(404, '评论不存在');

    const raw = (params.emoji ?? '').trim();
    if (raw && !isAllowedReplyEmoji(raw)) throw new HttpError(400, '不支持的表情');

    const key = { replyId_userId: { replyId, userId: params.userId } };
    const existing = await prisma.forumReplyReaction.findUnique({ where: key });

    if (!raw) {
      if (existing) await prisma.forumReplyReaction.delete({ where: key });
      return this.getReplyReactionSnapshot(replyId, params.userId);
    }

    if (existing?.emoji === raw) {
      await prisma.forumReplyReaction.delete({ where: key });
      return this.getReplyReactionSnapshot(replyId, params.userId);
    }

    if (existing) {
      await prisma.forumReplyReaction.update({ where: key, data: { emoji: raw } });
    } else {
      await prisma.forumReplyReaction.create({
        data: { replyId, userId: params.userId, emoji: raw },
      });
    }
    return this.getReplyReactionSnapshot(replyId, params.userId);
  }

  async like(params: { userId: string; postId: string }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');
    const post = await prisma.forumPost.findFirst({
      where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      select: { id: true },
    });
    if (!post) throw new HttpError(404, '帖子不存在');
    try {
      await prisma.forumPostLike.create({ data: { postId: id, userId: params.userId } });
      const updated = await prisma.forumPost.update({ where: { id }, data: { likeCount: { increment: 1 } } });
      await invalidateForumPostListCache();
      return { liked: true, likeCount: updated.likeCount };
    } catch {
      const row = await prisma.forumPost.findUnique({ where: { id }, select: { likeCount: true } });
      await invalidateForumPostListCache();
      return { liked: true, likeCount: row?.likeCount ?? 0 };
    }
  }

  async unlike(params: { userId: string; postId: string }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');
    const post = await prisma.forumPost.findFirst({
      where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      select: { id: true },
    });
    if (!post) throw new HttpError(404, '帖子不存在');
    try {
      await prisma.forumPostLike.delete({ where: { postId_userId: { postId: id, userId: params.userId } } });
      const updated = await prisma.forumPost.update({
        where: { id },
        data: { likeCount: { decrement: 1 } },
      });
      await invalidateForumPostListCache();
      return { liked: false, likeCount: Math.max(0, updated.likeCount) };
    } catch {
      const row = await prisma.forumPost.findUnique({ where: { id }, select: { likeCount: true } });
      await invalidateForumPostListCache();
      return { liked: false, likeCount: row?.likeCount ?? 0 };
    }
  }

  async favorite(params: { userId: string; postId: string }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');
    const post = await prisma.forumPost.findFirst({
      where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      select: { id: true },
    });
    if (!post) throw new HttpError(404, '帖子不存在');
    try {
      await prisma.forumPostFavorite.create({ data: { postId: id, userId: params.userId } });
    } catch {
      // duplicate
    }
    return { favorited: true };
  }

  async unfavorite(params: { userId: string; postId: string }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');
    const post = await prisma.forumPost.findFirst({
      where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      select: { id: true },
    });
    if (!post) throw new HttpError(404, '帖子不存在');
    try {
      await prisma.forumPostFavorite.delete({ where: { postId_userId: { postId: id, userId: params.userId } } });
    } catch {
      // ignore
    }
    return { favorited: false };
  }

  async getMyPosts(params: { userId: string }) {
    const rows = await prisma.forumPost.findMany({
      where: { authorId: params.userId, visibility: 'ONLINE', ...contentNotDeleted },
      orderBy: { createdAt: 'desc' },
    });
    const ids = rows.map((r) => r.id);
    const [liked, favorited] = await Promise.all([
      prisma.forumPostLike.findMany({ where: { userId: params.userId, postId: { in: ids } }, select: { postId: true } }),
      prisma.forumPostFavorite.findMany({
        where: { userId: params.userId, postId: { in: ids } },
        select: { postId: true },
      }),
    ]);
    const likedSet = new Set(liked.map((x) => x.postId));
    const favSet = new Set(favorited.map((x) => x.postId));
    return rows.map((p) => this.mapPostListItem(p, params.userId, likedSet.has(p.id), favSet.has(p.id)));
  }

  private async getReplyReactionSnapshot(replyId: string, userId: string) {
    const [agg, mine] = await Promise.all([
      prisma.forumReplyReaction.groupBy({
        by: ['emoji'],
        where: { replyId },
        _count: { _all: true },
      }),
      prisma.forumReplyReaction.findUnique({
        where: { replyId_userId: { replyId, userId } },
        select: { emoji: true },
      }),
    ]);
    const reactionCounts: Record<string, number> = {};
    for (const g of agg) reactionCounts[g.emoji] = g._count._all;
    return { reactionCounts, myReaction: mine?.emoji ?? '' };
  }

  private async buildFlatRepliesWithMeta(
    userId: string,
    rows: Array<{
      id: string;
      postId: string;
      parentReplyId: string | null;
      replyToAuthorName: string | null;
      authorId: string;
      authorName: string | null;
      content: string;
      images: unknown;
      videos: unknown;
      likeCount: number;
      favoriteCount: number;
      createdAt: Date;
    }>,
  ) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const authorIds = [...new Set(rows.map((r) => r.authorId).filter(Boolean))];
    const [likes, favs, userReactions, reactionAgg, users] = await Promise.all([
      prisma.forumReplyLike.findMany({
        where: { userId, replyId: { in: ids } },
        select: { replyId: true },
      }),
      prisma.forumReplyFavorite.findMany({
        where: { userId, replyId: { in: ids } },
        select: { replyId: true },
      }),
      prisma.forumReplyReaction.findMany({
        where: { userId, replyId: { in: ids } },
        select: { replyId: true, emoji: true },
      }),
      prisma.forumReplyReaction.groupBy({
        by: ['replyId', 'emoji'],
        where: { replyId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.user.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, avatar: true },
      }),
    ]);
    const likedSet = new Set(likes.map((x) => x.replyId));
    const favSet = new Set(favs.map((x) => x.replyId));
    const myReactMap = new Map(userReactions.map((x) => [x.replyId, x.emoji]));
    const userAvatarMap = new Map(users.map((x) => [x.id, x.avatar ?? '']));
    const countMap = new Map<string, Record<string, number>>();
    for (const g of reactionAgg) {
      if (!countMap.has(g.replyId)) countMap.set(g.replyId, {});
      countMap.get(g.replyId)![g.emoji] = g._count._all;
    }

    const mapBase = (r: (typeof rows)[number]) => ({
      _id: r.id,
      id: r.id,
      postId: r.postId,
      parentReplyId: r.parentReplyId,
      replyToAuthorName: r.replyToAuthorName,
      authorId: r.authorId,
      authorName: r.authorName ?? '',
      authorAvatar: userAvatarMap.get(r.authorId) ?? '',
      isAuthor: r.authorId === userId,
      content: r.content,
      images: Array.isArray(r.images) ? r.images : r.images ?? [],
      videos: Array.isArray(r.videos) ? r.videos : r.videos ?? [],
      likeCount: r.likeCount,
      isLiked: likedSet.has(r.id),
      favoriteCount: r.favoriteCount,
      isFavorited: favSet.has(r.id),
      reactionCounts: countMap.get(r.id) ?? {},
      myReaction: myReactMap.get(r.id) ?? '',
      createdAt: r.createdAt.toISOString(),
      createTime: r.createdAt.toISOString(),
    });

    type Node = ReturnType<typeof mapBase> & { children: Node[] };
    const nodes = new Map<string, Node>();
    for (const r of rows) {
      const b = mapBase(r);
      nodes.set(r.id, { ...b, children: [] });
    }
    const roots: Node[] = [];
    for (const r of rows) {
      const node = nodes.get(r.id)!;
      if (!r.parentReplyId) {
        roots.push(node);
      } else {
        const p = nodes.get(r.parentReplyId);
        if (p) p.children.push(node);
        else roots.push(node);
      }
    }
    roots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (const root of roots) {
      root.children.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    const flat: Array<Omit<Node, 'children'> & { depth: number }> = [];
    const walk = (n: Node, depth: number) => {
      const { children, ...rest } = n;
      flat.push({ ...rest, depth });
      for (const c of children) walk(c, depth + 1);
    };
    for (const root of roots) walk(root, 0);
    return flat;
  }

  async getMyFavoritePosts(params: { userId: string }) {
    const favs = await prisma.forumPostFavorite.findMany({
      where: { userId: params.userId },
      orderBy: { createdAt: 'desc' },
    });
    if (favs.length === 0) return [];

    const ids = favs.map((f) => f.postId);
    const posts = await prisma.forumPost.findMany({
      where: { id: { in: ids }, visibility: 'ONLINE', ...contentNotDeleted },
    });
    const map = new Map(posts.map((p) => [p.id, p]));

    const liked = await prisma.forumPostLike.findMany({
      where: { userId: params.userId, postId: { in: ids } },
      select: { postId: true },
    });
    const likedSet = new Set(liked.map((x) => x.postId));

    return ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((p) => this.mapPostListItem(p!, params.userId, likedSet.has(p!.id), true));
  }

  private mapPostListItem(
    p: {
      id: string;
      title: string;
      content: string;
      images: unknown;
      videos: unknown;
      authorId: string;
      authorName: string | null;
      authorAvatar?: string | null;
      adminLabel?: string | null;
      pinned?: boolean;
      viewCount?: number;
      likeCount: number;
      replyCount: number;
      createdAt: Date;
    },
    userId: string,
    isLiked: boolean,
    isFavorited: boolean,
  ) {
    const images = Array.isArray(p.images) ? p.images : p.images ?? [];
    const videos = Array.isArray(p.videos) ? p.videos : p.videos ?? [];
    return {
      _id: p.id,
      id: p.id,
      title: p.title,
      content: p.content,
      images,
      videos,
      pinned: Boolean(p.pinned),
      authorId: p.authorId,
      authorName: p.authorName ?? '',
      authorAvatar: p.authorAvatar ?? '',
      adminLabel: p.adminLabel ?? '',
      viewCount: p.viewCount ?? 0,
      likeCount: p.likeCount ?? 0,
      replyCount: p.replyCount ?? 0,
      isLiked,
      isFavorited,
      isAuthor: p.authorId === userId,
      createdAt: p.createdAt.toISOString(),
      createTime: p.createdAt.toISOString(),
    };
  }

  private mapPostDetail(
    p: {
      id: string;
      title: string;
      content: string;
      images: unknown;
      videos: unknown;
      authorId: string;
      authorName: string | null;
      authorAvatar?: string | null;
      pinned?: boolean;
      viewCount?: number;
      likeCount: number;
      replyCount: number;
      createdAt: Date;
    },
    userId: string,
    isLiked: boolean,
    isFavorited: boolean,
  ) {
    const base = this.mapPostListItem(p, userId, isLiked, isFavorited);
    return {
      ...base,
      authorAvatar: p.authorAvatar ?? '',
    };
  }
}
