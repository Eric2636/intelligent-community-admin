import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.resolve(root, '..');

function source(relativePath: string) {
  const file = path.join(root, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function workspaceSource(relativePath: string) {
  const file = path.join(workspaceRoot, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('测试与生产发布入口固定环境和分支，不能从命令行覆盖', () => {
  const testEntry = workspaceSource('deploy-test.sh');
  const productionEntry = workspaceSource('deploy-production.sh');

  assert.match(testEntry, /TARGET_ENV=test/);
  assert.match(testEntry, /TARGET_BRANCH=test/);
  assert.match(productionEntry, /TARGET_ENV=production/);
  assert.match(productionEntry, /TARGET_BRANCH=master/);
  assert.doesNotMatch(testEntry, /BRANCH=\$\{/);
  assert.doesNotMatch(productionEntry, /BRANCH=\$\{/);
});

test('发布入口只提供后端、后台或两者的选择，并默认可取消', () => {
  const release = workspaceSource('release.sh');

  assert.match(release, /1\. 仅后端/);
  assert.match(release, /2\. 仅后台管理系统/);
  assert.match(release, /3\. 后端和后台管理系统/);
  assert.match(release, /0\. 取消/);
  assert.match(release, /read -r/);
  assert.match(release, /ssh -n -o BatchMode=yes/);
});

test('发布预检只校验所选发布范围对应的仓库', () => {
  const release = workspaceSource('release.sh');
  const preflight = release.slice(release.indexOf('preflight()'), release.indexOf('confirm_release()'));

  assert.match(preflight, /case "\$RELEASE_SCOPE" in/);
  assert.match(preflight, /1\)[\s\S]*require_clean_branch "\$API_REPOSITORY" "\$TARGET_BRANCH"/);
  assert.match(preflight, /2\)[\s\S]*require_clean_branch "\$WEB_REPOSITORY" "\$TARGET_BRANCH"/);
  assert.match(preflight, /3\)[\s\S]*require_clean_branch "\$API_REPOSITORY" "\$TARGET_BRANCH"[\s\S]*require_clean_branch "\$WEB_REPOSITORY" "\$TARGET_BRANCH"/);
  const scopeOne = preflight.slice(preflight.indexOf('1)'), preflight.indexOf('2)'));
  const scopeTwo = preflight.slice(preflight.indexOf('2)'), preflight.indexOf('3)'));
  assert.match(scopeOne, /API_ENV_FILE[\s\S]*API_BACKUP_ENV_FILE/);
  assert.match(scopeTwo, /docker network inspect deploy_default/);
  assert.doesNotMatch(scopeTwo, /API_ENV_FILE|API_BACKUP_ENV_FILE/);
});

test('发布脚本从本地同步，测试与生产容器严格隔离', () => {
  const release = workspaceSource('release.sh');
  const testEntry = workspaceSource('deploy-test.sh');
  const productionEntry = workspaceSource('deploy-production.sh');

  assert.match(release, /rsync -az --delete/);
  assert.match(release, /prisma migrate deploy/);
  assert.match(testEntry, /API_CONTAINER=ic-test-admin-api/);
  assert.match(testEntry, /WEB_CONTAINER=ic-test-admin-web/);
  assert.match(testEntry, /API_PORT_ARGS='-p 3002:3000'/);
  assert.match(testEntry, /WEB_API_UPSTREAM=api-test:3000/);
  assert.doesNotMatch(testEntry, /WEB_BUILD_ARGS|WEB_BUILD_NO_CACHE/);
  assert.match(productionEntry, /API_CONTAINER=ic-admin-api/);
  assert.match(productionEntry, /WEB_CONTAINER=ic-admin-web/);
  assert.match(productionEntry, /^API_PORT_ARGS=$/m);
  assert.doesNotMatch(productionEntry, /WEB_BUILD_ARGS|WEB_BUILD_NO_CACHE/);
  const apiDeploy = release.slice(release.indexOf('deploy_api()'), release.indexOf('deploy_web()'));
  const webDeploy = release.slice(release.indexOf('deploy_web()'));
  assert.doesNotMatch(apiDeploy, /WEB_BUILD_ARGS/);
  assert.match(webDeploy, /TARGET_ENV" = test/);
  assert.match(webDeploy, /docker build --no-cache --build-arg VITE_APP_BASE=\/test-admin\//);
  assert.match(webDeploy, /web_build_command/);
  assert.match(release, /ADMIN_API_UPSTREAM=/);
  assert.match(release, /docker stop '\$\{API_CONTAINER\}-previous'/);
  assert.match(release, /docker stop '\$\{WEB_CONTAINER\}-previous'/);
});

test('父级目录是唯一发布入口，后端旧入口只负责兼容转发', () => {
  const release = workspaceSource('release.sh');
  const testEntry = workspaceSource('deploy-test.sh');
  const productionEntry = workspaceSource('deploy-production.sh');
  const legacyTestEntry = source('deploy/deploy-test.sh');
  const legacyProductionEntry = source('deploy/deploy-production.sh');

  assert.match(release, /API_REPOSITORY="\$SCRIPT_DIR\/intelligent-community-admin"/);
  assert.match(release, /WEB_REPOSITORY="\$SCRIPT_DIR\/intelligent-community-admin-web"/);
  assert.match(testEntry, /exec "\$SCRIPT_DIR\/release\.sh"/);
  assert.match(productionEntry, /exec "\$SCRIPT_DIR\/release\.sh"/);
  assert.match(legacyTestEntry, /exec "\$PROJECT_ROOT\/deploy-test\.sh"/);
  assert.match(legacyProductionEntry, /exec "\$PROJECT_ROOT\/deploy-production\.sh"/);
});
