import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaAssetService } from '../src/modules/media/media-asset.service';
import { mediaCleanupWhere } from '../src/modules/media/media-cleanup.worker';
import { forumBlobRaceAction } from '../src/modules/upload/upload.service';

test('a deleted blob race revives using the newly uploaded object instead of deleting it', () => {
  assert.equal(forumBlobRaceAction({ deletedAt: new Date() }), 'REVIVE_NEW_OBJECT');
  assert.equal(forumBlobRaceAction({ deletedAt: null, deleteRequestedAt: new Date() }), 'REVIVE_NEW_OBJECT');
  assert.equal(forumBlobRaceAction({ deletedAt: null }), 'REUSE_EXISTING_OBJECT');
});

test('cleanup marks the blob before taking the reference snapshot and only finalizes the same object', async () => {
  const events: string[] = [];
  const deleted: string[] = [];
  let findCount = 0;
  const service = new MediaAssetService({
    database: {
      mediaAsset: {
        findMany: async (args: any) => {
          findCount += 1;
          if (findCount === 1) {
            return [{
              id: 'asset-1', objectKey: 'test/forum/file/u/asset.bin', url: 'https://bucket-123.cos.ap-shanghai.myqcloud.com/test/forum/file/u/asset.bin',
              uploaderId: 'u', module: 'forum', mediaType: 'FILE', state: 'DELETING', attachedAt: null,
              deleteRequestedAt: null, deletedAt: null, deleteAttempts: 0, lastDeleteError: null,
              createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), forumAttachmentBlobId: 'blob-1',
              forumAttachmentBlob: { id: 'blob-1', objectKey: 'test/forum/file/shared.bin', deletedAt: null, deleteRequestedAt: null },
            }];
          }
          events.push('refs-read');
          return [{ id: 'asset-1' }];
        },
        updateMany: async (args: any) => {
          if (args.data?.state === 'DELETING') return { count: 1 };
          return { count: 1 };
        },
      },
      forumAttachmentBlob: {
        updateMany: async (args: any) => {
          if (args.data?.deleteRequestedAt) events.push('blob-marked');
          return { count: 1 };
        },
      },
    },
    bucket: 'bucket-123', region: 'ap-shanghai', envPrefix: 'test',
    deleteObject: async (key) => { events.push('cos-delete'); deleted.push(key); },
  });
  const result = await service.deleteAsset({
    id: 'asset-1', objectKey: 'test/forum/file/u/asset.bin', url: 'https://bucket-123.cos.ap-shanghai.myqcloud.com/test/forum/file/u/asset.bin',
    uploaderId: 'u', module: 'forum', mediaType: 'FILE', state: 'PENDING', attachedAt: null,
    deleteRequestedAt: null, deletedAt: null, deleteAttempts: 0, lastDeleteError: null,
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), forumAttachmentBlobId: 'blob-1',
    forumAttachmentBlob: { id: 'blob-1', objectKey: 'test/forum/file/shared.bin', deletedAt: null, deleteRequestedAt: null },
  });
  assert.equal(result, 'deleted');
  assert.deepEqual(events.slice(0, 3), ['blob-marked', 'refs-read', 'cos-delete']);
  assert.deepEqual(deleted, ['test/forum/file/shared.bin']);
});

test('cleanup claims the current state before deleting an expired pending snapshot', async () => {
  const deleted: string[] = [];
  const updates: any[] = [];
  const service = new MediaAssetService({
    database: {
      mediaAsset: {
        findMany: async () => [],
        updateMany: async (args: any) => { updates.push(args); return { count: 0 }; },
      },
    },
    bucket: 'bucket-123',
    region: 'ap-shanghai',
    envPrefix: 'test',
    deleteObject: async (key) => { deleted.push(key); },
  });
  const result = await service.deleteAsset({
    id: 'asset-1', objectKey: 'test/forum/img/u/key.jpg', url: 'https://bucket-123.cos.ap-shanghai.myqcloud.com/test/forum/img/u/key.jpg',
    uploaderId: 'u', module: 'forum', mediaType: 'IMG', state: 'PENDING', attachedAt: null,
    deleteRequestedAt: null, deletedAt: null, deleteAttempts: 0, lastDeleteError: null,
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
  });
  assert.equal(result, 'skipped');
  assert.deepEqual(deleted, []);
  assert.deepEqual(updates[0]?.data?.state, 'DELETING');
});

test('worker fallback only selects orphan forum FILE assets and cannot starve on attached images or videos', () => {
  const where = mediaCleanupWhere(new Date('2026-08-24T00:00:00.000Z'));
  assert.deepEqual(where.OR[2], {
    state: 'ATTACHED', module: 'forum', mediaType: 'FILE', forumPostAttachment: { is: null },
  });
  assert.equal(JSON.stringify(where.OR), JSON.stringify(where.OR.filter((item: any) => item.mediaType !== 'IMG' && item.mediaType !== 'VID')));
});

test('cleanup re-reads a newly committed attachment relation after claiming an orphan snapshot', async () => {
  const deleted: string[] = [];
  const states: string[] = [];
  let reads = 0;
  const service = new MediaAssetService({
    database: {
      mediaAsset: {
        findMany: async () => {
          reads += 1;
          if (reads === 1) return [{
            id: 'asset-2', objectKey: 'test/forum/file/u/asset.bin', url: 'https://bucket-123.cos.ap-shanghai.myqcloud.com/test/forum/file/u/asset.bin',
            uploaderId: 'u', module: 'forum', mediaType: 'FILE', state: 'DELETING', attachedAt: null,
            deleteRequestedAt: null, deletedAt: null, deleteAttempts: 0, lastDeleteError: null,
            createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000), forumPostAttachment: { id: 'relation-1' },
          }];
          return [];
        },
        updateMany: async (args: any) => { states.push(args.data?.state || ''); return { count: 1 }; },
      },
    },
    bucket: 'bucket-123', region: 'ap-shanghai', envPrefix: 'test', deleteObject: async (key) => deleted.push(key),
  });
  const result = await service.deleteAsset({
    id: 'asset-2', objectKey: 'test/forum/file/u/asset.bin', url: 'https://bucket-123.cos.ap-shanghai.myqcloud.com/test/forum/file/u/asset.bin',
    uploaderId: 'u', module: 'forum', mediaType: 'FILE', state: 'ATTACHED', attachedAt: new Date(),
    deleteRequestedAt: null, deletedAt: null, deleteAttempts: 0, lastDeleteError: null,
    createdAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
  });
  assert.equal(result, 'skipped');
  assert.deepEqual(deleted, []);
  assert.deepEqual(states, ['DELETING', 'ATTACHED']);
});
