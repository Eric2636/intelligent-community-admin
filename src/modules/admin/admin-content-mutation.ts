import { type Prisma, type PrismaClient } from '@prisma/client';
import {
  invalidateForumPostListCache,
  invalidateForumPostRepliesCache,
  invalidateMallItemDetailCache,
  invalidateMallItemsListCache,
  invalidatePendingTasksListCache,
} from '../../lib/redis-cache';

export type AdminContentCacheInvalidation =
  | { kind: 'forum-list' }
  | { kind: 'forum-replies'; id: string }
  | { kind: 'mall-list' }
  | { kind: 'mall-item'; id: string }
  | { kind: 'task-list' };

type AdminContentTransactionDatabase = Pick<PrismaClient, '$transaction'>;

async function invalidateAdminContentCache(pending: AdminContentCacheInvalidation): Promise<void> {
  if (pending.kind === 'forum-list') return invalidateForumPostListCache();
  if (pending.kind === 'forum-replies') return invalidateForumPostRepliesCache(pending.id);
  if (pending.kind === 'mall-list') return invalidateMallItemsListCache();
  if (pending.kind === 'mall-item') return invalidateMallItemDetailCache(pending.id);
  return invalidatePendingTasksListCache();
}

export async function runAdminContentMutation<
  const TOutcome extends {
    result: unknown;
    invalidations: AdminContentCacheInvalidation[];
  },
>(
  database: AdminContentTransactionDatabase,
  work: (tx: Prisma.TransactionClient) => Promise<TOutcome>,
  invalidate: (pending: AdminContentCacheInvalidation) => Promise<void> = invalidateAdminContentCache,
): Promise<TOutcome['result']> {
  const outcome = await database.$transaction(work);
  for (const pending of outcome.invalidations) {
    await invalidate(pending);
  }
  return outcome.result;
}
