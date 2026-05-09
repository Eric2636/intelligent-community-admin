# Docker + Jenkins 自动化部署文档

本文档用于在一台空的 Linux 服务器上部署智慧社区项目，包含：

- 后端：`intelligent-community-admin`，Node.js + Koa + Prisma
- 前端：前端项目或静态站点
- 数据库：MySQL 8
- 缓存：Redis 7
- 网关：Nginx
- 自动化发布：Jenkins + Docker Compose

以下命令默认基于 `Ubuntu 22.04 / 24.04`，服务器登录用户建议使用 `root` 或具备 `sudo` 权限的用户。

## 1. 服务器初始化

登录服务器：

```bash
ssh root@服务器IP
```

更新系统并安装基础工具：

```bash
apt update && apt upgrade -y
apt install -y curl wget git vim unzip ca-certificates gnupg lsb-release ufw
```

创建项目目录：

```bash
mkdir -p /data/apps/intelligent-community
mkdir -p /data/mysql
mkdir -p /data/redis
mkdir -p /data/nginx/conf.d
mkdir -p /data/jenkins
mkdir -p /data/backup/mysql
```

配置防火墙：

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw allow 8080
ufw enable
```

说明：

- `80/443`：Web 访问入口。
- `8080`：Jenkins 管理后台。
- MySQL `3306` 和 Redis `6379` 不建议开放公网访问。

## 2. 安装 Docker

安装 Docker：

```bash
curl -fsSL https://get.docker.com | bash
systemctl enable docker
systemctl start docker
```

检查版本：

```bash
docker -v
docker compose version
```

如果 `docker compose` 不存在：

```bash
apt install -y docker-compose-plugin
```

## 3. 拉取项目代码

进入应用目录：

```bash
cd /data/apps/intelligent-community
```

拉取后端项目：

```bash
git clone 后端仓库地址 intelligent-community-admin
```

拉取前端项目：

```bash
git clone 前端仓库地址 intelligent-community-web
```

如果前端暂时是小程序项目，或不需要部署 Web 静态站点，可以先只部署后端、MySQL、Redis、Nginx 接口网关。

## 4. 配置生产环境变量

进入后端项目：

```bash
cd /data/apps/intelligent-community/intelligent-community-admin
cp .env.example .env
vim .env
```

生产环境推荐配置：

```env
PORT=3000

DATABASE_URL=mysql://community_user:强密码@mysql:3306/intelligent_community?charset=utf8mb4

REDIS_ENABLED=true
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_DB=0
REDIS_PASSWORD=强密码
REDIS_COMMAND_TIMEOUT_MS=5000

WX_APPID=你的微信小程序AppID
WX_APPSECRET=你的微信小程序密钥

JWT_SECRET=生产环境随机长密钥
JWT_EXPIRES_IN=7d
ADMIN_JWT_EXPIRES_IN=3h
ADMIN_REFRESH_JWT_EXPIRES_IN=3h

COS_SECRET_ID=你的腾讯云COS SecretId
COS_SECRET_KEY=你的腾讯云COS SecretKey
COS_BUCKET=你的桶名
COS_REGION=ap-shanghai
COS_ENV_PREFIX=prod
COS_STS_DURATION_SECONDS=1800
COS_PRESIGN_EXPIRES_SECONDS=600
```

注意：

- `.env` 只放在服务器，不要提交到 Git。
- `DATABASE_URL` 中的主机名使用 `mysql`，这是 Docker Compose 内部服务名。
- `REDIS_HOST` 使用 `redis`，也是 Docker Compose 内部服务名。

## 5. 准备 Docker Compose

在 `/data/apps/intelligent-community/docker-compose.yml` 创建编排文件：

```yaml
services:
  mysql:
    image: mysql:8.0
    container_name: ic-mysql
    restart: unless-stopped
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      TZ: Asia/Shanghai
    command:
      - --default-authentication-plugin=mysql_native_password
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
    volumes:
      - /data/mysql:/var/lib/mysql
    networks:
      - ic-net

  redis:
    image: redis:7
    container_name: ic-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - /data/redis:/data
    networks:
      - ic-net

  api:
    build:
      context: ./intelligent-community-admin
      dockerfile: Dockerfile
    container_name: ic-admin-api
    restart: unless-stopped
    env_file:
      - ./intelligent-community-admin/.env
    depends_on:
      - mysql
      - redis
    networks:
      - ic-net

  web:
    build:
      context: ./intelligent-community-web
      dockerfile: Dockerfile
    container_name: ic-web
    restart: unless-stopped
    depends_on:
      - api
    networks:
      - ic-net

  nginx:
    image: nginx:1.25-alpine
    container_name: ic-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /data/nginx/conf.d:/etc/nginx/conf.d
    depends_on:
      - api
      - web
    networks:
      - ic-net

