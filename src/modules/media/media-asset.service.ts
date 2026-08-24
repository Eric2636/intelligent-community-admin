import COS from 'cos-nodejs-sdk-v5';
import { HttpError } from '../../http-error';

type MediaAssetState = 'PENDING' | 'ATTACHED' | 'DELETING' | 'DELETE_PENDING' | 'DELETED' | 'DELETE_FAILED';

type MediaAssetRecord = {
  id: string;
  objectKey: string;
  url: string;
  uploaderId: string;
  module: string;
  mediaType: 'IMG' | 'VID' | 'FILE';
  state: MediaAssetState;
  attachedAt: Date | null;
  deleteRequestedAt: Date | null;
  deletedAt: Date | null;
  deleteAttempts: number;
  lastDeleteError: string | null;
  createdAt: Date;
  forumAttachmentBlobId?: string | null;
  forumAttachmentBlob?: { id: string; objectKey: string; deletedAt: Date | null; deleteRequestedAt?: Date | null } | null;
  forumPostAttachment?: { id: string } | null;
};

type MediaAssetStore = {
  findMany?: (args: any) => PromiseLike<MediaAssetRecord[]>;
  updateMany: (args: any) => PromiseLike<{ count: number }>;
  upsert?: (args: any) => PromiseLike<MediaAssetRecord>;
};

type MediaAssetDatabase = {
  mediaAsset: MediaAssetStore;
  forumAttachmentBlob?: { updateMany: (args: any) => PromiseLike<{ count: number }> };
};

type DeleteObject = (objectKey: string) => Promise<void>;

const SUPPORTED_MODULES = new Set(['forum', 'task', 'mall', 'avatar']);
const SUPPORTED_TYPES = new Set(['img', 'vid', 'file']);
const PENDING_RETENTION_MS = 24 * 60 * 60 * 1000;

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

export class MediaAssetService {
  private readonly database: MediaAssetDatabase;
  private readonly bucket: string;
  private readonly region: string;
  private readonly envPrefix: string;
  private readonly deleteObject: DeleteObject;
  private readonly now: () => Date;

  constructor(params: {
    database: MediaAssetDatabase;
    bucket: string;
    region: string;
    envPrefix: string;
    deleteObject?: DeleteObject;
    now?: () => Date;
  }) {
    this.database = params.database;
    this.bucket = params.bucket;
    this.region = params.region;
    this.envPrefix = params.envPrefix.replace(/^\/+|\/+$/g, '');
    this.deleteObject = params.deleteObject || this.createCosDeleter();
    this.now = params.now || (() => new Date());
  }

  private createCosDeleter(): DeleteObject {
    return async (objectKey) => {
      const secretId = process.env.COS_SECRET_ID;
      const secretKey = process.env.COS_SECRET_KEY;
      if (!secretId || !secretKey) throw new Error('缺少 COS 删除凭证');
      const cos = new COS({ SecretId: secretId, SecretKey: secretKey });
      await new Promise<void>((resolve, reject) => {
        cos.deleteObject(
          { Bucket: this.bucket, Region: this.region, Key: objectKey },
          (error) => (error ? reject(error) : resolve()),
        );
      });
    };
  }

  urlToObjectKey(url: string) {
    try {
      const parsed = new URL(url);
      const expectedHost = `${this.bucket}.cos.${this.region}.myqcloud.com`;
      if (parsed.protocol !== 'https:' || parsed.hostname !== expectedHost) return null;
      const objectKey = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
      return this.isManagedObjectKey(objectKey) ? objectKey : null;
    } catch {
      return null;
    }
  }

  isManagedObjectKey(objectKey: string) {
    const segments = String(objectKey || '').split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
    const [envPrefix, module, type] = segments;
    return envPrefix === this.envPrefix && SUPPORTED_MODULES.has(module) && SUPPORTED_TYPES.has(type);
  }

  private managedObjectKeys(urls: string[]) {
    return uniqueStrings(urls.map((url) => this.urlToObjectKey(url) || ''));
  }

