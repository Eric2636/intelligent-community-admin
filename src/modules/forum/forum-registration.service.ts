import { HttpError } from '../../http-error';
import { Prisma } from '@prisma/client';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { invalidateForumPostListCache, invalidateForumPostRepliesCache } from '../../lib/redis-cache';
import { prisma } from '../../lib/prisma';
import { registrationStatus } from './forum-feature';

export class ForumRegistrationService {
  async register(postId: string, userId: string) {
    const result = await prisma.$transaction(async (tx) => {
      const post = await tx.forumPost.findFirst({ where: { id: postId, visibility: 'ONLINE', featureType: 'REGISTRATION', ...contentNotDeleted }, select: { id: true } });
      if (!post) throw new HttpError(404, '报名活动不存在');
      // 同一活动的报名请求串行化，避免两个请求同时越过名额校验。
      await tx.$queryRaw(Prisma.sql`SELECT \`postId\` FROM \`forum_post_registrations\` WHERE \`postId\` = ${postId} FOR UPDATE`);
      const registration = await tx.forumPostRegistration.findUnique({ where: { postId } });
      if (!registration) throw new HttpError(404, '报名活动不存在');
      const [registeredCount, existing] = await Promise.all([
        tx.forumPostRegistrationEntry.count({ where: { postId } }),
        tx.forumPostRegistrationEntry.findUnique({ where: { postId_userId: { postId, userId } }, select: { id: true } }),
      ]);
      const status = registrationStatus({ deadlineAt: registration.deadlineAt, capacity: registration.capacity, registeredCount });
      if (status === 'CLOSED') throw new HttpError(400, '报名已截止');
      if (status === 'FULL') throw new HttpError(400, '名额已满');
      if (existing) throw new HttpError(409, '您已报名');
      await tx.forumPostRegistrationEntry.create({ data: { postId, userId } });
      return { capacity: registration.capacity, registeredCount: registeredCount + 1, deadlineAt: registration.deadlineAt };
    });
    await Promise.all([invalidateForumPostListCache(), invalidateForumPostRepliesCache(postId)]);
    return { ...result, remainingCount: result.capacity - result.registeredCount, status: registrationStatus(result) };
  }

  async cancel(postId: string, userId: string) {
    const deleted = await prisma.forumPostRegistrationEntry.deleteMany({ where: { postId, userId } });
    if (deleted.count === 0) throw new HttpError(404, '未找到报名记录');
    await Promise.all([invalidateForumPostListCache(), invalidateForumPostRepliesCache(postId)]);
    return { registered: false };
  }
}
