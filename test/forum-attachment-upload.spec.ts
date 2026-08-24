import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { isForumAttachmentShaConflict, MAX_FORUM_ATTACHMENT_BYTES, UploadService, validateForumAttachmentFile } from '../src/modules/upload/upload.service';

test('forum attachment accepts exactly 20 MiB and rejects one byte over', () => {
  const valid = Buffer.alloc(MAX_FORUM_ATTACHMENT_BYTES, 0x41);
  assert.doesNotThrow(() => validateForumAttachmentFile({ filename: 'notice.txt', contentType: 'text/plain', buffer: valid }));
  assert.throws(
    () => validateForumAttachmentFile({ filename: 'notice.txt', contentType: 'text/plain', buffer: Buffer.concat([valid, Buffer.from('x')]) }),
    /20MB/,
  );
});

test('forum attachment rejects MIME and extension mismatch', () => {
  assert.throws(
    () => validateForumAttachmentFile({ filename: 'notice.pdf', contentType: 'text/plain', buffer: Buffer.from('%PDF-1.7') }),
    /类型必须匹配/,
  );
});

test('forum attachment rejects empty files and unsupported extensions', () => {
  assert.throws(() => validateForumAttachmentFile({ filename: 'x.zip', contentType: 'application/zip', buffer: Buffer.from('x') }), /仅支持/);
  assert.throws(() => validateForumAttachmentFile({ filename: 'x.txt', contentType: 'text/plain', buffer: Buffer.alloc(0) }), /为空/);
});

test('OOXML extension requires a real central directory with matching document roots', () => {
  const fakeZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(18), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
  assert.throws(
    () => validateForumAttachmentFile({ filename: 'fake.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fakeZip }),
    /签名无效/,
  );
});

test('only a forum blob SHA unique conflict may enter winner reuse; asset persistence errors must not', () => {
  assert.equal(isForumAttachmentShaConflict({ code: 'P2002', meta: { target: ['sha256'] } }), true);
  assert.equal(isForumAttachmentShaConflict({ code: 'P2002', meta: { target: ['objectKey'] } }), false);
  assert.equal(isForumAttachmentShaConflict({ code: 'P2002', message: 'Unique constraint on media_assets' }), false);
  assert.equal(isForumAttachmentShaConflict(new Error('asset create failed')), false);
});

function uploadFixture(assetError: any) {
  const blobs = new Map<string, any>();
  const deleted: string[] = [];
  const database: any = {
    forumAttachmentBlob: {
      findUnique: async ({ where }: any) => blobs.get(where.sha256) || null,
    },
    mediaAsset: {},
    $transaction: async (callback: any) => {
      const tx: any = {
        forumAttachmentBlob: {
          create: async ({ data }: any) => {
            if (assetError?.stage === 'blob') throw assetError.error;
            const blob = { id: 'blob-1', ...data, deletedAt: null, deleteRequestedAt: null };
            blobs.set(data.sha256, blob);
            return blob;
          },
          updateMany: async () => ({ count: 1 }),
          findUnique: async ({ where }: any) => [...blobs.values()].find((blob) => blob.id === where.id) || null,
        },
        mediaAsset: {
          create: async () => {
            if (assetError?.stage === 'asset') throw assetError.error;
            return { id: 'asset-1' };
          },
        },
      };
      try {
        return await callback(tx);
      } catch (error) {
        blobs.clear();
        throw error;
      }
    },
  };
  const service = new UploadService({
    database,
    cosFactory: () => ({
      putObject: (_args: any, cb: (error?: Error) => void) => cb(),
      deleteObject: (args: any, cb: () => void) => { deleted.push(args.Key); cb(); },
    }),
  });
  return { service, database, blobs, deleted };
}

test('asset persistence failure rolls back the new blob and makes the next preflight miss', async () => {
  const fixture = uploadFixture({ stage: 'asset', error: new Error('asset create failed') });
  process.env.COS_SECRET_ID = 'id'; process.env.COS_SECRET_KEY = 'key'; process.env.COS_BUCKET = 'bucket-123'; process.env.COS_REGION = 'ap-shanghai';
  const buffer = Buffer.from('hello');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  await assert.rejects(() => fixture.service.uploadForumAttachment({ userId: 'u', filename: 'x.txt', contentType: 'text/plain', buffer }), /附件上传登记失败/);
  assert.equal(fixture.blobs.size, 0);
  assert.equal(fixture.deleted.length, 1);
  assert.deepEqual(await fixture.service.prepareForumAttachment({ userId: 'u', sha256, filename: 'x.txt', contentType: 'text/plain', sizeBytes: buffer.length }), { exists: false });
});

test('only SHA conflict reuses a winner; an object-key P2002 rolls back the blob and does not delete a winner object', async () => {
  const fixture = uploadFixture({ stage: 'asset', error: { code: 'P2002', meta: { target: ['objectKey'] } } });
  process.env.COS_SECRET_ID = 'id'; process.env.COS_SECRET_KEY = 'key'; process.env.COS_BUCKET = 'bucket-123'; process.env.COS_REGION = 'ap-shanghai';
  const buffer = Buffer.from('hello');
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  await assert.rejects(() => fixture.service.uploadForumAttachment({ userId: 'u', filename: 'x.txt', contentType: 'text/plain', buffer }), /附件上传登记失败/);
  assert.equal(fixture.blobs.size, 0);
  assert.equal(fixture.deleted.length, 1);
  assert.deepEqual(await fixture.service.prepareForumAttachment({ userId: 'u', sha256, filename: 'x.txt', contentType: 'text/plain', sizeBytes: buffer.length }), { exists: false });
});
