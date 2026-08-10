import assert from 'node:assert/strict';
import test from 'node:test';

test('media cleanup runs as an explicit worker process rather than in the API process', async () => {
  const [entry, worker, packageFile] = await Promise.all([
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/media-cleanup-main.ts', import.meta.url), 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('../src/modules/media/media-cleanup.worker.ts', import.meta.url), 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile(new URL('../package.json', import.meta.url), 'utf8')),
  ]);
  assert.match(entry, /startMediaCleanupWorker/);
  assert.match(worker, /DELETE_PENDING/);
  assert.match(worker, /PENDING/);
  assert.match(worker, /deleteAsset/);
  assert.match(packageFile, /"start:media-cleanup"/);
});
