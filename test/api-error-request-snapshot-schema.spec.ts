import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const schemaUrl = new URL('../prisma/schema.prisma', import.meta.url);
const migrationUrl = new URL('../prisma/migrations/20260729090000_unify_api_request_logs/migration.sql', import.meta.url);

test('ApiRequestLog stores and migrates an optional sanitized request snapshot', async () => {
  const [schema, migration] = await Promise.all([
    readFile(schemaUrl, 'utf8'),
    readFile(migrationUrl, 'utf8'),
  ]);

  assert.match(schema, /model ApiRequestLog[\s\S]*?requestSnapshot\s+Json\?/);
  assert.match(migration, /`requestSnapshot` JSON NULL/);
  assert.match(migration, /SELECT[\s\S]*?`requestSnapshot`[\s\S]*?FROM `api_error_logs`/);
});
