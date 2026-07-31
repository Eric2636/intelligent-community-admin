import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationName = '20260731191000_add_avatar_reviews';

test('Prisma schema defines persisted avatar review state', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const model = schema.match(/model AvatarReview \{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(model, /id\s+String\s+@id\s+@default\(cuid\(\)\)/);
  assert.match(model, /userId\s+String/);
  assert.match(model, /mediaUrl\s+String\s+@db\.Text/);
  assert.match(model, /traceId\s+String\?\s+@unique/);
  assert.match(model, /status\s+String\s+@db\.VarChar\(24\)/);
  assert.match(model, /@@index\(\[userId, createdAt\]\)/);
  assert.match(model, /@@index\(\[userId, status, createdAt\]\)/);
  assert.match(model, /@@map\("avatar_reviews"\)/);
});

test('avatar review migration creates matching MySQL table and indexes', async () => {
  const migration = await readFile(
    new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url),
    'utf8',
  );

  assert.match(migration, /CREATE TABLE `avatar_reviews`/);
  assert.match(migration, /`traceId` VARCHAR\(191\) NULL/);
  assert.match(migration, /UNIQUE INDEX `avatar_reviews_traceId_key`\(`traceId`\)/);
  assert.match(migration, /INDEX `avatar_reviews_userId_createdAt_idx`\(`userId`, `createdAt`\)/);
  assert.match(
    migration,
    /INDEX `avatar_reviews_userId_status_createdAt_idx`\(`userId`, `status`, `createdAt`\)/,
  );
});
