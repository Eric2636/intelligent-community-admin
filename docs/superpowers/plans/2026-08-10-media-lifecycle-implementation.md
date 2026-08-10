# 媒体生命周期管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 COS 业务媒体建立资产台账，并自动清理未关联或已删除业务数据的文件。

**Architecture:** 上传接口登记 `MediaAsset(PENDING)`；业务创建或更新在同一事务内标记 `ATTACHED`；业务删除仅标记 `DELETE_PENDING`，独立 worker 负责 COS 删除和失败重试。

**Tech Stack:** TypeScript、Koa、Prisma/MySQL、`cos-nodejs-sdk-v5`、Node test runner、Docker。

---

## 文件结构

- `prisma/schema.prisma` 和 `prisma/migrations/<timestamp>_add_media_assets/migration.sql`：资产状态与表结构。
- `src/modules/media/media-asset.service.ts`：登记、关联、排队、受限 COS 删除。
- `src/modules/media/media-cleanup.worker.ts` 与 `src/media-cleanup-main.ts`：15 分钟清理 worker。
- `src/modules/upload/upload.service.ts`：上传后登记，登记失败时补偿删除。
- 论坛、市场、任务、头像审核服务：媒体关联及业务删除排队。
- `scripts/delete-media-from-backup.ts`：从清理前备份提取生产业务媒体，默认 dry-run。
- `test/media-*.spec.ts`：覆盖安全规则、worker 和业务集成。
- 父级 `release.sh`：启动 `ic-media-cleanup-worker` 容器。

### Task 1: 资产表和登记服务

**Files:** `prisma/schema.prisma`、新增迁移、`src/modules/media/media-asset.service.ts`、`test/media-asset.service.spec.ts`。

- [ ] 先写失败测试：同一 `objectKey` 重复登记只保留一条 `PENDING` 资产；其他用户不能关联 URL；未知 URL 不进入删除队列。
- [ ] 运行 `npx tsx --test test/media-asset.service.spec.ts`，确认因服务不存在失败。
- [x] 新增 `MediaAsset`，字段包括对象键、URL、上传者、模块、图片/视频类型、状态、关联/删除时间、删除次数和错误信息；对象键为唯一键（URL 为非唯一长文本），索引为 `(state, createdAt)`、`(state, deleteRequestedAt)`。
- [x] 实现 `registerUploaded`、`attachUrls(tx, { uploaderId, urls })`、`requestDeleteUrls(tx, urls)`。关联仅接受当前上传者的 `PENDING` URL，删除只操作已登记资产。
- [ ] 运行 `npm run prisma:generate && npx tsx --test test/media-asset.service.spec.ts`，预期 PASS。
- [ ] 提交模型与服务：`feat(media): add media asset lifecycle model`。

### Task 2: 上传登记与 COS 删除安全

**Files:** `src/modules/upload/upload.service.ts`、`src/modules/media/media-asset.service.ts`、`test/upload-media-asset.spec.ts`、`test/media-asset.service.spec.ts`。

- [ ] 先写失败测试：上传返回 URL 时登记 `PENDING`；超过 24 小时的待关联资产可删除；`ATTACHED` 不被临时清理；当前环境以外、未知模块或 COS 删除失败的资产不会误删。
- [ ] 运行 `npx tsx --test test/media-asset.service.spec.ts test/upload-media-asset.spec.ts`，确认当前实现失败。
- [x] `UploadService.uploadMedia` 在 COS `putObject` 成功后登记资产；登记失败立即以相同对象键补偿 `deleteObject` 并返回上传失败。
- [x] `deleteAsset` 仅接受 `COS_ENV_PREFIX/(forum|task|mall|avatar)/(img|vid)/` 的已登记对象。成功置 `DELETED`；异常置 `DELETE_FAILED`、记录错误并递增次数，不向用户请求抛出 COS 异常。
- [ ] 运行同一测试命令，预期 PASS。
- [ ] 提交：`feat(media): register and safely delete COS assets`。

### Task 3: 业务关联、替换和删除队列

