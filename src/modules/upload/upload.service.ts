import { createHash, randomUUID } from 'node:crypto';
import COS from 'cos-nodejs-sdk-v5';
import type { PrismaClient } from '@prisma/client';
import { getCredential } from 'qcloud-cos-sts';
import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import { MediaAssetService } from '../media/media-asset.service';

const UPLOAD_MODULES = new Set(['forum', 'task', 'mall', 'avatar']);
const UPLOAD_TYPES = new Set(['img', 'vid']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp', 'mpeg', 'mpg', 'flv']);
export const MAX_FORUM_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const FORUM_ATTACHMENT_EXTENSIONS = new Map<string, Set<string>>([
  ['pdf', new Set(['application/pdf'])],
  ['doc', new Set(['application/msword'])],
  ['docx', new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document'])],
  ['xls', new Set(['application/vnd.ms-excel'])],
  ['xlsx', new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])],
  ['ppt', new Set(['application/vnd.ms-powerpoint'])],
  ['pptx', new Set(['application/vnd.openxmlformats-officedocument.presentationml.presentation'])],
  ['txt', new Set(['text/plain'])],
]);

type UploadDatabase = Pick<PrismaClient, '$transaction' | 'forumAttachmentBlob' | 'mediaAsset'>;
type CosFactory = (credentials: { SecretId: string; SecretKey: string }) => any;

export function forumBlobRaceAction(blob: { deletedAt: Date | null; deleteRequestedAt?: Date | null }) {
  return blob.deletedAt || blob.deleteRequestedAt ? 'REVIVE_NEW_OBJECT' as const : 'REUSE_EXISTING_OBJECT' as const;
}

export function isForumAttachmentShaConflict(error: unknown) {
  const candidate = error as { code?: unknown; meta?: { target?: unknown }; message?: unknown };
  if (candidate?.code !== 'P2002') return false;
  const target = Array.isArray(candidate.meta?.target) ? candidate.meta.target.join('.') : String(candidate.meta?.target || '');
  const message = String(candidate.message || '');
  return /sha256|forum_attachment_blobs_sha256/i.test(`${target} ${message}`);
}

function publicObjectUrl(bucket: string, region: string, key: string) {
  const path = key
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `https://${bucket}.cos.${region}.myqcloud.com/${path}`;
}

function extFromFilename(filename: string) {
  const m = /\.(\w+)$/.exec(filename || '');
  return m ? m[1].toLowerCase() : '';
}

function extFromContentType(contentType: string) {
  const t = String(contentType || '').toLowerCase();
  if (t === 'image/jpeg') return 'jpg';
  if (t === 'video/quicktime') return 'mov';
  const m = /^(?:image|video)\/([\w.+-]+)$/.exec(t);
  return m ? m[1].replace(/^x-/, '') : '';
}

function safeOriginalName(filename: string) {
  const base = String(filename || '').split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 255);
  if (!cleaned) throw new HttpError(400, '附件文件名无效');
  return cleaned;
}

function hasSignature(ext: string, buffer: Buffer) {
  if (ext === 'pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  if (ext === 'doc' || ext === 'xls' || ext === 'ppt') return buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (ext === 'docx' || ext === 'xlsx' || ext === 'pptx') {
    if (!buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return false;
    const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 0 || eocd + 22 > buffer.length) return false;
    const count = buffer.readUInt16LE(eocd + 10);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    let offset = centralOffset;
    const entries: string[] = [];
    for (let i = 0; i < count && offset + 46 <= buffer.length; i += 1) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) return false;
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > buffer.length) return false;
      entries.push(buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8'));
      offset = end;
    }
    const root = ext === 'docx' ? 'word/' : ext === 'xlsx' ? 'xl/' : 'ppt/';
    return entries.includes('[Content_Types].xml') && entries.some((entry) => entry.startsWith(root));
  }
  if (ext === 'txt') return !buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
  return false;
}

