# 发布入口

后端 API 与后台管理系统共用同一套发布脚本，入口位于两个项目的父级目录：

```bash
cd /Users/chenglingyun/Documents/fuye-project
./deploy-test.sh
./deploy-production.sh
```

脚本会自动执行本地验证、源码同步、镜像构建、目标容器重建与健康检查；不需要手动 SSH、打包或运行 Docker 命令。测试入口固定 `test` 分支和 `ic-test-*` 容器，生产入口固定 `master` 分支和生产容器。

发布时选择范围：`1` 仅后端、`2` 仅后台管理系统、`3` 两者同时发布。脚本先展示所选项目的 `dev` 改动；确认后自动暂存、提交、推送 `dev`、合并并推送目标分支，再进行构建和部署。测试目标固定为 `dev → test`，生产目标固定为 `dev → master`；部署摘要处还需要再次输入 `y`。

合并冲突、提交、推送、测试、构建或部署失败时会立即停止，不会继续下一步。成功后，所选项目会自动回到 `dev`。父级目录不是 Git 仓库，因此父级的三个入口脚本只在当前电脑生效；仓库内保留的兼容入口和本说明会随分支提交。

`intelligent-community-admin/deploy/` 下的同名脚本仍可使用，但仅为兼容旧命令，会自动转发到父级入口；后续请优先使用父级入口。

旧 Jenkins 与服务器侧 Git 拉取发布方式不再用于日常发版。

# API + 接口文档（双容器）

分步操作（含 MySQL 地址、防火墙、排错）见仓库根目录：**`docs/管理后端Docker双容器部署手册.md`**。

## 是什么

| 容器 | 作用 |
|------|------|
| `ic-admin-api` | Node 跑 `intelligent-community-admin` 后端（端口 **3000**） |
| `ic-admin-docs` | Nginx 托管 Swagger UI，并把 `/api-docs/openapi.json` 与 `/api/` 反代到上面的 API（对外 **8088**） |

浏览器只访问 **`http://服务器IP:8088/`** 即可看文档并「试用」接口（请求会经 Nginx 转到 API）。

## 前置

1. 项目根目录已有可运行的 **`.env`**（与本地开发一致；库、Redis、密钥等）。
2. MySQL 若在 **宿主机**（本机 `127.0.0.1:3306`）：容器里不能用 `127.0.0.1` 指宿主机。请把 `DATABASE_URL` 主机改为 **`host.docker.internal`**（Compose 里已配 `extra_hosts`，需 Docker 20.10+）。
3. MySQL 若也在 **Docker**（例如 `ic-mysql`）：更稳妥是把 API 服务加入 **同一 Docker 网络**，`DATABASE_URL` 主机写 **容器名**（如 `ic-mysql`），此时可去掉 `extra_hosts` 段。

## 启动

在 **`intelligent-community-admin/`** 目录：

```bash
docker compose -f deploy/docker-compose.api-docs.yml up -d --build
```

## 验证

```bash
curl -s http://127.0.0.1:3000/api/health
curl -sI http://127.0.0.1:8088/
```

首次建表可在 API 容器内执行迁移（按你环境二选一）：

```bash
docker exec -it ic-admin-api npx prisma migrate deploy
```

## 停止

```bash
docker compose -f deploy/docker-compose.api-docs.yml down
```
