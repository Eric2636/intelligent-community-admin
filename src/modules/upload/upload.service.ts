import { createHash } from 'node:crypto';
import COS from 'cos-nodejs-sdk-v5';
import { getCredential } from 'qcloud-cos-sts';
import { HttpError } from '../../http-error';

const UPLOAD_MODULES = new Set(['forum', 'task', 'errand', 'mall', 'avatar']);
const UPLOAD_TYPES = new Set(['img', 'vid']);
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm', '3gp', 'mpeg', 'mpg', 'flv']);

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

export class UploadService {
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
            'name/cos:ListMultipartUploads',
            'name/cos:ListParts',
            'name/cos:UploadPart',
            'name/cos:CompleteMultipartUpload',
            'name/cos:AbortMultipartUpload',
          ],
          effect: 'allow',
          resource: [`qcs::cos:${region}:uid/${appId}:${bucket}/${allowPrefix}`],
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
    const ext = extFromFilename(params.filename) || extFromContentType(params.contentType);
    const allowed = params.type === 'vid' ? VIDEO_EXTS : IMAGE_EXTS;
    if (!ext || !allowed.has(ext)) {
      throw new HttpError(400, params.type === 'vid' ? '仅支持上传常见视频格式' : '仅支持上传常见图片格式');
    }
    return ext;
  }

  async uploadMedia(params: {
    userId: string;
    module: string;
    type?: string;
    filename: string;
    contentType: string;
    buffer: Buffer;
  }) {
    const secretId = this.mustGet('COS_SECRET_ID');
    const secretKey = this.mustGet('COS_SECRET_KEY');
    const bucket = this.mustGet('COS_BUCKET');
    const region = this.mustGet('COS_REGION');
    const scope = this.assertUploadScope(params);
    const ext = this.assertUploadFile({ ...params, type: scope.type });
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

    return { url: publicObjectUrl(bucket, region, key), key, bucket, region };
  }

  async presignGetObjectUrl(params: { key: string; expiresSeconds?: number }) {
    const secretId = this.mustGet('COS_SECRET_ID');
    const secretKey = this.mustGet('COS_SECRET_KEY');
    const bucket = this.mustGet('COS_BUCKET');
    const region = this.mustGet('COS_REGION');
    const cos = new COS({ SecretId: secretId, SecretKey: secretKey });

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
