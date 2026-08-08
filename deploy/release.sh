#!/usr/bin/env bash

set -euo pipefail

REMOTE_USER=ubuntu
REMOTE_HOST=124.222.34.110
REMOTE_RELEASE_ROOT=/home/ubuntu/docker-project/releases/local-direct
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_REPOSITORY="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_REPOSITORY="$(cd "$API_REPOSITORY/../intelligent-community-admin-web" && pwd)"

die() { printf '发布已停止：%s\n' "$*" >&2; exit 1; }
info() { printf '\n== %s ==\n' "$*"; }
remote() { ssh -n -o BatchMode=yes -o ConnectTimeout=30 -o ServerAliveInterval=20 "${REMOTE_USER}@${REMOTE_HOST}" "$@"; }

require_clean_branch() {
  local repository="$1" expected="$2"
  [ "$(git -C "$repository" branch --show-current)" = "$expected" ] || die "$repository 必须在 $expected 分支"
  [ -z "$(git -C "$repository" status --porcelain)" ] || die "$repository 存在未提交改动"
}

sync_source() {
  local source_dir="$1" remote_dir="$2"
  remote "mkdir -p '$remote_dir'"
  rsync -az --delete --exclude .git --exclude '.env*' --exclude node_modules --exclude dist --exclude .DS_Store --exclude '._*' \
    "${source_dir}/" "${REMOTE_USER}@${REMOTE_HOST}:${remote_dir}/"
}

choose_scope() {
  printf '\n请选择发布范围：\n1. 仅后端\n2. 仅后台管理系统\n3. 后端和后台管理系统\n0. 取消\n请输入选项：'
  read -r RELEASE_SCOPE
  case "$RELEASE_SCOPE" in 0) printf '已取消，未执行发布。\n'; exit 0;; 1|2|3) ;; *) die '无效选项，未执行发布';; esac
}

preflight() {
  info '本地检查'
  for command in git npm rsync ssh curl; do command -v "$command" >/dev/null 2>&1 || die "缺少本地命令：$command"; done
  require_clean_branch "$API_REPOSITORY" "$TARGET_BRANCH"
  require_clean_branch "$WEB_REPOSITORY" "$TARGET_BRANCH"
  API_COMMIT="$(git -C "$API_REPOSITORY" rev-parse --short=12 HEAD)"
  WEB_COMMIT="$(git -C "$WEB_REPOSITORY" rev-parse --short=12 HEAD)"
  remote "command -v docker >/dev/null && test -f '$API_ENV_FILE' && test -f '$API_BACKUP_ENV_FILE' && docker network inspect ic-network >/dev/null && docker network inspect deploy_default >/dev/null" \
    || die '服务器预检失败：Docker、环境文件或网络未准备好'
}

confirm_release() {
  printf '\n发布摘要：%s 环境 / %s 分支 / 后端 %s / 后台 %s / 范围 %s\n' "$TARGET_ENV" "$TARGET_BRANCH" "$API_COMMIT" "$WEB_COMMIT" "$RELEASE_SCOPE"
  printf '输入 y 确认发布，其余输入取消：'
  local answer
  read -r answer
  [ "$answer" = y ] || { printf '已取消，未执行发布。\n'; exit 0; }
}

