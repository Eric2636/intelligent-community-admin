# 论坛功能贴与管理员置顶 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加可扩展的帖子功能类型，以报名为首个功能，并在小程序和后台提供安全的置顶、报名和报名名单管理能力。

**Architecture:** 保留 `ForumPost.postType` 作为展示栏目（普通帖/社区公告），新增 `featureType` 作为业务能力（内容/报名）。报名配置和报名记录使用独立表；后端用事务、唯一约束和管理员绑定关系执行所有权限与名额校验；三端共用同一份摘要数据。

**Tech Stack:** Prisma/MySQL、Koa、TypeScript、Node test runner、微信小程序 TDesign、Vue 3、Ant Design Vue。

---

## Files to change

- Backend: `prisma/schema.prisma`、`prisma/migrations/20260819160000_add_forum_registration_feature/migration.sql`、`src/modules/forum/forum.dto.ts`、`forum.service.ts`、新 `forum-registration.service.ts`、`src/routes/index.ts`、`src/modules/user/user.service.ts`、`src/modules/admin/admin.dto.ts`、`admin.service.ts`、`src/routes/admin.routes.ts`。
- Backend tests: 新 `test/forum-registration.spec.ts`、新 `test/forum-functional-posts-contract.spec.ts`，并更新 `test/admin-publishing-freeze-and-forum-search.spec.ts`。
- Mini program: `api/cloud.js`、`packageForum/publish/*`、`packageForum/my-posts/*`、`packageForum/post/*`、新 `test/forum-functional-posts.spec.ts`。
- Admin web: `src/types/api.ts`、`src/api/admin.ts`、`src/views/ContentView.vue`、新 `test/forum-functional-posts-ui.spec.mjs`。

### Task 1: Add registration schema and a migration

**Files:**

- Modify: `intelligent-community-admin/prisma/schema.prisma`
- Create: `intelligent-community-admin/prisma/migrations/20260819160000_add_forum_registration_feature/migration.sql`
- Test: `intelligent-community-admin/test/forum-functional-posts-contract.spec.ts`

- [ ] **Step 1: Write the failing schema contract test**

```ts
test('forum posts separate channel from feature type', () => {
  assert.match(schema, /enum ForumPostFeatureType[\s\S]*CONTENT[\s\S]*REGISTRATION/);
  assert.match(schema, /featureType\s+ForumPostFeatureType\s+@default\(CONTENT\)/);
  assert.match(schema, /model ForumPostRegistration/);
  assert.match(schema, /@@unique\(\[postId, userId\]\)/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/forum-functional-posts-contract.spec.ts`

Expected: FAIL because feature enum and registration models do not exist.

- [ ] **Step 3: Implement the minimal schema**

Add `ForumPostFeatureType { CONTENT REGISTRATION }`; add `featureType` with `@default(CONTENT)` plus optional `registration` relation to `ForumPost`; add one-to-one `ForumPostRegistration(postId, capacity, deadlineAt)` and child `ForumPostRegistrationEntry(postId, userId, createdAt)`. The entry model must have `@@unique([postId, userId])` and `@@index([postId, createdAt])`; use cascade deletes from post to config and entries. Write a non-destructive MySQL migration that gives all existing posts `CONTENT`.

- [ ] **Step 4: Verify GREEN**

Run: `npx prisma validate && npm test -- test/forum-functional-posts-contract.spec.ts`

Expected: Prisma validates and the test passes.

### Task 2: Build transactional registration domain behavior

**Files:**

- Create: `intelligent-community-admin/src/modules/forum/forum-feature.ts`
- Create: `intelligent-community-admin/src/modules/forum/forum-registration.service.ts`
- Create: `intelligent-community-admin/test/forum-registration.spec.ts`

- [ ] **Step 1: Write failing behavior tests**

```ts
test('one user cannot register twice', async () => {
  await service.register({ postId: 'p1', userId: 'u1' });
  await assert.rejects(() => service.register({ postId: 'p1', userId: 'u1' }), /已报名/);
});

test('full, expired and cancellation rules are enforced', async () => {
  await assert.rejects(() => service.register({ postId: 'full', userId: 'u2' }), /名额已满/);
  await service.cancel({ postId: 'p1', userId: 'u1' });
  await service.register({ postId: 'p1', userId: 'u2' });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/forum-registration.spec.ts`

Expected: FAIL because the registration service is unavailable.

- [ ] **Step 3: Implement the minimal service**

