import axios from 'axios';
import { HttpError } from '../../http-error';

type PostResult = {
  data?: {
    errcode?: number;
    errmsg?: string;
    trace_id?: string;
  };
};

type ClientDependencies = {
  getAccessToken: () => Promise<string>;
  post?: (url: string, data: unknown) => Promise<PostResult>;
};

export class WechatContentSecurityClient {
  private readonly post: (url: string, data: unknown) => Promise<PostResult>;

  constructor(private readonly dependencies: ClientDependencies) {
    this.post = dependencies.post ?? ((url, data) => axios.post(url, data, { timeout: 10_000 }));
  }

  async submitAvatar(params: { mediaUrl: string; openid: string }) {
    try {
      const accessToken = await this.dependencies.getAccessToken();
      const response = await this.post(
        `https://api.weixin.qq.com/wxa/media_check_async?access_token=${encodeURIComponent(accessToken)}`,
        {
          media_url: params.mediaUrl,
          media_type: 2,
          version: 2,
          scene: 1,
          openid: params.openid,
        },
      );
      const data = response.data || {};
      if (data.errcode !== 0 || !data.trace_id) throw new Error('wechat rejected media review');
      return { traceId: data.trace_id };
    } catch {
      throw new HttpError(503, '头像安全检测暂不可用，请稍后重试');
    }
  }
}
