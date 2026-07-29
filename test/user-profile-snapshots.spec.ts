import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ForumService } from '../src/modules/forum/forum.service';
import { serializeMallItem, serializeMallOrder } from '../src/modules/mall/mall.serialize';
import { TaskService } from '../src/modules/task/task.service';
import { avatarOrDefault, validateDefaultAvatarConfiguration } from '../src/modules/user/default-avatar';

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../prisma/migrations/20260726090000_add_author_avatar_snapshots/migration.sql', import.meta.url),
  'utf8',
);
const userService = readFileSync(new URL('../src/modules/user/user.service.ts', import.meta.url), 'utf8');
const profileSyncService = readFileSync(new URL('../src/modules/user/user-profile-sync.ts', import.meta.url), 'utf8');
const taskService = readFileSync(new URL('../src/modules/task/task.service.ts', import.meta.url), 'utf8');
const forumService = readFileSync(new URL('../src/modules/forum/forum.service.ts', import.meta.url), 'utf8');
const mallItemService = readFileSync(new URL('../src/modules/mall/mall-item.service.ts', import.meta.url), 'utf8');
const mallCommentService = readFileSync(
  new URL('../src/modules/mall/mall-comment.service.ts', import.meta.url),
  'utf8',
);
const mallOrderService = readFileSync(new URL('../src/modules/mall/mall-order.service.ts', import.meta.url), 'utf8');
const adminService = readFileSync(new URL('../src/modules/admin/admin.service.ts', import.meta.url), 'utf8');
const authService = readFileSync(new URL('../src/modules/auth/auth.service.ts', import.meta.url), 'utf8');
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  scripts?: Record<string, string>;
};

const expectedMigrationColumns = [
  ['Task', 'publisherAvatar'],
  ['Task', 'takerAvatar'],
  ['forum_replies', 'authorAvatar'],
  ['forum_replies', 'replyToUserId'],
  ['mall_items', 'publisherName'],
  ['mall_items', 'publisherAvatar'],
  ['mall_item_comments', 'authorName'],
  ['mall_item_comments', 'authorAvatar'],
  ['mall_item_comments', 'replyToUserId'],
  ['mall_orders', 'sellerName'],
  ['mall_orders', 'sellerAvatar'],
  ['mall_orders', 'buyerName'],
  ['mall_orders', 'buyerAvatar'],
] as const;

function modelBody(modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `Prisma model ${modelName} must exist`);
  return match[1];
}

function assertOptionalStringField(modelName: string, fieldName: string): void {
  assert.match(
    modelBody(modelName),
    new RegExp(`^\\s*${fieldName}\\s+String\\?\\s*$`, 'm'),
    `${modelName}.${fieldName} must be an optional string snapshot`,
  );
}

function withDefaultAvatarEnv(value: string | undefined, callback: () => void): void {
  const previous = process.env.DEFAULT_AVATAR_URL;
  if (value === undefined) delete process.env.DEFAULT_AVATAR_URL;
  else process.env.DEFAULT_AVATAR_URL = value;

  try {
    callback();
  } finally {
    if (previous === undefined) delete process.env.DEFAULT_AVATAR_URL;
    else process.env.DEFAULT_AVATAR_URL = previous;
  }
}

test('Prisma models persist task and forum author profile snapshots', () => {
  assertOptionalStringField('Task', 'publisherAvatar');
  assertOptionalStringField('Task', 'takerAvatar');
  assertOptionalStringField('ForumReply', 'authorAvatar');
  assertOptionalStringField('ForumReply', 'replyToUserId');
});

