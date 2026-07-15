import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentIdentityTag,
  identityTypeLabel,
  normalizeIdentityType,
} from '../src/modules/user/user-identity';

test('normalizeIdentityType accepts supported identity values', () => {
  assert.equal(normalizeIdentityType('OWNER'), 'OWNER');
  assert.equal(normalizeIdentityType('OUTSIDER'), 'OUTSIDER');
});

test('normalizeIdentityType rejects unsupported identity values', () => {
  assert.equal(normalizeIdentityType(''), null);
  assert.equal(normalizeIdentityType('tenant'), null);
  assert.equal(normalizeIdentityType(undefined), null);
});

test('identityTypeLabel maps identity values to mini program labels', () => {
  assert.equal(identityTypeLabel('OWNER'), '业主');
  assert.equal(identityTypeLabel('OUTSIDER'), '小区外人员');
  assert.equal(identityTypeLabel(null), '');
});

test('contentIdentityTag prefers admin label over default identity label', () => {
  assert.deepEqual(contentIdentityTag('OWNER', '网站管理员'), {
    label: '网站管理员',
    type: 'admin',
  });
  assert.deepEqual(contentIdentityTag('OWNER', ''), {
    label: '业主',
    type: 'owner',
  });
  assert.deepEqual(contentIdentityTag('OUTSIDER', null), {
    label: '小区外人员',
    type: 'outsider',
  });
  assert.deepEqual(contentIdentityTag(null, null), {
    label: '',
    type: '',
  });
});
