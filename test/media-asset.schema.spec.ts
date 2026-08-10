import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

test('media assets persist lifecycle metadata with safe lookup indexes', () => {
  const model = schema.match(/model MediaAsset \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(schema, /enum MediaAssetState \{[\s\S]*PENDING[\s\S]*ATTACHED[\s\S]*DELETE_PENDING[\s\S]*DELETED[\s\S]*DELETE_FAILED/);
  assert.match(schema, /enum MediaAssetType \{[\s\S]*IMG[\s\S]*VID/);
  assert.match(model, /^\s*objectKey\s+String\s+@unique\s+@db\.VarChar\(512\)/m);
  assert.match(model, /^\s*url\s+String\s+@db\.Text/m);
  assert.match(model, /^\s*uploaderId\s+String/m);
  assert.match(model, /^\s*state\s+MediaAssetState\s+@default\(PENDING\)/m);
  assert.match(model, /^\s*deleteAttempts\s+Int\s+@default\(0\)/m);
  assert.match(model, /@@index\(\[state, createdAt\]\)/);
  assert.match(model, /@@index\(\[state, deleteRequestedAt\]\)/);
  assert.match(model, /@@map\("media_assets"\)/);
});
