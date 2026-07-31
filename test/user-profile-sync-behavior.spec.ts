import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runAdminContentMutation,
  type AdminContentCacheInvalidation,
} from '../src/modules/admin/admin-content-mutation';
import {
  updateExistingWechatUser,
  upsertWechatLoginUser,
} from '../src/modules/auth/auth.service';
import {
  applyUserProfileSnapshotUpdate,
  lockUsersForProfileSnapshot,
  runUserProfileUpdate,
  type UserProfileSnapshotChanges,
} from '../src/modules/user/user-profile-sync';

type RecordedCall = {
  delegate: string;
  args: unknown;
};

function createFakeTransaction(options?: { failDelegate?: string }) {
  const calls: RecordedCall[] = [];
  const record = async (delegate: string, args: unknown) => {
    calls.push({ delegate, args });
    if (delegate === options?.failDelegate) throw new Error(`forced ${delegate} failure`);
    return { count: 1 };
  };
  const tx = {
    $queryRaw: async (...args: unknown[]) => {
      calls.push({ delegate: '$queryRaw', args });
      return [{ id: 'user-1' }];
    },
    user: {
      update: async (args: { data: Record<string, unknown> }) => {
        calls.push({ delegate: 'user.update', args });
        return {
          name: '新昵称',
          avatar: 'https://cdn.example.com/new.png',
          identityType: 'owner',
          ...args.data,
        };
      },
    },
    forumReply: {
      findMany: async (args: unknown) => {
        calls.push({ delegate: 'forumReply.findMany', args });
        return [{ postId: 'post-1' }];
      },
      updateMany: (args: unknown) => record('forumReply.updateMany', args),
    },
    mallItem: {
      findMany: async (args: unknown) => {
        calls.push({ delegate: 'mallItem.findMany', args });
        return [{ id: 'item-1' }];
      },
      updateMany: (args: unknown) => record('mallItem.updateMany', args),
    },
    task: { updateMany: (args: unknown) => record('task.updateMany', args) },
    forumPost: {
      updateMany: (args: unknown) => record('forumPost.updateMany', args),
    },
    mallItemComment: {
      updateMany: (args: unknown) => record('mallItemComment.updateMany', args),
    },
    mallOrder: {
      updateMany: (args: unknown) => record('mallOrder.updateMany', args),
    },
  };
  return { tx, calls };
}

function callsFor(calls: RecordedCall[], delegate: string) {
  return calls.filter((call) => call.delegate === delegate).map((call) => call.args);
}

test('profile synchronizer locks first and updates only snapshots matching supplied fields', async () => {
  const { tx, calls } = createFakeTransaction();
  const changes: UserProfileSnapshotChanges = { name: '新昵称' };

  const result = await applyUserProfileSnapshotUpdate(tx as never, 'user-1', changes);

  assert.equal(calls[0]?.delegate, '$queryRaw');
  assert.deepEqual(callsFor(calls, 'user.update'), [
    {
      where: { id: 'user-1' },
      data: { name: '新昵称' },
      select: { name: true, avatar: true, identityType: true },
    },
  ]);
  assert.deepEqual(callsFor(calls, 'task.updateMany'), [
    { where: { publisherId: 'user-1' }, data: { publisherName: '新昵称' } },
    { where: { takerId: 'user-1' }, data: { takerName: '新昵称' } },
  ]);
  assert.deepEqual(callsFor(calls, 'forumReply.updateMany'), [
    { where: { authorId: 'user-1' }, data: { authorName: '新昵称' } },
    {
      where: { replyToUserId: 'user-1' },
      data: { replyToAuthorName: '新昵称' },
    },
  ]);
  assert.deepEqual(callsFor(calls, 'mallItemComment.updateMany'), [
    { where: { userId: 'user-1' }, data: { authorName: '新昵称' } },
    {
      where: { replyToUserId: 'user-1' },
      data: { replyToAuthorName: '新昵称' },
    },
  ]);
  const allMutationData = calls
    .filter((call) => call.delegate.endsWith('updateMany'))
    .map((call) => (call.args as { data: Record<string, unknown> }).data);
  assert.equal(
    allMutationData.some((data) => 'adminLabel' in data),
    false,
  );
  assert.deepEqual(result.cacheTargets, {
    forumPostIds: ['post-1'],
    mallItemIds: ['item-1'],
  });
});

