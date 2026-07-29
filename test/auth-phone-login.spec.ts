import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPhoneUserName, resolvePhoneLoginBindingAction } from '../src/modules/auth/auth.service';

test('resolvePhoneLoginBindingAction migrates a verified phone from old openid to current openid', () => {
  assert.equal(
    resolvePhoneLoginBindingAction({ id: 'old-user', openid: 'old-openid' }, 'new-openid'),
    'migrate-bound-user',
  );
});

test('resolvePhoneLoginBindingAction upserts when phone is not bound', () => {
  assert.equal(resolvePhoneLoginBindingAction(null, 'new-openid'), 'upsert-current-openid');
});

test('resolvePhoneLoginBindingAction upserts when phone is already bound to current openid', () => {
  assert.equal(
    resolvePhoneLoginBindingAction({ id: 'same-user', openid: 'new-openid' }, 'new-openid'),
    'upsert-current-openid',
  );
});

test('defaultPhoneUserName uses the final four digits of a verified phone number', () => {
  assert.equal(defaultPhoneUserName('13800123456'), '用户3456');
});
