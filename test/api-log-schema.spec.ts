import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertProtectedMigrationManifest,
  protectedMigrationHashes,
} from './support/protected-migration-manifest';

const migrationName = '20260726160000_add_api_access_logging';
const migrationUrl = new URL(`../prisma/migrations/${migrationName}/migration.sql`, import.meta.url);

function extractPrismaModel(schema: string, modelName: string) {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `model ${modelName} must exist`);
  return match[1];
}

function prismaFieldLines(model: string) {
  return model
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line && !line.startsWith('///') && !line.startsWith('@@'));
}

function prismaAttributes(model: string) {
  return model
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('@@'));
}

function extractCreateTable(migration: string, tableName: string) {
  const match = migration.match(
    new RegExp(
      `CREATE TABLE \\\`${tableName}\\\` \\(([\\s\\S]*?)\\n\\) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    ),
  );
  assert.ok(match, `CREATE TABLE ${tableName} must exist`);
  return match[1];
}

function sqlColumnLines(table: string) {
  return table
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter((line) => line.startsWith('`'));
}

function sqlKeyLines(table: string) {
  return table
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(
      (line) =>
        line.startsWith('PRIMARY KEY') ||
        line.startsWith('UNIQUE INDEX') ||
        line.startsWith('INDEX'),
    );
}

const expectedSchema = {
  ApiEndpoint: {
    fields: [
      'id String @id @default(cuid()) @db.VarChar(191)',
      'source String @db.VarChar(24)',
      'method String @db.VarChar(16)',
      'routePattern String @db.VarChar(512)',
      'description String? @db.VarChar(500)',
      'logEnabled Boolean @default(true)',
      'createdAt DateTime @default(now())',
      'updatedAt DateTime @default(now()) @updatedAt',
    ],
    attributes: [
      '@@unique([method, routePattern])',
      '@@index([source, logEnabled])',
      '@@index([updatedAt])',
      '@@map("api_endpoints")',
    ],
  },
  ApiRequestLog: {
    fields: [
      'id BigInt @id @default(autoincrement())',
      'requestId String @db.VarChar(64)',
      'endpointId String? @db.VarChar(191)',
      'source String @db.VarChar(24)',
      'method String @db.VarChar(16)',
      'routePattern String @db.VarChar(512)',
      'requestUrl String? @db.Text',
      'ip String? @db.VarChar(64)',
      'userId String? @db.VarChar(191)',
      'adminId String? @db.VarChar(191)',
      'httpStatus Int',
      'businessCode Int?',
      'durationMs Int',
      'errorCode String? @db.VarChar(96)',
      'errorSummary String? @db.Text',
      'requestSnapshot Json?',
      'createdAt DateTime @default(now())',
    ],
    attributes: [
      '@@index([createdAt])',
      '@@index([requestId])',
      '@@index([ip, createdAt])',
      '@@index([endpointId, createdAt])',
      '@@index([method, createdAt])',
      '@@index([source, createdAt])',
      '@@index([httpStatus, createdAt])',
      '@@index([userId, createdAt])',
      '@@index([adminId, createdAt])',
      '@@index([durationMs, createdAt])',
      '@@map("api_request_logs")',
    ],
  },
} as const;

const expectedSql = {
  api_endpoints: {
    columns: [
      '`id` VARCHAR(191) NOT NULL',
      '`source` VARCHAR(24) NOT NULL',
      '`method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL',
      '`routePattern` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL',
      '`description` VARCHAR(500) NULL',
      '`logEnabled` BOOLEAN NOT NULL DEFAULT true',
      '`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
      '`updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
    ],
    keys: [
      'UNIQUE INDEX `api_endpoints_method_routePattern_key`(`method`, `routePattern`)',
      'INDEX `api_endpoints_source_logEnabled_idx`(`source`, `logEnabled`)',
      'INDEX `api_endpoints_updatedAt_idx`(`updatedAt`)',
      'PRIMARY KEY (`id`)',
    ],
  },
  api_access_logs: {
    columns: [
      '`id` BIGINT NOT NULL AUTO_INCREMENT',
      '`endpointId` VARCHAR(191) NULL',
      '`source` VARCHAR(24) NOT NULL',
      '`method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL',
      '`routePattern` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL',
      '`path` VARCHAR(1024) NOT NULL',
      '`ip` VARCHAR(64) NULL',
      '`userId` VARCHAR(191) NULL',
      '`adminId` VARCHAR(191) NULL',
      '`httpStatus` INTEGER NOT NULL',
      '`businessCode` INTEGER NULL',
      '`durationMs` INTEGER NOT NULL',
      '`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
    ],
    keys: [
      'INDEX `api_access_logs_createdAt_idx`(`createdAt`)',
      'INDEX `api_access_logs_ip_createdAt_idx`(`ip`, `createdAt`)',
      'INDEX `api_access_logs_endpointId_createdAt_idx`(`endpointId`, `createdAt`)',
      'INDEX `api_access_logs_method_createdAt_idx`(`method`, `createdAt`)',
      'INDEX `api_access_logs_source_createdAt_idx`(`source`, `createdAt`)',
      'INDEX `api_access_logs_httpStatus_createdAt_idx`(`httpStatus`, `createdAt`)',
      'INDEX `api_access_logs_userId_createdAt_idx`(`userId`, `createdAt`)',
      'INDEX `api_access_logs_adminId_createdAt_idx`(`adminId`, `createdAt`)',
      'INDEX `api_access_logs_durationMs_createdAt_idx`(`durationMs`, `createdAt`)',
      'PRIMARY KEY (`id`)',
    ],
  },
  api_error_logs: {
    columns: [
      '`id` BIGINT NOT NULL AUTO_INCREMENT',
      '`endpointId` VARCHAR(191) NULL',
      '`source` VARCHAR(24) NOT NULL',
      '`method` VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL',
      '`routePattern` VARCHAR(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL',
      '`path` VARCHAR(1024) NOT NULL',
      '`ip` VARCHAR(64) NULL',
      '`userId` VARCHAR(191) NULL',
      '`adminId` VARCHAR(191) NULL',
      '`httpStatus` INTEGER NOT NULL',
      '`errorCode` VARCHAR(96) NULL',
      '`errorSummary` TEXT NOT NULL',
      '`durationMs` INTEGER NOT NULL',
      '`createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
    ],
    keys: [
      'INDEX `api_error_logs_createdAt_idx`(`createdAt`)',
      'INDEX `api_error_logs_ip_createdAt_idx`(`ip`, `createdAt`)',
      'INDEX `api_error_logs_endpointId_createdAt_idx`(`endpointId`, `createdAt`)',
      'INDEX `api_error_logs_method_createdAt_idx`(`method`, `createdAt`)',
      'INDEX `api_error_logs_source_createdAt_idx`(`source`, `createdAt`)',
      'INDEX `api_error_logs_httpStatus_createdAt_idx`(`httpStatus`, `createdAt`)',
      'INDEX `api_error_logs_userId_createdAt_idx`(`userId`, `createdAt`)',
      'INDEX `api_error_logs_adminId_createdAt_idx`(`adminId`, `createdAt`)',
      'INDEX `api_error_logs_durationMs_createdAt_idx`(`durationMs`, `createdAt`)',
      'PRIMARY KEY (`id`)',
    ],
  },
} as const;

test('Prisma schema defines the endpoint registry and unified safe request log contract', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');

  for (const [modelName, expected] of Object.entries(expectedSchema)) {
    const model = extractPrismaModel(schema, modelName);
    assert.deepEqual(prismaFieldLines(model), expected.fields, `${modelName} fields changed`);
    assert.deepEqual(prismaAttributes(model), expected.attributes, `${modelName} attributes changed`);
  }

  const requestModel = extractPrismaModel(schema, 'ApiRequestLog');
  assert.doesNotMatch(requestModel, /stack|response|header|cookie|token|password/i);
  assert.match(requestModel, /requestSnapshot\s+Json\?/);
});

test('migration creates exactly three matching MySQL 8 tables and no foreign keys', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.equal((migration.match(/\bCREATE TABLE\b/gi) ?? []).length, 3);
  assert.deepEqual(
    [...migration.matchAll(/CREATE TABLE `([^`]+)`/g)].map((match) => match[1]),
    Object.keys(expectedSql),
  );

  for (const [tableName, expected] of Object.entries(expectedSql)) {
    const table = extractCreateTable(migration, tableName);
    assert.deepEqual(sqlColumnLines(table), expected.columns, `${tableName} columns changed`);
    assert.deepEqual(sqlKeyLines(table), expected.keys, `${tableName} keys changed`);
  }

  const statementsOutsideTables = migration
    .replace(
      /CREATE TABLE `[^`]+` \([\s\S]*?\n\) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;/g,
      '',
    )
    .replace(/--[^\n]*/g, '')
    .trim();
  assert.equal(statementsOutsideTables, '', 'migration must contain only the three CREATE TABLE statements');
  assert.doesNotMatch(
    migration,
    /(?:^|;)\s*(?:ALTER|DROP|DELETE|UPDATE|INSERT|REPLACE|TRUNCATE|RENAME)\b/i,
  );
  assert.doesNotMatch(migration, /\b(?:FOREIGN KEY|REFERENCES|CASCADE)\b/i);
});

test('endpoint identity is case-sensitive and its composite unique key stays below MySQL 8 limits', async () => {
  const migration = await readFile(migrationUrl, 'utf8');
  const endpointTable = extractCreateTable(migration, 'api_endpoints');

  assert.match(
    endpointTable,
    /`method` VARCHAR\(16\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/,
  );
  assert.match(
    endpointTable,
    /`routePattern` VARCHAR\(512\) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL/,
  );
  assert.match(
    endpointTable,
    /UNIQUE INDEX `api_endpoints_method_routePattern_key`\(`method`, `routePattern`\)/,
  );

  const compositeKeyBytes = 16 + 512 * 4;
  assert.equal(compositeKeyBytes, 2064);
  assert.ok(compositeKeyBytes <= 3072);
});

test('the new migration leaves all ten existing migrations byte-for-byte unchanged', async () => {
  const migrationsDirectory = new URL('../prisma/migrations/', import.meta.url);
  const names = (await readdir(migrationsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const actualHashes = new Map<string, string>();

  for (const name of names) {
    const sql = await readFile(new URL(`${name}/migration.sql`, migrationsDirectory));
    actualHashes.set(name, createHash('sha256').update(sql).digest('hex'));
  }

  assertProtectedMigrationManifest(protectedMigrationHashes, actualHashes);
});

test('protected migration manifest allows unrelated future migrations', () => {
  const protectedHashes = new Map([['20260101000000_existing', 'original-hash']]);
  const actualHashes = new Map([
    ['20260101000000_existing', 'original-hash'],
    ['20991231235959_future_feature', 'future-hash'],
  ]);

  assert.doesNotThrow(() => assertProtectedMigrationManifest(protectedHashes, actualHashes));
});

test('protected migration manifest rejects a missing protected migration', () => {
  const protectedHashes = new Map([['20260101000000_existing', 'original-hash']]);

  assert.throws(
    () => assertProtectedMigrationManifest(protectedHashes, new Map()),
    /protected migration is missing: 20260101000000_existing/,
  );
});

test('protected migration manifest rejects a changed protected migration hash', () => {
  const protectedHashes = new Map([['20260101000000_existing', 'original-hash']]);
  const actualHashes = new Map([['20260101000000_existing', 'tampered-hash']]);

  assert.throws(
    () => assertProtectedMigrationManifest(protectedHashes, actualHashes),
    /protected migration was modified: 20260101000000_existing/,
  );
});
