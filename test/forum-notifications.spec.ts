import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForumService } from '../src/modules/forum/forum.service';

type ForumPostRow = {
  id: string;
  authorId: string;
  visibility: string;
  deletedAt: Date | null;
  replyCount: number;
};

type ForumReplyRow = {
  id: string;
  postId: string;
  parentReplyId: string | null;
  replyToAuthorName: string | null;
  replyToUserId: string | null;
  authorId: string;
  authorName: string | null;
  authorAvatar: string | null;
  authorIdentity: string | null;
  content: string;
  images: unknown;
  videos: unknown;
  likeCount: number;
  favoriteCount: number;
  createdAt: Date;
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
  posts: ForumPostRow[];
  replies: ForumReplyRow[];
  notifications: NotificationRow[];
};

function cloneState(state: FakeState): FakeState {
  return {
    posts: state.posts.map((row) => ({ ...row })),
    replies: state.replies.map((row) => ({ ...row })),
    notifications: state.notifications.map((row) => ({ ...row })),
  };
}

function createFakeDatabase(options: {
  posts: ForumPostRow[];
  replies?: ForumReplyRow[];
  failNotification?: boolean;
  fixedReplyId?: string;
}) {
  let committed: FakeState = cloneState({
    posts: options.posts,
    replies: options.replies ?? [],
    notifications: [],
  });
  const lockedUserIds: string[] = [];
  let transactionCount = 0;
  let notificationUpserts = 0;

  function transactionClient(draft: FakeState) {
    return {
      $queryRaw: async (query: { values?: unknown[] }) => {
        const userId = String(query.values?.[0] ?? '');
        if (userId) lockedUserIds.push(userId);
        return [];
      },
      forumPost: {
        findFirst: async ({ where }: { where: { id: string; visibility?: string; deletedAt?: null } }) =>
          draft.posts.find(
            (row) =>
              row.id === where.id &&
              (!where.visibility || row.visibility === where.visibility) &&
              (where.deletedAt !== null || row.deletedAt === null),
          ) ?? null,
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { replyCount: { increment: number } };
        }) => {
          const row = draft.posts.find((candidate) => candidate.id === where.id);
          if (!row) throw new Error('post not found');
          row.replyCount += data.replyCount.increment;
          return row;
        },
      },
      forumReply: {
        findFirst: async ({ where }: { where: { id: string; postId: string } }) =>
          draft.replies.find((row) => row.id === where.id && row.postId === where.postId) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) =>
          draft.replies.find((row) => row.id === where.id) ?? null,
        create: async ({ data }: { data: Omit<ForumReplyRow, 'id' | 'likeCount' | 'favoriteCount' | 'createdAt'> }) => {
          const row: ForumReplyRow = {
            ...data,
            id: options.fixedReplyId ?? `reply-${draft.replies.length + 1}`,
            likeCount: 0,
            favoriteCount: 0,
            createdAt: new Date('2026-07-26T00:00:00.000Z'),
          };
          draft.replies.push(row);
          return row;
        },
      },
      user: {
        findUnique: async ({ where }: { where: { id: string } }) => ({
          name: `用户${where.id}`,
          avatar: null,
          identityType: null,
        }),
      },
      adminUser: {
        findFirst: async () => null,
      },
      notification: {
        upsert: async ({ create }: { create: NotificationRow }) => {
          notificationUpserts++;
          if (options.failNotification) throw new Error('notification write failed');
          const existing = draft.notifications.find(
            (row) => row.recipientId === create.recipientId && row.dedupeKey === create.dedupeKey,
          );
          if (existing) return existing;
          draft.notifications.push({ ...create });
          return create;
        },
      },
    };
  }

  const database = {
    $transaction: async <T>(callback: (tx: ReturnType<typeof transactionClient>) => Promise<T>) => {
      transactionCount++;
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
    get lockedUserIds() {
      return lockedUserIds;
    },
    get transactionCount() {
      return transactionCount;
    },
    get notificationUpserts() {
      return notificationUpserts;
    },
  };
}

function reply(overrides: Partial<ForumReplyRow> = {}): ForumReplyRow {
  return {
    id: 'reply-b',
    postId: 'post-a',
    parentReplyId: null,
    replyToAuthorName: null,
    replyToUserId: null,
    authorId: 'user-b',
    authorName: '用户B',
    authorAvatar: null,
    authorIdentity: null,
    content: 'B 的回复',
    images: [],
    videos: [],
    likeCount: 0,
    favoriteCount: 0,
    createdAt: new Date('2026-07-25T00:00:00.000Z'),
    ...overrides,
  };
}