  async registerUploaded(params: {
    userId: string;
    module: string;
    type: 'img' | 'vid' | 'file';
    key: string;
    url: string;
    originalName?: string;
    contentType?: string;
    sizeBytes?: number;
  }) {
    if (!this.isManagedObjectKey(params.key)) throw new HttpError(400, '媒体路径不属于当前环境');
    const [envPrefix, module, type, uploaderId] = params.key.split('/');
    if (
      envPrefix !== this.envPrefix ||
      module !== params.module ||
      type !== params.type ||
      uploaderId !== params.userId ||
      !SUPPORTED_MODULES.has(module) ||
      !SUPPORTED_TYPES.has(type)
    ) {
      throw new HttpError(400, '媒体路径与上传信息不匹配');
    }
    if (!this.database.mediaAsset.upsert) throw new Error('媒体资产登记能力不可用');
    return this.database.mediaAsset.upsert({
      where: { objectKey: params.key },
      create: {
        objectKey: params.key,
        url: params.url,
        uploaderId: params.userId,
        module,
        mediaType: type === 'vid' ? 'VID' : type === 'file' ? 'FILE' : 'IMG',
        originalName: params.originalName,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        state: 'PENDING',
      },
      update: {
        url: params.url,
        uploaderId: params.userId,
        module,
        mediaType: type === 'vid' ? 'VID' : type === 'file' ? 'FILE' : 'IMG',
        originalName: params.originalName,
        contentType: params.contentType,
        sizeBytes: params.sizeBytes,
        state: 'PENDING',
        attachedAt: null,
        deleteRequestedAt: null,
        deletedAt: null,
        lastDeleteError: null,
      },
    });
  }

  async attachUrls(database: MediaAssetDatabase, params: { uploaderId: string; urls: string[] }) {
    const objectKeys = this.managedObjectKeys(params.urls);
    if (!objectKeys.length) return;
    if (!database.mediaAsset.findMany) throw new Error('媒体资产查询能力不可用');
    const assets = await database.mediaAsset.findMany({ where: { objectKey: { in: objectKeys } } });
    const byObjectKey = new Map(assets.map((asset) => [asset.objectKey, asset]));
    for (const objectKey of objectKeys) {
      const asset = byObjectKey.get(objectKey);
      if (!asset) throw new HttpError(400, '媒体不存在或不可用');
      if (asset.uploaderId !== params.uploaderId) throw new HttpError(403, '媒体不属于当前用户');
      if (asset.state !== 'PENDING' && asset.state !== 'ATTACHED') {
        throw new HttpError(400, '媒体当前不可关联');
      }
    }
    await database.mediaAsset.updateMany({
      where: { objectKey: { in: objectKeys }, uploaderId: params.uploaderId, state: 'PENDING' },
      data: { state: 'ATTACHED', attachedAt: this.now() },
    });
  }

  async requestDeleteUrls(database: MediaAssetDatabase, urls: string[]) {
    const objectKeys = this.managedObjectKeys(urls);
    if (!objectKeys.length) return;
    await database.mediaAsset.updateMany({
      where: { objectKey: { in: objectKeys }, state: { in: ['PENDING', 'ATTACHED', 'DELETE_FAILED'] } },
      data: { state: 'DELETE_PENDING', deleteRequestedAt: this.now(), lastDeleteError: null },
    });
  }

