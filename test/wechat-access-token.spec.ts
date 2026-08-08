import assert from 'node:assert/strict';
import test from 'node:test';
import { WechatAccessTokenService } from '../src/modules/wechat/wechat-access-token';

test('uses WeChat stable token API so independent API processes do not invalidate each other', async (t) => {
  const previousAppId = process.env.WX_APPID;
  const previousSecret = process.env.WX_APPSECRET;
  process.env.WX_APPID = 'test-appid';
  process.env.WX_APPSECRET = 'test-secret';
  t.after(() => {
    if (previousAppId === undefined) delete process.env.WX_APPID;
    else process.env.WX_APPID = previousAppId;
    if (previousSecret === undefined) delete process.env.WX_APPSECRET;
    else process.env.WX_APPSECRET = previousSecret;
  });

  const calls: Array<{ url: string; body: unknown }> = [];
  const service = new WechatAccessTokenService({
    post: async (url, body) => {
      calls.push({ url, body });
      return { data: { access_token: 'stable-token', expires_in: 7200 } };
    },
  });

  assert.equal(await service.getAccessToken(), 'stable-token');
  assert.equal(await service.getAccessToken(), 'stable-token');
  assert.deepEqual(calls, [
    {
      url: 'https://api.weixin.qq.com/cgi-bin/stable_token',
      body: {
        grant_type: 'client_credential',
        appid: 'test-appid',
        secret: 'test-secret',
        force_refresh: false,
      },
    },
  ]);
});
