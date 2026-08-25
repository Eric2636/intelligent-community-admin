import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDisposableLocalDatabaseUrl,
  businessTablesForCleanup,
} from './support/local-test-database';

test('local test database guard accepts only 127.0.0.1:3308/ic_local', () => {
  assert.doesNotThrow(() =>
    assertDisposableLocalDatabaseUrl('mysql://user:pass@127.0.0.1:3308/ic_local?charset=utf8mb4'),
  );
  assert.doesNotThrow(() =>
    assertDisposableLocalDatabaseUrl('mysql://user:pass@localhost:3308/ic_local'),
  );

  for (const url of [
    'mysql://user:pass@124.222.34.110:3308/ic_local',
    'mysql://user:pass@127.0.0.1:3306/ic_local',
    'mysql://user:pass@127.0.0.1:3308/ic_test',
  ]) {
    assert.throws(() => assertDisposableLocalDatabaseUrl(url), /拒绝清理非本地测试数据库/);
  }
});

test('cleanup keeps Prisma migration history and returns only business tables', () => {
  assert.deepEqual(
    businessTablesForCleanup(['users', '_prisma_migrations', 'forum_posts']),
    ['forum_posts', 'users'],
  );
});
