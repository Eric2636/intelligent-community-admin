import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, basename, join } from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { isBackupDue, safeEnvironmentName, scheduleWindowKey } from './database-backup-schedule';

const LEASE_MS = 120_000;
const HEARTBEAT_MS = 30_000;

type BackupConfiguration = {
  environment: string;
  directory: string;
  finalPath: string;
  dumpUrl: URL;
  database: string;
};

function databaseName(url: URL, label: string) {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) throw new Error(`${label} 未指定数据库`);
  return name;
}

function backupFileName(environment: string) {
  if (environment === 'production') return 'ic_prod_latest.sql.gz';
  if (environment === 'test') return 'ic_test_latest.sql.gz';
  return `ic_${environment}_latest.sql.gz`;
}

export function validateBackupConfiguration(): BackupConfiguration {
  const environment = safeEnvironmentName();
  if (environment === 'unknown') throw new Error('APP_ENV 无效，已拒绝启动数据库备份');
  const directory = String(process.env.DATABASE_BACKUP_DIRECTORY || '').trim();
  if (!directory || !isAbsolute(directory)) throw new Error('DATABASE_BACKUP_DIRECTORY 必须是绝对路径');
  const expectedDatabase = String(process.env.DATABASE_BACKUP_EXPECTED_DATABASE || '').trim();
  if (!expectedDatabase) throw new Error('DATABASE_BACKUP_EXPECTED_DATABASE 未配置');
  const applicationUrl = new URL(process.env.DATABASE_URL || '');
  const dumpUrl = new URL(process.env.DATABASE_BACKUP_URL || '');
  const applicationDatabase = databaseName(applicationUrl, 'DATABASE_URL');
  const dumpDatabase = databaseName(dumpUrl, 'DATABASE_BACKUP_URL');
  if (applicationDatabase !== expectedDatabase || dumpDatabase !== expectedDatabase) {
    throw new Error('备份数据库与当前环境预期数据库不一致，已拒绝执行');
  }
  return {
    environment,
    directory,
    finalPath: join(directory, backupFileName(environment)),
    dumpUrl,
    database: dumpDatabase,
  };
}

async function validateGzip(path: string) {
  let uncompressedBytes = 0;
  await pipeline(
    createReadStream(path),
    createGunzip(),
    new Writable({
      write(chunk, _encoding, callback) {
        uncompressedBytes += chunk.length;
        callback();
      },
    }),
  );
  if (uncompressedBytes < 20) throw new Error('备份文件校验失败：解压内容为空');
}

