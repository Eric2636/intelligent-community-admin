import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { HttpError } from '../src/http-error';
import { jwtAuth } from '../src/middleware/jwt-auth';
import { TaskService } from '../src/modules/task/task.service';
import { updateAdminTaskContentCas } from '../src/modules/admin/admin.service';
import { createRouter } from '../src/routes';
import { openApiDocument } from '../src/swagger/openapi';

type TaskRow = {
  id: string;
  title: string;
  desc: string;
  images: unknown;
  videos: unknown;
  reward: string | null;
  location: unknown;
  status: string;
  version: number;
  visibility: string;
  pinned: boolean;
  publisherId: string;
  publisherName: string | null;
  publisherAvatar: string | null;
  takerId: string | null;
  takerName: string | null;
  takerAvatar: string | null;
  proofText: string | null;
  proofImages: unknown;
  deletedAt: Date | null;
  createdAt: Date;
  claimedAt: Date | null;
  completedAt: Date | null;
  confirmedAt: Date | null;
};

type NotificationRow = {
  recipientId: string;
  actorId?: string;
  type: string;
  bizType: string;
  bizId?: string;
  title: string;
  content: string;
  dedupeKey: string;
};

type FakeState = {
  tasks: TaskRow[];
  notifications: NotificationRow[];
};

function cloneState(state: FakeState): FakeState {
  return {
    tasks: state.tasks.map((row) => ({
      ...row,
      images: Array.isArray(row.images) ? [...row.images] : row.images,
      videos: Array.isArray(row.videos) ? [...row.videos] : row.videos,
      proofImages: Array.isArray(row.proofImages) ? [...row.proofImages] : row.proofImages,
    })),
    notifications: state.notifications.map((row) => ({ ...row })),
  };
}

function matchesWhere(row: TaskRow, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && 'in' in expected) {
      return (expected as { in: unknown[] }).in.includes(row[key as keyof TaskRow]);
    }
    return row[key as keyof TaskRow] === expected;
  });
}

function applyData(row: TaskRow, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      const increment = Number((value as { increment: number }).increment);
      (row as unknown as Record<string, unknown>)[key] =
        Number(row[key as keyof TaskRow]) + increment;
      continue;
    }
    (row as unknown as Record<string, unknown>)[key] = value;
  }
}

function createFakeDatabase(options: {
  tasks: TaskRow[];
  failNotification?: boolean;
  forceConditionalConflict?: boolean;
}) {
  let committed = cloneState({ tasks: options.tasks, notifications: [] });
  const updateManyCalls: Array<{
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }> = [];
  let notificationUpserts = 0;

  function transactionClient(draft: FakeState) {
    return {
      $queryRaw: async () => [],
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => ({
          name: where.id === 'user-b' ? '小李' : '邻居',
          avatar: null,
        }),
      },
      task: {
        findFirst: async ({ where }: { where: Record<string, unknown> }) =>
          draft.tasks.find((row) => matchesWhere(row, where)) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) =>
          draft.tasks.find((row) => row.id === where.id) ?? null,
        updateMany: async ({
          where,
          data,
        }: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => {
          updateManyCalls.push({ where, data });
          if (options.forceConditionalConflict) return { count: 0 };
          const rows = draft.tasks.filter((row) => matchesWhere(row, where));
          rows.forEach((row) => applyData(row, data));
          return { count: rows.length };
        },
        create: async ({ data }: { data: Record<string, unknown> }) => {
          const row = task({
            id: String(data.id || `task-${draft.tasks.length + 1}`),
            ...data,
          } as Partial<TaskRow>);
          draft.tasks.push(row);
          return row;
        },
      },
      notification: {
        upsert: async ({ create }: { create: NotificationRow }) => {
          notificationUpserts += 1;
          if (options.failNotification) throw new Error('notification write failed');
          const existing = draft.notifications.find(
            (row) =>
              row.recipientId === create.recipientId &&
              row.dedupeKey === create.dedupeKey,
          );
          if (existing) return existing;
          draft.notifications.push({ ...create });
          return create;
        },
      },
    };
  }

  const database = {
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, identityType: 'OWNER' })),
    },
    adminUser: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    task: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        committed.tasks.find((row) => matchesWhere(row, where)) ?? null,
      findMany: async ({ where = {} }: { where?: Record<string, unknown> }) =>
        committed.tasks.filter((row) => matchesWhere(row, where)),
    },
    $transaction: async <T>(
      callback: (tx: ReturnType<typeof transactionClient>) => Promise<T>,
    ) => {
      const draft = cloneState(committed);
      const result = await callback(transactionClient(draft));
      committed = draft;
      return result;
    },
  };

  return {
    database,
    get state() {
      return committed;
    },
    get updateManyCalls() {
      return updateManyCalls;
    },
    get notificationUpserts() {
      return notificationUpserts;
    },
  };
}

