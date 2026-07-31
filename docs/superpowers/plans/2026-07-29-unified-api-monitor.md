# 统一接口监控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将成功、重定向和错误请求统一为可按“小程序 / 后台管理”两个来源 Tab 浏览的接口监控页面，并记录可复制的真实请求地址。

**Architecture:** 新建 `ApiRequestLog` 作为唯一请求事实表，错误字段为可空字段；Koa 中间件对每次请求写入一条统一日志。后台只调用统一查询/导出接口，来源由两个 Tab 固定，状态类别和耗时由筛选条件控制。

**Tech Stack:** Koa、Prisma/MySQL、TypeScript、Vue 3、Ant Design Vue、现有 TDesign 视觉 token。

---

### Task 1: 建立统一日志数据模型和本地迁移

**Files:**
- Modify: `intelligent-community-admin/prisma/schema.prisma`
- Create: `intelligent-community-admin/prisma/migrations/20260729090000_unify_api_request_logs/migration.sql`
- Create: `intelligent-community-admin/test/api-request-log-schema.spec.ts`

- [ ] **Step 1: 写入失败的 schema 测试**

测试必须断言 `ApiRequestLog` 具有 `requestId`、`requestUrl`、来源、操作者、状态、耗时、可空错误字段和创建时间；断言新迁移会复制两张旧表数据，再删除旧表。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx tsx --test test/api-request-log-schema.spec.ts`

Expected: FAIL，因为统一模型和迁移尚不存在。

- [ ] **Step 3: 定义 Prisma 模型**

在 `schema.prisma` 添加：

```prisma
model ApiRequestLog {
  id              BigInt   @id @default(autoincrement())
  requestId       String   @db.VarChar(64)
  endpointId      String?  @db.VarChar(191)
  source          String   @db.VarChar(24)
  method          String   @db.VarChar(16)
  routePattern    String   @db.VarChar(512)
  requestUrl      String?  @db.Text
  ip              String?  @db.VarChar(64)
  userId          String?  @db.VarChar(191)
  adminId         String?  @db.VarChar(191)
  httpStatus      Int
  businessCode    Int?
  durationMs      Int
  errorCode       String?  @db.VarChar(96)
  errorSummary    String?  @db.Text
  requestSnapshot Json?
  createdAt       DateTime @default(now())

  @@index([createdAt])
  @@index([requestId])
  @@index([source, createdAt])
  @@index([httpStatus, createdAt])
  @@index([endpointId, createdAt])
  @@index([userId, createdAt])
  @@index([adminId, createdAt])
  @@index([durationMs, createdAt])
  @@map("api_request_logs")
}
```

移除 Prisma 中的 `ApiAccessLog` 和 `ApiErrorLog` 模型。

- [ ] **Step 4: 编写可恢复本地迁移**

迁移顺序：创建 `api_request_logs`；将 `api_access_logs` 复制为无错误字段的记录；将 `api_error_logs` 复制为有错误字段的记录；历史记录 `requestId` 使用 `legacy-access-{id}` 或 `legacy-error-{id}`；历史记录 `requestUrl` 保持 `NULL`；核对复制完成后删除两张旧表。

- [ ] **Step 5: 运行 schema 测试**

Run: `npx tsx --test test/api-request-log-schema.spec.ts`

Expected: PASS。

### Task 2: 统一请求写入、真实地址和安全来源

**Files:**
- Modify: `intelligent-community-admin/src/middleware/api-access-log.ts`
- Modify: `intelligent-community-admin/src/modules/api-log/api-log-redaction.ts`
- Modify: `intelligent-community-admin/.env.example`
- Create: `intelligent-community-admin/test/api-request-log-middleware.spec.ts`

- [ ] **Step 1: 写入失败的中间件测试**

覆盖以下行为：

```ts
test('writes one 401 unified request log with no actor', async () => { /* assert httpStatus 401 and adminId null */ });
test('writes a 200 unified request log without an error snapshot', async () => { /* assert null error fields */ });
test('creates a full public URL with a redacted query string', async () => { /* assert https://api.example.com/...token=[REDACTED] */ });
test('does not trust forwarded host or protocol from an untrusted peer', async () => { /* assert fallback origin */ });
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx tsx --test test/api-request-log-middleware.spec.ts`

Expected: FAIL，因为统一写入和完整地址尚不存在。

- [ ] **Step 3: 实现统一写入**

将中间件依赖改为 `apiRequestLog.create`，每个响应只写入一次。生成 `requestId`，优先复用可信请求头中的追踪编号，缺失时生成 UUID；所有 `2xx/3xx/4xx/5xx` 写入同一表。`4xx/5xx` 才写入 `errorCode`、`errorSummary` 和 `safeRequestSnapshot`。

- [ ] **Step 4: 实现真实 URL 生成器**

在脱敏模块新增 `requestUrlForLog(ctx)`：优先使用 `PUBLIC_API_ORIGIN`；仅当 socket peer 在 `TRUST_PROXY_IPS` 且 `TRUST_PROXY=true` 时使用代理协议和主机；否则使用 Koa 实际协议和主机；最后拼接 `redactPath(ctx.originalUrl || ctx.url || ctx.path)`。

- [ ] **Step 5: 补充环境说明**

在 `.env.example` 添加：

```dotenv
# 生产公网 API 域名，例如 https://api.example.com；日志完整地址优先使用它
PUBLIC_API_ORIGIN=
```

- [ ] **Step 6: 运行中间件测试**

Run: `npx tsx --test test/api-request-log-middleware.spec.ts`

Expected: PASS。

### Task 3: 统一查询、导出和接口选择器

**Files:**
- Modify: `intelligent-community-admin/src/modules/api-log/api-log.service.ts`
- Modify: `intelligent-community-admin/src/modules/api-log/api-log.routes.ts`
- Modify: `intelligent-community-admin/src/swagger/openapi.ts`
- Modify: `intelligent-community-admin/scripts/cleanup-api-logs.ts`
- Modify: `intelligent-community-admin/src/modules/api-log/api-log-retention.service.ts`
- Create: `intelligent-community-admin/test/api-request-log.service.spec.ts`

- [ ] **Step 1: 写入失败的查询服务测试**

测试统一列表按 `source`、`2xx/3xx/4xx/5xx`、精确状态码、时间、操作者和耗时过滤；测试错误记录返回错误详情字段；测试 CSV 不导出请求快照；测试接口选择器支持关键词和来源分页。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npx tsx --test test/api-request-log.service.spec.ts`

