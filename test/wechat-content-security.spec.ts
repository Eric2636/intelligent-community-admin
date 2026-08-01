import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/http-error';
import { WechatContentSecurityClient } from '../src/modules/wechat/wechat-content-security';
import {
  parseWechatMediaCheckResult,
  validateWechatCallbackConfiguration,
  verifyWechatCallbackSignature,
} from '../src/modules/avatar-review/wechat-callback';
import { UpdateMeDto } from '../src/modules/user/user.dto';
import { editableProfileSnapshotChanges } from '../src/modules/user/user.service';
import { parseDto } from '../src/validate';

test('mediaCheckAsync submits the required avatar scene payload', async () => {
  const calls: Array<{ url: string; data: unknown }> = [];
  const client = new WechatContentSecurityClient({
    getAccessToken: async () => 'token-value',
    post: async (url, data) => {
      calls.push({ url, data });
      return { data: { errcode: 0, errmsg: 'ok', trace_id: 'trace-1' } };
    },
  });

  const result = await client.submitAvatar({
    mediaUrl: 'https://cdn.example.com/avatar.jpg',
    openid: 'openid-1',
  });

  assert.equal(result.traceId, 'trace-1');
  assert.deepEqual(calls, [
    {
      url: 'https://api.weixin.qq.com/wxa/media_check_async?access_token=token-value',
      data: {
        media_url: 'https://cdn.example.com/avatar.jpg',
        media_type: 2,
        version: 2,
        scene: 1,
        openid: 'openid-1',
      },
    },
  ]);
});

test('mediaCheckAsync fails closed on WeChat errors and missing trace ids', async () => {
  for (const data of [
    { errcode: 45009, errmsg: 'quota exceeded' },
    { errcode: 0, errmsg: 'ok' },
  ]) {
    const client = new WechatContentSecurityClient({
      getAccessToken: async () => 'token-value',
      post: async () => ({ data }),
    });

    await assert.rejects(
      () => client.submitAvatar({ mediaUrl: 'https://cdn.example.com/a.jpg', openid: 'o-1' }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 503 &&
        error.message === '头像安全检测暂不可用，请稍后重试',
    );
  }
});

test('callback signature accepts only the configured token tuple', () => {
  assert.equal(
    verifyWechatCallbackSignature({
      token: 'avatar-token',
      timestamp: '1722411000',
      nonce: 'nonce-1',
      signature: 'be420744608d52fc4be46cc1bf49b081cf2c27b7',
    }),
    true,
  );
  assert.equal(
    verifyWechatCallbackSignature({
      token: 'wrong-token',
      timestamp: '1722411000',
      nonce: 'nonce-1',
      signature: 'be420744608d52fc4be46cc1bf49b081cf2c27b7',
    }),
    false,
  );
});

test('callback payload accepts only the configured app and extracts review outcome', () => {
  assert.deepEqual(
    parseWechatMediaCheckResult(
      {
        appid: 'wx-app',
        trace_id: 'trace-1',
        errcode: 0,
        result: { suggest: 'pass', label: 100 },
      },
      'wx-app',
    ),
    { traceId: 'trace-1', errcode: 0, suggest: 'pass', label: 100 },
  );
  assert.throws(
    () =>
      parseWechatMediaCheckResult(
        { appid: 'other-app', trace_id: 'trace-1', errcode: 0, result: { suggest: 'pass' } },
        'wx-app',
      ),
    /回调来源无效/,
  );
});

test('ordinary profile update accepts legacy avatar payloads but ignores them', async () => {
  const dto = await parseDto(UpdateMeDto, {
    name: '新名字',
    avatar: 'https://cdn.example.com/unreviewed.jpg',
  });
  assert.deepEqual(editableProfileSnapshotChanges(dto), { name: '新名字' });
});

test('production refuses to start without a callback verification token', () => {
  assert.throws(() => validateWechatCallbackConfiguration('production', ''), /WX_MESSAGE_TOKEN/);
  assert.doesNotThrow(() => validateWechatCallbackConfiguration('production', 'random-secret-token'));
  assert.doesNotThrow(() => validateWechatCallbackConfiguration('development', ''));
  assert.doesNotThrow(() => validateWechatCallbackConfiguration('test', '', 'production'));
  assert.throws(
    () => validateWechatCallbackConfiguration(undefined, '', 'production'),
    /WX_MESSAGE_TOKEN/,
  );
});