function task(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 'task-1',
    title: '帮忙取快递',
    desc: '下午到门卫处取一下',
    images: [],
    videos: [],
    reward: '5',
    location: '门卫处',
    status: 'PENDING_TAKE',
    version: 0,
    visibility: 'ONLINE',
    pinned: false,
    publisherId: 'user-a',
    publisherName: '小王',
    publisherAvatar: null,
    takerId: null,
    takerName: null,
    takerAvatar: null,
    proofText: null,
    proofImages: [],
    deletedAt: null,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    claimedAt: null,
    completedAt: null,
    confirmedAt: null,
    ...overrides,
  };
}

function createService(fake: ReturnType<typeof createFakeDatabase>) {
  const ServiceWithDependencies = TaskService as unknown as new (
    database: typeof fake.database,
    invalidatePendingList: () => Promise<void>,
  ) => TaskService;
  return new ServiceWithDependencies(fake.database, async () => undefined);
}

function assertNotification(
  fake: ReturnType<typeof createFakeDatabase>,
  expected: Pick<NotificationRow, 'recipientId' | 'actorId' | 'type' | 'dedupeKey'>,
) {
  assert.equal(fake.state.notifications.length, 1);
  assert.deepEqual(
    {
      recipientId: fake.state.notifications[0]?.recipientId,
      actorId: fake.state.notifications[0]?.actorId,
      type: fake.state.notifications[0]?.type,
      dedupeKey: fake.state.notifications[0]?.dedupeKey,
    },
    expected,
  );
  assert.equal(fake.state.notifications[0]?.bizType, 'task');
  assert.equal(fake.state.notifications[0]?.bizId, 'task-1');
}

test('task schema and the pending notification migration add a monotonic version', async () => {
  const [schema, migration] = await Promise.all([
    readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../prisma/migrations/20260726130000_add_notification_center/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);
  const taskModel = schema.slice(schema.indexOf('model Task'), schema.indexOf('model ForumPost'));
  assert.match(taskModel, /version\s+Int\s+@default\(0\)/);
  assert.match(
    migration,
    /ALTER TABLE `Task` ADD COLUMN `version` INTEGER NOT NULL DEFAULT 0/,
  );
});

test('saving an existing draft uses status/version CAS, increments version, and never writes status', async () => {
  const fake = createFakeDatabase({
    tasks: [task({ status: 'DRAFT', version: 3, title: '旧标题' })],
  });

  const result = await createService(fake).saveDraft({
    taskId: 'task-1',
    userId: 'user-a',
    title: '新标题',
  });

  assert.equal(result.status, 'draft');
  assert.equal(result.version, 4);
  assert.equal(fake.state.tasks[0]?.title, '新标题');
  assert.deepEqual(fake.updateManyCalls[0]?.where, {
    id: 'task-1',
    publisherId: 'user-a',
    status: 'DRAFT',
    version: 3,
    deletedAt: null,
  });
  assert.equal(Object.hasOwn(fake.updateManyCalls[0]?.data ?? {}, 'status'), false);
});

test('deleting an unpublished task uses the legal read status/version in CAS', async () => {
  const fake = createFakeDatabase({
    tasks: [task({ status: 'CANCELLED', version: 7 })],
  });

  await createService(fake).deleteUnpublished({ taskId: 'task-1', userId: 'user-a' });

  assert.equal(fake.state.tasks[0]?.version, 8);
  assert.ok(fake.state.tasks[0]?.deletedAt instanceof Date);
  assert.deepEqual(fake.updateManyCalls[0]?.where, {
    id: 'task-1',
    publisherId: 'user-a',
    status: 'CANCELLED',
    version: 7,
    takerId: null,
    deletedAt: null,
  });
});

function createDraftRaceDatabase(initial: TaskRow) {
  const shared = { ...initial };
  let waiting = 0;
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tx: {
      $queryRaw: () => Promise<unknown[]>;
      user: { findUnique: () => Promise<{ name: string; avatar: null; identityType: string }> };
      task: {
        findFirst: () => Promise<TaskRow>;
        findUnique: () => Promise<TaskRow>;
        updateMany: (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }) => Promise<{ count: number }>;
      };
    } = {
      $queryRaw: async () => [],
      user: {
        findUnique: async () => ({ name: '小王', avatar: null, identityType: 'OWNER' }),
      },
      task: {
        findFirst: async () => ({ ...shared }),
        findUnique: async () => ({ ...shared }),
        updateMany: async ({ where, data }) => {
          waiting += 1;
          if (waiting === 2) release?.();
          await barrier;
          if (!matchesWhere(shared, where)) return { count: 0 };
          applyData(shared, data);
          return { count: 1 };
        },
      },
    };
  const database = {
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, identityType: 'OWNER' })),
    },
    adminUser: { findFirst: async () => null, findMany: async () => [] },
    $transaction: async <T>(callback: (client: typeof tx) => Promise<T>) => callback(tx),
  };
  return { database, shared, tx };
}

