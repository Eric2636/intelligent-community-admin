import assert from 'node:assert/strict';
import test from 'node:test';
import { AvatarReviewService } from '../src/modules/avatar-review/avatar-review.service';

type Review = {
  id: string;
  userId: string;
  mediaUrl: string;
  traceId: string | null;
  status: string;
  suggest?: string | null;
  createdAt: Date;
};

function fakeService(
  initial: Review[] = [],
  submitAvatar: (params: { mediaUrl: string }) => Promise<{ traceId: string }> = async () => ({ traceId: `trace-${Date.now()}` }),
) {
  const rows = initial.map((row) => ({ ...row }));
  const applied: string[] = [];
  const invalidated: string[] = [];
  let nextId = rows.length + 1;
  const delegate = {
    create: async ({ data }: { data: Omit<Review, 'id' | 'createdAt' | 'traceId'> }) => {
      const row: Review = {
        ...data,
        id: `review-${nextId++}`,
        traceId: null,
        createdAt: new Date(1_000 * nextId),
      };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Review> }) => {
      const row = rows.find((item) => item.id === where.id)!;
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Partial<Review> }) => {
      let count = 0;
      for (const row of rows) {
        const sameUser = !where.userId || row.userId === where.userId;
        const exactId = typeof where.id === 'string' ? where.id : undefined;
        const excluded = (where.id as { not?: string } | undefined)?.not;
        const allowedStatuses = (where.status as { in?: string[] } | undefined)?.in;
        if (
          sameUser &&
          (!exactId || row.id === exactId) &&
          row.id !== excluded &&
          (!allowedStatuses || allowedStatuses.includes(row.status))
        ) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
    findUnique: async ({ where }: { where: { id?: string; traceId?: string } }) =>
      rows.find((row) => row.id === where.id || row.traceId === where.traceId) || null,
    findFirst: async ({ where }: { where: { userId: string; status?: string } }) =>
      [...rows]
        .filter((row) => row.userId === where.userId && (!where.status || row.status === where.status))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] || null,
  };
  const database = {
    avatarReview: delegate,
    user: {
      findUnique: async () => ({ openid: 'openid-1' }),
    },
    $transaction: undefined as unknown as <T>(callback: (tx: { avatarReview: typeof delegate }) => Promise<T>) => Promise<T>,
  };
  let transactionTail = Promise.resolve();
  database.$transaction = <T>(callback: (tx: { avatarReview: typeof delegate }) => Promise<T>) => {
    const run = transactionTail.then(() => callback({ avatarReview: delegate }));
    transactionTail = run.then(() => undefined, () => undefined);
    return run;
  };
  const service = new AvatarReviewService({
    database: database as never,
    submitAvatar,
    lockUser: async () => {},
    applyAvatar: async ({ mediaUrl }) => {
      applied.push(mediaUrl);
      return { forumPostIds: [], mallItemIds: [] };
    },
    invalidateAvatarCaches: async () => invalidated.push('done'),
  });
  return { service, rows, applied, invalidated };
}

test('a slower older submission cannot supersede a newer pending avatar', async () => {
  let releaseOlder;
  const olderResult = new Promise((resolve) => {
    releaseOlder = resolve;
  });
  const { service, rows } = fakeService([], ({ mediaUrl }) =>
    mediaUrl.endsWith('/old.jpg')
      ? olderResult
      : Promise.resolve({ traceId: 'trace-new' }),
  );
  const older = service.submit({
    userId: 'user-1',
    openid: 'openid-1',
    mediaUrl: 'https://cdn.example.com/old.jpg',
  });
  await Promise.resolve();
  const newer = await service.submit({
    userId: 'user-1',
    openid: 'openid-1',
    mediaUrl: 'https://cdn.example.com/new.jpg',
  });
  releaseOlder({ traceId: 'trace-old' });
  const olderDone = await older;

  assert.equal(newer.status, 'PENDING');
  assert.equal(olderDone.status, 'SUPERSEDED');
  assert.equal(rows.find((row) => row.mediaUrl.endsWith('/new.jpg'))?.status, 'PENDING');
});

test('submitting a newer avatar supersedes older pending reviews', async () => {
  const { service, rows } = fakeService([
    {
      id: 'old',
      userId: 'user-1',
      mediaUrl: 'https://cdn.example.com/old.jpg',
      traceId: 'trace-old',
      status: 'PENDING',
      createdAt: new Date(1_000),
    },
  ]);

  const result = await service.submit({
    userId: 'user-1',
    openid: 'openid-1',
    mediaUrl: 'https://cdn.example.com/new.jpg',
  });

  assert.equal(result.status, 'PENDING');
  assert.equal(rows.find((row) => row.id === 'old')?.status, 'SUPERSEDED');
  assert.equal(rows.find((row) => row.id === result.id)?.traceId?.startsWith('trace-'), true);
});

