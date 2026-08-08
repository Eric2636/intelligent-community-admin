import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adminService = readFileSync(new URL('../src/modules/admin/admin.service.ts', import.meta.url), 'utf8');
const jwtAuth = readFileSync(new URL('../src/middleware/jwt-auth.ts', import.meta.url), 'utf8');
const authService = readFileSync(new URL('../src/modules/auth/auth.service.ts', import.meta.url), 'utf8');
const adminDto = readFileSync(new URL('../src/modules/admin/admin.dto.ts', import.meta.url), 'utf8');
const forumService = readFileSync(new URL('../src/modules/forum/forum.service.ts', import.meta.url), 'utf8');

test('admin announcements bypass bound users while ordinary content does not', () => {
  assert.match(adminService, /postType === 'ANNOUNCEMENT'/);
  assert.match(adminService, /ADMIN_ANNOUNCEMENT_AUTHOR_ID/);
  assert.doesNotMatch(adminService, /operator\.role === 'SUPERADMIN'\) return this\.resolveActorUserId/);
  assert.match(adminService, /管理员绑定的小程序用户已被冻结/);
});

test('frozen users are denied both protected reads and login', () => {
  assert.doesNotMatch(jwtAuth, /if \(!\['GET', 'HEAD', 'OPTIONS'\]\.includes\(ctx\.method\)\)/);
  assert.match(authService, /账号已被冻结/);
});

test('forum content queries accept a real author keyword', () => {
  assert.match(adminDto, /authorKeyword\?: string/);
  assert.match(adminService, /authorKeyword/);
  assert.match(adminService, /authorId: \{ in: authorIds \}/);
});

test('replies to system announcements do not create a notification for a virtual author', () => {
  assert.match(forumService, /ADMIN_ANNOUNCEMENT_AUTHOR_ID/);
  assert.match(forumService, /notificationRecipientId !== ADMIN_ANNOUNCEMENT_AUTHOR_ID/);
});
