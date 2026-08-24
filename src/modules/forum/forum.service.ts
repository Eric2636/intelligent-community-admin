import type { ForumReply, Prisma, PrismaClient } from '@prisma/client';
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
import { notify } from '../notification/notification-notify';
import { sanitizeNotificationText } from '../notification/notification-text';
import { configuredMediaAssetService } from '../media/media-asset.service';
import { avatarOrDefault } from '../user/default-avatar';
import { effectiveUserTag, resolveEffectiveUserTags, type EffectiveUserTag } from '../user/user-identity';
import { lockUsersForProfileSnapshot } from '../user/user-profile-sync';
import { isAllowedReplyEmoji } from './forum-reply-emoji';
import { assertForumPostTypeFeatureType, registrationStatus } from './forum-feature';
import { assertForumAttachmentsAvailable, forumAttachmentIds, replaceForumPostAttachments } from './forum-attachments';

const MAX_POST_IMAGES = 9;
const MAX_POST_VIDEOS = 2;
const MAX_REPLY_IMAGES = 6;
const MAX_REPLY_VIDEOS = 2;
const MAX_POST_ATTACHMENTS = 5;
const ADMIN_ANNOUNCEMENT_AUTHOR_ID = '__admin_announcement__';

function jsonMedia(arr: string[]): Prisma.InputJsonValue {
  return arr as unknown as Prisma.InputJsonValue;
}

function mediaUrls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string') : [];
}

type ForumDatabase = Pick<PrismaClient, '$transaction' | 'user' | 'adminUser'>;

type ForumCacheInvalidators = {
  invalidatePostList: () => Promise<void>;
  invalidateReplies: (postId: string) => Promise<void>;
};

const defaultForumCacheInvalidators: ForumCacheInvalidators = {
  invalidatePostList: invalidateForumPostListCache,
  invalidateReplies: invalidateForumPostRepliesCache,
};

function notificationExcerpt(content: string): string {
  return sanitizeNotificationText(content);
}

export class ForumService {
  constructor(
    private readonly database: ForumDatabase = prisma,
    private readonly cacheInvalidators: ForumCacheInvalidators = defaultForumCacheInvalidators,
  ) {}

