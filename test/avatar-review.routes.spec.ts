import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRouter } from '../src/routes';

test('router exposes signed WeChat callback and owner review status endpoints', () => {
  const routes = createRouter().stack.map((layer) => ({ path: layer.path, methods: layer.methods }));
  assert.ok(routes.some((route) => route.path === '/api/wechat/content-security/callback' && route.methods.includes('GET')));
  assert.ok(routes.some((route) => route.path === '/api/wechat/content-security/callback' && route.methods.includes('POST')));
  assert.ok(routes.some((route) => route.path === '/api/user/avatar-reviews/:reviewId' && route.methods.includes('GET')));
});

test('avatar upload submits the public URL with the authenticated user and openid', async () => {
  const source = await readFile(new URL('../src/routes/index.ts', import.meta.url), 'utf8');
  assert.match(source, /form\.fields\.module !== 'avatar'/);
  assert.match(source, /avatarReviewService\.submit\(\{[\s\S]*?userId,[\s\S]*?openid: ctx\.state\.user!\.openid,[\s\S]*?mediaUrl: uploaded\.url/);
  assert.match(source, /ctx\.body = \{ \.\.\.uploaded, avatarReview \}/);
});

test('callback returns a retryable error when its trace id is not persisted yet', async () => {
  const source = await readFile(new URL('../src/routes/index.ts', import.meta.url), 'utf8');
  assert.match(source, /const handled = await avatarReviewService\.handleResult\(result\)/);
  assert.match(source, /if \(!handled\.handled\) throw new HttpError\(503/);
});
