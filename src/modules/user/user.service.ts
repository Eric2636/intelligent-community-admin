import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { isImageMediaUrl, parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import { invalidateForumPostListCache, invalidateForumPostRepliesCache } from '../../lib/redis-cache';
import type { UpdateMeDto } from './user.dto';

const MAX_USER_PHOTOS = 20;

export class UserService {
  async getMe(userId: string) {
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
    if (!user) throw new HttpError(404, '用户不存在');
    return user;
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    if (dto.avatar != null && String(dto.avatar).trim() !== '') {
      const a = String(dto.avatar).trim();
      if (!isImageMediaUrl(a)) throw new HttpError(400, '头像仅支持图片链接');
    }
    const photos =
      dto.photos === undefined
        ? undefined
        : (parseStrictMediaUrlList(dto.photos, MAX_USER_PHOTOS, 'image', 'photos') as unknown as Prisma.InputJsonValue);

    const touchedReplyPostIds = new Set<string>();
    const shouldRefreshForumCache = dto.name !== undefined || dto.avatar !== undefined;
    const user = await prisma.$transaction(async (tx) => {
      if (shouldRefreshForumCache) {
        const replies = await tx.forumReply.findMany({
          where: { authorId: userId },
          select: { postId: true },
          distinct: ['postId'],
        });
        replies.forEach((r) => touchedReplyPostIds.add(r.postId));
      }

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          name: dto.name,
          avatar: dto.avatar,
          gender: dto.gender,
          birth: dto.birth,
          address: dto.address as Prisma.InputJsonValue | undefined,
          ...(dto.photos === undefined ? {} : { photos }),
          brief: dto.brief,
        },
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

      const forumPostData: Prisma.ForumPostUpdateManyMutationInput = {};
      const forumReplyData: Prisma.ForumReplyUpdateManyMutationInput = {};
      if (dto.name !== undefined) {
        forumPostData.authorName = updated.name;
        forumReplyData.authorName = updated.name;
      }
      if (dto.avatar !== undefined) forumPostData.authorAvatar = updated.avatar;

      await Promise.all([
        Object.keys(forumPostData).length
          ? tx.forumPost.updateMany({ where: { authorId: userId }, data: forumPostData })
          : Promise.resolve(),
        Object.keys(forumReplyData).length
          ? tx.forumReply.updateMany({ where: { authorId: userId }, data: forumReplyData })
          : Promise.resolve(),
      ]);

      return updated;
    });
    if (shouldRefreshForumCache) {
      await Promise.all([
        invalidateForumPostListCache(),
        ...Array.from(touchedReplyPostIds).map((postId) => invalidateForumPostRepliesCache(postId)),
      ]);
    }
    return user;
  }
}
