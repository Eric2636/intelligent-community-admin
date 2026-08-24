import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import {
  invalidateForumPostListCache,
  invalidateForumPostRepliesCache,
  invalidateMallItemDetailCache,
  invalidateMallItemsListCache,
  invalidatePendingTasksListCache,
} from '../../lib/redis-cache';

export type UserProfileSnapshotChanges = {
  name?: string | null;
  avatar?: string | null;
  identityType?: string | null;
};

export type ProfileSyncTransaction = Prisma.TransactionClient;
type ProfileSyncDatabase = Pick<PrismaClient, '$transaction'>;

export type ProfileCacheTargets = {
  forumPostIds: string[];
  mallItemIds: string[];
};

export type ProfileCacheInvalidators = {
  invalidateTaskList: () => Promise<void>;
  invalidateForumList: () => Promise<void>;
  invalidateForumReplies: (postId: string) => Promise<void>;
  invalidateMallList: () => Promise<void>;
  invalidateMallItemDetail: (itemId: string) => Promise<void>;
};

const defaultCacheInvalidators: ProfileCacheInvalidators = {
  invalidateTaskList: invalidatePendingTasksListCache,
  invalidateForumList: invalidateForumPostListCache,
  invalidateForumReplies: invalidateForumPostRepliesCache,
  invalidateMallList: invalidateMallItemsListCache,
  invalidateMallItemDetail: invalidateMallItemDetailCache,
};

export async function invalidateUserProfileCaches(
  changes: UserProfileSnapshotChanges,
  cacheTargets: ProfileCacheTargets,
  cacheInvalidators: ProfileCacheInvalidators = defaultCacheInvalidators,
) {
  const nameChanged = changes.name !== undefined;
  const avatarChanged = changes.avatar !== undefined;
  const identityChanged = changes.identityType !== undefined;
  if (nameChanged || avatarChanged || identityChanged) {
    await cacheInvalidators.invalidateTaskList();
    await cacheInvalidators.invalidateForumList();
    for (const postId of cacheTargets.forumPostIds) {
      await cacheInvalidators.invalidateForumReplies(postId);
    }
  }
  if (nameChanged || avatarChanged) {
    await cacheInvalidators.invalidateMallList();
    for (const itemId of cacheTargets.mallItemIds) {
      await cacheInvalidators.invalidateMallItemDetail(itemId);
    }
  }
}

export async function lockUsersForProfileSnapshot(
  tx: Pick<ProfileSyncTransaction, '$queryRaw'>,
  userIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))].sort();
  for (const userId of ids) {
    await tx.$queryRaw(Prisma.sql`SELECT \`id\` FROM \`users\` WHERE \`id\` = ${userId} FOR UPDATE`);
  }
}

