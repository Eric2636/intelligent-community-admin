import { prisma } from './lib/prisma';
import { startDatabaseBackupWorker } from './modules/database/database-backup.worker';

async function main() {
  if (process.env.DATABASE_BACKUP_WORKER_ENABLED !== 'true') {
    throw new Error('DATABASE_BACKUP_WORKER_ENABLED 必须显式设置为 true');
  }
  await prisma.$connect();
  startDatabaseBackupWorker();
}

async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

main().catch((error) => {
  console.error('[database_backup_worker_fatal]', error instanceof Error ? error.message : error);
  process.exit(1);
});
