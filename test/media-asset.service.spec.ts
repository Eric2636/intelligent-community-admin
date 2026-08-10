import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaAssetService } from '../src/modules/media/media-asset.service';

type Row = {
  id: string;
  objectKey: string;
  url: string;
  uploaderId: string;
  module: string;
  mediaType: 'IMG' | 'VID';
  state: 'PENDING' | 'ATTACHED' | 'DELETE_PENDING' | 'DELETED' | 'DELETE_FAILED';
  attachedAt: Date | null;
  deleteRequestedAt: Date | null;
  deletedAt: Date | null;
  deleteAttempts: number;
  lastDeleteError: string | null;
  createdAt: Date;
};

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: 'asset-1',
    objectKey: 'production/forum/img/user-1/photo.jpg',
    url: 'https://bucket-1.cos.ap-shanghai.myqcloud.com/production/forum/img/user-1/photo.jpg',
    uploaderId: 'user-1',
    module: 'forum',
    mediaType: 'IMG',
    state: 'PENDING',
    attachedAt: null,
    deleteRequestedAt: null,
    deletedAt: null,
    deleteAttempts: 0,
    lastDeleteError: null,
    createdAt: new Date('2026-08-09T00:00:00.000Z'),
    ...overrides,
  };
}

test('assets attach only for their uploader and become delete-pending without deleting immediately', async () => {
  const rows = new Map<string, Row>([['asset-1', row()]]);
  const updates: Array<{ where: unknown; data: unknown }> = [];
  const database = {
    mediaAsset: {
        findMany: async () => [...rows.values()],
        updateMany: async (args: { where: { objectKey?: { in: string[] }; uploaderId?: string; state?: unknown }; data: Partial<Row> }) => {
          updates.push(args);
          let count = 0;
          for (const value of rows.values()) {
            if (args.where.objectKey?.in && !args.where.objectKey.in.includes(value.objectKey)) continue;
            if (args.where.uploaderId && args.where.uploaderId !== value.uploaderId) continue;
            if (args.where.state === 'PENDING' && value.state !== 'PENDING') continue;
            Object.assign(value, args.data);
            count += 1;
          }
          return { count };
        },
    },
  };
  const service = new MediaAssetService({
    database,
    bucket: 'bucket-1',
    region: 'ap-shanghai',
    envPrefix: 'production',
  });

  await assert.rejects(
    () => service.attachUrls(database as never, { uploaderId: 'another-user', urls: [row().url] }),
    /媒体不属于当前用户/,
  );

  await service.attachUrls(database as never, { uploaderId: 'user-1', urls: [row().url] });
  assert.equal(rows.get('asset-1')?.state, 'ATTACHED');

  await service.requestDeleteUrls(database as never, [row().url]);
  assert.equal(rows.get('asset-1')?.state, 'DELETE_PENDING');
  assert.equal(updates.length, 2);
});

test('only stale pending production business media can be deleted from COS', async () => {
  const deleted: string[] = [];
  const service = new MediaAssetService({
    database: { mediaAsset: { updateMany: async () => ({ count: 1 }) } },
    bucket: 'bucket-1',
    region: 'ap-shanghai',
    envPrefix: 'production',
    deleteObject: async (objectKey) => { deleted.push(objectKey); },
    now: () => new Date('2026-08-10T01:00:00.000Z'),
  });

  assert.equal(await service.deleteAsset(row()), 'deleted');
  assert.deepEqual(deleted, ['production/forum/img/user-1/photo.jpg']);
  assert.equal(
    await service.deleteAsset(row({ objectKey: 'test/forum/img/user-1/photo.jpg', state: 'DELETE_PENDING' })),
    'skipped',
  );
});

test('uploaded media is registered as pending only in the current COS environment', async () => {
  const creates: unknown[] = [];
  const database = {
    mediaAsset: {
      upsert: async (args: unknown) => {
        creates.push(args);
        return row();
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
  const service = new MediaAssetService({
    database: database as never,
    bucket: 'bucket-1',
    region: 'ap-shanghai',
    envPrefix: 'production',
  });

  await service.registerUploaded({
    userId: 'user-1',
    module: 'forum',
    type: 'img',
    key: row().objectKey,
    url: row().url,
  });
  assert.equal(creates.length, 1);

  await assert.rejects(
    () => service.registerUploaded({
      userId: 'user-1',
      module: 'forum',
      type: 'img',
      key: 'test/forum/img/user-1/photo.jpg',
      url: row().url,
    }),
    /媒体路径不属于当前环境/,
  );
});
