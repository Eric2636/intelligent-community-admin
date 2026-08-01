import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { invalidateAdminSession, openAdminSession } from '../src/modules/admin/admin-session';

test('opening an admin session atomically increments and returns the new session version', async () => {
  const calls: unknown[] = [];
  const repository = {
    async update(args: unknown) {
      calls.push(args);
      return { id: 'admin-a', sessionVersion: 8 };
    },
  };

  const result = await openAdminSession(repository, 'admin-a');

  assert.equal(result.sessionVersion, 8);
  assert.equal(calls.length, 1);
  const call = calls[0] as any;
  assert.deepEqual(call.where, { id: 'admin-a' });
  assert.deepEqual(call.data.sessionVersion, { increment: 1 });
  assert.ok(call.data.lastLoginAt instanceof Date);
  assert.deepEqual(call.select, { id: true, sessionVersion: true });
});

test('invalidating an admin session only increments its session version', async () => {
  const calls: unknown[] = [];
  const repository = {
    async update(args: unknown) {
      calls.push(args);
      return { id: 'admin-a', sessionVersion: 9 };
    },
  };

  await invalidateAdminSession(repository, 'admin-a');

  assert.deepEqual(calls, [
    {
      where: { id: 'admin-a' },
      data: { sessionVersion: { increment: 1 } },
      select: { id: true, sessionVersion: true },
    },
  ]);
});

test('admin login and refresh tokens are bound to the current database session version', () => {
  const source = readFileSync('src/modules/admin/admin.service.ts', 'utf8');

  assert.match(source, /openAdminSession\(prisma\.adminUser, admin\.id\)/);
  assert.match(source, /sessionVersion:\s*session\.sessionVersion/);
  assert.match(source, /payload\.sessionVersion\s*!==\s*admin\.sessionVersion/);
  assert.match(source, /new AdminSessionReplacedError\(\)/);
});

test('password changes and resets invalidate every previously issued admin token', () => {
  const source = readFileSync('src/modules/admin/admin.service.ts', 'utf8');
  const changePassword = source.slice(
    source.indexOf('async changeMyPassword'),
    source.indexOf('async listUsers', source.indexOf('async changeMyPassword')),
  );
  const resetPassword = source.slice(
    source.indexOf('async superAdminResetRandomPassword'),
    source.indexOf('async deleteAdmin', source.indexOf('async superAdminResetRandomPassword')),
  );

  assert.match(changePassword, /data:\s*\{\s*passwordHash,\s*sessionVersion:\s*\{\s*increment:\s*1\s*\}\s*\}/);
  assert.match(resetPassword, /data:\s*\{\s*passwordHash,\s*sessionVersion:\s*\{\s*increment:\s*1\s*\}\s*\}/);
});

test('disabling an enabled administrator invalidates the session without affecting ordinary edits', () => {
  const source = readFileSync('src/modules/admin/admin.service.ts', 'utf8');
  const updateAdmin = source.slice(
    source.indexOf('async updateAdmin('),
    source.indexOf('async superAdminResetRandomPassword', source.indexOf('async updateAdmin(')),
  );

  assert.match(
    updateAdmin,
    /const shouldInvalidateSession\s*=\s*Boolean\(params\.password\)\s*\|\|\s*\(target\.enabled\s*&&\s*params\.enabled\s*===\s*false\)/,
  );
  assert.match(
    updateAdmin,
    /\.\.\.\(shouldInvalidateSession\s*\?\s*\{\s*sessionVersion:\s*\{\s*increment:\s*1\s*\}\s*\}\s*:\s*\{\}\)/,
  );
});
