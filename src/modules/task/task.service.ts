import { TaskStatus, type Prisma, type PrismaClient } from '@prisma/client';
import { HttpError } from '../../http-error';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import {
  cacheAsideJson,
  invalidatePendingTasksListCache,
  taskPendingListCacheKey,
  TASK_PENDING_LIST_TTL_SEC,
} from '../../lib/redis-cache';
import { adminContentAttributionForMiniPublisher } from '../admin/admin.service';
import { notify } from '../notification/notification-notify';
import { avatarOrDefault } from '../user/default-avatar';
import { contentIdentityTag, identityTypeLabel } from '../user/user-identity';
import { lockUsersForProfileSnapshot } from '../user/user-profile-sync';

const MAX_TASK_IMAGES = 9;
const MAX_TASK_VIDEOS = 2;

type TaskDatabase = Pick<PrismaClient, '$transaction' | 'adminUser'>;

function taskNotificationContent(taskTitle: string, action: string) {
  const title = Array.from(String(taskTitle || '').trim()).slice(0, 80).join('');
  return title ? `“${title}”${action}` : action;
}

export class TaskService {
  constructor(
    private readonly database: TaskDatabase = prisma,
    private readonly invalidatePendingList: () => Promise<void> =
      invalidatePendingTasksListCache,
  ) {}

  private async getMiniPublisherAdminAttribution(userId: string) {
    const admin = await this.database.adminUser.findFirst({
      where: { boundUserId: userId, enabled: true },
      select: { id: true, role: true, orgName: true },
    });
    return adminContentAttributionForMiniPublisher(admin);
  }