  private reviveForumReplyRows(rows: ForumReply[]): ForumReply[] {
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as string),
    }));
  }

  private reviveForumPostRows<T extends { createdAt: Date }>(rows: T[]): T[] {
    return rows.map((r) => ({
      ...r,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as unknown as string),
    }));
  }

  async listPosts(params: {
    userId?: string;
    page: number;
    pageSize: number;
    keyword?: string;
    orderBy?: 'time' | 'hot';
  }) {
    const { userId, page, pageSize, keyword } = params;
    const skip = (page - 1) * pageSize;

    const k = keyword && keyword.trim() ? keyword.trim() : '';
    const textFilter: Prisma.ForumPostWhereInput = k ? { title: { contains: k } } : {};

    const visibleWhere: Prisma.ForumPostWhereInput = {
      visibility: 'ONLINE',
      postType: 'NORMAL',
      ...contentNotDeleted,
      ...textFilter,
    };
    const pinnedWhere: Prisma.ForumPostWhereInput = {
      pinned: true,
      ...visibleWhere,
    };
    const listWhere: Prisma.ForumPostWhereInput = {
      pinned: false,
      ...visibleWhere,
    };

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
      !userId || uniqueIds.length === 0
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

    const [tags, registrations] = await Promise.all([
      resolveEffectiveUserTags(this.database, [...pinnedRows, ...listRows].map((row) => row.authorId)),
      this.getRegistrationSummaries(uniqueIds, userId || ''),
    ]);
    const mapOne = (p: (typeof pinnedRows)[number]) =>
      this.mapPostListItem(p, userId || '', likedSet.has(p.id), favSet.has(p.id), tags.get(p.authorId), registrations.get(p.id));

    return {
      pinned: pinnedRows.map(mapOne),
      list: listRows.map(mapOne),
      total,
    };
  }

  async listAnnouncements(params: { userId?: string; limit?: number }) {
    const limit = Math.min(Math.max(Number(params.limit || 5), 1), 10);
    const rows = await prisma.forumPost.findMany({
      where: {
        visibility: 'ONLINE',
        postType: 'ANNOUNCEMENT',
        validUntil: { gt: new Date() },
        ...contentNotDeleted,
      },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [liked, favorited] = params.userId
      ? await Promise.all([
          prisma.forumPostLike.findMany({
            where: { userId: params.userId, postId: { in: ids } },
            select: { postId: true },
          }),
          prisma.forumPostFavorite.findMany({
            where: { userId: params.userId, postId: { in: ids } },
            select: { postId: true },
          }),
        ])
      : [[], []];
    const likedSet = new Set(liked.map((x) => x.postId));
    const favSet = new Set(favorited.map((x) => x.postId));

    const [tags, registrations] = await Promise.all([
      resolveEffectiveUserTags(this.database, rows.map((row) => row.authorId)),
      this.getRegistrationSummaries(ids, params.userId || ''),
    ]);
    return rows.map((p) => this.mapPostListItem(p, params.userId || '', likedSet.has(p.id), favSet.has(p.id), tags.get(p.authorId), registrations.get(p.id)));
  }

  async getPostDetail(params: { userId?: string; postId: string }) {
    const userId = params.userId || '';
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');

    const row = await prisma.$transaction(async (tx) => {
      const exists = await tx.forumPost.findFirst({
        where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      });
      if (!exists) return null;
      await tx.forumPost.update({
        where: { id },
        data: { viewCount: { increment: 1 } },
      });
      return tx.forumPost.findUnique({ where: { id } });
    });
    if (!row) throw new HttpError(404, '帖子不存在');

    const replyKey = await forumPostRepliesDataCacheKey(id);
    const [replyRowsRaw, liked, attachments, favorited] = await Promise.all([
      cacheAsideJson(replyKey, FORUM_POST_REPLIES_TTL_SEC, async () =>
        prisma.forumReply.findMany({
          where: { postId: id },
          orderBy: { createdAt: 'asc' },
        }),
      ),
      userId
        ? prisma.forumPostLike.findUnique({
            where: { postId_userId: { postId: id, userId } },
            select: { id: true },
          })
        : Promise.resolve(null),
      prisma.forumPostAttachment.findMany({
        where: { postId: id },
        include: { mediaAsset: { select: { id: true, url: true, originalName: true, contentType: true, sizeBytes: true } } },
        orderBy: { sortOrder: 'asc' },
      }),
      userId
        ? prisma.forumPostFavorite.findUnique({
            where: { postId_userId: { postId: id, userId } },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    const replyRows = this.reviveForumReplyRows(replyRowsRaw);
    const registration = row.featureType === 'REGISTRATION'
      ? await prisma.forumPostRegistration.findUnique({ where: { postId: id }, include: { entries: { select: { userId: true } } } })
      : null;
    const tags = await resolveEffectiveUserTags(this.database, [row.authorId]);
    const detail = this.mapPostDetail(row, userId, Boolean(liked), Boolean(favorited), tags.get(row.authorId));
    return {
      ...detail,
      registration: registration
        ? {
            capacity: registration.capacity,
            registeredCount: registration.entries.length,
            remainingCount: Math.max(0, registration.capacity - registration.entries.length),
            deadlineAt: registration.deadlineAt.toISOString(),
            status: registrationStatus({ deadlineAt: registration.deadlineAt, capacity: registration.capacity, registeredCount: registration.entries.length }),
            isRegistered: registration.entries.some((entry) => entry.userId === userId),
          }
        : null,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        mediaAssetId: attachment.mediaAsset.id,
        name: attachment.mediaAsset.originalName || '附件',
        sizeBytes: attachment.mediaAsset.sizeBytes || 0,
        contentType: attachment.mediaAsset.contentType || '',
        url: attachment.mediaAsset.url,
      })),
      replies: await this.buildFlatRepliesWithMeta(userId, replyRows),
    };
  }

  async deletePost(params: { userId: string; postId: string }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');

    await prisma.$transaction(async (tx) => {
      const post = await tx.forumPost.findFirst({
        where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      });
      if (!post) throw new HttpError(404, '帖子不存在');
      if (post.authorId !== params.userId) throw new HttpError(403, '仅能删除自己的帖子');
      const replies = await tx.forumReply.findMany({ where: { postId: id }, select: { images: true, videos: true } });
      const attachments = await tx.forumPostAttachment.findMany({ where: { postId: id }, select: { mediaAssetId: true } });
      await tx.forumPost.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      const media = configuredMediaAssetService(tx);
      await media?.requestDeleteUrls(tx, [
        ...mediaUrls(post.images),
        ...mediaUrls(post.videos),
        ...replies.flatMap((reply) => [
          ...mediaUrls(reply.images),
          ...mediaUrls(reply.videos),
        ]),
      ]);
      await tx.forumPostAttachment.deleteMany({ where: { postId: id } });
      if (attachments.length) {
        await tx.mediaAsset.updateMany({
          where: { id: { in: attachments.map((attachment) => attachment.mediaAssetId) }, state: { in: ['PENDING', 'ATTACHED', 'DELETE_FAILED'] } },
          data: { state: 'DELETE_PENDING', deleteRequestedAt: new Date(), lastDeleteError: null },
        });
      }
    });
    await Promise.all([invalidateForumPostListCache(), invalidateForumPostRepliesCache(id)]);
    return {};
  }

  async setPinned(params: { userId: string; postId: string; pinned: boolean }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');
    const admin = await prisma.adminUser.findFirst({ where: { boundUserId: params.userId, enabled: true }, select: { id: true } });
    if (!admin) throw new HttpError(403, '仅管理员可以置顶帖子');
    const post = await prisma.forumPost.findFirst({ where: { id, visibility: 'ONLINE', ...contentNotDeleted } });
    if (!post) throw new HttpError(404, '帖子不存在');
    if (post.authorId !== params.userId) throw new HttpError(403, '仅发布该帖的管理员可以置顶');
    await prisma.forumPost.update({ where: { id }, data: { pinned: params.pinned } });
    await invalidateForumPostListCache();
    return { pinned: params.pinned };
  }

  async assertCanManageAttachments(userId: string) {
    const admin = await prisma.adminUser.findFirst({ where: { boundUserId: userId, enabled: true }, select: { id: true } });
    if (!admin) throw new HttpError(403, '仅管理员可以上传帖子附件');
    return admin;
  }

  async getRegistrationEntries(params: { userId: string; postId: string }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');
    const admin = await prisma.adminUser.findFirst({ where: { boundUserId: params.userId, enabled: true }, select: { id: true } });
    if (!admin) throw new HttpError(403, '仅管理员可以查看报名名单');
    const post = await prisma.forumPost.findFirst({ where: { id, featureType: 'REGISTRATION', ...contentNotDeleted }, select: { authorId: true } });
    if (!post) throw new HttpError(404, '报名活动不存在');
    if (post.authorId !== params.userId) throw new HttpError(403, '仅发布该帖的管理员可以查看报名名单');
    const entries = await prisma.forumPostRegistrationEntry.findMany({ where: { postId: id }, orderBy: { createdAt: 'asc' } });
    const users = await prisma.user.findMany({ where: { id: { in: entries.map((entry) => entry.userId) } }, select: { id: true, name: true, avatar: true, phoneNumber: true } });
    const usersById = new Map(users.map((user) => [user.id, user]));
    return {
      total: entries.length,
      list: entries.map((entry) => {
        const user = usersById.get(entry.userId);
        return { userId: entry.userId, name: user?.name ?? '', avatar: avatarOrDefault(user?.avatar), phoneNumber: user?.phoneNumber ?? '', createdAt: entry.createdAt.toISOString() };
      }),
    };
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
      const media = configuredMediaAssetService(tx);
      await media?.requestDeleteUrls(tx, [
        ...mediaUrls(reply.images),
        ...mediaUrls(reply.videos),
      ]);
      const cnt = await tx.forumReply.count({ where: { postId } });
      await tx.forumPost.update({
        where: { id: postId },
        data: { replyCount: cnt },
      });
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
    postType?: 'NORMAL' | 'ANNOUNCEMENT';
    featureType?: 'CONTENT' | 'REGISTRATION';
    registrationCapacity?: number;
    registrationDeadlineAt?: string;
    pinned?: boolean;
    attachments?: { mediaAssetId: string }[];
  }) {
    const title = String(params.title || '').trim();
    const content = String(params.content || '').trim();
    const images = parseStrictMediaUrlList(params.images, MAX_POST_IMAGES, 'image', 'images');
    const videos = parseStrictMediaUrlList(params.videos, MAX_POST_VIDEOS, 'video', 'videos');
    if (!title) throw new HttpError(400, '请输入标题');
    if (!content && images.length === 0 && videos.length === 0) {
      throw new HttpError(400, '请输入内容或添加图片/视频');
    }
    const postType = params.postType || 'NORMAL';
    const featureType = params.featureType || 'CONTENT';
    const attachmentIds = params.attachments === undefined ? [] : forumAttachmentIds(params.attachments);
    assertForumPostTypeFeatureType(postType, featureType);
    const announcementValidUntil = postType === 'ANNOUNCEMENT'
      ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      : null;
    const requiresAdmin = postType !== 'NORMAL' || featureType !== 'CONTENT' || Boolean(params.pinned) || attachmentIds.length > 0;
    const boundAdmin = requiresAdmin
      ? await prisma.adminUser.findFirst({ where: { boundUserId: params.userId, enabled: true }, select: { id: true } })
      : null;
    if (requiresAdmin && !boundAdmin) throw new HttpError(403, '仅管理员可以发布公告、报名帖或置顶帖子');
    const registrationDeadlineAt = params.registrationDeadlineAt ? new Date(params.registrationDeadlineAt) : null;
    if (featureType === 'REGISTRATION') {
      if (!Number.isInteger(params.registrationCapacity) || Number(params.registrationCapacity) < 1) {
        throw new HttpError(400, '请设置报名人数上限');
      }
      if (!registrationDeadlineAt || Number.isNaN(registrationDeadlineAt.getTime()) || registrationDeadlineAt.getTime() <= Date.now()) {
        throw new HttpError(400, '报名截止时间必须晚于当前时间');
      }
    }

    const row = await prisma.$transaction(async (tx) => {
      await lockUsersForProfileSnapshot(tx, [params.userId]);
      const author = await tx.user.findUnique({
        where: { id: params.userId },
        select: { name: true, avatar: true },
      });
      const row = await tx.forumPost.create({
        data: {
          title,
          content,
          images: jsonMedia(images),
          videos: jsonMedia(videos),
          authorId: params.userId,
          authorName: author?.name ?? '邻居',
          authorAvatar: author?.avatar ?? null,
          createdByAdminId: boundAdmin?.id,
          postType,
          featureType,
          validUntil: announcementValidUntil,
          pinned: Boolean(params.pinned),
        },
      });
      if (attachmentIds.length) {
        const activeAdmin = await tx.adminUser.findFirst({ where: { boundUserId: params.userId, enabled: true }, select: { id: true } });
        if (!activeAdmin) throw new HttpError(403, '管理员账号已停用，无法关联附件');
        await assertForumAttachmentsAvailable(tx, { uploaderId: params.userId, mediaAssetIds: attachmentIds });
        await replaceForumPostAttachments(tx, { postId: row.id, mediaAssetIds: attachmentIds });
      }
      if (featureType === 'REGISTRATION') {
        await tx.forumPostRegistration.create({
          data: { postId: row.id, capacity: Number(params.registrationCapacity), deadlineAt: registrationDeadlineAt! },
        });
      }
      const media = configuredMediaAssetService(tx);
      await media?.attachUrls(tx, { uploaderId: params.userId, urls: [...images, ...videos] });
      return row;
    });
    await invalidateForumPostListCache();
    const tags = await resolveEffectiveUserTags(this.database, [params.userId]);
    return this.mapPostDetail(row, params.userId, false, false, tags.get(params.userId));
  }

  async updatePost(params: {
    userId: string;
    postId: string;
    title?: string;
    content?: string;
    images?: string[];
    videos?: string[];
    attachments?: { mediaAssetId: string }[];
  }) {
    await this.assertCanManageAttachments(params.userId);
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');
    const current = await prisma.forumPost.findFirst({ where: { id, authorId: params.userId, visibility: 'ONLINE', ...contentNotDeleted } });
    if (!current) throw new HttpError(403, '仅能编辑自己发布的管理员帖子');
    const title = params.title === undefined ? current.title : String(params.title).trim();
    const content = params.content === undefined ? current.content : String(params.content).trim();
    const images = params.images === undefined ? mediaUrls(current.images) : parseStrictMediaUrlList(params.images, MAX_POST_IMAGES, 'image', 'images');
    const videos = params.videos === undefined ? mediaUrls(current.videos) : parseStrictMediaUrlList(params.videos, MAX_POST_VIDEOS, 'video', 'videos');
    if (!title) throw new HttpError(400, '请输入标题');
    if (!content && images.length === 0 && videos.length === 0) throw new HttpError(400, '请输入内容或添加图片/视频');
    const attachmentIds = params.attachments === undefined ? undefined : forumAttachmentIds(params.attachments);
    const updated = await prisma.$transaction(async (tx) => {
      const activeAdmin = await tx.adminUser.findFirst({ where: { boundUserId: params.userId, enabled: true }, select: { id: true } });
      if (!activeAdmin) throw new HttpError(403, '管理员账号已停用，无法编辑帖子');
      const row = await tx.forumPost.findFirst({ where: { id, authorId: params.userId, visibility: 'ONLINE', ...contentNotDeleted } });
      if (!row) throw new HttpError(403, '仅能编辑自己发布的管理员帖子');
      const result = await tx.forumPost.update({ where: { id }, data: { title, content, images: jsonMedia(images), videos: jsonMedia(videos) } });
      if (attachmentIds !== undefined) {
        await assertForumAttachmentsAvailable(tx, { uploaderId: params.userId, mediaAssetIds: attachmentIds, postId: id });
        await replaceForumPostAttachments(tx, { postId: id, mediaAssetIds: attachmentIds });
      }
      const media = configuredMediaAssetService(tx);
      await media?.attachUrls(tx, { uploaderId: params.userId, urls: [...images, ...videos] });
      await media?.requestDeleteUrls(tx, [...mediaUrls(current.images), ...mediaUrls(current.videos)].filter((url) => ![...images, ...videos].includes(url)));
      return result;
    });
    await invalidateForumPostListCache();
    return updated;
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

    const parentReplyId: string | null = params.parentReplyId?.trim() || null;
    const created = await this.database.$transaction(async (tx) => {
      const targetPost = await tx.forumPost.findFirst({
        where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      });
      if (!targetPost) throw new HttpError(404, '帖子不存在');
      const targetParent = parentReplyId
        ? await tx.forumReply.findFirst({
            where: { id: parentReplyId, postId: id },
          })
        : null;
      if (parentReplyId && !targetParent) throw new HttpError(400, '要回复的评论不存在');

      const recipientId = targetParent?.authorId ?? targetPost.authorId;
      await lockUsersForProfileSnapshot(tx, [params.userId, recipientId]);

      const post = await tx.forumPost.findFirst({
        where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      });
      if (!post) throw new HttpError(404, '帖子不存在');
      const parent = parentReplyId
        ? await tx.forumReply.findFirst({
            where: { id: parentReplyId, postId: id },
          })
        : null;
      if (parentReplyId && !parent) throw new HttpError(400, '要回复的评论不存在');

      let displayDepth = 0;
      let pid: string | null = parentReplyId;
      while (pid) {
        displayDepth++;
        const ancestor = await tx.forumReply.findUnique({
          where: { id: pid },
          select: { parentReplyId: true, postId: true },
        });
        if (!ancestor || ancestor.postId !== id) break;
        pid = ancestor.parentReplyId;
      }
      const author = await tx.user.findUnique({
        where: { id: params.userId },
        select: { name: true, avatar: true },
      });
      const r = await tx.forumReply.create({
        data: {
          postId: id,
          parentReplyId,
          replyToAuthorName: parent?.authorName ?? null,
          replyToUserId: parent?.authorId ?? null,
          authorId: params.userId,
          authorName: author?.name ?? '邻居',
          authorAvatar: author?.avatar ?? null,
          content,
          images: jsonMedia(images),
          videos: jsonMedia(videos),
        },
      });
      const media = configuredMediaAssetService(tx);
      await media?.attachUrls(tx, { uploaderId: params.userId, urls: [...images, ...videos] });
      await tx.forumPost.update({
        where: { id },
        data: { replyCount: { increment: 1 } },
      });
      const notificationRecipientId = parent?.authorId ?? post.authorId;
      // 后台公告没有对应小程序用户，不能向保留发布者标识创建通知。
      if (notificationRecipientId !== ADMIN_ANNOUNCEMENT_AUTHOR_ID) {
        await notify(tx, {
          recipientId: notificationRecipientId,
          actorId: params.userId,
          type: parent ? 'FORUM_REPLY_REPLY' : 'FORUM_POST_REPLY',
          bizType: 'forum',
          bizId: id,
          title: parent ? '有人回复了你的评论' : '有人回复了你的帖子',
          content: notificationExcerpt(content) || '对方发送了图片或视频回复',
          dedupeKey: `forum:reply:${r.id}:recipient:${notificationRecipientId}`,
        });
      }
      return { row: r, displayDepth };
    });

    await Promise.all([
      this.cacheInvalidators.invalidatePostList(),
      this.cacheInvalidators.invalidateReplies(id),
    ]);

    const { row, displayDepth } = created;
    const tag = (await resolveEffectiveUserTags(this.database, [row.authorId])).get(row.authorId) ?? effectiveUserTag(null);
    return {
      _id: row.id,
      id: row.id,
      postId: row.postId,
      parentReplyId: row.parentReplyId,
      replyToAuthorName: row.replyToAuthorName,
      replyToUserId: row.replyToUserId ?? '',
      authorId: row.authorId,
      authorName: row.authorName ?? '',
      userTagLabel: tag.label,
      userTagType: tag.type,
      authorAvatar: avatarOrDefault(row.authorAvatar),
      isAuthor: true,
      content: row.content,
      images: Array.isArray(row.images) ? row.images : (row.images ?? []),
      videos: Array.isArray(row.videos) ? row.videos : (row.videos ?? []),
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
    const reply = await prisma.forumReply.findFirst({
      where: { id: replyId, postId },
    });
    if (!reply) throw new HttpError(404, '评论不存在');
    try {
      await prisma.forumReplyLike.create({
        data: { replyId, userId: params.userId },
      });
      const updated = await prisma.forumReply.update({
        where: { id: replyId },
        data: { likeCount: { increment: 1 } },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isLiked: true, likeCount: updated.likeCount };
    } catch {
      const row = await prisma.forumReply.findUnique({
        where: { id: replyId },
        select: { likeCount: true },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isLiked: true, likeCount: row?.likeCount ?? 0 };
    }
  }

  async unlikeReply(params: { userId: string; postId: string; replyId: string }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({
      where: { id: replyId, postId },
    });
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
      const row = await prisma.forumReply.findUnique({
        where: { id: replyId },
        select: { likeCount: true },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isLiked: false, likeCount: row?.likeCount ?? 0 };
    }
  }

  async favoriteReply(params: { userId: string; postId: string; replyId: string }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({
      where: { id: replyId, postId },
    });
    if (!reply) throw new HttpError(404, '评论不存在');
    try {
      await prisma.forumReplyFavorite.create({
        data: { replyId, userId: params.userId },
      });
      const updated = await prisma.forumReply.update({
        where: { id: replyId },
        data: { favoriteCount: { increment: 1 } },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isFavorited: true, favoriteCount: updated.favoriteCount };
    } catch {
      const row = await prisma.forumReply.findUnique({
        where: { id: replyId },
        select: { favoriteCount: true },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isFavorited: true, favoriteCount: row?.favoriteCount ?? 0 };
    }
  }

  async unfavoriteReply(params: { userId: string; postId: string; replyId: string }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({
      where: { id: replyId, postId },
    });
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
        await prisma.forumReply.update({
          where: { id: replyId },
          data: { favoriteCount: fc },
        });
      }
      await invalidateForumPostRepliesCache(postId);
      return { isFavorited: false, favoriteCount: fc };
    } catch {
      const row = await prisma.forumReply.findUnique({
        where: { id: replyId },
        select: { favoriteCount: true },
      });
      await invalidateForumPostRepliesCache(postId);
      return { isFavorited: false, favoriteCount: row?.favoriteCount ?? 0 };
    }
  }

  async setReplyReaction(params: { userId: string; postId: string; replyId: string; emoji: string | undefined }) {
    const postId = String(params.postId || '').trim();
    const replyId = String(params.replyId || '').trim();
    if (!postId || !replyId) throw new HttpError(400, '参数不完整');
    const reply = await prisma.forumReply.findFirst({
      where: { id: replyId, postId },
    });
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
      await prisma.forumReplyReaction.update({
        where: key,
        data: { emoji: raw },
      });
    } else {
      await prisma.forumReplyReaction.create({
        data: { replyId, userId: params.userId, emoji: raw },
      });
    }
    return this.getReplyReactionSnapshot(replyId, params.userId);
  }

  async share(params: { postId: string }) {
    const id = String(params.postId || '').trim();
    if (!id) throw new HttpError(400, 'postId 不能为空');
    const post = await prisma.forumPost.findFirst({
      where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      select: { id: true },
    });
    if (!post) throw new HttpError(404, '帖子不存在');

    const updated = await prisma.forumPost.update({
      where: { id },
      data: { shareCount: { increment: 1 } },
      select: { shareCount: true },
    });
    await invalidateForumPostListCache();
    return { shareCount: updated.shareCount };
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
      await prisma.forumPostLike.create({
        data: { postId: id, userId: params.userId },
      });
      const updated = await prisma.forumPost.update({
        where: { id },
        data: { likeCount: { increment: 1 } },
      });
      await invalidateForumPostListCache();
      return { liked: true, likeCount: updated.likeCount };
    } catch {
      const row = await prisma.forumPost.findUnique({
        where: { id },
        select: { likeCount: true },
      });
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
      await prisma.forumPostLike.delete({
        where: { postId_userId: { postId: id, userId: params.userId } },
      });
      const updated = await prisma.forumPost.update({
        where: { id },
        data: { likeCount: { decrement: 1 } },
      });
      await invalidateForumPostListCache();
      return { liked: false, likeCount: Math.max(0, updated.likeCount) };
    } catch {
      const row = await prisma.forumPost.findUnique({
        where: { id },
        select: { likeCount: true },
      });
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
      await prisma.forumPostFavorite.create({
        data: { postId: id, userId: params.userId },
      });
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
      await prisma.forumPostFavorite.delete({
        where: { postId_userId: { postId: id, userId: params.userId } },
      });
    } catch {
      // ignore
    }
    return { favorited: false };
  }

  async getMyPosts(params: { userId: string }) {
    const rows = await prisma.forumPost.findMany({
      where: {
        authorId: params.userId,
        visibility: 'ONLINE',
        ...contentNotDeleted,
      },
      orderBy: { createdAt: 'desc' },
    });
    const ids = rows.map((r) => r.id);
    const [liked, favorited] = await Promise.all([
      prisma.forumPostLike.findMany({
        where: { userId: params.userId, postId: { in: ids } },
        select: { postId: true },
      }),
      prisma.forumPostFavorite.findMany({
        where: { userId: params.userId, postId: { in: ids } },
        select: { postId: true },
      }),
    ]);
    const likedSet = new Set(liked.map((x) => x.postId));
    const favSet = new Set(favorited.map((x) => x.postId));
    const [tags, registrations] = await Promise.all([
      resolveEffectiveUserTags(this.database, rows.map((row) => row.authorId)),
      this.getRegistrationSummaries(ids, params.userId),
    ]);
    return rows.map((p) => this.mapPostListItem(p, params.userId, likedSet.has(p.id), favSet.has(p.id), tags.get(p.authorId), registrations.get(p.id)));
  }

  private async getRegistrationSummaries(postIds: string[], userId: string) {
    if (postIds.length === 0) return new Map<string, ReturnType<typeof this.toRegistrationSummary>>();
    const registrations = await prisma.forumPostRegistration.findMany({
      where: { postId: { in: postIds } },
      include: { entries: { select: { userId: true } } },
    });
    return new Map(registrations.map((registration) => [registration.postId, this.toRegistrationSummary(registration, userId)]));
  }

  private toRegistrationSummary(
    registration: { capacity: number; deadlineAt: Date; entries: { userId: string }[] },
    userId: string,
  ) {
    const registeredCount = registration.entries.length;
    return {
      capacity: registration.capacity,
      registeredCount,
      remainingCount: Math.max(0, registration.capacity - registeredCount),
      deadlineAt: registration.deadlineAt.toISOString(),
      status: registrationStatus({ deadlineAt: registration.deadlineAt, capacity: registration.capacity, registeredCount }),
      isRegistered: Boolean(userId) && registration.entries.some((entry) => entry.userId === userId),
    };
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
      replyToUserId?: string | null;
      authorId: string;
      authorName: string | null;
      authorAvatar?: string | null;
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
    const [likes, favs, userReactions, reactionAgg, admins] = await Promise.all([
      userId
        ? prisma.forumReplyLike.findMany({
            where: { userId, replyId: { in: ids } },
            select: { replyId: true },
          })
        : Promise.resolve([]),
      userId
        ? prisma.forumReplyFavorite.findMany({
            where: { userId, replyId: { in: ids } },
            select: { replyId: true },
          })
        : Promise.resolve([]),
      userId
        ? prisma.forumReplyReaction.findMany({
            where: { userId, replyId: { in: ids } },
            select: { replyId: true, emoji: true },
          })
        : Promise.resolve([]),
      prisma.forumReplyReaction.groupBy({
        by: ['replyId', 'emoji'],
        where: { replyId: { in: ids } },
        _count: { _all: true },
      }),
      resolveEffectiveUserTags(this.database, authorIds),
    ]);
    const likedSet = new Set(likes.map((x) => x.replyId));
    const favSet = new Set(favs.map((x) => x.replyId));
    const myReactMap = new Map(userReactions.map((x) => [x.replyId, x.emoji] as const));
    const countMap = new Map<string, Record<string, number>>();
    for (const g of reactionAgg) {
      if (!countMap.has(g.replyId)) countMap.set(g.replyId, {});
      countMap.get(g.replyId)![g.emoji] = g._count._all;
    }

    const mapBase = (r: (typeof rows)[number]) => {
      const tag = admins.get(r.authorId) ?? effectiveUserTag(null);
      return {
        _id: r.id,
        id: r.id,
        postId: r.postId,
        parentReplyId: r.parentReplyId,
        replyToAuthorName: r.replyToAuthorName,
        replyToUserId: r.replyToUserId ?? '',
        authorId: r.authorId,
        authorName: r.authorName ?? '',
        userTagLabel: tag.label,
        userTagType: tag.type,
        authorAvatar: avatarOrDefault(r.authorAvatar),
        isAuthor: r.authorId === userId,
        content: r.content,
        images: Array.isArray(r.images) ? r.images : (r.images ?? []),
        videos: Array.isArray(r.videos) ? r.videos : (r.videos ?? []),
        likeCount: r.likeCount,
        isLiked: likedSet.has(r.id),
        favoriteCount: r.favoriteCount,
        isFavorited: favSet.has(r.id),
        reactionCounts: countMap.get(r.id) ?? {},
        myReaction: myReactMap.get(r.id) ?? '',
        createdAt: r.createdAt.toISOString(),
        createTime: r.createdAt.toISOString(),
      };
    };

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
      where: {
        id: { in: ids },
        visibility: 'ONLINE',
        ...contentNotDeleted,
        OR: [{ postType: 'NORMAL' }, { postType: 'ANNOUNCEMENT', validUntil: { gt: new Date() } }],
      },
    });
    const map = new Map(posts.map((p) => [p.id, p]));

    const liked = await prisma.forumPostLike.findMany({
      where: { userId: params.userId, postId: { in: ids } },
      select: { postId: true },
    });
    const likedSet = new Set(liked.map((x) => x.postId));

    const tags = await resolveEffectiveUserTags(this.database, posts.map((post) => post.authorId));
    return ids
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((p) => this.mapPostListItem(p!, params.userId, likedSet.has(p!.id), true, tags.get(p!.authorId)));
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
      postType?: string | null;
      featureType?: string | null;
      validUntil?: Date | null;
      pinned?: boolean;
      viewCount?: number;
      shareCount?: number;
      likeCount: number;
      replyCount: number;
      createdAt: Date;
    },
    userId: string,
    isLiked: boolean,
    isFavorited: boolean,
    tag: EffectiveUserTag = effectiveUserTag(null),
    registration?: ReturnType<typeof this.toRegistrationSummary>,
  ) {
    const images = Array.isArray(p.images) ? p.images : (p.images ?? []);
    const videos = Array.isArray(p.videos) ? p.videos : (p.videos ?? []);
    const isAdminAnnouncement = p.postType === 'ANNOUNCEMENT' && p.authorId === '__admin_announcement__';
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
      authorAvatar: avatarOrDefault(p.authorAvatar),
      userTagLabel: isAdminAnnouncement ? '' : tag.label,
      userTagType: isAdminAnnouncement ? '' : tag.type,
      postType: p.postType ?? 'NORMAL',
      featureType: p.featureType ?? 'CONTENT',
      registration: registration ?? null,
      validUntil: p.validUntil ? p.validUntil.toISOString() : '',
      viewCount: p.viewCount ?? 0,
      shareCount: p.shareCount ?? 0,
      forwardCount: p.shareCount ?? 0,
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
      postType?: string | null;
      featureType?: string | null;
      validUntil?: Date | null;
      pinned?: boolean;
      viewCount?: number;
      shareCount?: number;
      likeCount: number;
      replyCount: number;
      createdAt: Date;
    },
    userId: string,
    isLiked: boolean,
    isFavorited: boolean,
    tag?: EffectiveUserTag,
  ) {
    const base = this.mapPostListItem(p, userId, isLiked, isFavorited, tag);
    return {
      ...base,
      authorAvatar: avatarOrDefault(p.authorAvatar),
    };
  }
}
