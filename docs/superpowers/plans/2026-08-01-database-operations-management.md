# 数据库运维管理实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为超级管理员提供可配置、可审计、失败安全的数据库备份和只读表结构管理。

**Architecture:** Koa API 保存备份配置和任务，独立 Node 备份执行器领取任务并使用固定参数调用 `mysqldump`，临时文件通过 gzip 校验后原子替换环境独立的最新备份。表结构接口只查询 `information_schema`，后台页面以备份状态卡片和结构化表格展示。

**Tech Stack:** Koa、TypeScript、Prisma/MySQL、Node child_process、Docker、Vue 3、Ant Design Vue（沿用现有 TDesign 企业主题规范）。

---

### Task 1: 备份配置与任务数据模型

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260801150000_add_database_backup_management/migration.sql`
- Create: `test/database-backup-model.spec.ts`

- [ ] **Step 1: 写失败测试验证模型、枚举、单例约束和任务索引**
- [ ] **Step 2: 运行测试确认 schema 尚未包含模型**
- [ ] **Step 3: 新增 `DatabaseBackupSetting` 和 `DatabaseBackupJob` 模型**

设置包含启用、频率、执行分钟/小时及更新管理员；任务包含触发类型、状态、计划/开始/结束时间、耗时、大小、错误摘要和操作管理员。

- [ ] **Step 4: 生成 Prisma Client，运行模型测试和构建**

### Task 2: 备份调度纯逻辑与管理 API

**Files:**
- Create: `src/modules/database/database-backup.dto.ts`
- Create: `src/modules/database/database-backup-schedule.ts`
- Create: `src/modules/database/database-backup.service.ts`
- Create: `src/routes/admin-database.routes.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/swagger/openapi.ts`
- Create: `test/database-backup-api.spec.ts`

- [ ] **Step 1: 写失败测试覆盖默认每小时第 5 分钟、三种频率、参数校验、手动任务去重、超级管理员权限和审计**
- [ ] **Step 2: 运行专项测试确认失败**
- [ ] **Step 3: 实现纯调度函数和服务**

```ts
nextScheduledAt(setting, from): Date
getBackupSetting(): Promise<BackupSetting>
updateBackupSetting(admin, dto): Promise<BackupSetting>
enqueueManualBackup(admin): Promise<BackupJob>
listBackupJobs(query): Promise<PageResult<BackupJob>>
```

- [ ] **Step 4: 注册 `/api/admin/database/*` 路由并使用 `adminAuth` 与 `requireSuperAdmin`**
- [ ] **Step 5: 运行专项测试、全量测试、构建和 lint**

### Task 3: 失败安全的独立备份执行器

**Files:**
- Create: `src/modules/database/database-backup-runner.ts`
- Create: `src/backup-worker.ts`
- Create: `test/database-backup-runner.spec.ts`
- Modify: `tsconfig.build.json`
- Modify: `Dockerfile`
- Modify: `.env.example`

- [ ] **Step 1: 写失败测试覆盖参数数组、防 shell 注入、互斥领取、临时文件、gzip 校验、原子替换和脱敏错误**
- [ ] **Step 2: 运行专项测试确认失败**
- [ ] **Step 3: 实现执行器**

只使用 `spawn` 参数数组调用 `mysqldump` 和 `gzip`，输出位置由 `BACKUP_OUTPUT_FILE` 指定；测试环境设置为测试库专用文件，生产环境以后设置为 `ic_prod_latest.sql.gz`。

- [ ] **Step 4: 增加 worker 镜像入口与健康日志，验证 API 运行镜像不获得额外权限**
- [ ] **Step 5: 运行执行器测试和 Docker 构建测试**

### Task 4: 只读数据表元数据 API

**Files:**
- Create: `src/modules/database/database-table-catalog.ts`
- Create: `src/modules/database/database-table.service.ts`
- Modify: `src/routes/admin-database.routes.ts`
- Create: `test/database-table-catalog.spec.ts`

- [ ] **Step 1: 写失败测试覆盖中文说明、模块归类、搜索、字段/索引查询和未知表拒绝**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 使用参数化查询读取当前 schema 的 `information_schema.TABLES/COLUMNS/STATISTICS`**
- [ ] **Step 4: 确认接口不接受 SQL、不返回业务行、不暴露连接配置**
- [ ] **Step 5: 运行专项测试、全量测试和构建**

### Task 5: 后台数据库管理页面

**Files:**
- Create: `../intelligent-community-admin-web/src/views/DatabaseManagementView.vue`
- Modify: `../intelligent-community-admin-web/src/App.vue`
- Modify: `../intelligent-community-admin-web/src/router/index.ts`
- Modify: `../intelligent-community-admin-web/src/api/admin.ts`
- Modify: `../intelligent-community-admin-web/src/types/api.ts`
- Modify: `../intelligent-community-admin-web/src/style.css`
- Create: `../intelligent-community-admin-web/test/database-management.spec.mjs`

- [ ] **Step 1: 写失败测试覆盖超级管理员菜单/路由、两个区域、备份确认、状态卡、任务表和表结构抽屉**
- [ ] **Step 2: 运行测试确认失败**
- [ ] **Step 3: 实现备份管理区域**

关键状态用少量卡片；配置使用有标签的紧凑表单；手动备份为明确文字按钮并二次确认；任务历史使用表格和分页。

- [ ] **Step 4: 实现数据表区域**

列表支持表名/说明/模块搜索，查看操作使用带 tooltip 和 `aria-label` 的图标，字段及索引在抽屉中展示；区分加载、空结果、失败和重试。

- [ ] **Step 5: 运行页面测试、类型检查和生产构建**

Run: `node --test test/*.spec.mjs && npm run build`

### Task 6: 运维配置、迁移和文档

**Files:**
- Modify: `README.md`
- Create: `docs/database-backup-operations.md`
- Modify: `../docs/本地直发部署指南.md`
- Modify: `../docs/当前工程需求与本地测试报告.md`
- Modify: local test release configuration/scripts as discovered during deployment

- [ ] **Step 1: 文档化权限、频率、环境独立输出路径、失败恢复和旧 cron 切换步骤**
- [ ] **Step 2: 对已确认的本地隔离数据库生成并应用迁移，记录目标和验证结果**
- [ ] **Step 3: 全量运行后端和后台测试、lint、构建与 Docker 构建**
- [ ] **Step 4: 合并到 `test` 后先备份测试库，再执行正式 migration deploy**
- [ ] **Step 5: 部署测试 API、备份 worker 和后台页面，验证权限、手动备份、自动调度、日志、表结构及测试环境独立性**
- [ ] **Step 6: 测试环境保留现有生产 cron，不对生产调度做任何变更；生产替换须另行验收授权**