export function validateForumAttachmentFile(params: { filename: string; contentType: string; buffer: Buffer }) {
  if (!params.buffer.length) throw new HttpError(400, '上传文件为空');
  if (params.buffer.length > MAX_FORUM_ATTACHMENT_BYTES) throw new HttpError(400, '单个附件不能超过 20MB');
  const originalName = safeOriginalName(params.filename);
  const ext = extFromFilename(originalName);
  const allowedTypes = FORUM_ATTACHMENT_EXTENSIONS.get(ext);
  const contentType = String(params.contentType || '').split(';')[0].trim().toLowerCase();
  if (!allowedTypes || (!allowedTypes.has(contentType) && contentType !== 'application/octet-stream')) {
    throw new HttpError(400, '附件仅支持 PDF、Office 文档或 TXT，且文件类型必须匹配');
  }
  if (!hasSignature(ext, params.buffer)) throw new HttpError(400, '附件文件签名无效');
  return { ext, originalName, contentType: contentType === 'application/octet-stream' ? [...allowedTypes][0]! : contentType };
}

export class UploadService {
  private readonly database: UploadDatabase;
  private readonly cosFactory: CosFactory;

  constructor(params: { database?: UploadDatabase; cosFactory?: CosFactory } = {}) {
    this.database = params.database || prisma;
    this.cosFactory = params.cosFactory || ((credentials) => new COS(credentials));
  }

  private mustGet(key: string) {
    const v = process.env[key];
    if (!v) throw new HttpError(400, `缺少配置 ${key}`);
    return v;
  }

  private getAppIdFromBucket(bucket: string) {
    // COS bucket 一般形如 name-appid，例如 chengly-1361977936
    const m = /-(\d+)$/.exec(bucket);
    if (!m) throw new HttpError(400, 'COS_BUCKET 必须包含 appid 后缀（形如 name-appid）');
    return m[1];
  }

  getEnvPrefix() {
    return (process.env.COS_ENV_PREFIX || 'test').replace(/\/+$/, '');
  }

  async getStsCredentials(params: { userId: string; module: string; type?: string }) {
    const secretId = this.mustGet('COS_SECRET_ID');
    const secretKey = this.mustGet('COS_SECRET_KEY');
    const bucket = this.mustGet('COS_BUCKET');
    const region = this.mustGet('COS_REGION');
    const appId = this.getAppIdFromBucket(bucket);

    const envPrefix = this.getEnvPrefix();
    const typeSeg = params.type ? `/${params.type}` : '';
    const allowPrefix = `${envPrefix}/${params.module}${typeSeg}/${params.userId}/*`;

    const objectResource = `qcs::cos:${region}:uid/${appId}:${bucket}/${allowPrefix}`;
    const bucketResource = `qcs::cos:${region}:uid/${appId}:${bucket}/*`;

    const policy = {
      version: '2.0',
      statement: [
        {
          // 分块上传全流程见 https://cloud.tencent.com/document/product/436/31923
          // 缺 ListParts / ListMultipartUploads / AbortMultipartUpload 时，小程序 SDK 常见 403
          action: [
            'name/cos:PutObject',
            'name/cos:PostObject',
            // 秒传：客户端 headObject 探测对象是否已存在，与 GetObject 同资源鉴权
            'name/cos:GetObject',
            'name/cos:InitiateMultipartUpload',
            'name/cos:ListParts',
            'name/cos:UploadPart',
            'name/cos:CompleteMultipartUpload',
            'name/cos:AbortMultipartUpload',
          ],
          effect: 'allow',
          resource: [objectResource],
        },
        {
          // COS SDK 会先请求 /?uploads&prefix=... 列出未完成分块上传。
          // 这个请求按 bucket 级资源鉴权，不能只给对象前缀资源，否则会 403。
          action: ['name/cos:ListMultipartUploads'],
          effect: 'allow',
          resource: [bucketResource],
          condition: {
            string_like: {
              'cos:prefix': allowPrefix,
            },
          },
        },
      ],
    };

    const durationSeconds = Number(process.env.COS_STS_DURATION_SECONDS || '1800');

    const r = await getCredential({
      secretId,
      secretKey,
      durationSeconds,
      policy,
    });

    return {
      bucket,
      region,
      envPrefix,
      allowPrefix,
      credentials: r.credentials,
      startTime: r.startTime,
      expiredTime: r.expiredTime,
    };
  }

