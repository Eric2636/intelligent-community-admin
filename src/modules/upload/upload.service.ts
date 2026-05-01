import COS from 'cos-nodejs-sdk-v5';
import { getCredential } from 'qcloud-cos-sts';
import { HttpError } from '../../http-error';

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
