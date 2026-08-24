# 数据库注入与本地测试清理 Implementation Plan

**Goal:** 修复服务数据库注入回归，并建立可安全清理 `ic_local` 数据的集成测试规范。

### Task 1: RED

- 执行 `mall-owner-actions`、`mall-public-read`、`task-notifications`，保留当前绕过注入导致的失败证据。
- 新增清理目标保护测试：远程目标、错误端口/库名必须拒绝，迁移表必须排除。

### Task 2: GREEN

- `TaskService` 标签查询改用 `this.database` 并扩展数据库类型。
- `MallItemService` 增加可注入数据库并把所有 Prisma delegate 访问统一到 `this.database`。
- 更新测试 fake database 的 `user/adminUser` delegate。

### Task 3: 本地数据库测试生命周期

- 新增测试数据库 guard/cleanup helper，只允许 `127.0.0.1:3308/ic_local`。
- 提供迁移前置和 `finally` 清理入口，保留 schema 与 `_prisma_migrations`。
- 把强制隔离、迁移和清理规则写入数据库规范 skill。

### Task 4: 发布门禁

- 运行后端全测、TypeScript、Prisma、后台网页全测/构建。
- 验证通过后提交 `dev`，合入并推送 `test`；通过维护脚本以 `BRANCH=test` 发布 API 和管理网页。