test('pass applies only the latest pending avatar and duplicate callbacks are idempotent', async () => {
  const { service, rows, applied, invalidated } = fakeService([
    {
      id: 'review-1',
      userId: 'user-1',
      mediaUrl: 'https://cdn.example.com/new.jpg',
      traceId: 'trace-1',
      status: 'PENDING',
      createdAt: new Date(2_000),
    },
  ]);

  await service.handleResult({ traceId: 'trace-1', errcode: 0, suggest: 'pass', label: 100 });
  const duplicate = await service.handleResult({ traceId: 'trace-1', errcode: 0, suggest: 'pass', label: 100 });

  assert.deepEqual(applied, ['https://cdn.example.com/new.jpg']);
  assert.deepEqual(invalidated, ['done']);
  assert.equal(rows[0]?.status, 'PASSED');
  assert.equal(duplicate.handled, true);
});

test('concurrent duplicate pass callbacks apply once and remain passed', async () => {
  const { service, rows, applied, invalidated } = fakeService([
    {
      id: 'review-concurrent',
      userId: 'user-1',
      mediaUrl: 'https://cdn.example.com/concurrent.jpg',
      traceId: 'trace-concurrent',
      status: 'PENDING',
      createdAt: new Date(2_000),
    },
  ]);
  const outcomes = await Promise.all([
    service.handleResult({ traceId: 'trace-concurrent', errcode: 0, suggest: 'pass' }),
    service.handleResult({ traceId: 'trace-concurrent', errcode: 0, suggest: 'pass' }),
  ]);
  assert.deepEqual(applied, ['https://cdn.example.com/concurrent.jpg']);
  assert.deepEqual(invalidated, ['done']);
  assert.equal(rows[0]?.status, 'PASSED');
  assert.deepEqual(outcomes.map((item) => item.status), ['PASSED', 'PASSED']);
});

test('unknown callback asks the sender to retry instead of silently losing an early result', async () => {
  const { service } = fakeService();
  assert.deepEqual(
    await service.handleResult({ traceId: 'not-persisted-yet', errcode: 0, suggest: 'pass' }),
    { handled: false, status: 'NOT_FOUND' },
  );
});

test('a review with no callback eventually fails closed and retains the old avatar', async () => {
  const { service, rows, applied } = fakeService([
    {
      id: 'timed-out',
      userId: 'user-1',
      mediaUrl: 'https://cdn.example.com/pending.jpg',
      traceId: 'trace-timeout',
      status: 'PENDING',
      createdAt: new Date(Date.now() - 36 * 60 * 1000),
    },
  ]);
  assert.deepEqual(await service.getStatus('user-1', 'timed-out'), {
    id: 'timed-out',
    status: 'FAILED',
  });
  assert.equal(rows[0]?.status, 'FAILED');
  assert.deepEqual(applied, []);
});

test('risky and review results retain the old avatar', async () => {
  for (const suggest of ['risky', 'review']) {
    const { service, rows, applied } = fakeService([
      {
        id: `review-${suggest}`,
        userId: 'user-1',
        mediaUrl: `https://cdn.example.com/${suggest}.jpg`,
        traceId: `trace-${suggest}`,
        status: 'PENDING',
        createdAt: new Date(2_000),
      },
    ]);
    await service.handleResult({ traceId: `trace-${suggest}`, errcode: 0, suggest, label: 20002 });
    assert.deepEqual(applied, []);
    assert.equal(rows[0]?.status, 'REJECTED');
  }
});

test('an older late pass can never overwrite a newer pending avatar', async () => {
  const { service, rows, applied } = fakeService([
    {
      id: 'old',
      userId: 'user-1',
      mediaUrl: 'https://cdn.example.com/old.jpg',
      traceId: 'trace-old',
      status: 'PENDING',
      createdAt: new Date(1_000),
    },
    {
      id: 'new',
      userId: 'user-1',
      mediaUrl: 'https://cdn.example.com/new.jpg',
      traceId: 'trace-new',
      status: 'PENDING',
      createdAt: new Date(2_000),
    },
  ]);

  await service.handleResult({ traceId: 'trace-old', errcode: 0, suggest: 'pass', label: 100 });

  assert.deepEqual(applied, []);
  assert.equal(rows.find((row) => row.id === 'old')?.status, 'SUPERSEDED');
});

test('an older pass cannot apply after a newer upload has failed closed', async () => {
  const { service, rows, applied } = fakeService([
    {
      id: 'old',
      userId: 'user-1',
      mediaUrl: 'https://cdn.example.com/old.jpg',
      traceId: 'trace-old',
      status: 'PENDING',
      createdAt: new Date(1_000),
    },
    {
      id: 'new-failed',
      userId: 'user-1',
      mediaUrl: 'https://cdn.example.com/new.jpg',
      traceId: 'trace-new',
      status: 'FAILED',
      createdAt: new Date(2_000),
    },
  ]);
  await service.handleResult({ traceId: 'trace-old', errcode: 0, suggest: 'pass' });
  assert.deepEqual(applied, []);
  assert.equal(rows.find((row) => row.id === 'old')?.status, 'SUPERSEDED');
});
