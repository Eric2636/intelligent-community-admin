# API Error Request Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为所有 4xx/5xx 接口错误持久化安全、脱敏且限长的请求参数快照，并在超级管理员错误日志详情中展示。

**Architecture:** 在最外层 `apiAccessLog` 中间件结束请求后，针对 `status >= 400` 生成 `requestSnapshot` 并写入 `ApiErrorLog`。快照构造独立放入日志脱敏模块，避免路由/业务代码自行记录参数；Prisma 可空 JSON 字段保证历史错误记录兼容。管理端只在错误详情读取并格式化展示，CSV 继续不携带该字段。

**Tech Stack:** Koa、TypeScript、Prisma/MySQL、Node `node:test`、Vue 3、Ant Design Vue。

---

### Task 1: 定义并验证安全请求快照

**Files:**
- Modify: `src/modules/api-log/api-log-redaction.ts`
- Modify: `test/api-log-redaction.spec.ts`

- [ ] **Step 1: 写入失败用例**

```ts
test('request snapshot redacts secrets and bounds JSON data', () => {
  const snapshot = safeRequestSnapshot({
    params: { id: 'post-1' },
    query: { phone: '13800138000', token: 'secret' },
    body: { password: 'pass', title: '正常标题', images: ['data:image/png;base64,abc'] },
  });
  assert.deepEqual(snapshot.params, { id: 'post-1' });
  assert.equal(snapshot.query.token, '[REDACTED]');
  assert.equal(snapshot.query.phone, '138****8000');
  assert.equal(snapshot.body.password, '[REDACTED]');
  assert.equal(snapshot.body.images[0], '[OMITTED]');
});
```

- [ ] **Step 2: 运行失败用例**

Run: `npx tsx --test test/api-log-redaction.spec.ts`

Expected: FAIL，提示 `safeRequestSnapshot is not a function`。

- [ ] **Step 3: 最小实现**

```ts
export function safeRequestSnapshot(input: { params?: unknown; query?: unknown; body?: unknown }) {
  return enforceSnapshotBudget({
    params: sanitizeSnapshotValue(input.params),
    query: sanitizeSnapshotValue(input.query),
    body: sanitizeSnapshotValue(input.body),
  });
}
```

`sanitizeSnapshotValue` 必须递归按敏感键名脱敏、掩码手机号、移除文件/Base64/Buffer，且限制深度、对象键数、数组长度和字符串长度；`enforceSnapshotBudget` 超过 8 KiB 时返回 `{ truncated: true }`，不得抛出异常。

- [ ] **Step 4: 运行用例确认通过**

Run: `npx tsx --test test/api-log-redaction.spec.ts`

Expected: PASS。

### Task 2: 4xx/5xx 持久化错误快照

**Files:**
- Modify: `src/middleware/api-access-log.ts`
- Modify: `test/api-access-log.spec.ts`

- [ ] **Step 1: 写入失败用例**

```ts
test('400 writes a sanitized error snapshot and no ordinary access log', async () => {
  const d = deps({ enabled: false });
  const ctx = context({ status: 400, params: { id: 'task-1' }, query: { token: 'x' }, request: { body: { title: 'x', password: 'p' } } });
  await createApiAccessLogMiddleware(d)(ctx, async () => { ctx.status = 400; });
  assert.equal(d.access.length, 0);
  assert.equal(d.errors.length, 1);
  assert.deepEqual(d.errors[0].requestSnapshot, { params: { id: 'task-1' }, query: { token: '[REDACTED]' }, body: { title: 'x', password: '[REDACTED]' } });
});
```

- [ ] **Step 2: 运行失败用例**

Run: `npx tsx --test test/api-access-log.spec.ts`

Expected: FAIL，400 当前未写入 `apiErrorLog`。

- [ ] **Step 3: 最小实现**

```ts
if (status >= 400) {
  await db.apiErrorLog.create({
    data: {
      ...data,
      errorCode,
      errorSummary: safeErrorSummary(thrown ?? ctx.state.handledError ?? `HTTP ${status}`),
      requestSnapshot: safeRequestSnapshot({ params: ctx.params, query: ctx.query, body: ctx.request.body }),
    },
  });
}
```

