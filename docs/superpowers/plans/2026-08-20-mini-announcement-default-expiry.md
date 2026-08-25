# Mini Announcement Default Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure announcements published from the mini program receive a 30-day effective period and appear in the announcement area.

**Architecture:** The mini program continues to submit only the administrator-controlled post type. The forum service assigns `validUntil` when `postType` is `ANNOUNCEMENT`; normal posts retain a null expiry. The local database backfill repairs only the already-created local announcement records whose expiry is absent.

**Tech Stack:** TypeScript, Prisma, Node test runner, WeChat Mini Program JavaScript.

---

### Task 1: Lock down the service behavior

**Files:**
- Modify: `test/forum-functional-posts-contract.spec.ts`
- Modify: `src/modules/forum/forum.service.ts`

- [ ] **Step 1: Write the failing test**

Add a contract test that invokes `publishPost` with `postType: 'ANNOUNCEMENT'`, then asserts the Prisma create payload contains a `validUntil` value approximately 30 days after the invocation; also assert a `NORMAL` post retains `validUntil: null`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx tsx --test test/forum-functional-posts-contract.spec.ts`

Expected: FAIL because `publishPost` currently omits `validUntil`.

- [ ] **Step 3: Implement the minimal service default**

In `ForumService.publishPost`, compute `validUntil` as `new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)` only for `ANNOUNCEMENT`, and include it in the `forumPost.create` data.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx tsx --test test/forum-functional-posts-contract.spec.ts`

Expected: PASS.

### Task 2: Repair local test data and verify the user path

**Files:**
- No source files

- [ ] **Step 1: Read the actual local runtime target and affected rows**

Confirm the backend uses `127.0.0.1:3308/ic_local`, then select only `ANNOUNCEMENT` rows where `validUntil IS NULL`.

- [ ] **Step 2: Update the affected local rows**

Set `validUntil` to `DATE_ADD(createdAt, INTERVAL 30 DAY)` only for those local announcement rows.

- [ ] **Step 3: Verify public data flow**

Call the local `GET /api/posts/announcements` route and confirm the repaired announcement is returned. Re-enter the Mini Program forum page and confirm the announcement module renders it.

### Task 3: Regression verification

**Files:**
- No source files

- [ ] **Step 1: Run backend test suite and type build**

Run: `npm test && npm run build`

Expected: all tests pass and TypeScript exits successfully.

- [ ] **Step 2: Run mini-program tests and static checks**

Run: `node --test test/forum-functional-posts.spec.mjs && npx eslint packageForum/publish/index.js pages/forum/index.js api/cloud.js && git diff --check`

Expected: all commands exit successfully.
