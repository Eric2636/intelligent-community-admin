import { prisma } from './lib/prisma';
import { startMediaCleanupWorker } from './modules/media/media-cleanup.worker';

async function main() {
  if (process.env.MEDIA_CLEANUP_WORKER_ENABLED !== 'true') {
    throw new Error('MEDIA_CLEANUP_WORKER_ENABLED 必须显式设置为 true');
  }
  await prisma.$connect();
  startMediaCleanupWorker();
}

async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

main().catch((error) => {
  console.error('[media_cleanup_worker_fatal]', error instanceof Error ? error.message : error);
  process.exit(1);
});
