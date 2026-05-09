import axios from 'axios';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import type { WechatLoginDto } from './auth.dto';

type JsCode2SessionResponse = {
  openid?: string;
  session_key?: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
};

export class AuthService {
  async wechatLogin(dto: WechatLoginDto) {
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
          js_code: dto.code,
          grant_type: 'authorization_code',
        },
        timeout: 10_000,
      },
    );

    const data = r.data || {};
    if (!data.openid) {
      throw new HttpError(
        401,
        data.errmsg ? `微信登录失败：${data.errmsg}` : '微信登录失败',
      );
    }

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

    const expiresIn = process.env.JWT_EXPIRES_IN ?? '7d';
    const secretKey = process.env.JWT_SECRET;
    if (!secretKey) {
      throw new HttpError(500, '后端未配置 JWT_SECRET');
    }

    const signOpts: SignOptions = { expiresIn: expiresIn as SignOptions['expiresIn'] };
    const token = jwt.sign({ sub: user.id, openid: user.openid }, secretKey, signOpts);

    return {
      token,
      expiresIn,
      user,
    };
  }
}
