# intelligent-community-admin

智慧社区小程序的 Koa + TypeScript + Prisma API 服务，同时为后台管理 Web 提供管理接口。

## 本地开发

```bash
npm install
npm run prisma:generate
npm run build
npm test
```

环境变量示例见 `.env.example`。任何密码、JWT 密钥和云服务密钥都不得写入仓库。

## 第一阶段接口语义

- 用户资料是用户名和头像的唯一真实来源。资料更新会在同一事务中同步任务、帖子/回复、市场商品/评论/订单的历史展示快照。
- 数据库作者或交易方头像快照允许为 NULL。API 对缺失或历史默认头像返回空值，小程序统一由 TDesign `user` 矢量图兜底，避免使用位图默认头像。
- 小区市场的分类、在线商品列表、在线商品详情和在线商品评论允许游客查询。携带有效 Bearer token 时会返回收藏、点赞等当前用户状态。
- 发布、评论、收藏、下单、“我的商品”和“我的订单”等私有操作仍要求 Bearer token。
- 小区跑腿模块已从路由、服务、上传类型和 OpenAPI 中移除；旧接口不再提供。

完整接口以启动后的 `/api-docs` Swagger 页面和 `src/swagger/openapi.ts` 为准。

## 第二阶段意见反馈

- `POST /api/feedbacks` 要求 Bearer token，用户 ID 只取自服务端登录态。
- 请求体只接受 `content`；服务端 trim 后要求 1–500 个 Unicode code points，不接受反馈类型、联系方式、图片或客户端伪造的用户 ID。
- `GET /api/admin/feedbacks` 要求后台管理员登录，`SUPERADMIN` 与 `ADMIN` 均可访问；支持按昵称/内容关键词、用户身份和提交时间范围分页查询。
- 后台反馈列表关联返回昵称、头像和身份标签，默认按提交时间倒序；当前不包含标题、处理状态、处理备注、修改或删除能力。

## 第三阶段消息通知

- 用户接口均要求小程序 Bearer token：
  - `GET /api/notifications`：分页查询当前用户未软删除的通知。
  - `GET /api/notifications/unread-count`：查询当前用户未读数。
  - `PATCH /api/notifications/read-all`：全部已读。
  - `PATCH /api/notifications/:id/read`：幂等标记当前用户单条通知已读。
  - `DELETE /api/notifications/:id`：仅软删除当前用户的单条通知。
- 论坛回复、任务状态和市场订单通知与对应业务写入共用事务；自通知被抑制，去重键按回复编号、业务版本或发布意图区分。点赞和收藏不产生通知。
- `POST /api/admin/system-notices` 使用管理端 Bearer token 且仅 `SUPERADMIN` 可调用。请求体包含 `title`、`content` 和 `clientRequestId`，安全重试不会重复发送。
- 完整事件矩阵、接收人、去重键和跳转规则见小程序仓库 `docs/消息通知事件清单.md`；完整 schema 和响应定义见 OpenAPI。

## 第四阶段接口访问日志（实现中）

- 已有 `ApiEndpoint`、`ApiAccessLog`、`ApiErrorLog` 模型和迁移、标准路由自动注册服务、最外层访问日志中间件及基础脱敏。
- 新接口注册时普通日志默认开启；普通日志开关关闭后，5xx 仍写入独立错误日志。日志写入失败不得改变原业务响应。
- 超级管理员查询/编辑 API、完整筛选与 CSV 导出、后台接口管理/访问日志/错误日志页面、OpenAPI 和 90 天分批清理脚本已有本地实现。
- 保留周期已有 90 天边界与 5,000 行批次行为测试；代理 IP 只有在 `TRUST_PROXY=true` 且 socket peer 命中 `TRUST_PROXY_IPS` 时才读取转发头。
- 同一 PATCH 同时修改描述和日志开关时会分别写入两类管理员操作 action，并已有行为测试。2026-07-28 已在备份后迁移本机 `127.0.0.1:3308/ic_test`，并验证接口同步与成功请求日志写入；89/90/91 天清理演练、测试/生产迁移、目标环境定时任务/代理白名单配置和完整故障/安全/性能验收尚未完成。
- 字段、安全边界、可信代理配置和待验收项见 `docs/接口访问日志说明.md`。

## 数据库迁移

第一至第四阶段当前共包含五份迁移：

