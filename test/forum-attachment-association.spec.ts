import assert from 'node:assert/strict';
import test from 'node:test';
import { assertForumAttachmentsAvailable, forumAttachmentIds, replaceForumPostAttachments } from '../src/modules/forum/forum-attachments';

function database(assets: any[], current: any[] = []) {
  return {
    mediaAsset: { findMany: async () => assets, updateMany: async () => ({ count: 0 }) },
    forumPostAttachment: { findMany: async () => current, deleteMany: async () => ({}), createMany: async () => ({ count: 0 }) },
  } as any;
}

test('new association only accepts the current owner PENDING asset', async () => {
  await assert.rejects(
    () => assertForumAttachmentsAvailable(database([{ id: 'a', uploaderId: 'other', module: 'forum', mediaType: 'FILE', state: 'PENDING' }]), { uploaderId: 'admin', mediaAssetIds: ['a'] }),
    /不属于当前管理员/,
  );
});

test('edit can retain the current post ATTACHED asset but rejects another post', async () => {
  await assert.doesNotReject(() => assertForumAttachmentsAvailable(
    database([{ id: 'a', uploaderId: 'other', module: 'forum', mediaType: 'FILE', state: 'ATTACHED' }], [{ mediaAssetId: 'a' }]),
    { uploaderId: 'admin', postId: 'post-1', mediaAssetIds: ['a'] },
  ));
  await assert.rejects(
    () => assertForumAttachmentsAvailable(database([{ id: 'a', uploaderId: 'other', module: 'forum', mediaType: 'FILE', state: 'ATTACHED' }]), { uploaderId: 'admin', postId: 'post-1', mediaAssetIds: ['a'] }),
    /其他帖子/,
  );
});

test('attachment lists cap at five and reject duplicate IDs', () => {
  assert.throws(() => forumAttachmentIds([{ mediaAssetId: '1' }, { mediaAssetId: '1' }]), /不能重复/);
  assert.throws(() => forumAttachmentIds(Array.from({ length: 6 }, (_, i) => ({ mediaAssetId: String(i) }))), /最多上传 5/);
});

test('association aborts when cleanup wins the PENDING to ATTACHED conditional update', async () => {
  let created = 0;
  const database = {
    mediaAsset: {
      findMany: async () => [{ id: 'asset-1' }],
      updateMany: async () => ({ count: 0 }),
    },
    forumPostAttachment: {
      findMany: async () => [],
      deleteMany: async () => ({}),
      createMany: async () => { created += 1; return { count: 1 }; },
    },
  } as any;
  await assert.rejects(
    () => replaceForumPostAttachments(database, { postId: 'post-1', mediaAssetIds: ['asset-1'] }),
    /附件状态已变化/,
  );
  assert.equal(created, 0);
});

test('editing can retain an ATTACHED asset while atomically attaching one new PENDING asset', async () => {
  let created = 0;
  const database = {
    mediaAsset: {
      findMany: async (args: any) => args.where?.state === 'PENDING'
        ? [{ id: 'new-pending', state: 'PENDING' }]
        : [{ id: 'old-attached', state: 'ATTACHED' }, { id: 'new-pending', state: 'PENDING' }],
      updateMany: async (args: any) => ({ count: args.data?.state === 'ATTACHED' ? 1 : 2 }),
    },
    forumPostAttachment: {
      findMany: async () => [{ mediaAssetId: 'old-attached' }],
      deleteMany: async () => ({}),
      createMany: async ({ data }: any) => { created = data.length; return { count: data.length }; },
    },
  } as any;
  await assert.doesNotReject(() => replaceForumPostAttachments(database, { postId: 'post-1', mediaAssetIds: ['old-attached', 'new-pending'] }));
  assert.equal(created, 2);
});

test('stale edit cannot reattach an asset already moved to DELETE_PENDING by another edit', async () => {
  let created = 0;
  const database = {
    mediaAsset: {
      findMany: async (args: any) => args.where?.state === 'PENDING' ? [] : [{ id: 'old-attached', state: 'DELETE_PENDING' }],
      updateMany: async () => ({ count: 1 }),
    },
    forumPostAttachment: {
      findMany: async () => [{ mediaAssetId: 'old-attached' }],
      deleteMany: async () => ({}),
      createMany: async () => { created += 1; return { count: 1 }; },
    },
  } as any;
  await assert.rejects(
    () => replaceForumPostAttachments(database, { postId: 'post-1', mediaAssetIds: ['old-attached'] }),
    /附件状态已变化|不可关联/,
  );
  assert.equal(created, 0);
});

test('edit A removal followed by stale edit B cannot recreate the removed relation', async () => {
  let state = 'ATTACHED';
  let relation = true;
  let created = 0;
  const database = {
    mediaAsset: {
      findMany: async (args: any) => [{ id: 'asset-1', state }].filter((asset) => !args.where?.state || args.where.state === asset.state),
      updateMany: async (args: any) => {
        if (args.data?.state === 'DELETE_PENDING') { if (state !== 'ATTACHED') return { count: 0 }; state = 'DELETE_PENDING'; return { count: 1 }; }
        if (args.where?.state?.in && state !== 'ATTACHED') return { count: 0 };
        return { count: 1 };
      },
    },
    forumPostAttachment: {
      findMany: async () => relation ? [{ mediaAssetId: 'asset-1' }] : [],
      deleteMany: async () => { relation = false; return {}; },
      createMany: async () => { relation = true; created += 1; return { count: 1 }; },
    },
  } as any;
  await replaceForumPostAttachments(database, { postId: 'post-1', mediaAssetIds: [] });
  await assert.rejects(
    () => replaceForumPostAttachments(database, { postId: 'post-1', mediaAssetIds: ['asset-1'] }),
    /附件状态已变化/,
  );
  assert.equal(created, 0);
  assert.equal(relation, false);
});