Implement `registrationStatus({ deadlineAt, capacity, registeredCount })` returning `OPEN`, `FULL`, or `CLOSED`. In a database transaction, lock/read the registration configuration, verify online/not-deleted `REGISTRATION` post, deadline, capacity, and unique user entry before insert/delete. Map unique-key collisions to “已报名”; invalidate forum list and post-detail caches after successful changes; return capacity, count, remaining, status, deadline, and caller registration state.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- test/forum-registration.spec.ts test/forum-notifications.spec.ts`

Expected: all tests pass.

### Task 3: Extend public forum APIs and administrator-only publishing

**Files:**

- Modify: `intelligent-community-admin/src/modules/forum/forum.dto.ts`
- Modify: `intelligent-community-admin/src/modules/forum/forum.service.ts`
- Modify: `intelligent-community-admin/src/modules/user/user.service.ts`
- Modify: `intelligent-community-admin/src/routes/index.ts`
- Test: `intelligent-community-admin/test/forum-registration.spec.ts`

- [ ] **Step 1: Write failing permission and mapper tests**

```ts
test('ordinary users can publish only NORMAL plus CONTENT', async () => {
  await assert.rejects(() => forum.publishPost({ userId: 'resident', featureType: 'REGISTRATION' }), /管理员/);
  await assert.rejects(() => forum.publishPost({ userId: 'resident', postType: 'ANNOUNCEMENT' }), /管理员/);
});

