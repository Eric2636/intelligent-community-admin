#!/usr/bin/env bash

set -euo pipefail

TARGET_ENV=test
TARGET_BRANCH=test
API_CONTAINER=ic-test-admin-api
API_BACKUP_CONTAINER=ic-test-db-backup-worker
API_ENV_FILE=/home/ubuntu/docker-project/intelligent-community-admin/.env.test
API_BACKUP_ENV_FILE=/home/ubuntu/docker-project/intelligent-community-admin/.env.test.backup
API_IMAGE_PREFIX=ic-api-test
API_PORT_ARGS='-p 3002:3000'
API_NETWORK_ALIAS=api-test
WEB_CONTAINER=ic-test-admin-web
WEB_IMAGE_PREFIX=ic-admin-web-test
WEB_HOST_PORT=3001
WEB_API_UPSTREAM=api-test:3000
WEB_BUILD_ARGS='--build-arg VITE_APP_BASE=/test-admin/'

export TARGET_ENV TARGET_BRANCH API_CONTAINER API_BACKUP_CONTAINER API_ENV_FILE API_BACKUP_ENV_FILE API_IMAGE_PREFIX API_PORT_ARGS API_NETWORK_ALIAS WEB_CONTAINER WEB_IMAGE_PREFIX WEB_HOST_PORT WEB_API_UPSTREAM WEB_BUILD_ARGS
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/release.sh"
