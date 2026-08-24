import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migrationPath = new URL('../prisma/migrations/20260824090000_rename_legacy_tables/migration.sql', import.meta.url);
const profileSync = readFileSync(new URL('../src/modules/user/user-profile-sync.ts', import.meta.url), 'utf8');
const mallCategoryService = readFileSync(new URL('../src/modules/mall/mall-category.service.ts', import.meta.url), 'utf8');

const mappedModels = [
  ['User', 'users'],
  ['AdminUser', 'admin_users'],
  ['Task', 'tasks'],
  ['AppSettingTab', 'app_setting_tabs'],
] as const;

test('legacy Prisma models use explicit snake_case plural table mappings', () => {
  for (const [modelName, tableName] of mappedModels) {
    const model = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
    assert.match(model, new RegExp(`@@map\\(\\"${tableName}\\"\\)`));
  }
});

test('table naming migration atomically renames all legacy physical tables', () => {
  assert.ok(existsSync(migrationPath), 'table naming migration must exist');
  const migration = readFileSync(migrationPath, 'utf8');
  assert.match(
    migration,
    /RENAME TABLE\s+`User` TO `users`,\s+`AdminUser` TO `admin_users`,\s+`Task` TO `tasks`,\s+`AppSettingTab` TO `app_setting_tabs`;/s,
  );
});

test('runtime raw SQL uses physical table names', () => {
  assert.match(profileSync, /FROM \\`users\\` WHERE \\`id\\`/);
  assert.match(mallCategoryService, /FROM mall_items WHERE categoryId/);
  assert.doesNotMatch(profileSync, /FROM \\`User\\`/);
  assert.doesNotMatch(mallCategoryService, /FROM MallItem/);
});