Expected: FAIL，因为服务仍读取旧表且没有统一接口。

- [ ] **Step 3: 替换列表和导出服务**

新增 `listRequests(filters)` 和 `exportRequests(filters)`，仅查询 `apiRequestLog`。状态类别支持 `2xx`、`3xx`、`4xx`、`5xx`。返回字段包括 `requestUrl`、`requestId`、`actorLabel` 和可空错误详情。

- [ ] **Step 4: 替换管理路由**

保留 `GET /api/admin/api-access-logs` 作为统一查询兼容入口；将 `GET /api/admin/api-error-logs` 兼容指向同一查询；新增或复用统一导出逻辑。两条路由都只允许超级管理员。

- [ ] **Step 5: 调整清理任务**

清理服务只删除统一表中超过 90 天的数据，并保留每批 5,000 行限制。

- [ ] **Step 6: 运行服务测试**

Run: `npx tsx --test test/api-request-log.service.spec.ts test/api-log-retention.spec.ts`

Expected: PASS。

### Task 4: 本地数据库迁移与数据核对

**Files:**
- Modify: `intelligent-community-admin/docs/接口访问日志说明.md`

- [ ] **Step 1: 确认实际本地目标**

读取运行时环境，确认后端使用 `127.0.0.1:3308/ic_test`，并执行 `npx prisma migrate status`。

- [ ] **Step 2: 创建本地日志表备份**

