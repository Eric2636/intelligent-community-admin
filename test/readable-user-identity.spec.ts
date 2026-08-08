import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiLogService } from '../src/modules/api-log/api-log.service';
import { ClientLogService } from '../src/modules/client-log/client-log.service';

test('mini program exception logs resolve stored user IDs to user names', async () => {
  const db = {
    miniProgramApiErrorLog: {
      count: async () => 1,
      findMany: async () => [{
        id: 'error-1', userId: 'user-1', createdAt: new Date('2026-08-08T00:00:00Z'), method: 'GET', path: '/api/tasks',
      }],
    },
    user: {
      findMany: async () => [{ id: 'user-1', name: '江南', phoneNumber: null }],
    },
  } as any;

  const result = await new ClientLogService(db).listMiniApiErrorLogs({ page: 1, pageSize: 20 });

  assert.equal(result.list[0].userName, '江南');
});

test('API monitor accepts readable actor keywords while retaining internal ID matching', async () => {
  let requestWhere: any;
  const db = {
    apiRequestLog: {
      count: async ({ where }: { where: unknown }) => { requestWhere = where; return 0; },
      findMany: async () => [],
    },
    user: {
      findMany: async () => [{ id: 'user-1', name: '江南', phoneNumber: null }],
    },
    adminUser: {
      findMany: async () => [{ id: 'admin-1', username: 'community-admin' }],
    },
  } as any;

  await new ApiLogService(db).listAccess({ page: 1, pageSize: 20, actorKeyword: '江南' } as any);

  assert.deepEqual(requestWhere.OR, [
    { userId: { in: ['user-1'] } },
    { adminId: { in: ['admin-1'] } },
  ]);
});