test('avatar-only profile synchronization does not alter names or identity snapshots', async () => {
  const { tx, calls } = createFakeTransaction();
  await applyUserProfileSnapshotUpdate(tx as never, 'user-1', {
    avatar: 'https://cdn.example.com/avatar.png',
  });

  for (const call of calls.filter((item) => item.delegate.endsWith('updateMany'))) {
    const data = (call.args as { data: Record<string, unknown> }).data;
    assert.deepEqual(
      Object.keys(data).every((key) => key.endsWith('Avatar')),
      true,
      `${call.delegate} received unexpected fields`,
    );
  }
});

test('transaction failure rejects and prevents all cache invalidation', async () => {
  const { tx } = createFakeTransaction({
    failDelegate: 'forumReply.updateMany',
  });
  const invalidated: string[] = [];
  const database = {
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
  };

  await assert.rejects(
    runUserProfileUpdate(
      {
        database: database as never,
        userId: 'user-1',
        changes: { name: '新昵称' },
        complete: async () => 'never',
      },
      {
        invalidateTaskList: async () => invalidated.push('task'),
        invalidateForumList: async () => invalidated.push('forum'),
        invalidateForumReplies: async () => invalidated.push('forum-replies'),
        invalidateMallList: async () => invalidated.push('mall'),
        invalidateMallItemDetail: async () => invalidated.push('mall-detail'),
      },
    ),
    /forced forumReply\.updateMany failure/,
  );
  assert.deepEqual(invalidated, []);
});

test('successful shared profile update invalidates affected caches after transaction completion', async () => {
  const { tx } = createFakeTransaction();
  const events: string[] = [];
  const database = {
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => {
      const result = await callback(tx);
      events.push('commit');
      return result;
    },
  };

  const result = await runUserProfileUpdate(
    {
      database: database as never,
      userId: 'user-1',
      changes: { name: '新昵称', avatar: 'https://cdn.example.com/new.png' },
      complete: async () => 'updated-user',
    },
    {
      invalidateTaskList: async () => events.push('task'),
      invalidateForumList: async () => events.push('forum'),
      invalidateForumReplies: async (id) => events.push(`forum:${id}`),
      invalidateMallList: async () => events.push('mall'),
      invalidateMallItemDetail: async (id) => events.push(`mall:${id}`),
    },
  );

  assert.equal(result, 'updated-user');
  assert.deepEqual(events, ['commit', 'task', 'forum', 'forum:post-1', 'mall', 'mall:item-1']);
});

test('row lock helper locks unique user ids in deterministic order', async () => {
  const { tx, calls } = createFakeTransaction();
  await lockUsersForProfileSnapshot(tx as never, ['user-b', 'user-a', 'user-b']);
  const lockedIds = callsFor(calls, '$queryRaw').map((args) => {
    const sql = (args as unknown[])[0] as { values: unknown[] };
    return sql.values[0];
  });
  assert.deepEqual(lockedIds, ['user-a', 'user-b']);
});

test('existing wechat login ignores unreviewed avatar URLs and delegates only safe profile changes', async () => {
  const captured: Array<{
    userId: string;
    changes: UserProfileSnapshotChanges;
  }> = [];
  const result = await updateExistingWechatUser(
    'user-1',
    {
      nickName: '微信昵称',
      avatarUrl: 'https://cdn.example.com/wechat.png',
      gender: 2,
    },
    async (params) => {
      captured.push({ userId: params.userId, changes: params.changes });
      return 'updated-by-shared-runner' as never;
    },
  );

  assert.equal(result, 'updated-by-shared-runner');
  assert.deepEqual(captured, [
    {
      userId: 'user-1',
      changes: {
        name: '微信昵称',
      },
    },
  ]);
});