- `20260726090000_add_author_avatar_snapshots`：增加展示快照字段、索引，并按用户关系回填任务、论坛主帖/回复、市场内容和订单的历史用户名与头像；空白头像归一为 NULL，不写入环境相关默认 URL。
- `20260726100000_remove_errand_module`：删除跑腿相关表。
- `20260726120000_simplify_feedback`：新建最小纯文本 `feedbacks` 表和按用户/时间查询所需索引，不包含图片字段。
- `20260726130000_add_notification_center`：新增 `notifications`、`system_notice_publications`，为 `Task`、`MallOrder` 增加 `version`，并为订单增加 `clientRequestId` 及 `(buyerId, clientRequestId)` 复合唯一约束。
- `20260726160000_add_api_access_logging`：新增接口注册、普通访问日志和 5xx 错误日志三张表，以及按时间、IP、接口、方法、来源、状态、操作者和耗时使用的索引。
- `20260731191000_add_avatar_reviews`：新增头像异步内容安全审核记录、微信 trace ID 唯一约束及按用户、状态和时间查询所需索引。

## 头像内容安全审核

- 小程序头像上传到 `module=avatar` 后，API 调用微信 `mediaCheckAsync`（`media_type=2`、`version=2`、`scene=1`）；上传结果在审核完成前不会写入用户头像。
- 微信返回 `pass` 时才更新用户头像和历史内容快照；`risky`、`review`、接口错误及超时均保留旧头像。后到达的旧审核结果不能覆盖更新的头像请求。
- 生产环境必须配置随机且保密的 `WX_MESSAGE_TOKEN`。微信公众平台消息推送地址配置为 `https://lllhjh.asia/api/wechat/content-security/callback`，令牌与该环境变量完全一致，消息加密方式选择明文模式，数据格式选择 JSON。
- 回调 GET 用于微信签名验证，POST 接收异步结果；接口同时校验 SHA-1 签名和 `WX_APPID`，不要在日志或仓库中记录令牌。
- 发布前需使用“微信头像”和“自定义”两个入口分别真机验证：页面先显示“头像审核中，通过后自动生效”，通过后自动刷新；未通过或服务异常时只显示通用提示且旧头像不变。

当前项目尚未上线。2026-07-28 已备份并迁移本机 `127.0.0.1:3308/ic_test`，11 条迁移状态为最新，跑腿四张专属表仅从该本地库删除。测试和生产数据库仍必须先确认目标、备份并验证后再迁移；不要在未确认数据库目标时运行 `prisma migrate dev` 或 `prisma migrate deploy`。

## 数据库运维管理

- 仅超级管理员可访问 `/api/admin/database/*`。
- 自动备份只接受“每小时 / 每 6 小时 / 每天”三种结构化计划，不接受原始 cron。
- 手动与自动备份共用当前环境的最新文件；先写临时 gzip、校验后原子替换，失败保留上一份有效备份。
- 测试与生产必须挂载不同的持久化目录，文件分别为 `ic_test_latest.sql.gz` 与 `ic_prod_latest.sql.gz`。
- 数据表管理只读取 `information_schema` 的表和字段定义，不提供表内记录、SQL、恢复、下载、删除或修改功能。
- 备份设置与手动备份接口进入统一管理员操作审计；所有调用进入接口监控。
- API 与备份 Worker 必须作为两个独立进程运行：API 设置 `DATABASE_BACKUP_WORKER_ENABLED=false`，Worker 使用 `npm run start:backup` 且设置为 `true`。
- Worker 使用独立的 `DATABASE_BACKUP_URL` 只读备份账号，并要求它、`DATABASE_URL` 与 `DATABASE_BACKUP_EXPECTED_DATABASE` 指向同一目标库；不匹配时拒绝启动。
- 多实例通过数据库租约互斥执行。任务会记录计划时间、开始/结束时间、耗时与发起管理员；临时 gzip 经完整解压校验和落盘同步后才原子替换旧备份。
- 数据表支持按表名、所属模块、用途说明搜索；字段抽屉同时展示列定义和索引定义。

## 安全与发布

- 代码修改只在 `dev` 分支进行。
- 测试环境只能从 `test` 分支发布，生产环境只能从生产分支发布。
- 本地验证不等于已提交、已推送或已部署。
- 云服务器账户信息和密码请保存在密码管理器或独立运维记录中。
