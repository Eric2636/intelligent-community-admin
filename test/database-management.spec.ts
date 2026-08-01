import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { isBackupDue, safeEnvironmentName } from '../src/modules/database/database-backup-schedule';

test('backup schedule supports hourly, six-hour and daily windows without raw cron', () => {
  const now = new Date('2026-07-31T22:05:00.000Z');
  assert.equal(isBackupDue({ enabled: true, frequency: 'HOURLY', minute: 5, dailyHour: 2 }, null, now), true);
  assert.equal(isBackupDue({ enabled: true, frequency: 'EVERY_6_HOURS', minute: 5, dailyHour: 2 }, null, now), true);
  assert.equal(isBackupDue({ enabled: true, frequency: 'DAILY', minute: 5, dailyHour: 6 }, null, now), true);
  assert.equal(isBackupDue({ enabled: false, frequency: 'HOURLY', minute: 5, dailyHour: 2 }, null, now), false);
  assert.equal(isBackupDue({ enabled: true, frequency: 'HOURLY', minute: 6, dailyHour: 2 }, null, now), false);
});

test('backup environment names are restricted before becoming filenames', () => {
  assert.equal(safeEnvironmentName('test'), 'test');
  assert.equal(safeEnvironmentName('production'), 'production');
  assert.equal(safeEnvironmentName('../../prod'), 'unknown');
});

test('database routes are super-admin only and expose no restore, SQL or business-row APIs', async () => {
  const source = await readFile(new URL('../src/modules/database/database.routes.ts', import.meta.url), 'utf8');
  assert.match(source, /adminAuth/);
  assert.match(source, /requireSuperAdmin/);
  assert.match(source, /backup-settings/);
  assert.match(source, /backup-jobs/);
  assert.match(source, /database\/tables/);
  assert.doesNotMatch(source, /restore|download|execute-sql|table-rows/);
});

test('runtime image contains a database dump client and the worker never invokes a shell', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../src/modules/database/database-backup.worker.ts', import.meta.url), 'utf8');
  assert.match(dockerfile, /default-mysql-client/);
  assert.equal((dockerfile.match(/Acquire::ForceIPv4=true/g) || []).length, 2);
  assert.equal((dockerfile.match(/Acquire::Retries=3/g) || []).length, 2);
  assert.match(worker, /spawn\(/);
  assert.doesNotMatch(worker, /shell:\s*true|exec\(/);
  assert.match(worker, /rename\(/);
  assert.match(worker, /createGunzip/);
  assert.match(worker, /DATABASE_BACKUP_URL/);
  assert.match(worker, /DATABASE_BACKUP_EXPECTED_DATABASE/);
  assert.match(worker, /databaseBackupLease/);
  assert.match(worker, /status: 'RUNNING'[\s\S]*status: 'FAILED'/);
  assert.match(worker, /服务重启，备份任务已中断/);
});

test('backup worker is an explicit process and the API process does not start it', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  const workerMain = await readFile(new URL('../src/database-backup-main.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /startDatabaseBackupWorker/);
  assert.match(workerMain, /startDatabaseBackupWorker/);
  assert.match(workerMain, /DATABASE_BACKUP_WORKER_ENABLED/);
});

test('backup persistence includes a cross-instance lease and complete task audit fields', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const migration = await readFile(new URL('../prisma/migrations/20260801163000_harden_database_backup_management/migration.sql', import.meta.url), 'utf8');
  for (const source of [schema, migration]) {
    assert.match(source, /DatabaseBackupLease|database_backup_leases/);
    assert.match(source, /scheduledAt/);
    assert.match(source, /durationMs/);
    assert.match(source, /activeKey/);
  }
});

test('database management has dedicated before-after audit, latest overview, search and index metadata', async () => {
  const service = await readFile(new URL('../src/modules/database/database.service.ts', import.meta.url), 'utf8');
  const routes = await readFile(new URL('../src/modules/database/database.routes.ts', import.meta.url), 'utf8');
  assert.match(service, /DATABASE_BACKUP_SETTING_UPDATE/);
  assert.match(service, /before/);
  assert.match(service, /after/);
  assert.match(service, /keyword/);
  assert.match(service, /information_schema\.STATISTICS/);
  assert.match(service, /seqInIndex: Number/);
  assert.match(service, /nonUnique: Number/);
  assert.match(routes, /backup-overview/);
  assert.match(routes, /ctx\.query\.keyword/);
});