for (const operation of ['create', 'update'] as const) {
  test(`admin ${operation} invalidates caches only after the transaction commits`, async () => {
    const events: string[] = [];
    const database = {
      $transaction: async <T>(callback: (tx: object) => Promise<T>) => {
        const outcome = await callback({});
        events.push('callback-finished');
        events.push('commit');
        return outcome;
      },
    };
    const invalidations: AdminContentCacheInvalidation[] = [
      { kind: 'forum-list' },
      { kind: 'forum-replies', id: 'post-1' },
    ];

    const result = await runAdminContentMutation(
      database as never,
      async () => {
        events.push(`${operation}-write`);
        return { result: `${operation}-result`, invalidations };
      },
      async (pending) => {
        events.push(`invalidate:${pending.kind}`);
      },
    );

    assert.equal(result, `${operation}-result`);
    assert.deepEqual(events, [
      `${operation}-write`,
      'callback-finished',
      'commit',
      'invalidate:forum-list',
      'invalidate:forum-replies',
    ]);
  });
}

test('failed admin content transaction never invalidates caches', async () => {
  const invalidated: AdminContentCacheInvalidation[] = [];
  const database = {
    $transaction: async <T>(callback: (tx: object) => Promise<T>) => callback({}),
  };

  await assert.rejects(
    runAdminContentMutation(
      database as never,
      async () => {
        throw new Error('write failed');
      },
      async (pending) => {
        invalidated.push(pending);
      },
    ),
    /write failed/,
  );
  assert.deepEqual(invalidated, []);
});

test('concurrent repeated first-login upserts return one user without a unique-key race', async () => {
  let stored: Record<string, unknown> | undefined;
  let createCount = 0;
  const upsertArgs: Array<{ where: unknown; update: unknown }> = [];
  const database = {
    user: {
      upsert: async (args: { where: unknown; create: Record<string, unknown>; update: unknown }) => {
        upsertArgs.push({ where: args.where, update: args.update });
        await Promise.resolve();
        if (!stored) {
          createCount += 1;
          stored = {
            id: 'user-1',
            identityType: null,
            phoneNumber: null,
            householdNo: null,
            birth: null,
            address: null,
            photos: [],
            brief: null,
            enabled: true,
            disabledAt: null,
            disabledReason: null,
            createdAt: new Date(0),
            updatedAt: new Date(0),
            ...args.create,
          };
        }
        return stored;
      },
    },
  };
  let syncCount = 0;
  const runner = async () => {
    syncCount += 1;
    throw new Error('new matching profile must not run snapshot synchronization');
  };

  const [first, second] = await Promise.all([
    upsertWechatLoginUser(database as never, 'openid-1', {
      nickName: '首次用户',
      avatarUrl: 'https://cdn.example.com/first.png',
      gender: 1,
    }, runner as never),
    upsertWechatLoginUser(database as never, 'openid-1', {
      nickName: '首次用户',
      avatarUrl: 'https://cdn.example.com/first.png',
      gender: 1,
    }, runner as never),
  ]);

  assert.equal(first.id, 'user-1');
  assert.equal(second.id, 'user-1');
  assert.equal(createCount, 1);
  assert.equal(syncCount, 0);
  assert.deepEqual(upsertArgs, [
    { where: { openid: 'openid-1' }, update: {} },
    { where: { openid: 'openid-1' }, update: {} },
  ]);
});

test('repeated login atomically obtains the existing user and synchronizes changed profile fields', async () => {
  const captured: Array<{ userId: string; changes: UserProfileSnapshotChanges }> = [];
  const existing = {
    id: 'user-1',
    openid: 'openid-1',
    name: '旧昵称',
    avatar: 'https://cdn.example.com/old.png',
    gender: 0,
  };
  const database = {
    user: {
      upsert: async () => existing,
    },
  };

  const result = await upsertWechatLoginUser(
    database as never,
    'openid-1',
    {
      nickName: '新昵称',
      avatarUrl: 'https://cdn.example.com/new.png',
      gender: 2,
    },
    async (params) => {
      captured.push({ userId: params.userId, changes: params.changes });
      return { ...existing, name: '新昵称', avatar: 'https://cdn.example.com/new.png', gender: 2 } as never;
    },
  );

  assert.equal(result.name, '新昵称');
  assert.deepEqual(captured, [
    {
      userId: 'user-1',
      changes: {
        name: '新昵称',
      },
    },
  ]);
});