test('detail returns registration summary but never participant phone data', async () => {
  const post = await forum.getPostDetail({ userId: 'resident', postId: 'p1' });
  assert.equal(post.registration.status, 'OPEN');
  assert.equal('phoneNumber' in post.registration, false);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/forum-registration.spec.ts`

Expected: FAIL for missing publish fields and summary.

- [ ] **Step 3: Implement DTO, mapper, and routes**

Add `postType`, `featureType`, `registrationCapacity`, `registrationDeadlineAt`, and `pinned` to publish validation. Resolve an enabled `AdminUser.boundUserId` before accepting anything except `NORMAL + CONTENT`; create configuration in the post transaction. Extend list/detail/my-post mappers with feature type, registration summary, and `canManageRegistration` only for the authoring bound administrator. Return `canManageForumPosts` from `/api/user/me`.

Add authenticated routes:

```ts
POST   /api/posts/:postId/registration
DELETE /api/posts/:postId/registration
GET    /api/posts/:postId/registration/entries
```

The entry endpoint must return avatar, name, user ID, phone number, and registration time only to the post's bound administrator.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- test/forum-registration.spec.ts test/forum-notifications.spec.ts test/user-effective-tag.spec.ts`

Expected: all tests pass.

### Task 4: Add admin-console APIs for create/edit and entry lists

**Files:**

- Modify: `intelligent-community-admin/src/modules/admin/admin.dto.ts`
- Modify: `intelligent-community-admin/src/modules/admin/admin.service.ts`
- Modify: `intelligent-community-admin/src/routes/admin.routes.ts`
- Test: `intelligent-community-admin/test/admin-publishing-freeze-and-forum-search.spec.ts`
- Test: `intelligent-community-admin/test/forum-registration.spec.ts`

- [ ] **Step 1: Write failing admin rule tests**

```ts
test('admin cannot lower capacity below registrations or backdate a deadline', async () => {
  await assert.rejects(() => admin.updateContentFields('posts', 'p1', { registrationCapacity: 2 }, operator), /不能低于当前报名人数/);
  await assert.rejects(() => admin.updateContentFields('posts', 'p1', { registrationDeadlineAt: '2026-01-01T00:00:00.000Z' }, operator), /必须晚于当前时间/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- test/admin-publishing-freeze-and-forum-search.spec.ts test/forum-registration.spec.ts`

Expected: FAIL because admin DTO/service has no registration fields or entry list.

- [ ] **Step 3: Implement admin behavior**

Extend admin create/update DTOs and `AdminService` with the same feature/config validation. An admin may extend deadline, raise capacity, or lower capacity no lower than current count; never backdate deadline. Enrich post list/detail with channel, feature, status, progress, and config. Add `GET /api/admin/contents/posts/:id/registration-entries`, protect it with existing `assertCanModifyContent`, and return `{ total, list }` containing only avatar, name, id, phoneNumber, and createdAt. Invalidate forum caches after updates.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- test/admin-publishing-freeze-and-forum-search.spec.ts test/admin-content-audit.spec.ts test/forum-registration.spec.ts`

Expected: all tests pass.

### Task 5: Implement mini-program publish, registration, and my-post actions

**Files:**

- Modify: `intelligent-community/api/cloud.js`
- Modify: `intelligent-community/packageForum/publish/index.js`
- Modify: `intelligent-community/packageForum/publish/index.wxml`
- Modify: `intelligent-community/packageForum/publish/index.json`
- Modify: `intelligent-community/packageForum/publish/index.less`
- Modify: `intelligent-community/packageForum/my-posts/index.js`
- Modify: `intelligent-community/packageForum/my-posts/index.wxml`
- Modify: `intelligent-community/packageForum/my-posts/index.json`
- Modify: `intelligent-community/packageForum/my-posts/index.less`
- Modify: `intelligent-community/packageForum/post/index.js`
- Modify: `intelligent-community/packageForum/post/index.wxml`
- Modify: `intelligent-community/packageForum/post/index.json`
- Modify: `intelligent-community/packageForum/post/index.less`
- Create: `intelligent-community/test/forum-functional-posts.spec.ts`

- [ ] **Step 1: Write failing UI-contract tests**

```ts
test('publish page has administrator-only channel and feature controls', () => {
  assert.match(publishWxml, /canManageForumPosts/);
  assert.match(publishWxml, /帖子功能/);
  assert.match(publishWxml, /报名人数上限/);
});

test('my posts uses an action sheet with delete and registration actions', () => {
  assert.match(myPostsWxml, /<t-action-sheet/);
  assert.match(myPostsJs, /label:\s*'删除'/);
  assert.match(myPostsJs, /取消置顶/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/forum-functional-posts.spec.ts`

Expected: FAIL because the controls and action sheet do not exist.

- [ ] **Step 3: Implement the mini-program behavior**

Add cached API methods for registration, cancellation, entries, and administrator pin update; invalidate list cache after mutations. On publish, obtain `canManageForumPosts` from the logged-in profile. Administrators receive TDesign controls for channel, feature, capacity, deadline, and pin; regular users always submit implicit `NORMAL + CONTENT`. Validate positive capacity and future deadline.

In “我的帖子”, use a title row with conditional status tags and `t-icon name="more"`; stop propagation. Open `t-action-sheet`: every author gets Delete; administrators get Pin/Unpin; administrators get View registrations only for registration posts. Confirm delete in red and mention cascading replies/registrations. On detail, show register/cancel/full/closed states from the returned summary, prevent duplicate submissions, and refresh summary after success.

- [ ] **Step 4: Verify GREEN**

Run: `node --test test/forum-functional-posts.spec.ts test/list-clamp.spec.ts test/list-detail-return-state.spec.ts`

Expected: all tests pass.

### Task 6: Implement admin-web form, list, detail and registration drawer

**Files:**

- Modify: `intelligent-community-admin-web/src/types/api.ts`
- Modify: `intelligent-community-admin-web/src/api/admin.ts`
- Modify: `intelligent-community-admin-web/src/views/ContentView.vue`
- Create: `intelligent-community-admin-web/test/forum-functional-posts-ui.spec.mjs`

- [ ] **Step 1: Write failing UI-contract tests**

```js
test('post editor keeps channel and feature separate', () => {
  assert.match(view, /帖子功能/);
  assert.match(view, /registrationCapacity/);
  assert.match(view, /registrationDeadlineAt/);
});

test('registration entries render in a drawer with phone numbers', () => {
  assert.match(view, /<a-drawer/);
  assert.match(view, /报名名单/);
  assert.match(view, /phoneNumber/);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test test/forum-functional-posts-ui.spec.mjs`

Expected: FAIL because no feature form or registration drawer exists.

- [ ] **Step 3: Implement the admin-web UI**

Add typed feature, summary, and entry models plus the entry API function. In `ContentView.vue`, add separate post channel and feature controls; conditionally validate/serialize capacity and deadline; preserve the independent announcement validity date. Add feature, registration progress, and activity-status table columns/tags. Add a “报名名单” action only for mutable registration posts and a drawer containing avatar, nickname, user ID, phone number, and registration time. On entry request failure clear old rows, show the error, and offer reload.

- [ ] **Step 4: Verify GREEN and inspect the page**

Run: `node --test test/forum-functional-posts-ui.spec.mjs test/admin-design-system.spec.mjs && npm run build`

Expected: tests pass and build succeeds. Inspect at 1440×900 and 1920×1080: table does not clip critical columns, drawer scrolls, and failed requests do not show stale entries.

### Task 7: Migration rehearsal and full verification

**Files:**

- Modify only files identified by a failing verification test.

- [ ] **Step 1: Verify the local database target, then apply the migration**

Run: `npx prisma migrate status && npx prisma migrate dev --name add_forum_registration_feature`

Expected: the confirmed local development database receives the migration; existing posts remain `CONTENT`.

- [ ] **Step 2: Run all affected backend checks**

Run: `npm test -- test/forum-registration.spec.ts test/forum-functional-posts-contract.spec.ts test/admin-publishing-freeze-and-forum-search.spec.ts test/forum-notifications.spec.ts && npx prisma validate`

Expected: all tests pass and schema validation succeeds.

- [ ] **Step 3: Run client verification**

Run: `cd ../intelligent-community && node --test test/forum-functional-posts.spec.ts test/list-clamp.spec.ts test/list-detail-return-state.spec.ts && cd ../intelligent-community-admin-web && node --test test/forum-functional-posts-ui.spec.mjs test/admin-design-system.spec.mjs && npm run build`

Expected: mini-program and admin-web tests pass; admin-web build succeeds.

- [ ] **Step 4: Perform manual acceptance checks**

Use one bound administrator and one ordinary user. Create normal and announcement registration posts from both approved administrator entry points; verify pin/unpin, labels, capacity, duplicate rejection, full state, cancellation, expiration, phone visibility only in authorized entry lists, regular-user publish restrictions, and cascading deletion of entries/replies.
