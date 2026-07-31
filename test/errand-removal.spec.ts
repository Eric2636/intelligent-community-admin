import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

const source = (relativePath: string) => readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');

test('API routes and Prisma schema no longer expose the removed errand module', async () => {
  const [schema, routes, adminRoutes, adminService, uploadDto, uploadService, settings, cache, openapi] =
    await Promise.all([
      source('prisma/schema.prisma'),
      source('src/routes/index.ts'),
      source('src/routes/admin.routes.ts'),
      source('src/modules/admin/admin.service.ts'),
      source('src/modules/upload/upload.dto.ts'),
      source('src/modules/upload/upload.service.ts'),
      source('src/modules/settings/settings.service.ts'),
      source('src/lib/redis-cache.ts'),
      source('src/swagger/openapi.ts'),
    ]);

  const businessSources = [
    schema,
    routes,
    adminRoutes,
    adminService,
    uploadDto,
    uploadService,
    settings,
    cache,
    openapi,
  ].join('\n');
  assert.doesNotMatch(businessSources, /errand|跑腿/i);
  for (const moduleName of ['forum', 'task', 'mall', 'avatar']) {
    assert.match(uploadDto, new RegExp(`['"]${moduleName}['"]`));
    assert.match(uploadService, new RegExp(`['"]${moduleName}['"]`));
  }
});

test('removed API implementation files are absent', async () => {
  await assert.rejects(access(new URL('../src/modules/errand', import.meta.url)));
});

test('admin web no longer exposes errand content or upload types', async () => {
  const adminWebRoot = new URL('../../intelligent-community-admin-web/', import.meta.url);
  const files = ['src/router/index.ts', 'src/types/api.ts', 'src/api/admin.ts', 'src/views/ContentView.vue'];
  const sources = await Promise.all(files.map((file) => readFile(new URL(file, adminWebRoot), 'utf8')));
  assert.doesNotMatch(sources.join('\n'), /errand|跑腿/i);
  for (const moduleName of ['forum', 'task', 'mall', 'avatar']) {
    assert.match(sources[2]!, new RegExp(`['"]${moduleName}['"]`));
  }
});

test('drop migration removes only the four errand tables in foreign-key order', async () => {
  const [schema, migration] = await Promise.all([
    source('prisma/schema.prisma'),
    source('prisma/migrations/20260726100000_remove_errand_module/migration.sql'),
  ]);
  assert.match(schema, /datasource db\s*\{[\s\S]*?provider\s*=\s*"mysql"/);
  assert.match(schema, /model AppSettingTab\s*\{[\s\S]*?\n\s*key\s+String\s+@unique/);

  const deleteStatements = migration
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^DELETE FROM /i.test(line));
  const dropStatements = migration
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^DROP TABLE /i.test(line));

  assert.deepEqual(deleteStatements, ["DELETE FROM `AppSettingTab` WHERE `key` = 'errand';"]);
  assert.ok(migration.indexOf(deleteStatements[0]!) < migration.indexOf(dropStatements[0]!));
  assert.deepEqual(dropStatements, [
    'DROP TABLE `ErrandFavorite`;',
    'DROP TABLE `ErrandLike`;',
    'DROP TABLE `ErrandReply`;',
    'DROP TABLE `Errand`;',
  ]);
});
