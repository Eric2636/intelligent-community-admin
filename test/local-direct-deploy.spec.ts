import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function source(relativePath: string) {
  const file = path.join(root, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

test('测试与生产发布入口固定环境和分支，不能从命令行覆盖', () => {
  const testEntry = source('deploy/deploy-test.sh');
  const productionEntry = source('deploy/deploy-production.sh');

  assert.match(testEntry, /TARGET_ENV=test/);
  assert.match(testEntry, /TARGET_BRANCH=test/);
  assert.match(productionEntry, /TARGET_ENV=production/);
  assert.match(productionEntry, /TARGET_BRANCH=master/);
  assert.doesNotMatch(testEntry, /BRANCH=\$\{/);
  assert.doesNotMatch(productionEntry, /BRANCH=\$\{/);
});

test('发布入口只提供后端、后台或两者的选择，并默认可取消', () => {
  const release = source('deploy/release.sh');

  assert.match(release, /1\. 仅后端/);
  assert.match(release, /2\. 仅后台管理系统/);
  assert.match(release, /3\. 后端和后台管理系统/);
  assert.match(release, /0\. 取消/);
  assert.match(release, /read -r/);
  assert.match(release, /ssh -n -o BatchMode=yes/);
});

test('发布脚本从本地同步，测试与生产容器严格隔离', () => {
  const release = source('deploy/release.sh');
  const testEntry = source('deploy/deploy-test.sh');
  const productionEntry = source('deploy/deploy-production.sh');

  assert.match(release, /rsync -az --delete/);
  assert.match(release, /prisma migrate deploy/);
  assert.match(testEntry, /API_CONTAINER=ic-test-admin-api/);
  assert.match(testEntry, /WEB_CONTAINER=ic-test-admin-web/);
  assert.match(testEntry, /API_PORT_ARGS='-p 3002:3000'/);
  assert.match(testEntry, /WEB_API_UPSTREAM=api-test:3000/);
  assert.match(productionEntry, /API_CONTAINER=ic-admin-api/);
  assert.match(productionEntry, /WEB_CONTAINER=ic-admin-web/);
  assert.match(productionEntry, /^API_PORT_ARGS=$/m);
  assert.match(release, /ADMIN_API_UPSTREAM=/);
});
