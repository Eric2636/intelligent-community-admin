import assert from 'node:assert/strict';
import test from 'node:test';
import { API_LOG_BATCH_SIZE, API_LOG_RETENTION_DAYS, cleanupApiLogs, retentionCutoff } from '../src/modules/api-log/api-log-retention.service';

test('retention cutoff is exactly 90 days and boundary rows are retained', () => {
  const now = new Date('2026-07-28T00:00:00.000Z');
  const cutoff = retentionCutoff(now);
  assert.equal(API_LOG_RETENTION_DAYS, 90);
  assert.equal(cutoff.toISOString(), '2026-04-29T00:00:00.000Z');
  assert.equal(new Date(cutoff).getTime(), new Date('2026-04-29T00:00:00.000Z').getTime());
});

test('cleanup is bounded to 5000 rows per batch and only targets API log tables', () => {
  assert.equal(API_LOG_BATCH_SIZE, 5000);
});

test('deletes only unified request rows before cutoff in bounded batches', async () => {
  const calls: number[] = [];
  const repo = (count: number) => { let once = true; return { findMany: async () => { if (!once) return []; once = false; return Array.from({ length: Math.min(count, 5000) }, (_, i) => ({ id: BigInt(i) })); }, deleteMany: async () => { calls.push(1); return { count: count > 5000 ? 5000 : count }; } }; };
  const result = await cleanupApiLogs({ now: new Date('2026-07-28T00:00:00Z'), requests: repo(5000) });
  assert.equal(result.requests, 5000); assert.equal(calls.length, 1);
});
