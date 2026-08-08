import axios from 'axios';
import { HttpError } from '../../http-error';

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type PostStableToken = (url: string, body: object) => Promise<{ data?: TokenResponse }>;

export class WechatAccessTokenService {
  private cachedToken = '';
  private expiresAt = 0;

  constructor(private readonly dependencies: { post?: PostStableToken } = {}) {}

  async getAccessToken() {
    const now = Date.now();
    if (this.cachedToken && this.expiresAt - now > 60_000) return this.cachedToken;
    const appid = process.env.WX_APPID;
    const secret = process.env.WX_APPSECRET;
    if (!appid || !secret) throw new HttpError(503, '微信服务配置不完整');
    const post = this.dependencies.post ?? ((url, body) => axios.post(url, body, { timeout: 10_000 }));
    const response = await post('https://api.weixin.qq.com/cgi-bin/stable_token', {
      grant_type: 'client_credential',
      appid,
      secret,
      force_refresh: false,
    });
    const data = response.data || {};
    if (!data.access_token) throw new HttpError(503, data.errmsg || '微信 access_token 获取失败');
    this.cachedToken = data.access_token;
    this.expiresAt = now + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000;
    return this.cachedToken;
  }
}

export const wechatAccessTokenService = new WechatAccessTokenService();