  private assertUploadScope(params: { module: string; type?: string }) {
    const module = String(params.module || '').trim();
    const type = String(params.type || 'img').trim();
    if (!UPLOAD_MODULES.has(module)) throw new HttpError(400, '上传模块无效');
    if (!UPLOAD_TYPES.has(type)) throw new HttpError(400, '上传类型无效');
    return { module, type: type as 'img' | 'vid' };
  }

  private assertUploadFile(params: { filename: string; contentType: string; buffer: Buffer; type: 'img' | 'vid' }) {
    if (!params.buffer.length) throw new HttpError(400, '上传文件为空');
    const ext = extFromFilename(params.filename) || extFromContentType(params.contentType) || (params.type === 'vid' ? 'mp4' : 'jpg');
    const allowed = params.type === 'vid' ? VIDEO_EXTS : IMAGE_EXTS;
    if (!ext || !allowed.has(ext)) {
      throw new HttpError(400, params.type === 'vid' ? '仅支持上传常见视频格式' : '仅支持上传常见图片格式');
    }
    return ext;
  }

  private assertForumAttachmentFile(params: { filename: string; contentType: string; buffer: Buffer }) {
    return validateForumAttachmentFile(params);
  }

  /**
   * 在同一事务内锁定仍可用的 blob 再创建独立 PENDING 资产。
   * 清理器使用 deleteRequestedAt 抢占同一行，避免“已读可用、随后被清理”的陈旧快照竞态。
   */
  private async createForumAttachmentAsset(params: {
    blobId: string;
    userId: string;
    filename: string;
    ext: string;
    contentType: string;
    sizeBytes: number;
    objectKey?: string;
    url?: string;
    instant: boolean;
  }) {
    return this.database.$transaction(async (tx) => {
      const locked = await tx.forumAttachmentBlob.updateMany({
        where: { id: params.blobId, deletedAt: null, deleteRequestedAt: null },
        data: { updatedAt: new Date() },
      });
      if (locked.count !== 1) return null;
      const blob = await tx.forumAttachmentBlob.findUnique({ where: { id: params.blobId } });
      if (!blob) return null;
      const objectKey = params.objectKey || `${this.getEnvPrefix()}/forum/file/${params.userId}/${randomUUID()}.${params.ext}`;
      const url = params.url || blob.url;
      const asset = await tx.mediaAsset.create({
        data: {
          objectKey,
          url,
          uploaderId: params.userId,
          module: 'forum',
          mediaType: 'FILE',
          originalName: params.filename,
          contentType: params.contentType,
          sizeBytes: params.sizeBytes,
          forumAttachmentBlobId: blob.id,
          state: 'PENDING',
        },
      });
      return { id: asset.id, mediaAssetId: asset.id, name: params.filename, sizeBytes: params.sizeBytes, contentType: params.contentType, url, instant: params.instant };
    });
  }

  async prepareForumAttachment(params: { userId: string; sha256: string; filename: string; contentType: string; sizeBytes: number }) {
    if (!/^[a-f0-9]{64}$/i.test(params.sha256)) throw new HttpError(400, 'SHA-256 格式无效');
    if (!Number.isInteger(params.sizeBytes) || params.sizeBytes <= 0 || params.sizeBytes > MAX_FORUM_ATTACHMENT_BYTES) throw new HttpError(400, '附件大小无效');
    const originalName = safeOriginalName(params.filename);
    const ext = extFromFilename(originalName);
    const allowedTypes = FORUM_ATTACHMENT_EXTENSIONS.get(ext);
    const contentType = String(params.contentType || '').split(';')[0].trim().toLowerCase();
    if (!allowedTypes || (!allowedTypes.has(contentType) && contentType !== 'application/octet-stream')) throw new HttpError(400, '附件类型无效');
    const blob = await this.database.forumAttachmentBlob.findUnique({ where: { sha256: params.sha256.toLowerCase() } });
    if (!blob || blob.deletedAt || blob.deleteRequestedAt) return { exists: false };
    if (blob.sizeBytes !== params.sizeBytes) throw new HttpError(409, '文件摘要与大小不匹配');
    const asset = await this.createForumAttachmentAsset({
      blobId: blob.id, userId: params.userId, filename: originalName, ext, contentType: blob.contentType,
      sizeBytes: blob.sizeBytes, url: blob.url, instant: true,
    });
    if (!asset) return { exists: false };
    return { exists: true, ...asset };
  }

