import axios from 'axios';
import { HttpError } from '../../http-error';

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type GetToken = (url: string, options: object) => Promise<{ data?: TokenResponse }>;

export class WechatAccessTokenService {
  private cachedToken = '';
  private expiresAt = 0;

  constructor(private readonly get: GetToken = axios.get) {}

  async getAccessToken() {
    const now = Date.now();
    if (this.cachedToken && this.expiresAt - now > 60_000) return this.cachedToken;
    const appid = process.env.WX_APPID;
    const secret = process.env.WX_APPSECRET;
    if (!appid || !secret) throw new HttpError(503, '微信服务配置不完整');
    const response = await this.get('https://api.weixin.qq.com/cgi-bin/token', {
      params: { grant_type: 'client_credential', appid, secret },
      timeout: 10_000,
    });
    const data = response.data || {};
    if (!data.access_token) throw new HttpError(503, data.errmsg || '微信 access_token 获取失败');
    this.cachedToken = data.access_token;
    this.expiresAt = now + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000;
    return this.cachedToken;
  }
}

export const wechatAccessTokenService = new WechatAccessTokenService();
