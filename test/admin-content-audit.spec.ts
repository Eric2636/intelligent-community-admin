import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('content state mutations write an audit log only after a successful update', async () => {
  const source = await readFile(new URL('../src/routes/admin.routes.ts', import.meta.url), 'utf8');
  assert.match(source, /const data = await adminService\.updateContentState\([\s\S]*?await adminService\.writeSystemLog\([\s\S]*?CONTENT_PIN_UPDATE/);
  assert.match(source, /CONTENT_VISIBILITY_UPDATE/);
  assert.match(source, /CONTENT_BATCH_STATE_UPDATE/);
  assert.match(source, /module: contentTypeLabels\[type\]/);
  assert.match(source, /contentId: id/);
  assert.match(source, /auditDetail\(ctx, \{ module: contentTypeLabels\[type\], contentId: id/);
  assert.match(source, /requestUrl: `\$\{ctx\.protocol\}:\/\/\$\{ctx\.host\}/);
});