test('Prisma models persist mall author and order profile snapshots', () => {
  assertOptionalStringField('MallItem', 'publisherName');
  assertOptionalStringField('MallItem', 'publisherAvatar');
  assertOptionalStringField('MallItemComment', 'authorName');
  assertOptionalStringField('MallItemComment', 'authorAvatar');
  assertOptionalStringField('MallItemComment', 'replyToUserId');
  assertOptionalStringField('MallOrder', 'sellerName');
  assertOptionalStringField('MallOrder', 'sellerAvatar');
  assertOptionalStringField('MallOrder', 'buyerName');
  assertOptionalStringField('MallOrder', 'buyerAvatar');
});

test('author snapshot migration adds all nullable columns to their mapped tables', () => {
  const additions: Array<[string, string]> = [];
  const statements = migration.matchAll(/ALTER TABLE `([^`]+)`([\s\S]*?);/g);

  for (const statement of statements) {
    const [, tableName, body] = statement;
    const clauses = [...body.matchAll(/ADD COLUMN\s+`([^`]+)`\s+VARCHAR\(191\)\s+NULL/g)];
    for (const clause of clauses) additions.push([tableName, clause[1]]);
  }

  assert.equal(
    (migration.match(/\bADD COLUMN\b/g) || []).length,
    expectedMigrationColumns.length,
    'migration must contain exactly 13 ADD COLUMN clauses',
  );
  assert.deepEqual(additions, expectedMigrationColumns);
});

test('author snapshot migration backfills every retained profile snapshot with MySQL joins', () => {
  for (const table of ['Task', 'forum_posts', 'forum_replies', 'mall_items', 'mall_item_comments', 'mall_orders']) {
    assert.match(migration, new RegExp(`UPDATE\\s+\`${table}\`\\s+AS\\s+`, 'i'), `${table} must be backfilled`);
  }
  assert.match(migration, /UPDATE\s+`Task`[\s\S]*publisherName[\s\S]*publisherAvatar[\s\S]*publisherIdentity/i);
  assert.match(migration, /UPDATE\s+`Task`[\s\S]*takerName[\s\S]*takerAvatar/i);
  assert.match(
    migration,
    /UPDATE\s+`forum_posts`\s+AS\s+`post`\s+JOIN\s+`User`\s+AS\s+`author`\s+ON\s+`author`\.`id`\s*=\s*`post`\.`authorId`\s+SET\s+`post`\.`authorName`\s*=\s*`author`\.`name`,\s+`post`\.`authorAvatar`\s*=\s*NULLIF\(TRIM\(`author`\.`avatar`\),\s*''\),\s+`post`\.`authorIdentity`\s*=\s*`author`\.`identityType`;/i,
    'forum_posts must backfill all author snapshots from its authorId relation',
  );
  assert.match(migration, /UPDATE\s+`forum_replies`[\s\S]*authorName[\s\S]*authorAvatar[\s\S]*authorIdentity/i);
  assert.match(
    migration,
    /UPDATE\s+`forum_replies`[\s\S]*JOIN\s+`forum_replies`[\s\S]*parentReplyId[\s\S]*replyToUserId[\s\S]*replyToAuthorName/i,
  );
  assert.match(migration, /UPDATE\s+`mall_items`[\s\S]*publisherName[\s\S]*publisherAvatar/i);
  assert.match(migration, /UPDATE\s+`mall_item_comments`[\s\S]*authorName[\s\S]*authorAvatar/i);
  assert.match(
    migration,
    /UPDATE\s+`mall_item_comments`[\s\S]*JOIN\s+`mall_item_comments`[\s\S]*parentId[\s\S]*replyToUserId[\s\S]*replyToAuthorName/i,
  );
  assert.match(migration, /UPDATE\s+`mall_orders`[\s\S]*sellerName[\s\S]*sellerAvatar/i);
  assert.match(migration, /UPDATE\s+`mall_orders`[\s\S]*buyerName[\s\S]*buyerAvatar/i);
});

