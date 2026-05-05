import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import {
  cacheAsideJson,
  invalidatePendingTasksListCache,
  taskPendingListCacheKey,
  TASK_PENDING_LIST_TTL_SEC,
} from '../../lib/redis-cache';

const MAX_TASK_IMAGES = 9;
const MAX_TASK_VIDEOS = 2;

export class TaskService {
  async getTaskDetail(taskId: string) {
    const id = String(taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    const row = await prisma.task.findFirst({ where: { id, visibility: 'ONLINE' } });
    if (!row) throw new HttpError(404, '任务不存在');
    return this.mapTask(row);
  }

  async createTask(params: {
    publisherId: string;
    title: string;
    desc: string;
    reward: string;
    location: string;
    images?: string[];
    videos?: string[];
  }) {
    const title = (params.title || '').trim();
    const desc = (params.desc || '').trim();
    const reward = (params.reward || '').trim();
    const location = (params.location || '').trim();
    if (!title) throw new HttpError(400, 'title 不能为空');
    if (!desc && (!params.images?.length && !params.videos?.length)) {
      throw new HttpError(400, 'desc 与 images/videos 至少填写一项');
    }
    if (!reward) throw new HttpError(400, 'reward 不能为空');

    const publisher = await prisma.user.findUnique({
      where: { id: params.publisherId },
      select: { name: true },
    });

    const images = parseStrictMediaUrlList(params.images, MAX_TASK_IMAGES, 'image', 'images');
    const videos = parseStrictMediaUrlList(params.videos, MAX_TASK_VIDEOS, 'video', 'videos');

    const row = await prisma.task.create({
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
      },
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

    const publisher = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { name: true },
    });

    const images = parseStrictMediaUrlList(params.images, MAX_TASK_IMAGES, 'image', 'images');
    const videos = parseStrictMediaUrlList(params.videos, MAX_TASK_VIDEOS, 'video', 'videos');

    const data = {
      title: title || '未命名草稿',
      desc: desc || '',
      reward: reward || '',
      location: location || '',
      images,
      videos,
      status: 'DRAFT' as const,
      publisherId: params.userId,
      publisherName: publisher?.name ?? '',
    };

    const id = params.taskId ? String(params.taskId).trim() : '';
    if (id) {
      const row = await prisma.task.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, '草稿不存在');
      if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可编辑草稿');
      if (row.status !== 'DRAFT') throw new HttpError(400, '仅草稿可编辑');
      const updated = await prisma.task.update({ where: { id }, data });
      return this.mapTask(updated);
    }

    const created = await prisma.task.create({ data });
    return this.mapTask(created);
  }

  async publishDraft(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return prisma.$transaction(async (tx) => {
      const row = await tx.task.findUnique({ where: { id } });
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
      if (!desc && images.length === 0 && videos.length === 0) throw new HttpError(400, '请填写任务说明或添加图片/视频');
      if (!reward) throw new HttpError(400, '请填写佣金');
      if (!location) throw new HttpError(400, '请填写地点');
      const updated = await tx.task.update({ where: { id }, data: { status: 'PENDING_TAKE' } });
      return this.mapTask(updated);
    }).then(async (mapped) => {
      await invalidatePendingTasksListCache();
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
      };

      if (keyword && keyword.trim()) {
        where.title = { contains: keyword.trim() };
      }

      const rows = await prisma.task.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      });

      return rows.map((t) => this.mapTask(t));
    });
  }

  async revokePublish(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return prisma.$transaction(async (tx) => {
      const row = await tx.task.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, '任务不存在');
      if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可撤销发布');
      if (row.status !== 'PENDING_TAKE') throw new HttpError(400, '该任务当前不可撤销发布');
      if (row.takerId) throw new HttpError(400, '已被领取的任务不可撤销发布');
      const updated = await tx.task.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      return this.mapTask(updated);
    }).then(async (mapped) => {
      await invalidatePendingTasksListCache();
      return mapped;
    });
  }

  async republish(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return prisma.$transaction(async (tx) => {
      const row = await tx.task.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, '任务不存在');
      if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可重新发布');
      if (row.status !== 'CANCELLED') throw new HttpError(400, '仅已撤销的任务可重新发布');
      if (row.takerId) throw new HttpError(400, '已被领取的任务不可重新发布');
      const updated = await tx.task.update({
        where: { id },
        data: { status: 'PENDING_TAKE' },
      });
      return this.mapTask(updated);
    }).then(async (mapped) => {
      await invalidatePendingTasksListCache();
      return mapped;
    });
  }

  async deleteUnpublished(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return prisma.$transaction(async (tx) => {
      const row = await tx.task.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, '任务不存在');
      if (row.publisherId !== params.userId) throw new HttpError(403, '仅发布者可删除');
      // 未发布：草稿；或已撤销且无人领取
      if (row.status !== 'DRAFT' && row.status !== 'CANCELLED') {
        throw new HttpError(400, '仅草稿/已撤销的任务可删除');
      }
      if (row.takerId) throw new HttpError(400, '已被领取的任务不可删除');
      await tx.task.delete({ where: { id } });
      return { ok: true };
    });
  }

  async abandonTask(params: { taskId: string; userId: string }) {
    const id = String(params.taskId || '').trim();
    if (!id) throw new HttpError(400, 'taskId 不能为空');
    return prisma.$transaction(async (tx) => {
      const row = await tx.task.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, '任务不存在');
      if (row.takerId !== params.userId) throw new HttpError(403, '仅接单人可放弃任务');
      if (row.status !== 'IN_PROGRESS') throw new HttpError(400, '该任务当前不可放弃');
      const updated = await tx.task.update({
        where: { id },
        data: {
          status: 'PENDING_TAKE',
          takerId: null,
          takerName: null,
          claimedAt: null,
          proofText: null,
          proofImages: [],
          completedAt: null,
          confirmedAt: null,
        },
      });
      return this.mapTask(updated);
    }).then(async (mapped) => {
      await invalidatePendingTasksListCache();
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
    visibility?: string;
    pinned?: boolean;
    publisherId: string;
    publisherName: string | null;
    takerId: string | null;
    takerName: string | null;
    proofText: string | null;
    proofImages: unknown;
    createdAt: Date;
    claimedAt: Date | null;
    completedAt: Date | null;
    confirmedAt: Date | null;
  }) {
    return {
      _id: t.id,
      title: t.title,
      desc: t.desc,
      images: Array.isArray(t.images) ? t.images : t.images ?? [],
      videos: Array.isArray(t.videos) ? t.videos : t.videos ?? [],
      reward: t.reward ?? '',
      location: t.location ?? null,
      status: this.mapStatus(t.status),
      visibility: t.visibility ?? 'ONLINE',
      pinned: Boolean(t.pinned),
      publisherId: t.publisherId,
      publisherName: t.publisherName ?? '',
      takerId: t.takerId ?? '',
      takerName: t.takerName ?? '',
      proofText: t.proofText ?? '',
      proofImages: Array.isArray(t.proofImages) ? t.proofImages : t.proofImages ?? [],
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