test('save-draft versus publish barrier allows exactly one CAS winner', async () => {
  const race = createDraftRaceDatabase(task({ status: 'DRAFT', title: '有效标题' }));
  const ServiceWithDependencies = TaskService as unknown as new (
    database: typeof race.database,
    invalidatePendingList: () => Promise<void>,
  ) => TaskService;
  const service = new ServiceWithDependencies(race.database, async () => undefined);

  const results = await Promise.allSettled([
    service.saveDraft({ taskId: 'task-1', userId: 'user-a', title: '并发保存' }),
    service.publishDraft({ taskId: 'task-1', userId: 'user-a' }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(rejected?.reason instanceof HttpError);
  assert.equal(rejected.reason.status, 409);
  assert.equal(race.shared.version, 1);
});

test('delete versus publish barrier prevents deleting a concurrently published draft', async () => {
  const race = createDraftRaceDatabase(task({ status: 'DRAFT', title: '有效标题' }));
  const ServiceWithDependencies = TaskService as unknown as new (
    database: typeof race.database,
    invalidatePendingList: () => Promise<void>,
  ) => TaskService;
  const service = new ServiceWithDependencies(race.database, async () => undefined);

  const results = await Promise.allSettled([
    service.deleteUnpublished({ taskId: 'task-1', userId: 'user-a' }),
    service.publishDraft({ taskId: 'task-1', userId: 'user-a' }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(rejected?.reason instanceof HttpError);
  assert.equal(rejected.reason.status, 409);
  assert.equal(race.shared.version, 1);
  assert.equal(race.shared.status === 'PENDING_TAKE' && race.shared.deletedAt !== null, false);
});

test('admin content edit versus mini publish barrier allows exactly one CAS winner', async () => {
  const initial = task({ status: 'DRAFT', title: '有效标题' });
  const race = createDraftRaceDatabase(initial);
  const ServiceWithDependencies = TaskService as unknown as new (
    database: typeof race.database,
    invalidatePendingList: () => Promise<void>,
  ) => TaskService;
  const service = new ServiceWithDependencies(race.database, async () => undefined);

  const results = await Promise.allSettled([
    updateAdminTaskContentCas(
      race.tx as unknown as Parameters<typeof updateAdminTaskContentCas>[0],
      {
        id: initial.id,
        publisherId: initial.publisherId,
        status: initial.status,
        version: initial.version,
        data: { title: '后台编辑标题' },
      },
    ),
    service.publishDraft({ taskId: initial.id, userId: initial.publisherId }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  assert.ok(rejected?.reason instanceof HttpError);
  assert.equal(rejected.reason.status, 409);
  assert.equal(race.shared.version, 1);
});

test('reject-complete is a static JWT route documented by OpenAPI', () => {
  const router = createRouter();
  const route = router.stack.find(
    (layer) =>
      layer.path === '/api/tasks/:taskId/reject-complete' &&
      layer.methods.includes('POST'),
  );
  assert.ok(route);
  assert.equal(route.stack[0], jwtAuth);

  const paths = openApiDocument.paths as Record<
    string,
    { post?: { security?: Array<{ bearerAuth?: unknown[] }> } }
  >;
  assert.deepEqual(
    paths['/api/tasks/{taskId}/reject-complete']?.post?.security,
    [{ bearerAuth: [] }],
  );
});

test('every task CAS endpoint documents its 409 conflict response', () => {
  const paths = openApiDocument.paths as Record<string, Record<string, {
    responses?: Record<string, unknown>;
  }>>;
  const operations = [
    ['/api/tasks/{taskId}', 'delete'],
    ['/api/tasks/draft', 'post'],
    ['/api/tasks/{taskId}/publish', 'post'],
    ['/api/tasks/{taskId}/revoke', 'post'],
    ['/api/tasks/{taskId}/republish', 'post'],
    ['/api/tasks/{taskId}/abandon', 'post'],
  ] as const;
  for (const [path, method] of operations) {
    assert.ok(paths[path]?.[method]?.responses?.['409'], `${method.toUpperCase()} ${path}`);
  }
});

test('claim changes state, increments version and notifies the publisher in one transaction', async () => {
  const fake = createFakeDatabase({ tasks: [task()] });

  const result = await createService(fake).claimTask({
    taskId: 'task-1',
    userId: 'user-b',
  });

  assert.equal(result.status, 'in_progress');
  assert.equal(result.version, 1);
  assert.equal(fake.state.tasks[0]?.takerId, 'user-b');
  assertNotification(fake, {
    recipientId: 'user-a',
    actorId: 'user-b',
    type: 'TASK_CLAIMED',
    dedupeKey: 'task:task-1:TASK_CLAIMED:1:recipient:user-a',
  });
});

test('abandon returns a task to the pool and notifies its publisher', async () => {
  const fake = createFakeDatabase({
    tasks: [task({ status: 'IN_PROGRESS', version: 4, takerId: 'user-b', takerName: '小李' })],
  });

  const result = await createService(fake).abandonTask({
    taskId: 'task-1',
    userId: 'user-b',
  });

  assert.equal(result.status, 'pending_take');
  assert.equal(result.version, 5);
  assert.equal(fake.state.tasks[0]?.takerId, null);
  assertNotification(fake, {
    recipientId: 'user-a',
    actorId: 'user-b',
    type: 'TASK_ABANDONED',
    dedupeKey: 'task:task-1:TASK_ABANDONED:5:recipient:user-a',
  });
});

test('submit-complete stores the new proof and notifies the publisher', async () => {
  const fake = createFakeDatabase({
    tasks: [task({ status: 'IN_PROGRESS', version: 1, takerId: 'user-b', takerName: '小李' })],
  });

  const result = await createService(fake).submitComplete({
    taskId: 'task-1',
    userId: 'user-b',
    proofText: ' 已送到 ',
  });

  assert.equal(result.status, 'pending_confirm');
  assert.equal(result.version, 2);
  assert.equal(fake.state.tasks[0]?.proofText, '已送到');
  assert.ok(fake.state.tasks[0]?.completedAt instanceof Date);
  assertNotification(fake, {
    recipientId: 'user-a',
    actorId: 'user-b',
    type: 'TASK_SUBMITTED',
    dedupeKey: 'task:task-1:TASK_SUBMITTED:2:recipient:user-a',
  });
});

test('confirm-complete completes the task and notifies the taker without changing reward', async () => {
  const fake = createFakeDatabase({
    tasks: [
      task({
        status: 'PENDING_CONFIRM',
        version: 2,
        takerId: 'user-b',
        takerName: '小李',
        proofText: '已送到',
        completedAt: new Date('2026-07-26T01:00:00.000Z'),
      }),
    ],
  });

  const result = await createService(fake).confirmComplete({
    taskId: 'task-1',
    userId: 'user-a',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.version, 3);
  assert.equal(fake.state.tasks[0]?.reward, '5');
  assert.ok(fake.state.tasks[0]?.confirmedAt instanceof Date);
  assertNotification(fake, {
    recipientId: 'user-b',
    actorId: 'user-a',
    type: 'TASK_CONFIRMED',
    dedupeKey: 'task:task-1:TASK_CONFIRMED:3:recipient:user-b',
  });
});

test('reject-complete returns to in-progress while preserving the last proof for resubmission', async () => {
  const proofTime = new Date('2026-07-26T01:00:00.000Z');
  const fake = createFakeDatabase({
    tasks: [
      task({
        status: 'PENDING_CONFIRM',
        version: 2,
        takerId: 'user-b',
        takerName: '小李',
        proofText: '第一次凭证',
        proofImages: ['https://cdn.example.com/proof.png'],
        completedAt: proofTime,
      }),
    ],
  });

  const result = await createService(fake).rejectComplete({
    taskId: 'task-1',
    userId: 'user-a',
  });

  assert.equal(result.status, 'in_progress');
  assert.equal(result.version, 3);
  assert.equal(fake.state.tasks[0]?.proofText, '第一次凭证');
  assert.deepEqual(fake.state.tasks[0]?.proofImages, ['https://cdn.example.com/proof.png']);
  assert.equal(fake.state.tasks[0]?.completedAt, proofTime);
  assert.equal(fake.state.tasks[0]?.confirmedAt, null);
  assertNotification(fake, {
    recipientId: 'user-b',
    actorId: 'user-a',
    type: 'TASK_REJECTED',
    dedupeKey: 'task:task-1:TASK_REJECTED:3:recipient:user-b',
  });
});

test('the same taker can replace a rejected proof and resubmit with a new version', async () => {
  const fake = createFakeDatabase({
    tasks: [
      task({
        status: 'PENDING_CONFIRM',
        version: 2,
        takerId: 'user-b',
        takerName: '小李',
        proofText: '旧凭证',
        proofImages: ['https://cdn.example.com/old.png'],
        completedAt: new Date('2026-07-26T01:00:00.000Z'),
      }),
    ],
  });
  const service = createService(fake);

  await service.rejectComplete({ taskId: 'task-1', userId: 'user-a' });
  const result = await service.submitComplete({
    taskId: 'task-1',
    userId: 'user-b',
    proofText: '新凭证',
    proofImages: ['https://cdn.example.com/new.png'],
  });

  assert.equal(result.status, 'pending_confirm');
  assert.equal(result.version, 4);
  assert.equal(fake.state.tasks[0]?.proofText, '新凭证');
  assert.deepEqual(fake.state.tasks[0]?.proofImages, ['https://cdn.example.com/new.png']);
  assert.deepEqual(
    fake.state.notifications.map((row) => row.type),
    ['TASK_REJECTED', 'TASK_SUBMITTED'],
  );
  assert.deepEqual(
    fake.state.notifications.map((row) => row.dedupeKey),
    [
      'task:task-1:TASK_REJECTED:3:recipient:user-b',
      'task:task-1:TASK_SUBMITTED:4:recipient:user-a',
    ],
  );
});

test('publisher cancellation keeps assigned-party history and notifies the taker', async () => {
  const fake = createFakeDatabase({
    tasks: [task({ status: 'IN_PROGRESS', version: 8, takerId: 'user-b', takerName: '小李' })],
  });

  const result = await createService(fake).revokePublish({
    taskId: 'task-1',
    userId: 'user-a',
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.version, 9);
  assert.equal(fake.state.tasks[0]?.takerId, 'user-b');
  assertNotification(fake, {
    recipientId: 'user-b',
    actorId: 'user-a',
    type: 'TASK_CANCELLED',
    dedupeKey: 'task:task-1:TASK_CANCELLED:9:recipient:user-b',
  });
});

test('publisher cancellation before claim increments version without creating a notification', async () => {
  const fake = createFakeDatabase({ tasks: [task({ status: 'PENDING_TAKE', version: 2 })] });

  const result = await createService(fake).revokePublish({
    taskId: 'task-1',
    userId: 'user-a',
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.version, 3);
  assert.equal(fake.state.notifications.length, 0);
});

test('pending-confirm cancellation notifies the assigned taker', async () => {
  const fake = createFakeDatabase({
    tasks: [task({ status: 'PENDING_CONFIRM', version: 5, takerId: 'user-b' })],
  });

  const result = await createService(fake).revokePublish({
    taskId: 'task-1',
    userId: 'user-a',
  });

  assert.equal(result.status, 'cancelled');
  assert.equal(result.version, 6);
  assertNotification(fake, {
    recipientId: 'user-b',
    actorId: 'user-a',
    type: 'TASK_CANCELLED',
    dedupeKey: 'task:task-1:TASK_CANCELLED:6:recipient:user-b',
  });
});

test('republish and delete enforce cancelled/unassigned restrictions', async () => {
  const assigned = createFakeDatabase({
    tasks: [task({ status: 'CANCELLED', takerId: 'user-b' })],
  });
  await assert.rejects(
    createService(assigned).republish({ taskId: 'task-1', userId: 'user-a' }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
  await assert.rejects(
    createService(assigned).deleteUnpublished({ taskId: 'task-1', userId: 'user-a' }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );

  const published = createFakeDatabase({ tasks: [task({ status: 'PENDING_TAKE' })] });
  await assert.rejects(
    createService(published).deleteUnpublished({ taskId: 'task-1', userId: 'user-a' }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
});

test('notification failure rolls back both task state and version', async () => {
  const fake = createFakeDatabase({ tasks: [task()], failNotification: true });

  await assert.rejects(
    createService(fake).claimTask({ taskId: 'task-1', userId: 'user-b' }),
    /notification write failed/,
  );

  assert.equal(fake.state.tasks[0]?.status, 'PENDING_TAKE');
  assert.equal(fake.state.tasks[0]?.version, 0);
  assert.equal(fake.state.tasks[0]?.takerId, null);
  assert.equal(fake.state.notifications.length, 0);
});

test('notification failure rolls back every notifying task transition', async () => {
  const cases: Array<{
    name: string;
    row: TaskRow;
    run: (service: TaskService) => Promise<unknown>;
  }> = [
    {
      name: 'claim',
      row: task(),
      run: (service) => service.claimTask({ taskId: 'task-1', userId: 'user-b' }),
    },
    {
      name: 'abandon',
      row: task({ status: 'IN_PROGRESS', version: 2, takerId: 'user-b' }),
      run: (service) => service.abandonTask({ taskId: 'task-1', userId: 'user-b' }),
    },
    {
      name: 'submit',
      row: task({ status: 'IN_PROGRESS', version: 2, takerId: 'user-b' }),
      run: (service) =>
        service.submitComplete({ taskId: 'task-1', userId: 'user-b', proofText: '完成' }),
    },
    {
      name: 'confirm',
      row: task({ status: 'PENDING_CONFIRM', version: 2, takerId: 'user-b' }),
      run: (service) => service.confirmComplete({ taskId: 'task-1', userId: 'user-a' }),
    },
    {
      name: 'reject',
      row: task({ status: 'PENDING_CONFIRM', version: 2, takerId: 'user-b' }),
      run: (service) => service.rejectComplete({ taskId: 'task-1', userId: 'user-a' }),
    },
    {
      name: 'cancel assigned',
      row: task({ status: 'IN_PROGRESS', version: 2, takerId: 'user-b' }),
      run: (service) => service.revokePublish({ taskId: 'task-1', userId: 'user-a' }),
    },
  ];

  for (const scenario of cases) {
    const fake = createFakeDatabase({ tasks: [scenario.row], failNotification: true });
    await assert.rejects(scenario.run(createService(fake)), /notification write failed/, scenario.name);
    assert.equal(fake.state.tasks[0]?.status, scenario.row.status, scenario.name);
    assert.equal(fake.state.tasks[0]?.version, scenario.row.version, scenario.name);
    assert.equal(fake.state.notifications.length, 0, scenario.name);
  }
});

test('every task transition returns 409 when its status/version CAS loses', async () => {
  const cases: Array<{
    row: TaskRow;
    run: (service: TaskService) => Promise<unknown>;
  }> = [
    {
      row: task(),
      run: (service) => service.claimTask({ taskId: 'task-1', userId: 'user-b' }),
    },
    {
      row: task({ status: 'IN_PROGRESS', takerId: 'user-b' }),
      run: (service) => service.abandonTask({ taskId: 'task-1', userId: 'user-b' }),
    },
    {
      row: task({ status: 'IN_PROGRESS', takerId: 'user-b' }),
      run: (service) =>
        service.submitComplete({ taskId: 'task-1', userId: 'user-b', proofText: '完成' }),
    },
    {
      row: task({ status: 'PENDING_CONFIRM', takerId: 'user-b' }),
      run: (service) => service.confirmComplete({ taskId: 'task-1', userId: 'user-a' }),
    },
    {
      row: task({ status: 'PENDING_CONFIRM', takerId: 'user-b' }),
      run: (service) => service.rejectComplete({ taskId: 'task-1', userId: 'user-a' }),
    },
    {
      row: task({ status: 'IN_PROGRESS', takerId: 'user-b' }),
      run: (service) => service.revokePublish({ taskId: 'task-1', userId: 'user-a' }),
    },
  ];

  for (const scenario of cases) {
    const fake = createFakeDatabase({
      tasks: [scenario.row],
      forceConditionalConflict: true,
    });
    await assert.rejects(
      scenario.run(createService(fake)),
      (error: unknown) => error instanceof HttpError && error.status === 409,
    );
    assert.equal(fake.state.tasks[0]?.version, scenario.row.version);
    assert.equal(fake.state.notifications.length, 0);
  }
});

test('role-bound task transitions reject the wrong user with 403', async () => {
  const cases: Array<{
    row: TaskRow;
    run: (service: TaskService) => Promise<unknown>;
  }> = [
    {
      row: task({ status: 'IN_PROGRESS', takerId: 'user-b' }),
      run: (service) => service.abandonTask({ taskId: 'task-1', userId: 'user-c' }),
    },
    {
      row: task({ status: 'IN_PROGRESS', takerId: 'user-b' }),
      run: (service) =>
        service.submitComplete({ taskId: 'task-1', userId: 'user-c', proofText: '完成' }),
    },
    {
      row: task({ status: 'PENDING_CONFIRM', takerId: 'user-b' }),
      run: (service) => service.confirmComplete({ taskId: 'task-1', userId: 'user-c' }),
    },
    {
      row: task({ status: 'PENDING_CONFIRM', takerId: 'user-b' }),
      run: (service) => service.rejectComplete({ taskId: 'task-1', userId: 'user-c' }),
    },
    {
      row: task({ status: 'IN_PROGRESS', takerId: 'user-b' }),
      run: (service) => service.revokePublish({ taskId: 'task-1', userId: 'user-c' }),
    },
  ];

  for (const scenario of cases) {
    const fake = createFakeDatabase({ tasks: [scenario.row] });
    await assert.rejects(
      scenario.run(createService(fake)),
      (error: unknown) => error instanceof HttpError && error.status === 403,
    );
    assert.equal(fake.state.tasks[0]?.version, scenario.row.version);
    assert.equal(fake.state.notifications.length, 0);
  }
});

test('repeated HTTP intent cannot change state or duplicate a notification', async () => {
  const fake = createFakeDatabase({ tasks: [task()] });
  const service = createService(fake);

  await service.claimTask({ taskId: 'task-1', userId: 'user-b' });
  await assert.rejects(
    service.claimTask({ taskId: 'task-1', userId: 'user-b' }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );

  assert.equal(fake.state.tasks[0]?.version, 1);
  assert.equal(fake.state.notifications.length, 1);
  assert.equal(fake.notificationUpserts, 1);
});

test('a claim-abandon-reclaim loop uses a new version and never suppresses the second claim', async () => {
  const fake = createFakeDatabase({ tasks: [task()] });
  const service = createService(fake);

  await service.claimTask({ taskId: 'task-1', userId: 'user-b' });
  await service.abandonTask({ taskId: 'task-1', userId: 'user-b' });
  await service.claimTask({ taskId: 'task-1', userId: 'user-c' });

  assert.equal(fake.state.tasks[0]?.status, 'IN_PROGRESS');
  assert.equal(fake.state.tasks[0]?.version, 3);
  assert.deepEqual(
    fake.state.notifications.map((row) => row.dedupeKey),
    [
      'task:task-1:TASK_CLAIMED:1:recipient:user-a',
      'task:task-1:TASK_ABANDONED:2:recipient:user-a',
      'task:task-1:TASK_CLAIMED:3:recipient:user-a',
    ],
  );
});

test('claim uses status and version in an atomic conditional update', async () => {
  const fake = createFakeDatabase({ tasks: [task()], forceConditionalConflict: true });

  await assert.rejects(
    createService(fake).claimTask({ taskId: 'task-1', userId: 'user-b' }),
    (error: unknown) => error instanceof HttpError && error.status === 409,
  );

  assert.equal(fake.updateManyCalls.length, 1);
  assert.deepEqual(fake.updateManyCalls[0]?.where, {
    id: 'task-1',
    status: 'PENDING_TAKE',
    version: 0,
    takerId: null,
    visibility: 'ONLINE',
    deletedAt: null,
  });
  assert.deepEqual(fake.updateManyCalls[0]?.data.version, { increment: 1 });
  assert.equal(fake.state.notifications.length, 0);
});

test('two concurrent claim requests use compare-and-swap so exactly one wins', async () => {
  const sharedTask = task();
  const notifications: NotificationRow[] = [];
  let waiting = 0;
  let releaseBarrier: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => {
    releaseBarrier = resolve;
  });
  const database = {
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, identityType: 'OWNER' })),
    },
    adminUser: { findMany: async () => [] },
    $transaction: async <T>(
      callback: (tx: {
        $queryRaw: () => Promise<unknown[]>;
        user: { findUnique: (args: { where: { id: string } }) => Promise<{ name: string; avatar: null }> };
        task: {
          findFirst: () => Promise<TaskRow>;
          findUnique: () => Promise<TaskRow>;
          updateMany: (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => Promise<{ count: number }>;
        };
        notification: {
          upsert: (args: { create: NotificationRow }) => Promise<NotificationRow>;
        };
      }) => Promise<T>,
    ) => {
      const tx = {
        $queryRaw: async () => [],
        user: {
          findUnique: async ({ where }: { where: { id: string } }) => ({
            name: where.id,
            avatar: null,
          }),
        },
        task: {
          findFirst: async () => ({ ...sharedTask }),
          findUnique: async () => ({ ...sharedTask }),
          updateMany: async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            waiting += 1;
            if (waiting === 2) releaseBarrier?.();
            await barrier;
            if (!matchesWhere(sharedTask, where)) return { count: 0 };
            applyData(sharedTask, data);
            return { count: 1 };
          },
        },
        notification: {
          upsert: async ({ create }: { create: NotificationRow }) => {
            notifications.push(create);
            return create;
          },
        },
      };
      return callback(tx);
    },
  };
  const ServiceWithDependencies = TaskService as unknown as new (
    database: typeof database,
    invalidatePendingList: () => Promise<void>,
  ) => TaskService;
  const service = new ServiceWithDependencies(database, async () => undefined);

  const results = await Promise.allSettled([
    service.claimTask({ taskId: 'task-1', userId: 'user-b' }),
    service.claimTask({ taskId: 'task-1', userId: 'user-c' }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  assert.ok(rejected);
  assert.ok(rejected.reason instanceof HttpError);
  assert.equal(rejected.reason.status, 409);
  assert.equal(sharedTask.version, 1);
  assert.equal(notifications.length, 1);
});

test('reject-complete enforces publisher permission and PENDING_CONFIRM state', async () => {
  const unauthorized = createFakeDatabase({
    tasks: [task({ status: 'PENDING_CONFIRM', takerId: 'user-b' })],
  });
  await assert.rejects(
    createService(unauthorized).rejectComplete({ taskId: 'task-1', userId: 'user-b' }),
    (error: unknown) => error instanceof HttpError && error.status === 403,
  );

  const wrongState = createFakeDatabase({
    tasks: [task({ status: 'IN_PROGRESS', takerId: 'user-b' })],
  });
  await assert.rejects(
    createService(wrongState).rejectComplete({ taskId: 'task-1', userId: 'user-a' }),
    (error: unknown) => error instanceof HttpError && error.status === 400,
  );
});