  async uploadMedia(params: {
    userId: string;
    module: string;
    type?: string;
    filename: string;
    filenameHint?: string;
    contentType: string;
    buffer: Buffer;
  }) {
    const secretId = this.mustGet('COS_SECRET_ID');
    const secretKey = this.mustGet('COS_SECRET_KEY');
    const bucket = this.mustGet('COS_BUCKET');
    const region = this.mustGet('COS_REGION');
    const scope = this.assertUploadScope(params);
    const filename = extFromFilename(params.filename) ? params.filename : params.filenameHint || params.filename;
    const ext = this.assertUploadFile({ ...params, filename, type: scope.type });
    const allowPrefix = `${this.getEnvPrefix()}/${scope.module}/${scope.type}/${params.userId}/`;
    const digest = createHash('md5').update(params.buffer).digest('hex');
    const key = `${allowPrefix}${digest}.${ext}`;
    const cos = new COS({ SecretId: secretId, SecretKey: secretKey });

    await new Promise<void>((resolve, reject) => {
      cos.putObject(
        {
          Bucket: bucket,
          Region: region,
          Key: key,
          Body: params.buffer,
          ContentType: params.contentType || undefined,
        },
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });

    const url = publicObjectUrl(bucket, region, key);
    try {
      await new MediaAssetService({
        database: this.database,
        bucket,
        region,
        envPrefix: this.getEnvPrefix(),
      }).registerUploaded({
        userId: params.userId,
        module: scope.module,
        type: scope.type,
        key,
        url,
      });
    } catch (error) {
      await new Promise<void>((resolve) => {
        cos.deleteObject({ Bucket: bucket, Region: region, Key: key }, () => resolve());
      });
      throw new HttpError(500, `媒体上传登记失败：${error instanceof Error ? error.message : '未知错误'}`);
    }

    return { url, key, bucket, region };
  }

  async uploadForumAttachment(params: { userId: string; filename: string; contentType: string; buffer: Buffer }) {
    const file = this.assertForumAttachmentFile(params);
    const sha256 = createHash('sha256').update(params.buffer).digest('hex');
    const existing = await this.database.forumAttachmentBlob.findUnique({ where: { sha256 } });
    if (existing && !existing.deletedAt && !existing.deleteRequestedAt) {
      const asset = await this.createForumAttachmentAsset({
        blobId: existing.id, userId: params.userId, filename: file.originalName, ext: file.ext,
        contentType: file.contentType, sizeBytes: params.buffer.length, url: existing.url, instant: true,
      });
      if (asset) return asset;
    }
    const secretId = this.mustGet('COS_SECRET_ID');
    const secretKey = this.mustGet('COS_SECRET_KEY');
    const bucket = this.mustGet('COS_BUCKET');
    const region = this.mustGet('COS_REGION');
    const key = `${this.getEnvPrefix()}/forum/file/${params.userId}/${randomUUID()}.${file.ext}`;
    const cos = this.cosFactory({ SecretId: secretId, SecretKey: secretKey });
    await new Promise<void>((resolve, reject) => {
      cos.putObject({ Bucket: bucket, Region: region, Key: key, Body: params.buffer, ContentType: file.contentType }, (err) => (err ? reject(err) : resolve()));
    });
    const url = publicObjectUrl(bucket, region, key);
    try {
      // 首次上传必须把物理 blob 和第一个资产放在同一个事务中，资产失败时自动回滚 blob，
      // 避免预检命中一个没有任何可用资产的“坏 blob”。
      const created = await this.database.$transaction(async (tx) => {
        const blob = await tx.forumAttachmentBlob.create({ data: { sha256, objectKey: key, url, contentType: file.contentType, sizeBytes: params.buffer.length } });
        const asset = await tx.mediaAsset.create({
          data: {
            objectKey: key,
            url,
            uploaderId: params.userId,
            module: 'forum',
            mediaType: 'FILE',
            originalName: file.originalName,
            contentType: file.contentType,
            sizeBytes: params.buffer.length,
            forumAttachmentBlobId: blob.id,
            state: 'PENDING',
          },
        });
        return { id: asset.id, mediaAssetId: asset.id, name: file.originalName, sizeBytes: params.buffer.length, contentType: file.contentType, url, instant: false };
      });
      return created;
    } catch (error) {
      if (isForumAttachmentShaConflict(error)) {
        const blob = await this.database.forumAttachmentBlob.findUnique({ where: { sha256 } });
        if (blob && forumBlobRaceAction(blob) === 'REVIVE_NEW_OBJECT') {
          const claimWhere = blob.deletedAt
            ? { id: blob.id, deletedAt: { not: null } }
            : { id: blob.id, deletedAt: null, deleteRequestedAt: { not: null } };
          let revivedResult: { id: string; mediaAssetId: string; name: string; sizeBytes: number; contentType: string; url: string; instant: boolean } | null = null;
          try {
            revivedResult = await this.database.$transaction(async (tx) => {
              const claim = await tx.forumAttachmentBlob.updateMany({
                where: claimWhere,
                data: { objectKey: key, url, contentType: file.contentType, sizeBytes: params.buffer.length, deletedAt: null, deleteRequestedAt: null },
              });
              if (claim.count !== 1) return null;
              const asset = await tx.mediaAsset.create({
                data: {
                  objectKey: key, url, uploaderId: params.userId, module: 'forum', mediaType: 'FILE',
                  originalName: file.originalName, contentType: file.contentType, sizeBytes: params.buffer.length,
                  forumAttachmentBlobId: blob.id, state: 'PENDING',
                },
              });
              return { id: asset.id, mediaAssetId: asset.id, name: file.originalName, sizeBytes: params.buffer.length, contentType: file.contentType, url, instant: false };
            });
          } catch {
            // 外层统一回收本次新对象，避免事务异常留下无法引用的 COS key。
          }
          if (revivedResult) return revivedResult;
        }
        const winner = await this.database.forumAttachmentBlob.findUnique({ where: { sha256 } });
        if (winner && !winner.deletedAt && !winner.deleteRequestedAt) {
          await new Promise<void>((resolve) => cos.deleteObject({ Bucket: bucket, Region: region, Key: key }, () => resolve()));
          const asset = await this.createForumAttachmentAsset({
            blobId: winner.id, userId: params.userId, filename: file.originalName, ext: file.ext,
            contentType: file.contentType, sizeBytes: params.buffer.length, url: winner.url, instant: true,
          });
          if (asset) return asset;
        }
      }
      await new Promise<void>((resolve) => cos.deleteObject({ Bucket: bucket, Region: region, Key: key }, () => resolve()));
      throw new HttpError(500, `附件上传登记失败：${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  async presignGetObjectUrl(params: { key: string; expiresSeconds?: number }) {
    const secretId = this.mustGet('COS_SECRET_ID');
    const secretKey = this.mustGet('COS_SECRET_KEY');
    const bucket = this.mustGet('COS_BUCKET');
    const region = this.mustGet('COS_REGION');
    const cos = this.cosFactory({ SecretId: secretId, SecretKey: secretKey });

    const expires =
      params.expiresSeconds ?? Number(process.env.COS_PRESIGN_EXPIRES_SECONDS || '600');
    if (!params.key || params.key.includes('..')) throw new HttpError(400, '非法 key');

    const url = cos.getObjectUrl({
      Bucket: bucket,
      Region: region,
      Key: params.key.replace(/^\//, ''),
      Sign: true,
      Expires: expires,
    });

    return { url, expiresSeconds: expires };
  }
}
