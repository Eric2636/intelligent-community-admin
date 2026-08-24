import { HttpError } from '../../http-error';
import type { Prisma } from '@prisma/client';

export const MAX_POST_ATTACHMENTS = 5;

export function forumAttachmentIds(value: unknown): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, '附件格式不正确');
  const ids = value.map((item) => String((item as { mediaAssetId?: unknown })?.mediaAssetId || '').trim());
  if (ids.some((id) => !id)) throw new HttpError(400, '附件不能为空');
  if (ids.length > MAX_POST_ATTACHMENTS) throw new HttpError(400, `每篇帖子最多上传 ${MAX_POST_ATTACHMENTS} 个附件`);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, '附件不能重复');
  return ids;
}

export async function assertForumAttachmentsAvailable(
  database: Pick<Prisma.TransactionClient, 'mediaAsset' | 'forumPostAttachment'>,
  params: { uploaderId: string; mediaAssetIds: string[]; postId?: string },
) {
  const { mediaAssetIds, uploaderId } = params;
  if (!mediaAssetIds.length) return;
  const assets = await database.mediaAsset.findMany({ where: { id: { in: mediaAssetIds } } });
  if (assets.length !== mediaAssetIds.length) throw new HttpError(400, '附件不存在或不可用');
  const current = params.postId
    ? await database.forumPostAttachment.findMany({ where: { postId: params.postId, mediaAssetId: { in: mediaAssetIds } }, select: { mediaAssetId: true } })
    : [];
  const currentIds = new Set(current.map((item) => item.mediaAssetId));
  for (const asset of assets) {
    if (asset.module !== 'forum' || asset.mediaType !== 'FILE') throw new HttpError(400, '仅能关联论坛附件');
    if (asset.state === 'PENDING') {
      if (asset.uploaderId !== uploaderId) throw new HttpError(403, '附件不属于当前管理员');
    } else if (asset.state === 'ATTACHED') {
      if (!currentIds.has(asset.id)) throw new HttpError(409, '附件已关联其他帖子');
    } else {
      throw new HttpError(400, '附件当前不可关联');
    }
  }
}

export async function replaceForumPostAttachments(
  database: Pick<Prisma.TransactionClient, 'mediaAsset' | 'forumPostAttachment'>,
  params: { postId: string; mediaAssetIds: string[]; now?: Date },
) {
  const existing = await database.forumPostAttachment.findMany({ where: { postId: params.postId }, select: { mediaAssetId: true } });
  const now = params.now || new Date();
  const existingIds = existing.map((attachment) => attachment.mediaAssetId);
  const targetIds = [...new Set([...existingIds, ...params.mediaAssetIds])];
  const locked = targetIds.length
    ? await database.mediaAsset.updateMany({
      // 更新 updatedAt 是事务内的行锁；A/B 编辑和 worker 会在同一资产行上串行。
      where: { id: { in: targetIds }, state: { in: ['PENDING', 'ATTACHED'] } },
      data: { updatedAt: now },
    })
    : { count: 0 };
  if (locked.count !== targetIds.length) {
    throw new HttpError(409, '附件状态已变化，请重新上传或刷新后重试');
  }

  const latestAssets = targetIds.length
    ? await database.mediaAsset.findMany({ where: { id: { in: targetIds } }, select: { id: true, state: true } })
    : [];
  const latestById = new Map(latestAssets.map((asset) => [asset.id, asset]));
  if (latestAssets.length !== targetIds.length) throw new HttpError(409, '附件状态已变化，请重新上传或刷新后重试');
  const latestRelations = params.mediaAssetIds.length
    ? await database.forumPostAttachment.findMany({ where: { postId: params.postId, mediaAssetId: { in: params.mediaAssetIds } }, select: { mediaAssetId: true } })
    : [];
  const currentIds = new Set(latestRelations.map((attachment) => attachment.mediaAssetId));
  const pendingIds: string[] = [];
  for (const id of params.mediaAssetIds) {
    const asset = latestById.get(id);
    if (asset?.state === 'PENDING') pendingIds.push(id);
    else if (asset?.state !== 'ATTACHED' || !currentIds.has(id)) throw new HttpError(409, '附件状态已变化，请重新上传或刷新后重试');
  }
  for (const id of existingIds) {
    const asset = latestById.get(id);
    if (!params.mediaAssetIds.includes(id) && asset?.state !== 'ATTACHED') {
      throw new HttpError(409, '附件状态已变化，请重新上传或刷新后重试');
    }
  }

  // 先在事务内把新资产置为 ATTACHED，再写关系记录；清理器只会看到提交后的完整关联状态。
  if (pendingIds.length) {
    const attached = await database.mediaAsset.updateMany({
      where: { id: { in: pendingIds }, state: 'PENDING' },
      data: { state: 'ATTACHED', attachedAt: now },
    });
    if (attached.count !== pendingIds.length) {
      throw new HttpError(409, '附件状态已变化，请重新上传或刷新后重试');
    }
  }
  // 只有新资产全部抢占成功后，才替换关系；条件更新失败时不会先拆掉原有关联。
  await database.forumPostAttachment.deleteMany({ where: { postId: params.postId } });
  if (params.mediaAssetIds.length) {
    await database.forumPostAttachment.createMany({
      data: params.mediaAssetIds.map((mediaAssetId, sortOrder) => ({ postId: params.postId, mediaAssetId, sortOrder })),
    });
  }
  const removedIds = existing.map((attachment) => attachment.mediaAssetId).filter((id) => !params.mediaAssetIds.includes(id));
  if (removedIds.length) {
    const removedUpdate = await database.mediaAsset.updateMany({
      where: { id: { in: removedIds }, state: { in: ['PENDING', 'ATTACHED', 'DELETE_FAILED'] } },
      data: { state: 'DELETE_PENDING', deleteRequestedAt: now, lastDeleteError: null },
    });
    if (removedUpdate.count !== removedIds.length) {
      throw new HttpError(409, '附件状态已变化，请重新上传或刷新后重试');
    }
  }
}
