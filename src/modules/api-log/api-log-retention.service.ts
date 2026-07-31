export const API_LOG_BATCH_SIZE = 5000;
export const API_LOG_RETENTION_DAYS = 90;
export function retentionCutoff(now: Date) { return new Date(now.getTime() - API_LOG_RETENTION_DAYS * 86400000); }
type Repo = { findMany(args: unknown): Promise<Array<{ id: bigint }>>; deleteMany(args: unknown): Promise<{ count: number }> };
export async function cleanupApiLogs(params: { requests: Repo; now?: Date }) {
  const cutoff = retentionCutoff(params.now ?? new Date());
  const clean = async (repo: Repo) => { let count = 0; while (true) { const rows = await repo.findMany({ where: { createdAt: { lt: cutoff } }, take: API_LOG_BATCH_SIZE }); if (!rows.length) return count; const result = await repo.deleteMany({ where: { id: { in: rows.map((row) => row.id) }, createdAt: { lt: cutoff } } }); count += result.count; if (!result.count) return count; } };
  return { cutoff, requests: await clean(params.requests) };
}
