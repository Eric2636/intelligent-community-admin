import { HttpError } from '../../http-error';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { prisma } from '../../lib/prisma';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import type { Prisma } from '@prisma/client';

const COMMENT_LIST_CAP = 300;
const MAX_COMMENT_IMAGES = 3;

type CommentRow = {
  id: string;
  itemId: string;
  userId: string;
  parentId: string | null;
  replyToAuthorName: string | null;
  content: string;
  images: Prisma.JsonValue | null;
  createdAt: Date;
};

function parseImages(json: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(json)) return [];
  return (json as unknown[]).filter((x) => typeof x === 'string') as string[];
}

function serializeNode(
  r: CommentRow,
  userMap: Map<string, { name: string | null; avatar: string | null }>,
  likeCountMap: Map<string, number>,
  likedSet: Set<string>,
) {
  const u = userMap.get(r.userId);
  return {
    id: r.id,
    _id: r.id,
    itemId: r.itemId,
    userId: r.userId,
    userName: u?.name ?? '',
    userAvatar: u?.avatar ?? '',
    parentId: r.parentId,
    replyToAuthorName: r.replyToAuthorName ?? '',
    content: r.content,
    images: parseImages(r.images),
    createdAt: r.createdAt.toISOString(),
    likeCount: likeCountMap.get(r.id) ?? 0,
    liked: likedSet.has(r.id),
    replies: [] as ReturnType<typeof serializeNode>[],
  };
}

export class MallCommentService {
  async listItemComments(params: { itemId: string; userId: string }) {
    const itemId = String(params.itemId || '').trim();
    if (!itemId) throw new HttpError(400, '缺少 itemId');

    const rows = await prisma.mallItemComment.findMany({
      where: { itemId },
      orderBy: { createdAt: 'asc' },
      take: COMMENT_LIST_CAP,
    });

    if (rows.length === 0) return [];

    const userIds = Array.from(new Set(rows.map((r) => r.userId)));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, avatar: true },
    });
    const userMap = new Map(users.map((u) => [u.id, { name: u.name, avatar: u.avatar }]));

    const commentIds = rows.map((r) => r.id);
    const [groupCounts, myLikes] = await Promise.all([
      prisma.mallItemCommentLike.groupBy({
        by: ['commentId'],
        where: { commentId: { in: commentIds } },
        _count: { _all: true },
      }),
      prisma.mallItemCommentLike.findMany({
        where: { userId: params.userId, commentId: { in: commentIds } },
        select: { commentId: true },
      }),
    ]);

    const likeCountMap = new Map(groupCounts.map((g) => [g.commentId, g._count._all]));
    const likedSet = new Set(myLikes.map((x) => x.commentId));

    const nodeMap = new Map<string, ReturnType<typeof serializeNode>>();
    for (const r of rows) {
      nodeMap.set(r.id, serializeNode(r, userMap, likeCountMap, likedSet));
    }

    const roots: ReturnType<typeof serializeNode>[] = [];
    for (const r of rows) {
      const node = nodeMap.get(r.id)!;
      if (!r.parentId) {
        roots.push(node);
      } else {
        const parent = nodeMap.get(r.parentId);
        if (parent) parent.replies.push(node);
      }
    }

    roots.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    for (const root of roots) {
      root.replies.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }

    return roots;
  }

  async createItemComment(params: {
    itemId: string;
    userId: string;
    content?: string;
    parentCommentId?: string;
    images?: string[];
  }) {
    const itemId = String(params.itemId || '').trim();
    const content = String(params.content ?? '').trim();
    const parentCommentId = String(params.parentCommentId || '').trim() || undefined;

    if (!itemId) throw new HttpError(400, '缺少 itemId');

    const imageUrls = parseStrictMediaUrlList(params.images, MAX_COMMENT_IMAGES, 'image', 'images');
    if (!content && imageUrls.length === 0) {
      throw new HttpError(400, '评论内容或图片至少填写一项');
    }

    const exists = await prisma.mallItem.findFirst({
      where: { id: itemId, visibility: 'ONLINE', ...contentNotDeleted },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, '商品不存在');

    let parentId: string | null = null;
    let replyToAuthorName: string | null = null;

    if (parentCommentId) {
      const parent = await prisma.mallItemComment.findUnique({ where: { id: parentCommentId } });
      if (!parent || parent.itemId !== itemId) throw new HttpError(404, '被回复的评论不存在');
      if (parent.parentId) {
        throw new HttpError(400, '仅支持回复主评论');
      }
      parentId = parent.id;
      const pu = await prisma.user.findUnique({
        where: { id: parent.userId },
        select: { name: true },
      });
      replyToAuthorName = pu?.name?.trim() || '用户';
    }

    const row = await prisma.mallItemComment.create({
      data: {
        itemId,
        userId: params.userId,
        parentId,
        replyToAuthorName,
        content,
        images: imageUrls.length ? (imageUrls as unknown as Prisma.InputJsonValue) : undefined,
      },
    });

    return { commentId: row.id };
  }

  async deleteItemComment(params: { itemId: string; commentId: string; userId: string }) {
    const itemId = String(params.itemId || '').trim();
    const commentId = String(params.commentId || '').trim();
    if (!itemId) throw new HttpError(400, '缺少 itemId');
    if (!commentId) throw new HttpError(400, '缺少 commentId');

    const row = await prisma.mallItemComment.findUnique({ where: { id: commentId } });
    if (!row || row.itemId !== itemId) throw new HttpError(404, '评论不存在');
    if (row.userId !== params.userId) throw new HttpError(403, '无权限删除该评论');

    await prisma.mallItemComment.delete({ where: { id: commentId } });
    return {};
  }

  async likeItemComment(params: { itemId: string; commentId: string; userId: string }) {
    const itemId = String(params.itemId || '').trim();
    const commentId = String(params.commentId || '').trim();
    if (!itemId) throw new HttpError(400, '缺少 itemId');
    if (!commentId) throw new HttpError(400, '缺少 commentId');

    const row = await prisma.mallItemComment.findUnique({ where: { id: commentId } });
    if (!row || row.itemId !== itemId) throw new HttpError(404, '评论不存在');

    await prisma.mallItemCommentLike.upsert({
      where: { commentId_userId: { commentId, userId: params.userId } },
      create: { commentId, userId: params.userId },
      update: {},
    });

    const likeCount = await prisma.mallItemCommentLike.count({ where: { commentId } });
    return { liked: true, likeCount };
  }

  async unlikeItemComment(params: { itemId: string; commentId: string; userId: string }) {
    const itemId = String(params.itemId || '').trim();
    const commentId = String(params.commentId || '').trim();
    if (!itemId) throw new HttpError(400, '缺少 itemId');
    if (!commentId) throw new HttpError(400, '缺少 commentId');

    const row = await prisma.mallItemComment.findUnique({ where: { id: commentId } });
    if (!row || row.itemId !== itemId) throw new HttpError(404, '评论不存在');

    await prisma.mallItemCommentLike.deleteMany({
      where: { commentId, userId: params.userId },
    });

    const likeCount = await prisma.mallItemCommentLike.count({ where: { commentId } });
    return { liked: false, likeCount };
  }
}