仅导出 `api_access_logs` 和 `api_error_logs` 到带时间戳的本地 SQL 文件，记录备份路径；不输出数据库密码。

- [ ] **Step 3: 应用本地迁移**

Run: `npm run prisma:migrate:dev:local`

Expected: 本地 `ic_test` 新建统一表、复制历史数据并删除旧表。

- [ ] **Step 4: 核对迁移结果**

比较迁移前旧表总数与迁移后统一表总数，分别核对 `2xx`、`4xx`、`5xx` 数量；历史记录完整地址为空是预期行为。

- [ ] **Step 5: 更新日志文档**

将文档改为统一请求表、两个来源 Tab、状态类别筛选、完整地址和本地迁移实际结果；明确目标环境尚未部署。

### Task 5: 后台统一接口监控页面

**Files:**
- Create: `intelligent-community-admin-web/src/views/ApiMonitorView.vue`
- Modify: `intelligent-community-admin-web/src/api/admin.ts`
- Modify: `intelligent-community-admin-web/src/types/api.ts`
- Modify: `intelligent-community-admin-web/src/router/index.ts`
- Modify: `intelligent-community-admin-web/src/App.vue`
- Create: `intelligent-community-admin-web/test/api-monitor-page.spec.mjs`

- [ ] **Step 1: 写入失败的页面契约测试**

断言页面只包含“微信小程序”“后台管理”两个 Tab；无“访问记录”“错误记录”Tab；来源下拉不存在；状态类别有 `2xx/3xx/4xx/5xx`；耗时预设与自定义范围存在；列表含“请求地址”和复制动作。

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test test/api-monitor-page.spec.mjs`

Expected: FAIL，因为统一页面尚不存在。

- [ ] **Step 3: 实现 API 和类型**

新增 `ApiRequestLog` 类型与 `listApiRequests`、`exportApiRequests` 调用，保留旧调用仅用于兼容；统一筛选类型增加 `requestId` 和 `durationPreset`，发送前转换为最小/最大耗时。

- [ ] **Step 4: 实现页面布局和来源 Tab**

默认 Tab 为 `MINI`，仅两个 Tab。切换时固定来源、重置页码为 1、按来源加载接口选项，保留其余筛选。

- [ ] **Step 5: 实现 TDesign 风格筛选区**

使用带标签的两行筛选面板；移除来源下拉；耗时使用一个预设选择器。选择“自定义”时才显示最小值和最大值的组合输入；在最小值大于最大值时显示中文字段错误并不发请求。

- [ ] **Step 6: 实现统一列表与详情**

列表显示真实请求地址、文本复制按钮、状态色标和耗时；仅错误行显示“查看详情”。详情中历史空地址显示固定说明，错误内容使用预格式化脱敏文本。

- [ ] **Step 7: 兼容旧路由**

`/api-access-logs` 进入统一页面；`/api-error-logs` 重定向到统一页面并预选 `4xx` 筛选；菜单中只保留“接口监控”。

- [ ] **Step 8: 运行页面测试**

Run: `node --test test/api-monitor-page.spec.mjs`

Expected: PASS。

### Task 6: 回归验证和本地手工验收

**Files:**
- Modify: `intelligent-community-admin/README.md`
- Modify: `intelligent-community-admin-web/README.md`

- [ ] **Step 1: 后端验证**

Run: `npm run build && npm run lint && npm test`

Expected: 所有后端构建、Lint 和测试通过。

- [ ] **Step 2: 后台前端验证**

Run: `npm run build && node --test test/*.spec.mjs`

Expected: 后台构建和页面契约测试通过。

- [ ] **Step 3: 本地手工验收**

通过 `http://127.0.0.1:5174` 验证：默认小程序 Tab、切换后台 Tab、2xx/3xx/4xx/5xx、401、耗时预设、自定义校验、真实 URL 复制、错误详情、重置、导出和旧错误路由重定向。

- [ ] **Step 4: 更新本地测试说明**

在两个 README 记录本地地址、统一接口监控入口和数据库迁移名称；不写入任何测试或生产地址。
