# 后台管理员单账号单会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让同一管理员账号只有最后一次成功登录签发的会话可用，并在会话被替换时提供明确、安全的退出交互。

**Architecture:** 在 `AdminUser` 保存单调递增的 `sessionVersion`，登录时原子递增并写入 access/refresh JWT；鉴权和刷新都对照数据库校验该版本。前端在响应拦截器中单独处理 `session_replaced`，清理本地状态、只提示一次并返回登录页。

**Tech Stack:** Koa、Prisma、PostgreSQL、jsonwebtoken、Vue 3、Axios、Node.js test、TypeScript

---

### Task 1: 会话版本数据模型和领域操作

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260801190000_add_admin_session_version/migration.sql`
- Create: `src/modules/admin/admin-session.ts`
- Create: `test/admin-session.spec.ts`

- [x] **Step 1: Write the failing test**

测试 `openAdminSession()` 使用 `{ increment: 1 }` 原子更新并返回新版本，`invalidateAdminSession()` 只递增版本。

- [x] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/admin-session.spec.ts`
Expected: FAIL because `admin-session.ts` does not exist.

- [x] **Step 3: Write minimal implementation**

新增 `AdminSessionRepository` 接口和两个小函数：

```ts
export async function openAdminSession(repository: AdminSessionRepository, adminId: string) {
  return repository.update({
    where: { id: adminId },
    data: { sessionVersion: { increment: 1 }, lastLoginAt: new Date() },
    select: { sessionVersion: true },
  });
}

export async function invalidateAdminSession(repository: AdminSessionRepository, adminId: string) {
  await repository.update({
    where: { id: adminId },
    data: { sessionVersion: { increment: 1 } },
    select: { id: true },
  });
}
```

Prisma 模型增加：

```prisma
sessionVersion Int @default(0)
```

迁移 SQL：

```sql
ALTER TABLE `AdminUser`
ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx tsx --test test/admin-session.spec.ts`
Expected: PASS.

### Task 2: 登录、刷新和鉴权执行唯一会话校验

**Files:**
- Modify: `src/modules/admin/admin.service.ts`
- Modify: `src/middleware/admin-auth.ts`
- Create: `test/admin-auth-session.spec.ts`

- [x] **Step 1: Write the failing tests**

覆盖新版本令牌通过、旧版本令牌返回 `401/session_replaced`、缺少版本的迁移前令牌失效、停用账号拒绝访问、旧 refresh token 无法刷新。

- [x] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test test/admin-auth-session.spec.ts`
Expected: FAIL because tokens and middleware do not validate `sessionVersion`.

- [x] **Step 3: Implement token/session validation**

JWT payload 增加整数 `sessionVersion`。登录密码验证成功后调用 `openAdminSession()` 获取新版本再签发两类令牌。`createAdminAuth()` 允许测试注入 `verifyToken` 和 `findAdminSession`，生产默认读取 Prisma：

```ts
const admin = await findAdminSession(payload.sub);
if (!admin?.enabled) return unauthorized('account_disabled');
if (!Number.isInteger(payload.sessionVersion) || payload.sessionVersion !== admin.sessionVersion) {
  return unauthorized('session_replaced');
}
```

刷新令牌在签发新 access token 前执行相同校验，并将原 `sessionVersion` 保留到新 access token。

- [x] **Step 4: Run targeted tests**

Run: `npx tsx --test test/admin-session.spec.ts test/admin-auth-session.spec.ts`
Expected: PASS.

### Task 3: 密码和停用操作使现有会话失效

**Files:**
- Modify: `src/modules/admin/admin.service.ts`
- Modify: `test/admin-session.spec.ts`

- [x] **Step 1: Add failing tests**

断言修改自己密码、随机重置其他管理员密码、账号从启用变为停用时，Prisma 更新同时包含：

```ts
sessionVersion: { increment: 1 }
```

重新启用或只修改所属单位等资料不得额外递增版本。

- [x] **Step 2: Run test to verify it fails**

Run: `npx tsx --test test/admin-session.spec.ts`
Expected: FAIL because mutation methods only update password/enabled fields.

- [x] **Step 3: Implement minimal invalidation**

将会话递增合并进对应的同一次 Prisma 更新，避免密码或状态已经变更但会话仍有效的中间状态：

```ts
data: {
  passwordHash,
  sessionVersion: { increment: 1 },
}
```

管理员停用仅在 `target.enabled && params.enabled === false` 时递增。

- [x] **Step 4: Run backend tests and build**

Run: `npm test && npm run build && npm run lint`
Expected: all tests pass, TypeScript build succeeds, lint has no errors.

### Task 4: 管理端识别顶号并安全退出

**Files:**
- Modify: `../intelligent-community-admin-web/src/api/admin.ts`
- Create: `../intelligent-community-admin-web/test/admin-single-session.spec.mjs`

- [x] **Step 1: Write the failing frontend contract test**

断言响应拦截器在刷新逻辑之前识别 `error.response.data.reason === 'session_replaced'`，清理三个本地键、不调用刷新接口、只显示一次中文提示并跳转登录页。

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/admin-single-session.spec.mjs`
Expected: FAIL because `session_replaced` has no dedicated branch.

- [x] **Step 3: Implement a single-flight notification path**

在管理端 API 模块增加模块级锁：

```ts
let sessionReplacedHandled = false;

if (error?.response?.status === 401 && error?.response?.data?.reason === 'session_replaced') {
  clearAdminSession();
  if (!sessionReplacedHandled) {
    sessionReplacedHandled = true;
    message.error('账号已在其他设备登录，请重新登录');
  }
  if (location.pathname !== appPath('/login')) location.href = appPath('/login');
  return Promise.reject(error);
}
```

`login()` 成功返回前将 `sessionReplacedHandled` 重置为 `false`，确保下一次真实顶号仍会提示；不额外暴露公共重置接口。

- [x] **Step 4: Run frontend checks**

Run: `node --test test/*.spec.mjs && npm run build`
Expected: all tests pass and production build succeeds.

### Task 5: Documentation and complete verification

**Files:**
- Modify: `docs/superpowers/specs/2026-08-01-admin-single-session-design.md`
- Modify: `docs/superpowers/plans/2026-08-01-admin-single-session.md`

- [x] **Step 1: Record migration and operational behavior**

在设计文档补充迁移名称、`session_replaced` 响应契约，以及“迁移后管理员需重新登录一次”。

- [x] **Step 2: Generate Prisma client and run full verification**

Run in backend: `npx prisma generate && npm test && npm run build && npm run lint && git diff --check`

Run in admin web: `node --test test/*.spec.mjs && npm run build && git diff --check`

Expected: all commands succeed.

- [x] **Step 3: Review scope**

确认 diff 只包含管理员会话、迁移、前端 401 交互、测试和文档；不包含小程序认证、发布脚本或环境配置。

- [x] **Step 4: Leave changes on dev branches**

按项目发布规范保留本地 `dev` 改动，不提交、不推送、不合并、不部署，等待用户明确发布指令。