test('migration keeps avatar snapshots nullable and never persists an environment-specific default URL', () => {
  const normalizedAvatarAssignments = [
    ...migration.matchAll(
      /`(?:publisherAvatar|takerAvatar|authorAvatar|sellerAvatar|buyerAvatar)`\s*=\s*NULLIF\(TRIM\(`[^`]+`\.`avatar`\),\s*''\)/g,
    ),
  ];

  assert.equal(normalizedAvatarAssignments.length, 8, 'all eight user-avatar backfills must normalize blank values to NULL');
  assert.doesNotMatch(migration, /COALESCE\s*\(/i);
  assert.doesNotMatch(migration, /DEFAULT_AVATAR_URL|\/static\/avatar|https?:\/\//i);
});

test('snapshot synchronization lookup indexes exist in schema and migration', () => {
  assert.match(modelBody('ForumReply'), /@@index\(\[authorId\]\)/);
  assert.match(modelBody('ForumReply'), /@@index\(\[replyToUserId\]\)/);
  assert.match(modelBody('MallItemComment'), /@@index\(\[replyToUserId\]\)/);
  for (const indexName of [
    'forum_replies_authorId_idx',
    'forum_replies_replyToUserId_idx',
    'mall_item_comments_replyToUserId_idx',
  ]) {
    assert.match(migration, new RegExp(`ADD INDEX \`${indexName}\``));
  }
});

test('avatarOrDefault uses the mini program fallback when no environment override exists', () => {
  withDefaultAvatarEnv(undefined, () => {
    assert.equal(avatarOrDefault(null), '/static/avatar1.png');
    assert.equal(avatarOrDefault('   '), '/static/avatar1.png');
  });
});

test('avatarOrDefault ignores a blank DEFAULT_AVATAR_URL environment override', () => {
  withDefaultAvatarEnv('   ', () => {
    assert.equal(avatarOrDefault(undefined), '/static/avatar1.png');
  });
});

test('avatarOrDefault prefers an existing avatar then DEFAULT_AVATAR_URL', () => {
  withDefaultAvatarEnv('https://cdn.example.com/default-avatar.png', () => {
    assert.equal(avatarOrDefault(' https://cdn.example.com/user.png '), 'https://cdn.example.com/user.png');
    assert.equal(avatarOrDefault(undefined), 'https://cdn.example.com/default-avatar.png');
  });
});

test('production requires an absolute HTTP(S) default avatar URL', () => {
  assert.throws(() => validateDefaultAvatarConfiguration('production', undefined), /DEFAULT_AVATAR_URL/);
  assert.throws(() => validateDefaultAvatarConfiguration('production', '/static/avatar1.png'), /HTTP\(S\)/);
  assert.equal(
    validateDefaultAvatarConfiguration('production', 'https://cdn.example.com/default.png'),
    'https://cdn.example.com/default.png',
  );
});

test('development and test retain the mini program relative avatar fallback', () => {
  assert.equal(validateDefaultAvatarConfiguration('development', undefined), '/static/avatar1.png');
  assert.equal(validateDefaultAvatarConfiguration('test', '/static/avatar1.png'), '/static/avatar1.png');
});

test('package exposes the standard full test command', () => {
  assert.equal(packageJson.scripts?.test, 'tsx --test test/*.spec.ts');
});

