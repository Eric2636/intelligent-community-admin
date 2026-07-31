import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiLogService, parseApiLogFilters } from '../src/modules/api-log/api-log.service';

test('parses all API log filters and leaves pagination bounded by service', () => {
  const filters = parseApiLogFilters({ ip: '1.2.3.4', endpointId: 'ep', method: 'post', source: 'mini', statusClass: '5xx', startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-02T00:00:00Z', actorId: 'u1', minDurationMs: '10', maxDurationMs: '99', page: '2', pageSize: '1000' });
  assert.deepEqual(filters, { ip: '1.2.3.4', endpointId: 'ep', method: 'post', source: 'mini', statusClass: '5xx', startAt: '2026-01-01T00:00:00Z', endAt: '2026-01-02T00:00:00Z', actorId: 'u1', minDurationMs: 10, maxDurationMs: 99, page: 2, pageSize: 1000, httpStatus: undefined });
});

test('serializes BigInt IDs and exports UTF-8 BOM CSV without sensitive columns', async () => {
  const db = {
    apiEndpoint: { count: async () => 0, findMany: async () => [] },
    apiRequestLog: { count: async () => 1, findMany: async () => [{ id: 12n, requestId: 'request-12', createdAt: new Date('2026-01-01T00:00:00Z'), source: 'MINI', method: 'GET', routePattern: '/api/x', requestUrl: 'https://test.example/api/x?token=%5BREDACTED%5D', ip: '127.0.0.1', userId: 'u1', adminId: null, httpStatus: 200, durationMs: 3 }] },
    adminSystemLog: { create: async () => ({}) },
  } as any;
  const service = new ApiLogService(db);
  const result = await service.listAccess({ page: 1, pageSize: 1000 });
  assert.equal(result.list[0].id, '12');
  const csv = await service.exportAccess({});
  assert.equal(csv.charCodeAt(0), 0xfeff); assert.doesNotMatch(csv, /abc|requestBody|stack/);
});

test('endpoint update writes separate audit entries only for changed fields', async () => {
  const logs: Array<{ action: string; detail: unknown }> = [];
  const db = {
    apiEndpoint: { findUnique: async () => ({ id: 'ep', description: 'old', logEnabled: true, method: 'GET', routePattern: '/api/x' }), update: async ({ data }: { data: { description?: string; logEnabled?: boolean } }) => ({ id: 'ep', description: data.description ?? 'old', logEnabled: data.logEnabled ?? true, method: 'GET', routePattern: '/api/x' }) },
    adminSystemLog: { create: async ({ data }: { data: { action: string; detail: unknown } }) => { logs.push(data); } },
  } as any;
  db.$transaction = async (fn: (tx: typeof db) => Promise<unknown>) => fn(db);
  await new ApiLogService(db).updateEndpoint('ep', { description: 'new', logEnabled: false }, { adminId: 'a', adminUsername: 'root', ip: '127.0.0.1' });
  assert.deepEqual(logs.map((item) => item.action), ['API_ENDPOINT_DESCRIPTION_UPDATE', 'API_ENDPOINT_LOGGING_UPDATE']);
  assert.deepEqual((logs[0].detail as { before: string; after: string }).before, 'old');
  assert.deepEqual((logs[0].detail as { before: string; after: string }).after, 'new');
  assert.deepEqual((logs[1].detail as { before: boolean; after: boolean }).before, true);
  assert.deepEqual((logs[1].detail as { before: boolean; after: boolean }).after, false);
});