export async function applyUserProfileSnapshotUpdate(
  tx: ProfileSyncTransaction,
  userId: string,
  changes: UserProfileSnapshotChanges,
): Promise<{
  profile: {
    name: string | null;
    avatar: string | null;
    identityType: string | null;
  };
  cacheTargets: ProfileCacheTargets;
}> {
  await lockUsersForProfileSnapshot(tx, [userId]);

  const nameChanged = changes.name !== undefined;
  const avatarChanged = changes.avatar !== undefined;
  const identityChanged = changes.identityType !== undefined;
  const profileSnapshotChanged = nameChanged || avatarChanged || identityChanged;
  const mallSnapshotChanged = nameChanged || avatarChanged;
  const forumPostIds: string[] = [];
  const mallItemIds: string[] = [];

  if (profileSnapshotChanged) {
    const replies = await tx.forumReply.findMany({
      where: { OR: [{ authorId: userId }, { replyToUserId: userId }] },
      select: { postId: true },
      distinct: ['postId'],
    });
    forumPostIds.push(...replies.map((reply) => reply.postId));
  }
  if (mallSnapshotChanged) {
    const items = await tx.mallItem.findMany({
      where: { publisherId: userId },
      select: { id: true },
    });
    mallItemIds.push(...items.map((item) => item.id));
  }

  const profile = await tx.user.update({
    where: { id: userId },
    data: {
      ...(nameChanged ? { name: changes.name } : {}),
      ...(avatarChanged ? { avatar: changes.avatar } : {}),
      ...(identityChanged ? { identityType: changes.identityType } : {}),
    },
    select: { name: true, avatar: true, identityType: true },
  });

  const taskPublisherData: Prisma.TaskUpdateManyMutationInput = {};
  const taskTakerData: Prisma.TaskUpdateManyMutationInput = {};
  const forumPostData: Prisma.ForumPostUpdateManyMutationInput = {};
  const forumReplyData: Prisma.ForumReplyUpdateManyMutationInput = {};
  const mallItemData: Prisma.MallItemUpdateManyMutationInput = {};
  const mallCommentData: Prisma.MallItemCommentUpdateManyMutationInput = {};
  const sellerOrderData: Prisma.MallOrderUpdateManyMutationInput = {};
  const buyerOrderData: Prisma.MallOrderUpdateManyMutationInput = {};

  if (nameChanged) {
    taskPublisherData.publisherName = profile.name;
    taskTakerData.takerName = profile.name;
    forumPostData.authorName = profile.name;
    forumReplyData.authorName = profile.name;
    mallItemData.publisherName = profile.name;
    mallCommentData.authorName = profile.name;
    sellerOrderData.sellerName = profile.name;
    buyerOrderData.buyerName = profile.name;
  }
  if (avatarChanged) {
    taskPublisherData.publisherAvatar = profile.avatar;
    taskTakerData.takerAvatar = profile.avatar;
    forumPostData.authorAvatar = profile.avatar;
    forumReplyData.authorAvatar = profile.avatar;
    mallItemData.publisherAvatar = profile.avatar;
    mallCommentData.authorAvatar = profile.avatar;
    sellerOrderData.sellerAvatar = profile.avatar;
    buyerOrderData.buyerAvatar = profile.avatar;
  }
  // Identity tags are resolved live from User/AdminUser at read time. Keep the
  // historical columns untouched for compatibility; do not propagate snapshots.

  if (Object.keys(taskPublisherData).length) {
    await tx.task.updateMany({
      where: { publisherId: userId },
      data: taskPublisherData,
    });
  }
  if (Object.keys(taskTakerData).length) {
    await tx.task.updateMany({
      where: { takerId: userId },
      data: taskTakerData,
    });
  }
  if (Object.keys(forumPostData).length) {
    await tx.forumPost.updateMany({
      where: { authorId: userId },
      data: forumPostData,
    });
  }
  if (Object.keys(forumReplyData).length) {
    await tx.forumReply.updateMany({
      where: { authorId: userId },
      data: forumReplyData,
    });
  }
  if (nameChanged) {
    await tx.forumReply.updateMany({
      where: { replyToUserId: userId },
      data: { replyToAuthorName: profile.name },
    });
  }
  if (Object.keys(mallItemData).length) {
    await tx.mallItem.updateMany({
      where: { publisherId: userId },
      data: mallItemData,
    });
  }
  if (Object.keys(mallCommentData).length) {
    await tx.mallItemComment.updateMany({
      where: { userId },
      data: mallCommentData,
    });
  }
  if (nameChanged) {
    await tx.mallItemComment.updateMany({
      where: { replyToUserId: userId },
      data: { replyToAuthorName: profile.name },
    });
  }
  if (Object.keys(sellerOrderData).length) {
    await tx.mallOrder.updateMany({
      where: { sellerId: userId },
      data: sellerOrderData,
    });
  }
  if (Object.keys(buyerOrderData).length) {
    await tx.mallOrder.updateMany({
      where: { buyerId: userId },
      data: buyerOrderData,
    });
  }

  return {
    profile,
    cacheTargets: {
      forumPostIds: [...new Set(forumPostIds)],
      mallItemIds: [...new Set(mallItemIds)],
    },
  };
}

export async function runUserProfileUpdate<T>(
  params: {
    database?: ProfileSyncDatabase;
    userId: string;
    changes: UserProfileSnapshotChanges;
    complete: (tx: ProfileSyncTransaction) => Promise<T>;
  },
  cacheInvalidators: ProfileCacheInvalidators = defaultCacheInvalidators,
): Promise<T> {
  const database = params.database ?? prisma;
  const outcome = await database.$transaction(async (tx) => {
    const sync = await applyUserProfileSnapshotUpdate(tx, params.userId, params.changes);
    const result = await params.complete(tx);
    return { result, cacheTargets: sync.cacheTargets };
  });

  await invalidateUserProfileCaches(params.changes, outcome.cacheTargets, cacheInvalidators);
  return outcome.result;
}
