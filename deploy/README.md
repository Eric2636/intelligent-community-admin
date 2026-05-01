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
