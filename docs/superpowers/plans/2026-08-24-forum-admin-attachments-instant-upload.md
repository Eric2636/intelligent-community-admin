# 管理员帖子附件与秒传 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `test-driven-development`; implementation is owned by the Luna worker and review is read-only by Terra.

**Goal:** 在小程序和后台网页为管理员帖子提供最多 5 个、单个 20 MiB 的附件上传、系统级 SHA-256 秒传、编辑和安全生命周期管理。

**Architecture:** API 中转真实上传，客户端先做 SHA-256 预检。共享物理文件与管理员资产记录分离；上传和帖子关联两个阶段均验证管理员、归属和状态。所有写入基于现有脏工作区增量完成，不覆盖用户改动。

**Tech Stack:** Prisma/MySQL、Koa/TypeScript、腾讯 COS、微信小程序、Vue 3/Ant Design Vue。

---

### Task 1: 固化后端失败行为测试

**Files:**
- Modify: `test/forum-functional-posts-contract.spec.ts`
- Create: `test/forum-attachment-upload.spec.ts`
- Create: `test/forum-attachment-association.spec.ts`
- Create: `test/forum-attachment-deduplication.spec.ts`

- [ ] 写行为测试覆盖 20 MiB/超 1 字节、空文件、扩展名/MIME/魔数、普通用户 403、停用管理员、错误 owner/module/type/state、跨帖 ATTACHED、5 个与重复 ID。
- [ ] 写 SHA-256 预检未命中、系统任意管理员命中并生成独立资产、并发首次上传只产生一个 blob、最后引用删除才清理物理文件的测试。
- [ ] 写帖子详情中 `favorited` 与 `attachments` 不错位的回归测试。
- [ ] 运行 `npx tsx --test test/forum-attachment-*.spec.ts`，记录因缺少秒传模型/API/正确关联规则产生的预期 RED。

