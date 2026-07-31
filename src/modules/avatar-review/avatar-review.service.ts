import type { Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import {
  applyUserProfileSnapshotUpdate,
  invalidateUserProfileCaches,
  lockUsersForProfileSnapshot,
  type ProfileCacheTargets,
  type ProfileSyncTransaction,
} from '../user/user-profile-sync';
import { wechatAccessTokenService } from '../wechat/wechat-access-token';
import { WechatContentSecurityClient } from '../wechat/wechat-content-security';

type AvatarReviewDatabase = Pick<PrismaClient, 'avatarReview' | '$transaction'>;
type ReviewTransaction = Prisma.TransactionClient;
type Dependencies = {
  database?: AvatarReviewDatabase;
  submitAvatar?: (params: { mediaUrl: string; openid: string }) => Promise<{ traceId: string }>;
  lockUser?: (tx: ReviewTransaction, userId: string) => Promise<void>;
  applyAvatar?: (params: { tx: ReviewTransaction; userId: string; mediaUrl: string }) => Promise<ProfileCacheTargets>;
  invalidateAvatarCaches?: (targets: ProfileCacheTargets) => Promise<void>;
};

const securityClient = new WechatContentSecurityClient({
  getAccessToken: () => wechatAccessTokenService.getAccessToken(),
});
const AVATAR_REVIEW_TIMEOUT_MS = 35 * 60 * 1000;

export class AvatarReviewService {
  private readonly database: AvatarReviewDatabase;
  private readonly submitAvatarToWechat: NonNullable<Dependencies['submitAvatar']>;
  private readonly lockUser: NonNullable<Dependencies['lockUser']>;
  private readonly applyAvatar: NonNullable<Dependencies['applyAvatar']>;
  private readonly invalidateAvatarCaches: NonNullable<Dependencies['invalidateAvatarCaches']>;

  constructor(dependencies: Dependencies = {}) {
    this.database = dependencies.database ?? prisma;
    this.submitAvatarToWechat = dependencies.submitAvatar ?? ((params) => securityClient.submitAvatar(params));
    this.lockUser = dependencies.lockUser ?? ((tx, userId) => lockUsersForProfileSnapshot(tx, [userId]));
    this.applyAvatar = dependencies.applyAvatar ?? (async ({ tx, userId, mediaUrl }) => {
      const result = await applyUserProfileSnapshotUpdate(tx as ProfileSyncTransaction, userId, { avatar: mediaUrl });
      return result.cacheTargets;
    });
    this.invalidateAvatarCaches = dependencies.invalidateAvatarCaches ?? ((targets) => invalidateUserProfileCaches({ avatar: '' }, targets));
  }

  async submit(params: { userId: string; openid: string; mediaUrl: string }) {
    const review = await this.database.avatarReview.create({
      data: { userId: params.userId, mediaUrl: params.mediaUrl, status: 'SUBMITTING' },
    });
    let traceId = '';
    try {
      ({ traceId } = await this.submitAvatarToWechat({ mediaUrl: params.mediaUrl, openid: params.openid }));
    } catch (error) {
      await this.database.avatarReview.update({
        where: { id: review.id },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      throw error;
    }
    return this.database.$transaction(async (tx) => {
      await this.lockUser(tx, params.userId);
      const latest = await tx.avatarReview.findFirst({
        where: { userId: params.userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!latest || latest.id !== review.id) {
        const superseded = await tx.avatarReview.update({
          where: { id: review.id },
          data: { status: 'SUPERSEDED', completedAt: new Date() },
        });
        return { id: superseded.id, status: superseded.status };
      }
      await tx.avatarReview.updateMany({
        where: { userId: params.userId, id: { not: review.id }, status: { in: ['SUBMITTING', 'PENDING'] } },
        data: { status: 'SUPERSEDED', completedAt: new Date() },
      });
      const pending = await tx.avatarReview.update({
        where: { id: review.id },
        data: { traceId, status: 'PENDING' },
      });
      return { id: pending.id, status: pending.status };
    });
  }

  async getStatus(userId: string, id: string) {
    const review = await this.database.avatarReview.findUnique({ where: { id } });
    if (!review || review.userId !== userId) throw new HttpError(404, '头像审核记录不存在');
    if (
      ['SUBMITTING', 'PENDING'].includes(review.status) &&
      review.createdAt.getTime() <= Date.now() - AVATAR_REVIEW_TIMEOUT_MS
    ) {
      const expired = await this.database.avatarReview.updateMany({
        where: { id: review.id, userId, status: { in: ['SUBMITTING', 'PENDING'] } },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      if (expired.count) return { id: review.id, status: 'FAILED' };
    }
    return { id: review.id, status: review.status };
  }

  async handleResult(params: { traceId: string; errcode: number; suggest?: string; label?: number }) {
    const review = await this.database.avatarReview.findUnique({ where: { traceId: params.traceId } });
    if (!review) return { handled: false, status: 'NOT_FOUND' };
    if (review.status !== 'PENDING') return { handled: true, status: review.status };
    if (params.errcode !== 0) {
      await this.database.avatarReview.update({
        where: { id: review.id },
        data: { status: 'FAILED', wechatErrcode: params.errcode, completedAt: new Date() },
      });
      return { handled: true, status: 'FAILED' };
    }
    if (params.suggest !== 'pass') {
      await this.database.avatarReview.update({
        where: { id: review.id },
        data: { status: 'REJECTED', suggest: params.suggest || null, label: params.label, wechatErrcode: 0, completedAt: new Date() },
      });
      return { handled: true, status: 'REJECTED' };
    }
    const outcome = await this.database.$transaction(async (tx) => {
      await this.lockUser(tx, review.userId);
      const current = await tx.avatarReview.findUnique({ where: { id: review.id } });
      if (!current) return { status: 'NOT_FOUND' as const };
      if (current.status !== 'PENDING') return { status: current.status };
      const latest = await tx.avatarReview.findFirst({
        where: { userId: review.userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!latest || latest.id !== current.id) {
        await tx.avatarReview.updateMany({
          where: { id: current.id, status: 'PENDING' },
          data: { status: 'SUPERSEDED', completedAt: new Date() },
        });
        return { status: 'SUPERSEDED' as const };
      }
      const cacheTargets = await this.applyAvatar({
        tx,
        userId: current.userId,
        mediaUrl: current.mediaUrl,
      });
      await tx.avatarReview.update({
        where: { id: current.id },
        data: { status: 'PASSED', suggest: 'pass', label: params.label, wechatErrcode: 0, completedAt: new Date() },
      });
      return { status: 'PASSED' as const, cacheTargets };
    });
    if (outcome.cacheTargets) await this.invalidateAvatarCaches(outcome.cacheTargets);
    return { handled: true, status: outcome.status };
  }
}