deploy_api() {
  info '构建、同步并部署后端'
  (cd "$API_REPOSITORY" && npm run build && npm test)
  local image="${API_IMAGE_PREFIX}:${API_COMMIT}" migration_image="${API_IMAGE_PREFIX}-migration:${API_COMMIT}" remote_dir="${REMOTE_RELEASE_ROOT}/${TARGET_ENV}/api-${API_COMMIT}"
  sync_source "$API_REPOSITORY" "$remote_dir"
  remote "set -euo pipefail
    cd '$remote_dir'
    docker build --target migration -t '$migration_image' .
    docker build $WEB_BUILD_ARGS -t '$image' .
    docker run --rm --network ic-network --env-file '$API_ENV_FILE' --add-host host.docker.internal:host-gateway '$migration_image' npx prisma migrate deploy
    docker rm -f '${API_CONTAINER}-previous' >/dev/null 2>&1 || true
    if docker inspect '$API_CONTAINER' >/dev/null 2>&1; then docker rename '$API_CONTAINER' '${API_CONTAINER}-previous'; docker stop '${API_CONTAINER}-previous' >/dev/null; fi
    docker run -d --name '$API_CONTAINER' --restart unless-stopped --network ic-network --network-alias '$API_NETWORK_ALIAS' --env-file '$API_ENV_FILE' --add-host host.docker.internal:host-gateway $API_PORT_ARGS '$image' >/dev/null
    docker network connect --alias '$API_NETWORK_ALIAS' deploy_default '$API_CONTAINER' 2>/dev/null || true
    healthy=0
    for i in \$(seq 1 30); do
      if docker exec '$API_CONTAINER' node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"; then healthy=1; break; fi
      sleep 2
    done
    if [ \"\$healthy\" -ne 1 ]; then
      docker logs --tail 80 '$API_CONTAINER' || true
      docker rm -f '$API_CONTAINER' >/dev/null 2>&1 || true
      if docker inspect '${API_CONTAINER}-previous' >/dev/null 2>&1; then docker rename '${API_CONTAINER}-previous' '$API_CONTAINER'; docker start '$API_CONTAINER' >/dev/null; fi
      exit 1
    fi
    docker rm -f '${API_CONTAINER}-previous' >/dev/null 2>&1 || true
    docker rm -f '$API_BACKUP_CONTAINER' >/dev/null 2>&1 || true
    docker run -d --name '$API_BACKUP_CONTAINER' --restart unless-stopped --network ic-network --env-file '$API_ENV_FILE' --env-file '$API_BACKUP_ENV_FILE' -e DATABASE_BACKUP_WORKER_ENABLED=true -e DATABASE_BACKUP_DIRECTORY=/var/backups/intelligent-community -e BACKUP_TIME_ZONE=Asia/Shanghai -v /home/ubuntu/db-backups/$TARGET_ENV:/var/backups/intelligent-community --add-host host.docker.internal:host-gateway '$image' node dist/database-backup-main.js >/dev/null" \
    || die '后端部署失败；请检查终端输出'
}

deploy_web() {
  info '构建、同步并部署后台管理系统'
  (cd "$WEB_REPOSITORY" && npm run build && node --test test/*.spec.mjs)
  local image="${WEB_IMAGE_PREFIX}:${WEB_COMMIT}" remote_dir="${REMOTE_RELEASE_ROOT}/${TARGET_ENV}/web-${WEB_COMMIT}"
  sync_source "$WEB_REPOSITORY" "$remote_dir"
  remote "set -euo pipefail
    cd '$remote_dir'
    docker build -t '$image' .
    docker rm -f '${WEB_CONTAINER}-previous' >/dev/null 2>&1 || true
    if docker inspect '$WEB_CONTAINER' >/dev/null 2>&1; then docker rename '$WEB_CONTAINER' '${WEB_CONTAINER}-previous'; docker stop '${WEB_CONTAINER}-previous' >/dev/null; fi
    docker run -d --name '$WEB_CONTAINER' --restart unless-stopped --network deploy_default -e ADMIN_API_UPSTREAM='$WEB_API_UPSTREAM' -p '$WEB_HOST_PORT:80' '$image' >/dev/null
    healthy=0
    for i in \$(seq 1 20); do
      if curl -fsSI --max-time 5 http://127.0.0.1:$WEB_HOST_PORT/ >/dev/null && curl -fsS --max-time 5 http://127.0.0.1:$WEB_HOST_PORT/api/health >/dev/null; then healthy=1; break; fi
      sleep 2
    done
    if [ \"\$healthy\" -ne 1 ]; then
      docker logs --tail 80 '$WEB_CONTAINER' || true
      docker rm -f '$WEB_CONTAINER' >/dev/null 2>&1 || true
      if docker inspect '${WEB_CONTAINER}-previous' >/dev/null 2>&1; then docker rename '${WEB_CONTAINER}-previous' '$WEB_CONTAINER'; docker start '$WEB_CONTAINER' >/dev/null; fi
      exit 1
    fi
    docker rm -f '${WEB_CONTAINER}-previous' >/dev/null 2>&1 || true" \
    || die '后台管理系统部署失败；请检查终端输出'
}

choose_scope
preflight
confirm_release
case "$RELEASE_SCOPE" in 1) deploy_api;; 2) deploy_web;; 3) deploy_api; deploy_web;; esac
printf '\n发布完成。\n'
