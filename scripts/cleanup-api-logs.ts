import { prisma } from '../src/lib/prisma';
import { cleanupApiLogs } from '../src/modules/api-log/api-log-retention.service';

if (import.meta.url === `file://${process.argv[1]}`) {
  const startedAt = performance.now();
  cleanupApiLogs({ requests: prisma.apiRequestLog }).then((result) => {
    console.info('[api-log-cleanup]', { ...result, durationMs: Math.round(performance.now() - startedAt) });
  }).catch((error) => { console.error('[api-log-cleanup] failed', error instanceof Error ? error.message : 'unknown'); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
}
