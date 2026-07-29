import assert from 'node:assert/strict';
import test from 'node:test';
import { redactPath, safeErrorSummary, safeRequestSnapshot } from '../src/modules/api-log/api-log-redaction';

test('redacts sensitive query parameters and masks phone numbers', () => {
  assert.equal(redactPath('/api/x?phone=13800138000&token=abc'), '/api/x?phone=138****8000&token=%5BREDACTED%5D');
  assert.equal(redactPath('/api/x?foo=bar'), '/api/x?foo=bar');
});

test('error summaries never expose credentials or stack details', () => {
  const summary = safeErrorSummary(new Error('password=secret token=abc Bearer xyz failed'));
  assert.doesNotMatch(summary, /secret|token=abc|Bearer xyz/);
  assert.match(summary, /REDACTED/);
});

test('request snapshots redact secrets, omit media and bound nested values', () => {
  const snapshot = safeRequestSnapshot({
    params: { id: 'post-1' },
    query: { phone: '13800138000', token: 'secret' },
    body: {
      password: 'pass',
      title: '正常标题',
      images: ['data:image/png;base64,abc'],
      nested: { openid: 'openid-value' },
    },
  });

  assert.deepEqual(snapshot, {
    params: { id: 'post-1' },
    query: { phone: '138****8000', token: '[REDACTED]' },
    body: {
      password: '[REDACTED]',
      title: '正常标题',
      images: ['[OMITTED]'],
      nested: { openid: '[REDACTED]' },
    },
  });
});
