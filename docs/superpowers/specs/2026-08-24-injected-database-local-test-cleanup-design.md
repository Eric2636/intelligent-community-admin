# 数据库注入与本地测试清理设计

## 目标

业务服务不得绕过构造函数注入直接访问全局 Prisma。自动化测试允许使用本机 `127.0.0.1:3308/ic_local`，但测试后必须清空业务数据并保留数据库结构和 `_prisma_migrations`。

## 设计

- `TaskService` 和 `MallItemService` 统一通过 `this.database` 访问 Prisma delegate，默认值仍为生产使用的全局 `prisma`。
- fake database 单元测试继续用于权限、失败和并发分支；真实数据库集成测试验证 Prisma、MySQL、外键和事务。
- 真实数据库测试启动前必须解析 `DATABASE_URL` 并同时满足 host=`127.0.0.1`/`localhost`、port=`3308`、database=`ic_local`，否则拒绝清理或写入。
- 测试前运行迁移。测试后在 `finally` 中按外键依赖关闭检查、truncate 业务表、恢复外键检查；明确排除 `_prisma_migrations`。
- 清理只能面向 information_schema 中当前库的业务表，不删除表、列、索引、外键或迁移记录。

## 验收

- 当前18项回归失败恢复通过，且测试不会从注入服务意外访问全局 Prisma。
- 清理保护测试证明远程地址、错误端口、错误库名均被拒绝，`_prisma_migrations` 永不进入清理集合。
- 后端全测、Prisma/TypeScript、附件测试、后台网页全测和构建全部通过后方可发布测试环境。