  async getTaskDetail(taskId: string) {
    const id = String(taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    const row = await prisma.task.findFirst({
      where: { id, visibility: 'ONLINE', ...contentNotDeleted },
    });
    if (!row) throw new HttpError(404, '任务不存在');
    return this.mapTask(row);
  }

  async createTask(params: {
    publisherId: string;
    title: string;
    desc: string;
    reward?: string;
    location: string;
    images?: string[];
    videos?: string[];
  }) {
    const title = (params.title || '').trim();
    const desc = (params.desc || '').trim();
    const reward = (params.reward || '').trim();
    const location = (params.location || '').trim();
    if (!title) throw new HttpError(400, 'title 不能为空');
    if (!desc && !params.images?.length && !params.videos?.length) {
      throw new HttpError(400, 'desc 与 images/videos 至少填写一项');
    }
    if (reward && (Number.isNaN(Number(reward)) || Number(reward) < 0)) {
      throw new HttpError(400, '感谢金金额无效');
    }

    const adminAttribution = await this.getMiniPublisherAdminAttribution(params.publisherId);
    const images = parseStrictMediaUrlList(params.images, MAX_TASK_IMAGES, 'image', 'images');
    const videos = parseStrictMediaUrlList(params.videos, MAX_TASK_VIDEOS, 'video', 'videos');
    const row = await prisma.$transaction(async (tx) => {
      await lockUsersForProfileSnapshot(tx, [params.publisherId]);
      const publisher = await tx.user.findUnique({
        where: { id: params.publisherId },
        select: { name: true, avatar: true, identityType: true },
      });
      return tx.task.create({
        data: {
          title,
          desc,
          reward,
          location,
          images,
          videos,
          status: 'PENDING_TAKE',
          publisherId: params.publisherId,
          publisherName: publisher?.name ?? '',
          publisherAvatar: publisher?.avatar ?? null,
          publisherIdentity: publisher?.identityType ?? null,
          ...adminAttribution,
        },
      });
    });

    await invalidatePendingTasksListCache();
    return this.mapTask(row);
  }

  async saveDraft(params: {
    userId: string;
    taskId?: string;
    title?: string;
    desc?: string;
    reward?: string;
    location?: string;
    images?: string[];
    videos?: string[];
  }) {
    const title = params.title != null ? String(params.title).trim() : '';
    const desc = params.desc != null ? String(params.desc).trim() : '';
    const reward = params.reward != null ? String(params.reward).trim() : '';
    const location = params.location != null ? String(params.location).trim() : '';

    const adminAttribution = await this.getMiniPublisherAdminAttribution(params.userId);
    const images = parseStrictMediaUrlList(params.images, MAX_TASK_IMAGES, 'image', 'images');
    const videos = parseStrictMediaUrlList(params.videos, MAX_TASK_VIDEOS, 'video', 'videos');
    const id = params.taskId ? String(params.taskId).trim() : '';
    return this.database.$transaction(async (tx) => {
      await lockUsersForProfileSnapshot(tx, [params.userId]);
      const publisher = await tx.user.findUnique({
        where: { id: params.userId },
        select: { name: true, avatar: true, identityType: true },
      });
      const data = {
        title: title || '未命名草稿',
        desc: desc || '',
        reward: reward || '',
        location: location || '',
        images,
        videos,
        publisherId: params.userId,
        publisherName: publisher?.name ?? '',
        publisherAvatar: publisher?.avatar ?? null,
        publisherIdentity: publisher?.identityType ?? null,
        ...adminAttribution,
      };
      if (id) {
        const row = await tx.task.findFirst({
          where: { id, ...contentNotDeleted },
        });
        if (!row) throw new HttpError(404, '草稿不存在');
        if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可编辑草稿');
        if (row.status !== 'DRAFT') throw new HttpError(400, '仅草稿可编辑');
        const transition = await tx.task.updateMany({
          where: {
            id,
            publisherId: params.userId,
            status: 'DRAFT',
            version: row.version,
            ...contentNotDeleted,
          },
          data: {
            ...data,
            version: { increment: 1 },
          },
        });
        if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
        const updated = await tx.task.findUnique({ where: { id } });
        if (!updated) throw new HttpError(404, '草稿不存在');
        return this.mapTask(updated);
      }
      return this.mapTask(await tx.task.create({ data: { ...data, status: 'DRAFT' } }));
    });
  }

  async publishDraft(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    const adminAttribution = await this.getMiniPublisherAdminAttribution(params.userId);
    return this.database
      .$transaction(async (tx) => {
        await lockUsersForProfileSnapshot(tx, [params.userId]);
        const row = await tx.task.findFirst({
          where: { id, ...contentNotDeleted },
        });
        if (!row) throw new HttpError(404, '任务不存在');
        if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可发布');
        if (row.status !== 'DRAFT') throw new HttpError(400, '仅草稿可发布');
        const title = (row.title || '').trim();
        const desc = (row.desc || '').trim();
        const reward = (row.reward || '').trim();
        const location = typeof row.location === 'string' ? row.location.trim() : String(row.location || '').trim();
        const images = Array.isArray(row.images) ? row.images : [];
        const videos = Array.isArray(row.videos) ? row.videos : [];
        if (!title || title === '未命名草稿') throw new HttpError(400, '请填写任务标题');
        if (!desc && images.length === 0 && videos.length === 0)
          throw new HttpError(400, '请填写任务说明或添加图片/视频');
        if (reward && (Number.isNaN(Number(reward)) || Number(reward) < 0)) {
          throw new HttpError(400, '感谢金金额无效');
        }
        if (!location) throw new HttpError(400, '请填写地点');
        const publisher = await tx.user.findUnique({
          where: { id: params.userId },
          select: { name: true, avatar: true, identityType: true },
        });
        const transition = await tx.task.updateMany({
          where: {
            id,
            status: 'DRAFT',
            version: row.version,
            publisherId: params.userId,
            ...contentNotDeleted,
          },
          data: {
            status: 'PENDING_TAKE',
            version: { increment: 1 },
            publisherName: publisher?.name ?? '',
            publisherAvatar: publisher?.avatar ?? null,
            publisherIdentity: publisher?.identityType ?? null,
            ...(row.adminLabel ? {} : adminAttribution),
          },
        });
        if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
        const updated = await tx.task.findUnique({ where: { id } });
        if (!updated) throw new HttpError(404, '任务不存在');
        return this.mapTask(updated);
      })
      .then(async (mapped) => {
        await this.invalidatePendingList();
        return mapped;
      });
  }

  async listPendingTasks(params: { keyword?: string; page: number; pageSize: number }) {
    const kw = (params.keyword || '').trim();
    const key = await taskPendingListCacheKey(params.page, params.pageSize, kw);
    return cacheAsideJson(key, TASK_PENDING_LIST_TTL_SEC, async () => {
      const { keyword, page, pageSize } = params;
      const skip = (page - 1) * pageSize;

      const where: Prisma.TaskWhereInput = {
        status: 'PENDING_TAKE',
        visibility: 'ONLINE',
        ...contentNotDeleted,
      };

      if (keyword && keyword.trim()) {
        where.title = { contains: keyword.trim() };
      }

      const rows = await prisma.task.findMany({
        where,
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      });

      return rows.map((t) => this.mapTask(t));
    });
  }

  async getMyTasks(params: { userId: string; type?: string }) {
    const type = String(params.type || 'published').trim();
    const where: Prisma.TaskWhereInput = {
      visibility: 'ONLINE',
      ...contentNotDeleted,
    };

    if (type === 'taken') {
      where.takerId = params.userId;
    } else if (type === 'draft') {
      where.publisherId = params.userId;
      where.status = TaskStatus.DRAFT;
    } else if (type === 'cancelled') {
      where.publisherId = params.userId;
      where.status = TaskStatus.CANCELLED;
    } else {
      where.publisherId = params.userId;
      where.status = { notIn: [TaskStatus.DRAFT, TaskStatus.CANCELLED] };
    }

    const rows = await prisma.task.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map((t) => this.mapTask(t));
  }

  async claimTask(params: { taskId: string; userId: string; takerName?: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return this.database
      .$transaction(async (tx) => {
        await lockUsersForProfileSnapshot(tx, [params.userId]);
        const row = await tx.task.findFirst({
          where: { id, visibility: 'ONLINE', ...contentNotDeleted },
        });
        if (!row) throw new HttpError(404, '任务不存在');
        if (row.publisherId === params.userId) throw new HttpError(400, '不能领取自己发布的任务');
        if (row.status !== 'PENDING_TAKE') throw new HttpError(400, '该任务已被领取或已结束');

        const taker = await tx.user.findUnique({
          where: { id: params.userId },
          select: { name: true, avatar: true },
        });
        const transition = await tx.task.updateMany({
          where: {
            id,
            status: 'PENDING_TAKE',
            version: row.version,
            takerId: null,
            visibility: 'ONLINE',
            ...contentNotDeleted,
          },
          data: {
            status: 'IN_PROGRESS',
            version: { increment: 1 },
            takerId: params.userId,
            takerName: taker?.name ?? '邻居',
            takerAvatar: taker?.avatar ?? null,
            claimedAt: new Date(),
          },
        });
        if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
        const updated = await tx.task.findUnique({ where: { id } });
        if (!updated) throw new HttpError(404, '任务不存在');
        await notify(tx, {
          recipientId: row.publisherId,
          actorId: params.userId,
          type: 'TASK_CLAIMED',
          bizType: 'task',
          bizId: id,
          title: '任务已被领取',
          content: taskNotificationContent(row.title, '已被领取'),
          dedupeKey: `task:${id}:TASK_CLAIMED:${updated.version}:recipient:${row.publisherId}`,
        });
        return this.mapTask(updated);
      })
      .then(async (mapped) => {
        await this.invalidatePendingList();
        return mapped;
      });
  }

  async submitComplete(params: { taskId: string; userId: string; proofText?: string; proofImages?: string[] }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    const proofText = String(params.proofText || '').trim();
    const proofImages = parseStrictMediaUrlList(params.proofImages, MAX_TASK_IMAGES, 'image', 'proofImages');
    if (!proofText && proofImages.length === 0) throw new HttpError(400, '请填写完成说明或上传凭证图片');

    return this.database.$transaction(async (tx) => {
      const row = await tx.task.findFirst({
        where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      });
      if (!row) throw new HttpError(404, '任务不存在');
      if (row.takerId !== params.userId) throw new HttpError(403, '仅接单人可提交完成');
      if (row.status !== 'IN_PROGRESS') throw new HttpError(400, '该任务当前不可提交完成');
      const transition = await tx.task.updateMany({
        where: {
          id,
          status: 'IN_PROGRESS',
          version: row.version,
          takerId: params.userId,
          visibility: 'ONLINE',
          ...contentNotDeleted,
        },
        data: {
          status: 'PENDING_CONFIRM',
          version: { increment: 1 },
          proofText,
          proofImages,
          completedAt: new Date(),
        },
      });
      if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
      const updated = await tx.task.findUnique({ where: { id } });
      if (!updated) throw new HttpError(404, '任务不存在');
      await notify(tx, {
        recipientId: row.publisherId,
        actorId: params.userId,
        type: 'TASK_SUBMITTED',
        bizType: 'task',
        bizId: id,
        title: '任务已提交完成',
        content: taskNotificationContent(row.title, '已由接单人提交完成，请及时确认'),
        dedupeKey: `task:${id}:TASK_SUBMITTED:${updated.version}:recipient:${row.publisherId}`,
      });
      return this.mapTask(updated);
    });
  }

  async confirmComplete(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');

    return this.database.$transaction(async (tx) => {
      const row = await tx.task.findFirst({
        where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      });
      if (!row) throw new HttpError(404, '任务不存在');
      if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可确认完成');
      if (row.status !== 'PENDING_CONFIRM') throw new HttpError(400, '该任务当前不可确认完成');
      if (!row.takerId) throw new HttpError(400, '任务缺少接单人，无法确认完成');
      const transition = await tx.task.updateMany({
        where: {
          id,
          status: 'PENDING_CONFIRM',
          version: row.version,
          publisherId: params.userId,
          visibility: 'ONLINE',
          ...contentNotDeleted,
        },
        data: {
          status: 'COMPLETED',
          version: { increment: 1 },
          confirmedAt: new Date(),
        },
      });
      if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
      const updated = await tx.task.findUnique({ where: { id } });
      if (!updated) throw new HttpError(404, '任务不存在');
      await notify(tx, {
        recipientId: row.takerId,
        actorId: params.userId,
        type: 'TASK_CONFIRMED',
        bizType: 'task',
        bizId: id,
        title: '任务已确认完成',
        content: taskNotificationContent(row.title, '已由发布者确认完成'),
        dedupeKey: `task:${id}:TASK_CONFIRMED:${updated.version}:recipient:${row.takerId}`,
      });
      return this.mapTask(updated);
    });
  }

  async rejectComplete(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');

    return this.database.$transaction(async (tx) => {
      const row = await tx.task.findFirst({
        where: { id, visibility: 'ONLINE', ...contentNotDeleted },
      });
      if (!row) throw new HttpError(404, '任务不存在');
      if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可驳回完成');
      if (row.status !== 'PENDING_CONFIRM') throw new HttpError(400, '该任务当前不可驳回');
      if (!row.takerId) throw new HttpError(400, '任务缺少接单人，无法驳回');
      const transition = await tx.task.updateMany({
        where: {
          id,
          status: 'PENDING_CONFIRM',
          version: row.version,
          publisherId: params.userId,
          visibility: 'ONLINE',
          ...contentNotDeleted,
        },
        data: {
          status: 'IN_PROGRESS',
          version: { increment: 1 },
          confirmedAt: null,
        },
      });
      if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
      const updated = await tx.task.findUnique({ where: { id } });
      if (!updated) throw new HttpError(404, '任务不存在');
      await notify(tx, {
        recipientId: row.takerId,
        actorId: params.userId,
        type: 'TASK_REJECTED',
        bizType: 'task',
        bizId: id,
        title: '任务完成被驳回',
        content: taskNotificationContent(row.title, '的完成提交被驳回，请修改后重新提交'),
        dedupeKey: `task:${id}:TASK_REJECTED:${updated.version}:recipient:${row.takerId}`,
      });
      return this.mapTask(updated);
    });
  }

  async revokePublish(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return this.database
      .$transaction(async (tx) => {
        const row = await tx.task.findFirst({
          where: { id, ...contentNotDeleted },
        });
        if (!row) throw new HttpError(404, '任务不存在');
        if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可撤销发布');
        if (!['PENDING_TAKE', 'IN_PROGRESS', 'PENDING_CONFIRM'].includes(row.status)) {
          throw new HttpError(400, '该任务当前不可撤销发布');
        }
        const transition = await tx.task.updateMany({
          where: {
            id,
            status: row.status,
            version: row.version,
            publisherId: params.userId,
            ...contentNotDeleted,
          },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
        if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
        const updated = await tx.task.findUnique({ where: { id } });
        if (!updated) throw new HttpError(404, '任务不存在');
        if (row.takerId) {
          await notify(tx, {
            recipientId: row.takerId,
            actorId: params.userId,
            type: 'TASK_CANCELLED',
            bizType: 'task',
            bizId: id,
            title: '任务已取消',
            content: taskNotificationContent(row.title, '已由发布者取消'),
            dedupeKey: `task:${id}:TASK_CANCELLED:${updated.version}:recipient:${row.takerId}`,
          });
        }
        return this.mapTask(updated);
      })
      .then(async (mapped) => {
        await this.invalidatePendingList();
        return mapped;
      });
  }

  async republish(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return this.database
      .$transaction(async (tx) => {
        const row = await tx.task.findFirst({
          where: { id, ...contentNotDeleted },
        });
        if (!row) throw new HttpError(404, '任务不存在');
        if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可重新发布');
        if (row.status !== 'CANCELLED') throw new HttpError(400, '仅已撤销的任务可重新发布');
        if (row.takerId) throw new HttpError(400, '已被领取的任务不可重新发布');
        const transition = await tx.task.updateMany({
          where: {
            id,
            status: 'CANCELLED',
            version: row.version,
            publisherId: params.userId,
            takerId: null,
            ...contentNotDeleted,
          },
          data: { status: 'PENDING_TAKE', version: { increment: 1 } },
        });
        if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
        const updated = await tx.task.findUnique({ where: { id } });
        if (!updated) throw new HttpError(404, '任务不存在');
        return this.mapTask(updated);
      })
      .then(async (mapped) => {
        await this.invalidatePendingList();
        return mapped;
      });
  }

  async deleteUnpublished(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return this.database
      .$transaction(async (tx) => {
        const row = await tx.task.findFirst({
          where: { id, ...contentNotDeleted },
        });
        if (!row) throw new HttpError(404, '任务不存在');
        if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可删除');
        // 未发布：草稿；或已撤销且无人领取
        if (row.status !== 'DRAFT' && row.status !== 'CANCELLED') {
          throw new HttpError(400, '仅草稿/已撤销的任务可删除');
        }
        if (row.takerId) throw new HttpError(400, '已被领取的任务不可删除');
        const transition = await tx.task.updateMany({
          where: {
            id,
            publisherId: params.userId,
            status: row.status,
            version: row.version,
            takerId: null,
            ...contentNotDeleted,
          },
          data: {
            deletedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
        return { ok: true };
      })
      .then(async () => {
        await this.invalidatePendingList();
        return { ok: true };
      });
  }

  async abandonTask(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return this.database
      .$transaction(async (tx) => {
        const row = await tx.task.findFirst({
          where: { id, ...contentNotDeleted },
        });
        if (!row) throw new HttpError(404, '任务不存在');
        if (row.takerId !== params.userId) throw new HttpError(403, '仅接单人可放弃任务');
        if (row.status !== 'IN_PROGRESS') throw new HttpError(400, '该任务当前不可放弃');
        const transition = await tx.task.updateMany({
          where: {
            id,
            status: 'IN_PROGRESS',
            version: row.version,
            takerId: params.userId,
            ...contentNotDeleted,
          },
          data: {
            status: 'PENDING_TAKE',
            version: { increment: 1 },
            takerId: null,
            takerName: null,
            takerAvatar: null,
            claimedAt: null,
            proofText: null,
            proofImages: [],
            completedAt: null,
            confirmedAt: null,
          },
        });
        if (transition.count !== 1) throw new HttpError(409, '任务状态已变化，请刷新后重试');
        const updated = await tx.task.findUnique({ where: { id } });
        if (!updated) throw new HttpError(404, '任务不存在');
        await notify(tx, {
          recipientId: row.publisherId,
          actorId: params.userId,
          type: 'TASK_ABANDONED',
          bizType: 'task',
          bizId: id,
          title: '接单人已放弃任务',
          content: taskNotificationContent(row.title, '已被接单人放弃并重新开放领取'),
          dedupeKey: `task:${id}:TASK_ABANDONED:${updated.version}:recipient:${row.publisherId}`,
        });
        return this.mapTask(updated);
      })
      .then(async (mapped) => {
        await this.invalidatePendingList();
        return mapped;
      });
  }

  private mapTask(t: {
    id: string;
    title: string;
    desc: string;
    images: unknown;
    videos: unknown;
    reward: string | null;
    location: unknown;
    status: string;
    version: number;
    visibility?: string;
    pinned?: boolean;
    publisherId: string;
    publisherName: string | null;
    publisherAvatar?: string | null;
    publisherIdentity?: string | null;
    adminLabel?: string | null;
    takerId: string | null;
    takerName: string | null;
    takerAvatar?: string | null;
    proofText: string | null;
    proofImages: unknown;
    createdAt: Date;
    claimedAt: Date | null;
    completedAt: Date | null;
    confirmedAt: Date | null;
  }) {
    const tag = contentIdentityTag(t.publisherIdentity, t.adminLabel);
    return {
      _id: t.id,
      title: t.title,
      desc: t.desc,
      images: Array.isArray(t.images) ? t.images : (t.images ?? []),
      videos: Array.isArray(t.videos) ? t.videos : (t.videos ?? []),
      reward: t.reward ?? '',
      location: t.location ?? null,
      status: this.mapStatus(t.status),
      version: t.version,
      visibility: t.visibility ?? 'ONLINE',
      pinned: Boolean(t.pinned),
      publisherId: t.publisherId,
      publisherName: t.publisherName ?? '',
      publisherAvatar: avatarOrDefault(t.publisherAvatar),
      publisherIdentity: t.publisherIdentity ?? '',
      publisherIdentityLabel: identityTypeLabel(t.publisherIdentity),
      adminLabel: t.adminLabel ?? '',
      contentTagLabel: tag.label,
      contentTagType: tag.type,
      takerId: t.takerId ?? '',
      takerName: t.takerName ?? '',
      takerAvatar: avatarOrDefault(t.takerAvatar),
      proofText: t.proofText ?? '',
      proofImages: Array.isArray(t.proofImages) ? t.proofImages : (t.proofImages ?? []),
      createdAt: t.createdAt.toISOString(),
      claimedAt: t.claimedAt ? t.claimedAt.toISOString() : '',
      completedAt: t.completedAt ? t.completedAt.toISOString() : '',
      confirmedAt: t.confirmedAt ? t.confirmedAt.toISOString() : '',
    };
  }

  private mapStatus(s: string) {
    if (s === 'DRAFT') return 'draft';
    if (s === 'PENDING_TAKE') return 'pending_take';
    if (s === 'IN_PROGRESS') return 'in_progress';
    if (s === 'PENDING_CONFIRM') return 'pending_confirm';
    if (s === 'COMPLETED') return 'completed';
    if (s === 'CANCELLED') return 'cancelled';
    return 'pending_take';
  }
}
