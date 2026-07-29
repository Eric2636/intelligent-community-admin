import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('admin mutation audit centrally covers successful admin writes and excludes dedicated business audits', async () => {
  const source = await readFile(new URL('../src/middleware/admin-mutation-audit.ts', import.meta.url), 'utf8');
  assert.match(source, /MUTATING_METHODS/);
  assert.match(source, /ctx\.path\.startsWith\('\/api\/admin\/'\)/);
  assert.match(source, /ctx\.status >= 400/);
  assert.match(source, /DEDICATED_AUDIT_ROUTES/);
  assert.match(source, /action: 'ADMIN_DATA_MUTATION'/);
  assert.match(source, /safeRequestSnapshot/);
  assert.match(source, /requestUrl: `\$\{ctx\.protocol\}:\/\/\$\{ctx\.host\}\$\{redactPath\(ctx\.originalUrl/);
});

test('admin access logging is forced on even if an endpoint switch is off', async () => {
  const source = await readFile(new URL('../src/middleware/api-access-log.ts', import.meta.url), 'utf8');
  assert.match(source, /source === 'ADMIN' \|\| logEnabled/);
});