networks:
  ic-net:
    driver: bridge
```

在同目录创建 `/data/apps/intelligent-community/.env`：

```env
MYSQL_ROOT_PASSWORD=生产环境root强密码
MYSQL_DATABASE=intelligent_community
MYSQL_USER=community_user
MYSQL_PASSWORD=生产环境业务用户强密码

REDIS_PASSWORD=生产环境Redis强密码
```

## 6. 后端 Dockerfile

当前后端项目根目录已包含 `Dockerfile`，可直接使用。它会：

- 安装依赖
- 生成 Prisma Client
- 编译 TypeScript
- 使用 `node dist/main.js` 启动服务

如需手动验证：

```bash
cd /data/apps/intelligent-community/intelligent-community-admin
docker build -t ic-admin-api:test .
```

## 7. 前端 Dockerfile 示例

如果前端是 Vite / Vue / React 静态项目，在前端项目根目录创建 `Dockerfile`：

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:1.25-alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
```

如果前端不是 Web 项目，可以删除 `docker-compose.yml` 中的 `web` 服务，并让 Nginx 只反代后端接口。

## 8. 配置 Nginx

创建 `/data/nginx/conf.d/intelligent-community.conf`：

```nginx
server {
    listen 80;
    server_name 你的域名或服务器IP;

    client_max_body_size 20m;

    location / {
        proxy_pass http://web:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://api:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果只部署后端接口：

```nginx
server {
    listen 80;
    server_name 你的域名或服务器IP;

    location /api/ {
        proxy_pass http://api:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 9. 首次启动服务

进入部署目录：

```bash
cd /data/apps/intelligent-community
```

检查 Compose 配置：

```bash
docker compose config
```

启动：

```bash
docker compose up -d --build
```

查看容器：

```bash
docker ps
```

查看日志：

```bash
docker compose logs -f api
docker compose logs -f mysql
docker compose logs -f redis
docker compose logs -f nginx
```

## 10. 执行数据库迁移

首次启动 MySQL 后，执行 Prisma 迁移：

```bash
cd /data/apps/intelligent-community
docker compose exec api npx prisma migrate deploy
```

如果需要生成初始数据，按项目实际 seed 脚本执行，例如：

```bash
docker compose exec api npx prisma db seed
```

健康检查：

```bash
curl http://127.0.0.1/api/health
```

## 11. 安装 Jenkins

使用 Docker 启动 Jenkins：

```bash
docker run -d \
  --name jenkins \
  --restart unless-stopped \
  -p 8080:8080 \
  -p 50000:50000 \
  -v /data/jenkins:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /usr/bin/docker:/usr/bin/docker \
  jenkins/jenkins:lts
```

查看初始密码：

```bash
docker logs jenkins
```

访问 Jenkins：

```text
http://服务器IP:8080
```

推荐安装插件：

- Git
- Pipeline
- Docker Pipeline
- Credentials Binding
- SSH Agent

让 Jenkins 容器内可以使用 Docker：

```bash
docker exec -u root -it jenkins bash
apt update
apt install -y docker.io docker-compose-plugin
usermod -aG docker jenkins
exit
docker restart jenkins
```

## 12. Jenkins 凭据配置

进入：

```text
Manage Jenkins -> Credentials
```

建议添加：

- Git 仓库凭据：用户名密码、Token 或 SSH Key。
- 服务器 SSH Key：如果 Jenkins 和部署服务器不在同一台机器。
- Docker Registry 凭据：如果需要推送镜像到镜像仓库。

生产环境 `.env` 不建议写在 Jenkinsfile 中，应保存在服务器 `/data/apps/intelligent-community` 目录。

## 13. Jenkins Pipeline

如果 Jenkins 和应用部署在同一台服务器，可以在后端仓库根目录创建 `Jenkinsfile`：

```groovy
pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    environment {
        DEPLOY_DIR = '/data/apps/intelligent-community'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Update Code') {
            steps {
                sh '''
                cd ${DEPLOY_DIR}/intelligent-community-admin
                git fetch --all
                git reset --hard origin/main

                if [ -d "${DEPLOY_DIR}/intelligent-community-web/.git" ]; then
                  cd ${DEPLOY_DIR}/intelligent-community-web
                  git fetch --all
                  git reset --hard origin/main
                fi
                '''
            }
        }

        stage('Build And Deploy') {
            steps {
                sh '''
                cd ${DEPLOY_DIR}
                docker compose up -d --build
                '''
            }
        }

        stage('Database Migration') {
            steps {
                sh '''
                cd ${DEPLOY_DIR}
                docker compose exec -T api npx prisma migrate deploy
                '''
            }
        }

        stage('Health Check') {
            steps {
                sh '''
                sleep 5
                curl -f http://127.0.0.1/api/health
                docker compose ps
                '''
            }
        }
    }

    post {
        success {
            sh '''
            cd ${DEPLOY_DIR}
            docker image prune -f
            '''
        }

        failure {
            sh '''
            cd ${DEPLOY_DIR}
            docker compose logs --tail=200 api
            '''
        }
    }
}
```

如果你的默认分支不是 `main`，把 `origin/main` 改为 `origin/dev` 或实际生产分支。

## 14. Jenkins 构建任务配置

创建任务：

```text
New Item -> Pipeline
```

配置：

- Definition：`Pipeline script from SCM`
- SCM：`Git`
- Repository URL：后端仓库地址
- Credentials：选择 Git 凭据
- Branch：生产分支，例如 `*/main` 或 `*/dev`
- Script Path：`Jenkinsfile`

自动触发方式可选：

- GitHub/Gitee Webhook 推送后触发。
- Jenkins 定时轮询。
- 手动点击 `Build Now`。

## 15. HTTPS 配置

有域名时推荐使用 `Nginx Proxy Manager` 或在宿主机统一管理 HTTPS。

如果使用宿主机 Nginx + Certbot：

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d your-domain.com
```

如果继续使用 Docker Nginx，需要把证书目录挂载进 Nginx 容器，再在 `conf.d` 中配置 `443 ssl`。

## 16. 日常运维命令

进入部署目录：

```bash
cd /data/apps/intelligent-community
```

查看服务：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f api
```

重启服务：

```bash
docker compose restart api
```

重新构建并启动：

```bash
docker compose up -d --build
```

停止服务：

```bash
docker compose down
```

进入后端容器：

```bash
docker compose exec api sh
```

进入 MySQL：

```bash
docker compose exec mysql mysql -u root -p
```

进入 Redis：

```bash
docker compose exec redis redis-cli -a "$REDIS_PASSWORD"
```

清理无用镜像：

```bash
docker image prune -f
```

## 17. MySQL 备份与恢复

创建备份：

```bash
mkdir -p /data/backup/mysql
docker exec ic-mysql mysqldump -u root -p intelligent_community > /data/backup/mysql/intelligent_community_$(date +%F_%H%M%S).sql
```

恢复备份：

```bash
docker exec -i ic-mysql mysql -u root -p intelligent_community < /data/backup/mysql/备份文件.sql
```

建议配置定时备份：

```bash
crontab -e
```

示例：每天凌晨 2 点备份。

```cron
0 2 * * * docker exec ic-mysql mysqldump -u root -p你的root密码 intelligent_community > /data/backup/mysql/intelligent_community_$(date +\%F_\%H\%M\%S).sql
```

## 18. 回滚方案

如果新版本异常，回滚代码：

```bash
cd /data/apps/intelligent-community/intelligent-community-admin
git log --oneline -5
git reset --hard 上一个稳定commit

cd /data/apps/intelligent-community
docker compose up -d --build api
```

如果前端也需要回滚：

```bash
cd /data/apps/intelligent-community/intelligent-community-web
git log --oneline -5
git reset --hard 上一个稳定commit

cd /data/apps/intelligent-community
docker compose up -d --build web nginx
```

数据库迁移一旦执行，回滚前需要确认迁移是否兼容。生产环境不建议直接手动删除表或字段，应先备份。

## 19. 常见问题

### 容器内连不上 MySQL

检查 `.env`：

```env
DATABASE_URL=mysql://community_user:密码@mysql:3306/intelligent_community?charset=utf8mb4
```

在 Compose 网络中不要使用 `127.0.0.1` 连接 MySQL，应使用服务名 `mysql`。

### 容器内连不上 Redis

检查：

```env
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=你的Redis密码
```

### Jenkins 无法执行 docker

检查是否挂载了 Docker Socket：

```bash
docker inspect jenkins | grep docker.sock
```

检查 Jenkins 容器内是否安装 Docker CLI：

```bash
docker exec -it jenkins docker version
```

### Nginx 访问 502

查看后端和 Nginx 日志：

```bash
docker compose logs --tail=200 api
docker compose logs --tail=200 nginx
```

确认服务名和端口：

```bash
docker compose ps
```

## 20. 推荐上线流程

1. 服务器初始化，安装 Docker。
2. 拉取后端和前端代码。
3. 配置生产 `.env`。
4. 编写并检查 `docker-compose.yml`。
5. 手动执行一次 `docker compose up -d --build`。
6. 执行 `npx prisma migrate deploy`。
7. 确认接口、前端、MySQL、Redis、Nginx 正常。
8. 安装 Jenkins。
9. 配置 Pipeline。
10. 后续通过 Jenkins 自动构建和部署。
