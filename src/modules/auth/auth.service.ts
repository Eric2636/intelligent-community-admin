import axios from 'axios';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import type { WechatLoginDto, WechatPhoneLoginDto } from './auth.dto';

type JsCode2SessionResponse = {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

type WechatSession = JsCode2SessionResponse & {
  openid: string;
};

type WechatAccessTokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type WechatPhoneNumberResponse = {
  errcode?: number;
  errmsg?: string;
  phone_info?: {
    phoneNumber?: string;
    purePhoneNumber?: string;
    countryCode?: string;
  };
};

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;

function maskCode(code: string) {
  const v = String(code || '');
  if (v.length <= 8) return { len: v.length, head: v.slice(0, 2), tail: v.slice(-2) };
  return { len: v.length, head: v.slice(0, 4), tail: v.slice(-4) };
}

type PhoneBindingUser = { id: string; openid: string } | null;
type PhoneLoginBindingAction = 'upsert-current-openid' | 'migrate-bound-user';

export function resolvePhoneLoginBindingAction(
  bound: PhoneBindingUser,
  currentOpenid: string,
): PhoneLoginBindingAction {
  if (bound && bound.openid !== currentOpenid) return 'migrate-bound-user';
  return 'upsert-current-openid';
}

export class AuthService {
  private async code2Session(code: string): Promise<WechatSession> {
    const appid = process.env.WX_APPID;
    const secret = process.env.WX_APPSECRET;
    if (!appid || !secret) {
      throw new HttpError(401, '后端未配置 WX_APPID/WX_APPSECRET');
    }

    const r = await axios.get<JsCode2SessionResponse>(
      'https://api.weixin.qq.com/sns/jscode2session',
      {
        params: {
          appid,
          secret,
          js_code: code,
          grant_type: 'authorization_code',
        },
        timeout: 10_000,
      },
    );

    const data = r.data || {};
    if (!data.openid) {
      console.warn('[wechat.code2Session.fail]', {
        appid,
        code: maskCode(code),
        errcode: data.errcode,
        errmsg: data.errmsg,
      });
      throw new HttpError(
        401,
        data.errmsg ? `微信登录失败：${data.errmsg}` : '微信登录失败',
      );
    }
    console.info('[wechat.code2Session.ok]', { appid, code: maskCode(code) });
    return { ...data, openid: data.openid };
  }

  private async getWechatAccessToken() {
    const now = Date.now();
    if (cachedAccessToken && cachedAccessTokenExpiresAt - now > 60_000) return cachedAccessToken;

    const appid = process.env.WX_APPID;
    const secret = process.env.WX_APPSECRET;
    if (!appid || !secret) {
      throw new HttpError(401, '后端未配置 WX_APPID/WX_APPSECRET');
    }

    const r = await axios.get<WechatAccessTokenResponse>(
      'https://api.weixin.qq.com/cgi-bin/token',
      {
        params: {
          grant_type: 'client_credential',
          appid,
          secret,
        },
        timeout: 10_000,
      },
    );
    const data = r.data || {};
    if (!data.access_token) {
      throw new HttpError(401, data.errmsg ? `微信 access_token 获取失败：${data.errmsg}` : '微信 access_token 获取失败');
    }

    cachedAccessToken = data.access_token;
    cachedAccessTokenExpiresAt = now + Math.max(60, Number(data.expires_in || 7200) - 120) * 1000;
    return cachedAccessToken;
  }

  private signToken(user: { id: string; openid: string }) {
    const expiresIn = process.env.JWT_EXPIRES_IN ?? '7d';
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) {
      throw new HttpError(500, '后端未配置 JWT_SECRET');
    }

    const signOpts: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };
    return {
      token: jwt.sign({ sub: user.id, openid: user.openid }, secretKey, signOpts),
      expiresIn,
    };
  }

  async wechatLogin(dto: WechatLoginDto) {
    const data = await this.code2Session(dto.code);

    const nickName = dto.nickName ? String(dto.nickName).trim() : '';
    const avatarUrl = dto.avatarUrl ? String(dto.avatarUrl).trim() : '';
    const profileData = {
      ...(nickName ? { name: nickName } : {}),
      ...(avatarUrl ? { avatar: avatarUrl } : {}),
      ...(dto.gender !== undefined ? { gender: dto.gender } : {}),
    };

    const user = await prisma.user.upsert({
      where: { openid: data.openid },
      update: profileData,
      create: {
        openid: data.openid,
        name: nickName || `用户${Math.floor(Math.random() * 10000)}`,
        avatar: avatarUrl || undefined,
        gender: dto.gender ?? 2,
      },
      select: {
        id: true,
        openid: true,
        phoneNumber: true,
        name: true,
        avatar: true,
        gender: true,
        birth: true,
        address: true,
        photos: true,
        brief: true,
        enabled: true,
        disabledAt: true,
        disabledReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const { token, expiresIn } = this.signToken(user);

    return {
      token,
      expiresIn,
      user,
    };
  }

  async wechatPhoneLogin(dto: WechatPhoneLoginDto) {
    console.info('[wechat.phoneLogin.start]', {
      loginCode: maskCode(dto.code),
      phoneCode: maskCode(dto.phoneCode),
    });
    const session = await this.code2Session(dto.code);
    const accessToken = await this.getWechatAccessToken();
    const r = await axios.post<WechatPhoneNumberResponse>(
      `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${encodeURIComponent(accessToken)}`,
      { code: dto.phoneCode },
      { timeout: 10_000 },
    );

    const phoneInfo = r.data?.phone_info;
    const phoneNumber = String(phoneInfo?.phoneNumber || phoneInfo?.purePhoneNumber || '').trim();
    if (!phoneNumber) {
      throw new HttpError(401, r.data?.errmsg ? `手机号验证失败：${r.data.errmsg}` : '手机号验证失败');
    }

    const bound = await prisma.user.findUnique({
      where: { phoneNumber },
      select: { id: true, openid: true },
    });
    const userSelect = {
      id: true,
      openid: true,
      phoneNumber: true,
      name: true,
      avatar: true,
      gender: true,
      birth: true,
      address: true,
      photos: true,
      brief: true,
      enabled: true,
      disabledAt: true,
      disabledReason: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    const user =
      resolvePhoneLoginBindingAction(bound, session.openid) === 'migrate-bound-user'
        ? await prisma.user.update({
            where: { id: bound!.id },
            data: { openid: session.openid },
            select: userSelect,
          })
        : await prisma.user.upsert({
            where: { openid: session.openid! },
            update: { phoneNumber },
            create: {
              openid: session.openid!,
              phoneNumber,
              name: `用户${phoneNumber.slice(-4)}`,
              gender: 2,
            },
            select: userSelect,
          });

    const { token, expiresIn } = this.signToken(user);
    return {
      token,
      expiresIn,
      user,
    };
  }
}
