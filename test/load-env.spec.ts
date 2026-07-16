import assert from 'node:assert/strict';
import test from 'node:test';
import { baseEnvFileForAppEnv, normalizeAppEnv } from '../src/load-env';

test('normalizeAppEnv supports local, test, and production profiles', () => {
  assert.equal(normalizeAppEnv('local'), 'local');
  assert.equal(normalizeAppEnv('test'), 'test');
  assert.equal(normalizeAppEnv('production'), 'production');
});

test('baseEnvFileForAppEnv maps test and production to their own env files', () => {
  assert.equal(baseEnvFileForAppEnv('test'), '.env.test');
  assert.equal(baseEnvFileForAppEnv('production'), '.env.production');
});
