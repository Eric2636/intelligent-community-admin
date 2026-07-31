import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());

test('unified request log schema keeps request identity, full URL and optional error diagnostics', async () => {
  const schema = await readFile(path.join(root, 'prisma/schema.prisma'), 'utf8');
  const model = /model ApiRequestLog \{([\s\S]*?)\n\}/.exec(schema)?.[1] || '';

  for (const field of [
    'requestId',
    'endpointId',
    'source',
    'method',
    'routePattern',
    'requestUrl',
    'ip',
    'userId',
    'adminId',
    'httpStatus',
    'businessCode',
    'durationMs',
    'errorCode',
    'errorSummary',
    'requestSnapshot',
    'createdAt',
  ]) {
    assert.match(model, new RegExp(`\\b${field}\\b`));
  }

  assert.match(model, /requestUrl\s+String\?/);
  assert.match(model, /errorSummary\s+String\?/);
  assert.match(model, /requestSnapshot\s+Json\?/);
  assert.match(model, /@@index\(\[requestId\]\)/);
  assert.match(model, /@@map\("api_request_logs"\)/);
});

test('unification migration copies legacy rows before removing legacy request log tables', async () => {
  const migration = await readFile(
    path.join(root, 'prisma/migrations/20260729090000_unify_api_request_logs/migration.sql'),
    'utf8',
  );

  assert.match(migration, /CREATE TABLE `api_request_logs`/);
  assert.match(migration, /INSERT INTO `api_request_logs`[\s\S]*?FROM `api_access_logs`/);
  assert.match(migration, /INSERT INTO `api_request_logs`[\s\S]*?FROM `api_error_logs`/);
  assert.match(migration, /DROP TABLE `api_access_logs`/);
  assert.match(migration, /DROP TABLE `api_error_logs`/);
});