普通访问日志只写成功响应（`status < 400`）且仍遵从 `logEnabled`；错误日志持久化失败时仅记录安全摘要，不改变响应。

- [ ] **Step 4: 运行用例确认通过**

Run: `npx tsx --test test/api-access-log.spec.ts`

Expected: PASS。

### Task 3: 数据模型与本地迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260728190000_add_api_error_request_snapshot/migration.sql`
- Modify: `test/api-log-schema.spec.ts`

- [ ] **Step 1: 写入失败 schema 用例**

```ts
assert.match(schema, /model ApiErrorLog[\s\S]*requestSnapshot\s+Json\?/, 'ApiErrorLog 必须保存可空请求快照');
assert.match(migration, /ADD COLUMN `requestSnapshot` JSON NULL/, '迁移必须新增可空 JSON 请求快照列');
```

- [ ] **Step 2: 运行失败用例**

Run: `npx tsx --test test/api-log-schema.spec.ts`

Expected: FAIL，缺少 `requestSnapshot` 字段与迁移。

- [ ] **Step 3: 最小实现**

```prisma
requestSnapshot Json?
```

```sql
ALTER TABLE `api_error_logs` ADD COLUMN `requestSnapshot` JSON NULL;
```

- [ ] **Step 4: 生成客户端并应用本地迁移**

Run: `npm run prisma:generate:local && npm run prisma:migrate:dev:local -- --name add_api_error_request_snapshot`

Expected: 仅 `127.0.0.1:3308/ic_test` 新增可空列；不得执行远程数据库命令。

- [ ] **Step 5: 运行 schema 用例确认通过**

Run: `npx tsx --test test/api-log-schema.spec.ts`

Expected: PASS。

### Task 4: 管理端错误详情展示请求快照

**Files:**
- Modify: `../intelligent-community-admin-web/src/types/api.ts`
- Modify: `../intelligent-community-admin-web/src/views/ApiErrorLogsView.vue`
- Create or modify: `../intelligent-community-admin-web/test/api-error-logs-view.spec.ts`

- [ ] **Step 1: 写入失败用例**

```ts
assert.match(view, /请求参数（已脱敏）/);
assert.match(view, /历史记录未采集请求参数/);
assert.match(types, /requestSnapshot\?: Record<string, unknown> \| null/);
```

- [ ] **Step 2: 运行失败用例**

Run: `npx tsx --test test/api-error-logs-view.spec.ts`

Expected: FAIL，错误详情尚未渲染请求参数。

- [ ] **Step 3: 最小实现**

```vue
<a-descriptions-item label="请求参数（已脱敏）" :span="2">
  <pre class="summary">{{ detailRow?.requestSnapshot ? JSON.stringify(detailRow.requestSnapshot, null, 2) : '历史记录未采集请求参数' }}</pre>
</a-descriptions-item>
```

将错误日志默认状态筛选改为空（显示 4xx 与 5xx）；状态标签用橙色展示 4xx、红色展示 5xx。

- [ ] **Step 4: 运行用例确认通过**

Run: `npx tsx --test test/api-error-logs-view.spec.ts`

Expected: PASS。

### Task 5: 更新文档并完整验证

**Files:**
- Modify: `../intelligent-community/FUNCTION_GUIDE.md`
- Modify: `../intelligent-community/FEATURE_STATUS.md`
- Modify: `swagger/openapi.ts`

- [ ] **Step 1: 更新能力说明**

在“后台与接口日志”中明确：接口错误日志记录 4xx/5xx，参数快照已脱敏、限长、仅超级管理员详情可见，CSV 不导出快照。

- [ ] **Step 2: 更新 OpenAPI 摘要**

将错误日志查询文案从“异常日志”改为“4xx/5xx 接口错误日志”，不把敏感快照加入导出接口返回示例。

- [ ] **Step 3: 运行后端完整验证**

Run: `npm test && npm run lint && npm run build`

Expected: 所有测试、lint、TypeScript 构建退出码均为 0。

- [ ] **Step 4: 运行管理端验证**

Run: `npm run build`

Expected: Vue 类型检查与 Vite 构建退出码均为 0。

- [ ] **Step 5: 检查差异与本地迁移目标**

Run: `git diff --check && git status --short --branch`

Expected: 无空白错误；仅 `dev` 工作区与确认的本地数据库发生变化。