async function runDump(config: BackupConfiguration, assertLease: () => Promise<void>) {
  const tempPath = `${config.finalPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(config.directory, { recursive: true });
  const args = [
    '--single-transaction',
    '--quick',
    '--triggers',
    '--default-character-set=utf8mb4',
    '--host', config.dumpUrl.hostname,
    '--port', config.dumpUrl.port || '3306',
    '--user', decodeURIComponent(config.dumpUrl.username),
    config.database,
  ];
  const dump = spawn(process.env.MYSQLDUMP_BIN || 'mysqldump', args, {
    env: { ...process.env, MYSQL_PWD: decodeURIComponent(config.dumpUrl.password) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  dump.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-4000); });
  const exited = new Promise<void>((resolve, reject) => {
    dump.once('error', reject);
    dump.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `mysqldump 退出码 ${code}`)));
  });
  try {
    await Promise.all([pipeline(dump.stdout, createGzip({ level: 6 }), createWriteStream(tempPath)), exited]);
    const info = await stat(tempPath);
    if (info.size < 20) throw new Error('备份文件校验失败：文件为空');
    await validateGzip(tempPath);
    const handle = await open(tempPath, 'r');
    await handle.sync();
    await handle.close();
    await assertLease();
    await rename(tempPath, config.finalPath);
    return info.size;
  } catch (error) {
    dump.kill('SIGTERM');
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
}

async function acquireLease(environment: string, ownerToken: string) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LEASE_MS);
  const reclaimed = await prisma.databaseBackupLease.updateMany({
    where: { environment, expiresAt: { lt: now } },
    data: { ownerToken, expiresAt },
  });
  if (reclaimed.count) return true;
  try {
    await prisma.databaseBackupLease.create({ data: { environment, ownerToken, expiresAt } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
}

async function renewLease(environment: string, ownerToken: string) {
  const renewed = await prisma.databaseBackupLease.updateMany({
    where: { environment, ownerToken },
    data: { expiresAt: new Date(Date.now() + LEASE_MS) },
  });
  if (!renewed.count) throw new Error('数据库备份执行租约已失效');
}

async function releaseLease(environment: string, ownerToken: string) {
  await prisma.databaseBackupLease.deleteMany({ where: { environment, ownerToken } });
}

async function enqueueScheduledBackup(config: BackupConfiguration, now: Date) {
  const setting = await prisma.databaseBackupSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
  if (!isBackupDue(setting, setting.lastScheduledAt, now)) return;
  const scheduleKey = `${config.environment}:${setting.frequency}:${scheduleWindowKey(setting, now)}`;
  try {
    await prisma.databaseBackupJob.create({
      data: {
        triggerType: 'AUTO',
        environment: config.environment,
        activeKey: config.environment,
        scheduleKey,
        scheduledAt: now,
      },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const duplicateWindow = await prisma.databaseBackupJob.findUnique({ where: { scheduleKey } });
    if (!duplicateWindow) {
      await prisma.databaseBackupJob.create({
        data: {
          triggerType: 'AUTO',
          status: 'SKIPPED',
          environment: config.environment,
          scheduleKey,
          scheduledAt: now,
          finishedAt: now,
          durationMs: 0,
          errorMessage: '已有备份任务正在执行，本次计划已跳过',
        },
      }).catch(() => undefined);
    }
  }
  await prisma.databaseBackupSetting.update({ where: { id: setting.id }, data: { lastScheduledAt: now } });
}

async function recoverInterruptedBackups(config: BackupConfiguration) {
  const now = new Date();
  await prisma.databaseBackupJob.updateMany({
    where: { environment: config.environment, status: 'RUNNING' },
    data: {
      status: 'FAILED',
      activeKey: null,
      finishedAt: now,
      errorMessage: '服务重启，备份任务已中断',
    },
  });
}

async function processNextBackup(config: BackupConfiguration) {
  const ownerToken = randomUUID();
  if (!(await acquireLease(config.environment, ownerToken))) return;
  let heartbeat: NodeJS.Timeout | undefined;
  try {
    await recoverInterruptedBackups(config);
    const pending = await prisma.databaseBackupJob.findFirst({
      where: { environment: config.environment, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    if (!pending) return;
    const startedAt = new Date();
    const claimed = await prisma.databaseBackupJob.updateMany({
      where: { id: pending.id, status: 'PENDING', activeKey: config.environment },
      data: { status: 'RUNNING', startedAt },
    });
    if (!claimed.count) return;
    heartbeat = setInterval(() => {
      void renewLease(config.environment, ownerToken).catch((error) => {
        console.error('[database_backup_lease_heartbeat]', error instanceof Error ? error.message : error);
      });
    }, HEARTBEAT_MS);
    try {
      const size = await runDump(config, () => renewLease(config.environment, ownerToken));
      const finishedAt = new Date();
      await prisma.databaseBackupJob.update({ where: { id: pending.id }, data: {
        status: 'SUCCESS',
        activeKey: null,
        outputFileName: basename(config.finalPath),
        outputSizeBytes: BigInt(size),
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
        errorMessage: null,
      } });
    } catch (error) {
      const finishedAt = new Date();
      await prisma.databaseBackupJob.update({ where: { id: pending.id }, data: {
        status: 'FAILED',
        activeKey: null,
        errorMessage: error instanceof Error ? error.message.slice(0, 2000) : '备份执行失败',
        finishedAt,
        durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
      } });
    }
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await releaseLease(config.environment, ownerToken).catch(() => undefined);
  }
}

let ticking = false;
async function tick(config: BackupConfiguration) {
  if (ticking) return;
  ticking = true;
  try {
    await enqueueScheduledBackup(config, new Date());
    await processNextBackup(config);
  } catch (error) {
    console.error('[database_backup_worker]', error instanceof Error ? error.message : error);
  } finally {
    ticking = false;
  }
}

export function startDatabaseBackupWorker() {
  if (process.env.DATABASE_BACKUP_WORKER_ENABLED !== 'true') {
    throw new Error('DATABASE_BACKUP_WORKER_ENABLED 必须显式设置为 true');
  }
  const config = validateBackupConfiguration();
  void tick(config);
  return setInterval(() => void tick(config), 30_000);
}