function createService(fake: ReturnType<typeof createFakeDatabase>) {
  const ServiceWithDependencies = ForumService as unknown as new (
    database: typeof fake.database,
    cacheInvalidators: {
      invalidatePostList: () => Promise<void>;
      invalidateReplies: (postId: string) => Promise<void>;
    },
  ) => ForumService;
  return new ServiceWithDependencies(fake.database, {
    invalidatePostList: async () => undefined,
    invalidateReplies: async () => undefined,
  });
}

function onlinePost(authorId = 'user-a', id = 'post-a'): ForumPostRow {
  return { id, authorId, visibility: 'ONLINE', deletedAt: null, replyCount: 0 };
}

test('B replies to A post and creates FORUM_POST_REPLY in the reply transaction', async () => {
  const fake = createFakeDatabase({ posts: [onlinePost()] });
  const service = createService(fake);

  await service.publishReply({
    userId: 'user-b',
    postId: 'post-a',
    content: '  A 的帖子写得很好  ',
  });

  assert.equal(fake.transactionCount, 1);
  assert.equal(fake.state.replies.length, 1);
  assert.equal(fake.state.posts[0]?.replyCount, 1);
  assert.deepEqual(fake.lockedUserIds, ['user-a', 'user-b']);
  assert.deepEqual(fake.state.notifications, [
    {
      recipientId: 'user-a',
      actorId: 'user-b',
      type: 'FORUM_POST_REPLY',
      bizType: 'forum',
      bizId: 'post-a',
      title: '有人回复了你的帖子',
      content: 'A 的帖子写得很好',
      dedupeKey: 'forum:reply:reply-1:recipient:user-a',
    },
  ]);
});

test('C replies directly to B and notifies the actual parent reply author', async () => {
  const fake = createFakeDatabase({ posts: [onlinePost()], replies: [reply()] });
  const service = createService(fake);

  const created = await service.publishReply({
    userId: 'user-c',
    postId: 'post-a',
    parentReplyId: 'reply-b',
    content: '回复 B',
  });

  assert.equal(created.replyToUserId, 'user-b');
  assert.equal(fake.state.notifications[0]?.recipientId, 'user-b');
  assert.equal(fake.state.notifications[0]?.type, 'FORUM_REPLY_REPLY');
  assert.equal(fake.state.notifications[0]?.dedupeKey, 'forum:reply:reply-2:recipient:user-b');
  assert.equal(fake.state.posts[0]?.replyCount, 1);
  assert.deepEqual(fake.lockedUserIds, ['user-b', 'user-c']);
});

test('self reply is suppressed by the notification domain service', async () => {
  const fake = createFakeDatabase({ posts: [onlinePost('user-a')] });
  const service = createService(fake);

  await service.publishReply({ userId: 'user-a', postId: 'post-a', content: '补充说明' });

  assert.equal(fake.state.replies.length, 1);
  assert.equal(fake.state.posts[0]?.replyCount, 1);
  assert.equal(fake.state.notifications.length, 0);
  assert.equal(fake.notificationUpserts, 0);
});

test('forum notification dedupe key is recipient-scoped and derived from the created reply', async () => {
  const fake = createFakeDatabase({
    posts: [onlinePost()],
    fixedReplyId: 'reply-fixed',
  });
  const service = createService(fake);

  await service.publishReply({ userId: 'user-b', postId: 'post-a', content: '回复内容' });

  assert.equal(fake.notificationUpserts, 1);
  assert.equal(fake.state.notifications.length, 1);
  assert.equal(fake.state.posts[0]?.replyCount, 1);
  assert.equal(
    fake.state.notifications[0]?.dedupeKey,
    'forum:reply:reply-fixed:recipient:user-a',
  );
});

test('notification failure rejects the transaction and does not commit reply or replyCount', async () => {
  const fake = createFakeDatabase({ posts: [onlinePost()], failNotification: true });
  const service = createService(fake);

  await assert.rejects(
    service.publishReply({ userId: 'user-b', postId: 'post-a', content: '不会提交' }),
    /notification write failed/,
  );

  assert.equal(fake.state.replies.length, 0);
  assert.equal(fake.state.posts[0]?.replyCount, 0);
  assert.equal(fake.state.notifications.length, 0);
});

test('parent reply from another post is rejected before creating reply or notification', async () => {
  const fake = createFakeDatabase({
    posts: [onlinePost(), onlinePost('user-z', 'post-z')],
    replies: [reply({ id: 'reply-z', postId: 'post-z', authorId: 'user-z' })],
  });
  const service = createService(fake);

  await assert.rejects(
    service.publishReply({
      userId: 'user-c',
      postId: 'post-a',
      parentReplyId: 'reply-z',
      content: '非法跨帖回复',
    }),
    /要回复的评论不存在/,
  );

  assert.equal(fake.state.replies.length, 1);
  assert.equal(fake.state.notifications.length, 0);
});

