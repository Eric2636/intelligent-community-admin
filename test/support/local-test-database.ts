import type { PrismaClient } from '@prisma/client';

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

export function assertDisposableLocalDatabaseUrl(databaseUrl: string) {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('拒绝清理非本地测试数据库：DATABASE_URL 无效');
  }
  const databaseName = parsed.pathname.replace(/^\//, '');
  if (
    parsed.protocol !== 'mysql:' ||
    !ALLOWED_HOSTS.has(parsed.hostname) ||
    parsed.port !== '3308' ||
    databaseName !== 'ic_local'
  ) {
    throw new Error('拒绝清理非本地测试数据库：仅允许 127.0.0.1:3308/ic_local');
  }
}

export function businessTablesForCleanup(tableNames: readonly string[]) {
  return [...new Set(tableNames)]
    .filter((tableName) => tableName !== '_prisma_migrations')
    .sort();
}

export async function cleanupLocalBusinessData(
  database: PrismaClient,
  databaseUrl = process.env.DATABASE_URL || '',
) {
  assertDisposableLocalDatabaseUrl(databaseUrl);
  const rows = await database.$queryRaw<Array<{ tableName: string }>>`
    SELECT TABLE_NAME AS tableName
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
  `;
  const tableNames = businessTablesForCleanup(rows.map((row) => row.tableName));
  await database.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const tableName of tableNames) {
        const escaped = tableName.replace(/`/g, '``');
        await tx.$executeRawUnsafe(`DELETE FROM \`${escaped}\``);
      }
    } finally {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    }
  });
}
