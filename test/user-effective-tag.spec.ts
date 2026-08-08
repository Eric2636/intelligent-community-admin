import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { effectiveUserTag } from '../src/modules/user/user-identity';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../prisma/migrations/20260808170000_remove_user_tag_snapshots/migration.sql', import.meta.url),
  'utf8',
);

test('effective user tag uses the stored default identity when no active admin is bound', () => {
  assert.deepEqual(effectiveUserTag('OWNER'), { label: '业主', type: 'owner' });
  assert.deepEqual(effectiveUserTag('OUTSIDER'), { label: '小区外人员', type: 'outsider' });
});

test('effective user tag uses the active bound admin role instead of a content snapshot', () => {
  assert.deepEqual(effectiveUserTag('OWNER', { role: 'ADMIN', orgName: '居委会', enabled: true }), {
    label: '居委会',
    type: 'admin',
  });
  assert.deepEqual(effectiveUserTag('OUTSIDER', { role: 'SUPERADMIN', orgName: '任意名称', enabled: true }), {
    label: '平台管理员',
    type: 'admin',
  });
});

test('disabled or removed admin binding immediately falls back to the user default identity', () => {
  assert.deepEqual(effectiveUserTag('OWNER', { role: 'ADMIN', orgName: '居委会', enabled: false }), {
    label: '业主',
    type: 'owner',
  });
  assert.deepEqual(effectiveUserTag(null, { role: 'ADMIN', orgName: '居委会', enabled: false }), {
    label: '',
    type: '',
  });
});

test('tag storage remains normalized and removes content tag snapshots', () => {
  const adminModel = schema.match(/model AdminUser \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(adminModel, /@@unique\(\[boundUserId\]\)/);
  for (const column of ['publisherIdentity', 'authorIdentity', 'adminLabel']) {
    assert.doesNotMatch(schema, new RegExp(`^\\s*${column}\\s+`, 'm'));
  }
  for (const column of ['publisherIdentity', 'authorIdentity', 'adminLabel']) {
    assert.match(migration, new RegExp("SET @drop_column_name = '" + column + "';"));
  }
});

test('tag snapshot cleanup migration targets physical MySQL table names and can resume after interruption', () => {
  assert.match(migration, /information_schema\.COLUMNS/);
  assert.match(migration, /PREPARE statement FROM @drop_column_sql/);
  assert.match(migration, /SET @drop_column_table = 'forum_replies';/);
  assert.match(migration, /SET @drop_column_name = 'authorIdentity';/);
  assert.doesNotMatch(migration, /ALTER TABLE `ForumReply`/);
  assert.doesNotMatch(migration, /DROP COLUMN IF EXISTS/);
  for (const column of ['publisherIdentity', 'adminLabel']) {
    assert.match(migration, new RegExp("SET @drop_column_name = '" + column + "';"));
  }
  assert.match(migration, /information_schema\.STATISTICS/);
});