### Task 2: 建立共享物理文件模型和增量迁移

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260824113000_add_forum_attachment_blobs/migration.sql`

- [ ] 新增单数 PascalCase Prisma model `ForumAttachmentBlob`，映射 `forum_attachment_blobs`；字段使用 camelCase，包含 `sha256`、`objectKey`、`url`、`contentType`、`sizeBytes`、删除状态/时间与时间戳。
- [ ] 为 SHA-256 建唯一约束；`MediaAsset` 增加 nullable `forumAttachmentBlobId` 外键，保留旧图片/视频兼容。
- [ ] 不修改可能已执行的 `20260824102000_add_forum_post_attachments`，只写 forward migration。
- [ ] 运行 Prisma validate/generate 和新 schema 测试至 GREEN。

### Task 3: 修复现有附件阻断并实现安全领域层

**Files:**
- Modify: `src/modules/forum/forum.service.ts`
- Modify: `src/modules/forum/forum-attachments.ts`
- Modify: `src/modules/upload/upload.service.ts`
- Modify: `src/modules/media/media-asset.service.ts`
- Modify: `src/lib/multipart-form.ts`
- Modify: `src/routes/index.ts`
- Modify: `src/routes/admin.routes.ts`
- Modify: `src/modules/forum/forum.dto.ts`
- Modify: `src/modules/admin/admin.dto.ts`
- Modify: `src/modules/admin/admin.service.ts`

- [ ] 先让详情错位、缺 import、transaction client 类型、20 MiB 边界和 MD5 upsert 的回归测试 RED。
- [ ] 修正详情 `Promise.all` 解构、导入与 Prisma 类型；multipart body 上限允许 25 MiB 且只收一个文件，文件层精确限制 20 MiB。
- [ ] 实现文件签名与允许类型校验、文件名净化、SHA-256 计算和随机真实 objectKey。
- [ ] 实现 mini/admin SHA-256 预检与真实上传：先鉴权再解析 body；命中只创建当前管理员独立 PENDING MediaAsset，未命中上传并以唯一约束处理并发竞争。
- [ ] 统一返回 `mediaAssetId`；禁止把其他管理员资产或其他帖子 ATTACHED 资产关联进来。
- [ ] 将校验和替换合并为事务内关联操作：create 只收 PENDING，edit 可保留当前帖 ATTACHED，移除转 DELETE_PENDING。
- [ ] 删除帖子和 worker 清理按 blob 引用数决定是否删除 COS；增加无帖子关系的 ATTACHED 文件资产兜底。
- [ ] 每个行为按 RED→GREEN 单独运行，最后执行全部后端附件测试。

### Task 4: 小程序附件选择、秒传、编辑与详情

**Files:**
- Modify: `api/cloud.js`
- Modify: `packageForum/publish/index.js`
- Modify: `packageForum/publish/index.wxml`
- Modify: `packageForum/publish/index.less`
- Modify: `packageForum/post/index.js`
- Modify: `packageForum/post/index.wxml`
- Modify: `packageForum/post/index.less`
- Modify: `packageForum/my-posts/index.js`
- Create or Modify: `test/forum-attachments.spec.mjs`

- [ ] 先写普通用户无控件/不提交、管理员最多 5 个和 20 MiB、SHA-256 命中不上传 body、未命中上传、失败重试、编辑完整 ID 列表、详情打开文档的失败测试。
- [ ] 在 API 层封装预检和 `wx.uploadFile`；使用文件系统 API 计算 SHA-256，并保持上传状态可恢复。
- [ ] 仅 `canManageForumPosts` 显示附件区，使用 `wx.chooseMessageFile`；上传未结束时禁止发布。
- [ ] 编辑加载现有附件并允许保留/添加/移除；提交 `attachments` 完整列表。
- [ ] 详情展示文件名与格式化大小，下载后用 `wx.openDocument` 打开并处理失败。
- [ ] 运行附件定向测试和 `node --test test/*.spec.mjs` 至 GREEN。

### Task 5: 后台网页附件选择、秒传、编辑与详情

**Files:**
- Modify: `src/api/admin.ts`
- Modify: `src/types/api.ts`
- Modify: `src/views/ContentView.vue`
- Create: `src/utils/forumAttachment.ts`
- Modify: `nginx.conf.template`
- Create or Modify: `test/forum-attachments.spec.mjs`

- [ ] 先写预检/上传路径、20 MiB/5 个、秒传命中、编辑快照 payload、详情下载和 Nginx 25m 的失败测试。
- [ ] 实现浏览器 SHA-256、预检、multipart 上传与状态模型；accept 只提示白名单，服务端仍最终校验。
- [ ] 帖子创建/编辑表单显示附件区，上传中禁止保存；编辑变化后提交完整附件 ID 列表。
- [ ] 详情弹窗展示附件下载列表。
- [ ] 配置 `client_max_body_size 25m`。
- [ ] 运行定向测试、全测与 `npm run build` 至 GREEN。

### Task 6: Luna 自检与交付 Terra

- [ ] 对照 spec 逐条检查权限、秒传、编辑、生命周期、旧帖兼容和两个入口。
- [ ] 后端执行 Prisma validate/generate、`npx tsc -p tsconfig.build.json --noEmit`、`npm test`。
- [ ] 小程序执行 `node --test test/*.spec.mjs`。
- [ ] 后台执行 `node --test test/*.spec.mjs` 与 `npm run build`。
- [ ] 报告准确 diff、预存脏改动、RED/GREEN 证据和未解决问题；不提交、不推送、不部署。

### Task 7: Terra 只读审核与 Luna 修复循环

- [ ] Terra 按 P0–P3 审核真实 diff、需求覆盖、权限绕过、SHA-256 秒传竞态、引用清理、迁移、20 MiB 边界和测试证据，不编辑文件。
- [ ] Luna 对每项有效发现补失败测试、修复至 GREEN 并重跑相关全量验证。
- [ ] Terra 复审修复后的 diff，直到无阻断发现。
- [ ] 主代理独立运行最终验证并逐项核对批准需求。