test('notification excerpt strips markup and controls and truncates by 80 Unicode code points', async () => {
  const fake = createFakeDatabase({ posts: [onlinePost()] });
  const service = createService(fake);
  const emojiContent = `<script>alert(1)</script>\u0000${'😀'.repeat(79)}末尾`;

  await service.publishReply({ userId: 'user-b', postId: 'post-a', content: emojiContent });

  const summary = fake.state.notifications[0]?.content ?? '';
  assert.equal(fake.state.posts[0]?.replyCount, 1);
  assert.equal(summary.includes('<script>'), false);
  assert.equal(summary.includes('\u0000'), false);
  assert.equal(Array.from(summary).length, 80);
  assert.equal(summary, `${'😀'.repeat(79)}末`);
});

test('notification excerpt removes unclosed script or style bodies after case-insensitive attributed opening tags', async () => {
  const cases = [
    '保留前文<SCRIPT type="text/javascript">不能泄露<script>嵌套内容',
    '保留前文<StYlE media="screen">.secret { display: block }',
  ];

  for (const content of cases) {
    const fake = createFakeDatabase({ posts: [onlinePost()] });
    await createService(fake).publishReply({ userId: 'user-b', postId: 'post-a', content });

    assert.equal(fake.state.notifications[0]?.content, '保留前文');
    assert.equal(fake.state.posts[0]?.replyCount, 1);
  }
});

test('notification excerpt removes nested and multiple dangerous blocks without leaking their bodies', async () => {
  const fake = createFakeDatabase({ posts: [onlinePost()] });
  const content =
    '前<script>one<script>two</script>three</script>中' +
    '<style>a<style>b</style>c</style>后' +
    '<script data-last="true">unclosed secret';

  await createService(fake).publishReply({ userId: 'user-b', postId: 'post-a', content });

  assert.equal(fake.state.notifications[0]?.content, '前中后');
  assert.equal(fake.state.posts[0]?.replyCount, 1);
});

test('cross-closed mixed dangerous blocks stay suppressed until every opened block closes', async () => {
  const cases = [
    '<script><style>hidden</script>LEAK</style>',
    '<style><script>hidden</style>LEAK</script>',
  ];

  for (const dangerousContent of cases) {
    const fake = createFakeDatabase({ posts: [onlinePost()] });
    await createService(fake).publishReply({
      userId: 'user-b',
      postId: 'post-a',
      content: `安全前文${dangerousContent}安全后文`,
    });

    assert.equal(fake.state.notifications[0]?.content, '安全前文安全后文');
    assert.equal(fake.state.posts[0]?.replyCount, 1);
  }
});

test('repeated mismatched dangerous closing tags never release still-open dangerous content', async () => {
  const fake = createFakeDatabase({ posts: [onlinePost()] });
  const content =
    '安全前文<script><style>hidden</script>LEAK1</script>LEAK2</style>安全后文';

  await createService(fake).publishReply({ userId: 'user-b', postId: 'post-a', content });

  assert.equal(fake.state.notifications[0]?.content, '安全前文安全后文');
  assert.equal(fake.state.posts[0]?.replyCount, 1);
});

test('unmatched dangerous closing tags outside a block are stripped while safe text remains', async () => {
  const fake = createFakeDatabase({ posts: [onlinePost()] });
  const content = '安全前文</script>安全中间</STYLE>安全后文';

  await createService(fake).publishReply({ userId: 'user-b', postId: 'post-a', content });

  assert.equal(fake.state.notifications[0]?.content, '安全前文安全中间安全后文');
  assert.equal(fake.state.posts[0]?.replyCount, 1);
});

test('image-only and video-only replies use a fixed safe summary without copying media data', async () => {
  const cases = [
    { images: ['https://cdn.example.com/private-photo.png'] },
    { videos: ['https://cdn.example.com/private-video.mp4'] },
  ];

  for (const media of cases) {
    const fake = createFakeDatabase({ posts: [onlinePost()] });
    await createService(fake).publishReply({
      userId: 'user-b',
      postId: 'post-a',
      content: ' \n\t ',
      ...media,
    });

    const notification = fake.state.notifications[0];
    const summary = notification?.content;
    assert.equal(summary, '对方发送了图片或视频回复');
    assert.equal(summary?.includes('http'), false);
    assert.equal(summary?.includes('private-'), false);
    assert.equal(notification ? Object.hasOwn(notification, 'images') : true, false);
    assert.equal(notification ? Object.hasOwn(notification, 'videos') : true, false);
    assert.equal(fake.state.posts[0]?.replyCount, 1);
  }
});
