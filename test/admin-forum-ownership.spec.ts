import assert from 'node:assert/strict';
import test from 'node:test';
import { canAdminModifyContent, assertAdminCanModifyBatch, isAdminForumAuthor } from '../src/modules/admin/admin-content-ownership';

const normal = { role: 'ADMIN' as const, adminId: 'admin-a', boundUserId: 'user-b' };

test('real mini-program authorship always follows the current binding even with historical createdByAdminId', () => {
  const row = { ownerUserId: 'user-b', createdByAdminId: 'admin-a' };
  assert.equal(canAdminModifyContent({ ...normal, adminId: 'admin-b', type: 'posts', ...row }), true);
  assert.equal(canAdminModifyContent({ ...normal, adminId: 'admin-a', boundUserId: 'user-a', type: 'posts', ...row }), false);
});

test('virtual backend forum authorship follows creator while super admin can always modify', () => {
  for (const ownerUserId of ['__admin_forum__', '__admin_announcement__']) {
    assert.equal(isAdminForumAuthor(ownerUserId), true);
    const row = { type: 'posts' as const, ownerUserId, createdByAdminId: 'admin-a' };
    assert.equal(canAdminModifyContent({ ...normal, boundUserId: '', ...row }), true);
    assert.equal(canAdminModifyContent({ ...normal, adminId: 'admin-b', ...row }), false);
    assert.equal(canAdminModifyContent({ role: 'SUPERADMIN', adminId: 'root', boundUserId: '', ...row }), true);
  }
});

test('post batch permissions accept own virtual posts without binding and atomically reject mixed ownership', () => {
  const own = { ownerUserId: '__admin_forum__', createdByAdminId: 'admin-a' };
  const historicalOwn = { ownerUserId: '__admin_announcement__', createdByAdminId: 'admin-a' };
  assert.doesNotThrow(() => assertAdminCanModifyBatch({ ...normal, boundUserId: '', type: 'posts', rows: [own, historicalOwn] }));
  assert.throws(
    () => assertAdminCanModifyBatch({ ...normal, boundUserId: '', type: 'posts', rows: [own, historicalOwn, { ...historicalOwn, createdByAdminId: 'admin-b' }] }),
    /批量操作中包含非本人发布的内容/,
  );
});

test('item and task batch permissions continue to require the current bound publisher', () => {
  for (const type of ['items', 'tasks'] as const) {
    assert.doesNotThrow(() => assertAdminCanModifyBatch({ ...normal, type, rows: [{ ownerUserId: 'user-b', createdByAdminId: 'admin-a' }] }));
    assert.throws(() => assertAdminCanModifyBatch({ ...normal, type, rows: [{ ownerUserId: 'user-a', createdByAdminId: 'admin-a' }] }), /批量操作中包含非本人发布的内容/);
  }
});