**Files:** `src/modules/forum/forum.service.ts`、`src/modules/mall/mall-item.service.ts`、`src/modules/mall/mall-comment.service.ts`、`src/modules/task/task.service.ts`、`src/modules/avatar-review/avatar-review.service.ts`、`src/modules/admin/admin.service.ts`、`test/media-lifecycle-integration.spec.ts`。

- [ ] 先写失败测试：论坛发布附着图片/视频；市场编辑新增媒体附着、移除媒体排队；删除市场商品时商品和评论媒体均排队且软删除仍成功；删除任务时发布和凭证媒体均排队。
- [ ] 运行 `npx tsx --test test/media-lifecycle-integration.spec.ts`，确认现有服务不调用媒体资产服务而失败。
- [ ] 在论坛发帖/回帖、市场发布/编辑/评论、任务发布/完成凭证的既有事务中附着 URL。后台发布按绑定小程序用户作为上传者验证身份。
- [ ] 删除帖子时收集全部回复媒体；删除回复/评论时收集级联子项媒体；删除市场商品时收集商品与评论媒体；删除任务时收集发布与凭证媒体。所有路径均在业务删除事务内置为 `DELETE_PENDING`。
- [ ] 头像审核记录创建后立即附着；审核失败、超时、拒绝或被取代时排队删除；仅审核通过的新头像替换旧头像时删除旧资产。
- [ ] 运行 `npx tsx --test test/media-lifecycle-integration.spec.ts`，预期 PASS。
- [ ] 提交：`feat(media): manage content media lifecycle`。

### Task 4: 清理 worker 和发布容器

**Files:** 新增 `src/modules/media/media-cleanup.worker.ts`、`src/media-cleanup-main.ts`、`test/media-cleanup.worker.spec.ts`；修改 `package.json`、父级 `release.sh`。

- [ ] 先写失败测试：worker 每 15 分钟处理超过 24 小时的 `PENDING`、`DELETE_PENDING`、`DELETE_FAILED`，并且同一进程不重入。
- [ ] 运行 `npx tsx --test test/media-cleanup.worker.spec.ts`，确认 worker 不存在而失败。
- [ ] 实现启动即执行一次、后续每 15 分钟执行的 worker；使用状态条件更新抢占资产，避免多实例重复删除。仅当 `MEDIA_CLEANUP_WORKER_ENABLED=true` 时运行。
- [ ] 新增 `start:media-cleanup`；父级发布脚本在 API 健康检查后替换 `ic-media-cleanup-worker`，使用同一镜像和环境文件运行 `node dist/media-cleanup-main.js`。
- [ ] 运行 `npx tsx --test test/media-cleanup.worker.spec.ts && npm run build && npm test`，预期全部 PASS。
- [ ] 提交：`feat(media): run scheduled media cleanup worker`。

### Task 5: 历史生产媒体清理与发布验证

**Files:** 新增 `scripts/delete-media-from-backup.ts`、`test/media-backup-cleanup.spec.ts`；更新设计文档。

- [ ] 先写失败测试：从 SQL 或 `.sql.gz` 备份中只提取去重后的生产环境业务 URL，跳过默认资源、测试环境和不符合对象前缀的 URL。
- [ ] 运行 `npx tsx --test test/media-backup-cleanup.spec.ts`，确认提取器不存在而失败。
- [ ] 实现 `--backup <path>` 必填、默认 dry-run 的脚本。只有同时给出 `--env production --confirm` 时才调用 COS 删除；输出成功、跳过、失败汇总 JSON，绝不输出密钥。
- [ ] 运行 `npx tsx --test test/media-backup-cleanup.spec.ts && npm run prisma:generate && npm run build && npm test && git diff --check`，预期全部 PASS。
- [ ] 合并已验证的 `dev` 到 `master` 并运行父级 `./deploy-production.sh`（仅后端）。验证 API 健康检查、`ic-admin-api`、`ic-media-cleanup-worker` 与 Prisma 新迁移。
- [ ] 历史备份媒体只先运行 dry-run；实际带 `--confirm` 的生产 COS 删除必须在展示清单后再次取得用户明确授权。
