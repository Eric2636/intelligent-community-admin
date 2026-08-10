import { prisma } from '../../lib/prisma';
import { configuredMediaAssetService } from './media-asset.service';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const BATCH_SIZE = 100;

function intervalMs() {
  const configured = Number(process.env.MEDIA_CLEANUP_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  return Number.isFinite(configured) ? Math.max(60_000, configured) : DEFAULT_INTERVAL_MS;
}

async function cleanupOnce() {
  const media = configuredMediaAssetService(prisma);
  if (!media) throw new Error('媒体清理缺少 COS_BUCKET 或 COS_REGION 配置');
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const assets = await prisma.mediaAsset.findMany({
    where: {
      OR: [
        { state: 'PENDING', createdAt: { lte: staleBefore } },
        { state: { in: ['DELETE_PENDING', 'DELETE_FAILED'] } },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });
  for (const asset of assets) {
    await media.deleteAsset(asset);
  }
}

let running = false;
async function tick() {
  if (running) return;
  running = true;
  try {
    await cleanupOnce();
  } catch (error) {
    console.error('[media_cleanup_worker]', error instanceof Error ? error.message : error);
  } finally {
    running = false;
  }
}

export function startMediaCleanupWorker() {
  if (process.env.MEDIA_CLEANUP_WORKER_ENABLED !== 'true') {
    throw new Error('MEDIA_CLEANUP_WORKER_ENABLED 必须显式设置为 true');
  }
  void tick();
  return setInterval(() => void tick(), intervalMs());
}