  async deleteAsset(asset: MediaAssetRecord) {
    if (!this.isManagedObjectKey(asset.objectKey)) return 'skipped' as const;
    const isExpiredPending = asset.state === 'PENDING' && asset.createdAt.getTime() <= this.now().getTime() - PENDING_RETENTION_MS;
    const isQueued = asset.state === 'DELETING' || asset.state === 'DELETE_PENDING' || asset.state === 'DELETE_FAILED';
    const orphanForumFile = asset.state === 'ATTACHED' && asset.module === 'forum' && asset.mediaType === 'FILE' && !asset.forumPostAttachment;
    if (!isExpiredPending && !isQueued && !orphanForumFile) return 'skipped' as const;

    // 先原子抢占当前状态，再重读记录；发布/编辑若已将 PENDING 转为 ATTACHED，抢占会失败。
    const claimed = await this.database.mediaAsset.updateMany({
      where: { id: asset.id, state: isExpiredPending ? 'PENDING' : orphanForumFile ? 'ATTACHED' : { in: ['DELETE_PENDING', 'DELETE_FAILED', 'DELETING'] } },
      data: { state: 'DELETING' },
    });
    if (claimed.count !== 1) return 'skipped' as const;
    const freshRows = this.database.mediaAsset.findMany
      ? await this.database.mediaAsset.findMany({ where: { id: asset.id }, include: { forumAttachmentBlob: true, forumPostAttachment: true } })
      : [];
    const fresh = freshRows[0] || { ...asset, state: 'DELETING' as const };
    if (fresh.state !== 'DELETING') return 'skipped' as const;
    // ATTACHED 兜底查询可能在关联事务提交前拿到旧快照；重读发现关系已存在时，恢复状态并放弃清理。
    if (fresh.module === 'forum' && fresh.mediaType === 'FILE' && fresh.forumPostAttachment) {
      await this.database.mediaAsset.updateMany({ where: { id: asset.id, state: 'DELETING' }, data: { state: 'ATTACHED' } });
      return 'skipped' as const;
    }

    try {
      const blob = fresh.forumAttachmentBlobId && fresh.forumAttachmentBlob;
      if (blob) {
        // 先把当前对象标记为清理中，阻止秒传/预检在引用快照期间再创建 PENDING 引用。
        // objectKey 条件确保复活流程已替换对象时不会误标记新对象。
        const marked = await this.database.forumAttachmentBlob?.updateMany({
          where: { id: blob.id, objectKey: blob.objectKey, deletedAt: null },
          data: { deleteRequestedAt: this.now() },
        });
        if (marked && marked.count !== 1) {
          await this.database.mediaAsset.updateMany({
            where: { id: asset.id, state: 'DELETING' },
            data: { state: 'DELETED', deletedAt: this.now(), lastDeleteError: null },
          });
          return 'deleted' as const;
        }
        const refs = this.database.mediaAsset.findMany
          ? await this.database.mediaAsset.findMany({ where: { forumAttachmentBlobId: blob.id, state: { not: 'DELETED' } }, select: { id: true } })
          : [];
        if (refs.length <= 1) {
          await this.deleteObject(blob.objectKey);
          await this.database.forumAttachmentBlob?.updateMany({
            where: { id: blob.id, objectKey: blob.objectKey, deletedAt: null, deleteRequestedAt: { not: null } },
            data: { deletedAt: this.now(), deleteRequestedAt: null },
          });
        } else {
          // 仍有其它引用，撤销本次清理标记；若期间已复活/换 key，条件会使本次撤销失效。
          await this.database.forumAttachmentBlob?.updateMany({
            where: { id: blob.id, objectKey: blob.objectKey, deletedAt: null, deleteRequestedAt: { not: null } },
            data: { deleteRequestedAt: null },
          });
        }
      } else {
        await this.deleteObject(asset.objectKey);
      }
      await this.database.mediaAsset.updateMany({
        where: { id: asset.id, state: 'DELETING' },
        data: { state: 'DELETED', deletedAt: this.now(), lastDeleteError: null },
      });
      return 'deleted' as const;
    } catch (error) {
      await this.database.mediaAsset.updateMany({
        where: { id: asset.id, state: 'DELETING' },
        data: {
          state: 'DELETE_FAILED',
          deleteAttempts: asset.deleteAttempts + 1,
          lastDeleteError: error instanceof Error ? error.message.slice(0, 2000) : String(error).slice(0, 2000),
        },
      });
      return 'failed' as const;
    }
  }
}

/**
 * 业务事务中按当前 COS 环境启用媒体关联；未配置 COS 的离线单测不介入旧媒体数据。
 */
export function configuredMediaAssetService(database: MediaAssetDatabase) {
  const bucket = String(process.env.COS_BUCKET || '').trim();
  const region = String(process.env.COS_REGION || '').trim();
  if (!bucket || !region) return null;
  return new MediaAssetService({
    database,
    bucket,
    region,
    envPrefix: String(process.env.COS_ENV_PREFIX || 'test'),
  });
}