test('wechat login routes existing profile changes through the shared synchronizer', () => {
  assert.match(authService, /runUserProfileUpdate/);
  assert.doesNotMatch(authService, /user\.upsert\([\s\S]*update:\s*profileData/);
});

test('updateMe synchronizes every retained profile snapshot in its transaction', () => {
  assert.match(userService, /runUserProfileUpdate/);
  const requiredDelegates = [
    'tx.task.updateMany',
    'tx.forumPost.updateMany',
    'tx.forumReply.updateMany',
    'tx.mallItem.updateMany',
    'tx.mallItemComment.updateMany',
    'tx.mallOrder.updateMany',
  ];
  for (const delegate of requiredDelegates) {
    assert.match(profileSyncService, new RegExp(delegate.replace('.', '\\.')), `${delegate} must run in shared sync`);
  }

  assert.match(profileSyncService, /where:\s*\{\s*replyToUserId:\s*userId\s*\}/);
  assert.doesNotMatch(profileSyncService, /replyToAuthorName:\s*\{\s*contains:/);
  assert.doesNotMatch(profileSyncService, /\.adminLabel\s*=/);
  assert.doesNotMatch(profileSyncService, /data:\s*\{\s*adminLabel:/);
});

test('profile snapshot synchronization covers publisher, taker, reply target, seller and buyer roles', () => {
  const requiredWhereClauses = [
    /publisherId:\s*userId/,
    /takerId:\s*userId/,
    /authorId:\s*userId/,
    /replyToUserId:\s*userId/,
    /sellerId:\s*userId/,
    /buyerId:\s*userId/,
  ];
  for (const clause of requiredWhereClauses) assert.match(profileSyncService, clause);

  const requiredSnapshotFields = [
    'publisherName',
    'publisherAvatar',
    'publisherIdentity',
    'takerName',
    'takerAvatar',
    'authorName',
    'authorAvatar',
    'authorIdentity',
    'replyToAuthorName',
    'sellerName',
    'sellerAvatar',
    'buyerName',
    'buyerAvatar',
  ];
  for (const field of requiredSnapshotFields) {
    assert.match(profileSyncService, new RegExp(`\\b${field}\\b`), `${field} must be synchronized`);
  }
});

test('creation paths persist profile snapshots read by the server', () => {
  for (const field of ['publisherName', 'publisherAvatar', 'publisherIdentity', 'takerName', 'takerAvatar']) {
    assert.match(taskService, new RegExp(`\\b${field}\\b`), `task creation/claim must write ${field}`);
  }
  for (const field of ['authorName', 'authorAvatar', 'authorIdentity', 'replyToUserId']) {
    assert.match(forumService, new RegExp(`\\b${field}\\b`), `forum creation must write ${field}`);
  }
  for (const field of ['publisherName', 'publisherAvatar']) {
    assert.match(mallItemService, new RegExp(`\\b${field}\\b`), `mall item creation must write ${field}`);
  }
  for (const field of ['authorName', 'authorAvatar', 'replyToUserId']) {
    assert.match(mallCommentService, new RegExp(`\\b${field}\\b`), `mall comment creation must write ${field}`);
  }
  for (const field of ['sellerName', 'sellerAvatar', 'buyerName', 'buyerAvatar']) {
    assert.match(mallOrderService, new RegExp(`\\b${field}\\b`), `mall order creation must write ${field}`);
  }
});

test('all snapshot creation and actor-transfer paths acquire the shared user row lock', () => {
  for (const [source, label, minimumCalls] of [
    [taskService, 'task', 4],
    [forumService, 'forum', 2],
    [mallItemService, 'mall item', 1],
    [mallCommentService, 'mall comment', 1],
    [mallOrderService, 'mall order', 1],
    [adminService, 'admin content', 2],
  ] as const) {
    assert.match(source, /lockUsersForProfileSnapshot/, `${label} must use the shared row lock`);
    assert.ok(
      (source.match(/await lockUsersForProfileSnapshot\(/g) || []).length >= minimumCalls,
      `${label} must lock every snapshot-writing path`,
    );
  }
});

test('admin content creation and actor edits retain labels while refreshing snapshots', () => {
  assert.match(adminService, /adminLabel,/);
  for (const field of ['authorAvatar', 'authorIdentity', 'publisherName', 'publisherAvatar', 'publisherIdentity']) {
    assert.match(adminService, new RegExp(`\\b${field}\\b`), `admin content must write ${field}`);
  }
});

test('admin create and update route transaction results through post-commit cache invalidation', () => {
  assert.match(adminService, /import\s+\{\s*runAdminContentMutation\s*\}/);
  assert.equal(
    (adminService.match(/return runAdminContentMutation\(/g) || []).length,
    2,
    'createContent and updateContentFields must both use the post-commit mutation runner',
  );
});

test('admin task, forum and mall list/detail output also applies the avatar fallback', () => {
  assert.match(adminService, /import\s+\{\s*avatarOrDefault\s*\}/);
  assert.match(adminService, /authorAvatar:\s*avatarOrDefault\(row\.authorAvatar\)/);
  assert.match(adminService, /publisherAvatar:\s*avatarOrDefault\(row\.publisherAvatar\)/);
  assert.match(adminService, /takerAvatar:\s*avatarOrDefault\(row\.takerAvatar\)/);
  assert.match(adminService, /authorAvatar:\s*avatarOrDefault\(r\.authorAvatar\)/);
});

test('task, forum, mall item and order serializers never return blank avatars', () => {
  withDefaultAvatarEnv(undefined, () => {
    const now = new Date('2026-07-26T00:00:00.000Z');
    const task = (
      new TaskService() as unknown as {
        mapTask(row: Record<string, unknown>): {
          publisherAvatar: string;
          takerAvatar: string;
        };
      }
    ).mapTask({
      id: 'task-1',
      title: '任务',
      desc: '',
      images: [],
      videos: [],
      reward: null,
      location: null,
      status: 'PENDING_TAKE',
      publisherId: 'publisher-1',
      publisherName: '发布者',
      publisherAvatar: null,
      publisherIdentity: null,
      adminLabel: null,
      takerId: null,
      takerName: null,
      takerAvatar: null,
      proofText: null,
      proofImages: [],
      createdAt: now,
      claimedAt: null,
      completedAt: null,
      confirmedAt: null,
    });
    assert.equal(task.publisherAvatar, '/static/avatar1.png');
    assert.equal(task.takerAvatar, '/static/avatar1.png');

    const forum = (
      new ForumService() as unknown as {
        mapPostListItem(
          row: Record<string, unknown>,
          userId: string,
          liked: boolean,
          favorited: boolean,
        ): { authorAvatar: string };
      }
    ).mapPostListItem(
      {
        id: 'post-1',
        title: '帖子',
        content: '',
        images: [],
        videos: [],
        authorId: 'author-1',
        authorName: '作者',
        authorIdentity: null,
        authorAvatar: null,
        adminLabel: null,
        likeCount: 0,
        replyCount: 0,
        createdAt: now,
      },
      '',
      false,
      false,
    );
    assert.equal(forum.authorAvatar, '/static/avatar1.png');

    const item = serializeMallItem({
      id: 'item-1',
      categoryId: 'flea',
      title: '商品',
      price: null,
      unit: '元',
      desc: '',
      contact: null,
      mainImages: [],
      subImages: [],
      videos: [],
      images: [],
      publisherId: 'seller-1',
      publisherName: '卖家',
      publisherAvatar: null,
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(item.publisherAvatar, '/static/avatar1.png');

    const order = serializeMallOrder({
      id: 'order-1',
      itemId: 'item-1',
      itemTitle: '商品',
      itemPrice: null,
      itemUnit: '元',
      sellerId: 'seller-1',
      sellerName: '卖家',
      sellerAvatar: null,
      buyerId: 'buyer-1',
      buyerName: '买家',
      buyerAvatar: null,
      contact: null,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    assert.equal(order.sellerAvatar, '/static/avatar1.png');
    assert.equal(order.buyerAvatar, '/static/avatar1.png');
  });
});

test('profile updates invalidate task, forum, mall list and affected detail caches', () => {
  for (const invalidator of [
    'invalidatePendingTasksListCache',
    'invalidateForumPostListCache',
    'invalidateForumPostRepliesCache',
    'invalidateMallItemsListCache',
    'invalidateMallItemDetailCache',
  ]) {
    assert.match(profileSyncService, new RegExp(`\\b${invalidator}\\b`), `${invalidator} must be called`);
  }
});
