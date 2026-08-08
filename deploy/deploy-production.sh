#!/usr/bin/env bash

set -euo pipefail

TARGET_ENV=production
TARGET_BRANCH=master
API_CONTAINER=ic-admin-api
API_BACKUP_CONTAINER=ic-db-backup-worker
API_ENV_FILE=/home/ubuntu/docker-project/intelligent-community-admin/.env
API_BACKUP_ENV_FILE=/home/ubuntu/docker-project/intelligent-community-admin/.env.backup
API_IMAGE_PREFIX=ic-api-production
API_PORT_ARGS=
API_NETWORK_ALIAS=api
WEB_CONTAINER=ic-admin-web
WEB_IMAGE_PREFIX=ic-admin-web-production
WEB_HOST_PORT=3000
WEB_API_UPSTREAM=ic-admin-api:3000

export TARGET_ENV TARGET_BRANCH API_CONTAINER API_BACKUP_CONTAINER API_ENV_FILE API_BACKUP_ENV_FILE API_IMAGE_PREFIX API_PORT_ARGS API_NETWORK_ALIAS WEB_CONTAINER WEB_IMAGE_PREFIX WEB_HOST_PORT WEB_API_UPSTREAM
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/release.sh"
