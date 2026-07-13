import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminContentAttributionForMiniPost,
  adminContentAttributionForMiniPublisher,
  adminDisplayLabelForContent,
  DEFAULT_SUPER_ADMIN_ORG_NAME,
} from '../src/modules/admin/admin.service';

test('super admin content label is platform administrator', () => {
  assert.equal(DEFAULT_SUPER_ADMIN_ORG_NAME, '平台管理员');
  assert.equal(
    adminDisplayLabelForContent({ role: 'SUPERADMIN', orgName: '平台' }),
    '平台管理员',
  );
});

test('third party admin content label uses organization name', () => {
  assert.equal(
    adminDisplayLabelForContent({ role: 'ADMIN', orgName: '物业服务中心' }),
    '物业服务中心',
  );
});

test('mini post attribution uses bound admin organization label', () => {
  assert.deepEqual(
    adminContentAttributionForMiniPost({
      id: 'admin-1',
      role: 'ADMIN',
      orgName: '物业服务中心',
    }),
    {
      adminLabel: '物业服务中心',
      createdByAdminId: 'admin-1',
    },
  );
});

test('mini post attribution uses platform label for bound super admin', () => {
  assert.deepEqual(
    adminContentAttributionForMiniPost({
      id: 'admin-2',
      role: 'SUPERADMIN',
      orgName: '平台',
    }),
    {
      adminLabel: '平台管理员',
      createdByAdminId: 'admin-2',
    },
  );
});

test('mini post attribution is empty when no enabled admin is bound', () => {
  assert.deepEqual(adminContentAttributionForMiniPost(null), {});
});

test('mini publisher attribution is shared by forum posts and owner tasks', () => {
  assert.deepEqual(
    adminContentAttributionForMiniPublisher({
      id: 'admin-3',
      role: 'ADMIN',
      orgName: '社区运营中心',
    }),
    {
      adminLabel: '社区运营中心',
      createdByAdminId: 'admin-3',
    },
  );
});
