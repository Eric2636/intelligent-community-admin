import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from '../src/http-error';
import { assertForumPostTypeFeatureType, registrationStatus } from '../src/modules/forum/forum-feature';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const now = new Date('2026-08-19T12:00:00.000Z');

test('registration is open before its deadline while capacity remains', () => {
  assert.equal(
    registrationStatus({ deadlineAt: new Date('2026-08-20T12:00:00.000Z'), capacity: 10, registeredCount: 3 }, now),
    'OPEN',
  );
});

test('registration is full when registered count reaches capacity', () => {
  assert.equal(
    registrationStatus({ deadlineAt: new Date('2026-08-20T12:00:00.000Z'), capacity: 3, registeredCount: 3 }, now),
    'FULL',
  );
});

test('registration is closed at its deadline even when capacity remains', () => {
  assert.equal(
    registrationStatus({ deadlineAt: now, capacity: 10, registeredCount: 1 }, now),
    'CLOSED',
  );
});

test('community announcements cannot use the registration feature', () => {
  assert.doesNotThrow(() => assertForumPostTypeFeatureType('NORMAL', 'REGISTRATION'));
  assert.doesNotThrow(() => assertForumPostTypeFeatureType('ANNOUNCEMENT', 'CONTENT'));
  assert.throws(
    () => assertForumPostTypeFeatureType('ANNOUNCEMENT', 'REGISTRATION'),
    (error: unknown) => error instanceof HttpError && error.message === '社区公告不支持活动报名',
  );
});

test('forum APIs expose registration summaries, management entries and pin controls', () => {
  const forum = readFileSync(resolve(process.cwd(), 'src/modules/forum/forum.service.ts'), 'utf8');
  const routes = readFileSync(resolve(process.cwd(), 'src/routes/index.ts'), 'utf8');
  assert.match(forum, /featureType:\s*p\.featureType/);
  assert.match(forum, /async setPinned\(/);
  assert.match(forum, /async getRegistrationEntries\(/);
  assert.match(routes, /\/api\/posts\/:postId\/registration\/entries/);
  assert.match(routes, /\/api\/posts\/:postId\/pin/);
});

test('admin-authored registration ownership uses the active admin identity', () => {
  const adminService = readFileSync(resolve(process.cwd(), 'src/modules/admin/admin.service.ts'), 'utf8');
  assert.match(adminService, /authorId:\s*actorId \|\| ADMIN_FORUM_AUTHOR_ID/);
  assert.match(adminService, /createdByAdminId:\s*operator\.adminId/);
  assert.match(adminService, /assertCanModifyContent\(operator,\s*type,\s*[^,]+,\s*[^)]+createdByAdminId/);
  assert.match(adminService, /getForumRegistrationEntries[\s\S]*select:\s*\{\s*authorId:\s*true,\s*createdByAdminId:\s*true\s*\}/);
});

test('admin-authored registrations do not require a bound mini-program user', () => {
  const adminService = readFileSync(resolve(process.cwd(), 'src/modules/admin/admin.service.ts'), 'utf8');
  assert.match(adminService, /type === 'posts'\s*\? ''\s*:\s*await this\.resolveActorUserIdForAdmin/);
  assert.match(adminService, /authorName:\s*author\?\.name \?\? operator\.username/);
});
