import { BackupFrequency, BackupTrigger, Prisma, PrismaClient } from '@prisma/client';
import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import { safeEnvironmentName } from './database-backup-schedule';

type AuditActor = {
  adminId: string;
  adminUsername: string;
  ip: string;
  requestUrl: string;
};

const TABLE_DESCRIPTIONS: Record<string, { module: string; description: string }> = {
  User: { module: '用户与权限', description: '小程序用户资料与账号状态' },
  users: { module: '用户与权限', description: '小程序用户资料与账号状态' },
  AdminUser: { module: '用户与权限', description: '后台管理员账号与权限' },
  admin_users: { module: '用户与权限', description: '后台管理员账号与权限' },
  AppSettingTab: { module: '模块设置', description: '小程序模块入口配置' },
  Task: { module: '业主互助', description: '业主互助任务信息' },
  admin_system_logs: { module: '日志中心', description: '后台数据修改操作审计' },
  api_endpoints: { module: '日志中心', description: '接口日志开关与接口说明' },
  api_request_logs: { module: '日志中心', description: '小程序与后台接口访问记录' },
  mini_program_api_error_logs: { module: '日志中心', description: '小程序客户端异常上报' },
  tasks: { module: '业主互助', description: '业主互助任务信息' },
  forum_posts: { module: '小区留言', description: '小区留言帖子' },
  forum_replies: { module: '小区留言', description: '小区留言回复' },
  mall_categories: { module: '小区市场', description: '市场分类设置' },
  mall_items: { module: '小区市场', description: '市场发布信息' },
  mall_orders: { module: '小区市场', description: '预留市场订单信息' },
  feedbacks: { module: '意见反馈', description: '小程序用户意见反馈' },
  notifications: { module: '消息通知', description: '小程序站内消息通知' },
  database_backup_settings: { module: '数据库管理', description: '自动备份计划设置' },
  database_backup_jobs: { module: '数据库管理', description: '备份任务执行历史' },
  database_backup_leases: { module: '数据库管理', description: '跨实例备份执行租约' },
  _prisma_migrations: { module: '系统基础数据', description: '数据库迁移执行记录' },
};

function currentDatabaseName() {
  try {
    return decodeURIComponent(new URL(process.env.DATABASE_URL || '').pathname.replace(/^\//, ''));
  } catch {
    throw new HttpError(500, '数据库连接配置无效');
  }
}

function tableDescription(tableName: string) {
  return TABLE_DESCRIPTIONS[tableName] || { module: '系统基础数据', description: '未配置说明' };
}

function serializeJob<T extends { outputSizeBytes: bigint | null }>(job: T) {
  return { ...job, outputSizeBytes: job.outputSizeBytes == null ? null : job.outputSizeBytes.toString() };
}

function settingSnapshot(setting: { enabled: boolean; frequency: BackupFrequency; minute: number; dailyHour: number }) {
  return {
    enabled: setting.enabled,
    frequency: setting.frequency,
    minute: setting.minute,
    dailyHour: setting.dailyHour,
  };
}

export class DatabaseService {
  constructor(private readonly db: PrismaClient = prisma) {}

  getBackupSetting() {
    return this.db.databaseBackupSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
  }

  async updateBackupSetting(
    input: { enabled: boolean; frequency: BackupFrequency; minute: number; dailyHour: number },
    actor: AuditActor,
  ) {
    if (!Object.values(BackupFrequency).includes(input.frequency)) throw new HttpError(400, '备份频率无效');
    if (!Number.isInteger(input.minute) || input.minute < 0 || input.minute > 59) throw new HttpError(400, '执行分钟必须为 0 到 59');
    if (!Number.isInteger(input.dailyHour) || input.dailyHour < 0 || input.dailyHour > 23) throw new HttpError(400, '执行小时必须为 0 到 23');
    return this.db.$transaction(async (tx) => {
      const existing = await tx.databaseBackupSetting.findUnique({ where: { id: 'default' } });
      const before = settingSnapshot(existing || { enabled: true, frequency: BackupFrequency.HOURLY, minute: 5, dailyHour: 2 });
      const updated = await tx.databaseBackupSetting.upsert({
        where: { id: 'default' },
        update: { ...input, updatedBy: actor.adminId },
        create: { id: 'default', ...input, updatedBy: actor.adminId },
      });
      await tx.adminSystemLog.create({ data: {
        adminId: actor.adminId,
        adminUsername: actor.adminUsername,
        ip: actor.ip,
        action: 'DATABASE_BACKUP_SETTING_UPDATE',
        moduleKey: 'database',
        detail: { before, after: settingSnapshot(updated), requestUrl: actor.requestUrl } as Prisma.InputJsonValue,
      } });
      return updated;
    });
  }

  async createManualBackup(actor: AuditActor) {
    const environment = safeEnvironmentName();
    const scheduledAt = new Date();
    try {
      return await this.db.$transaction(async (tx) => {
        const job = await tx.databaseBackupJob.create({
          data: {
            triggerType: BackupTrigger.MANUAL,
            environment,
            activeKey: environment,
            scheduledAt,
            requestedByAdminId: actor.adminId,
          },
        });
        await tx.adminSystemLog.create({ data: {
          adminId: actor.adminId,
          adminUsername: actor.adminUsername,
          ip: actor.ip,
          action: 'DATABASE_BACKUP_MANUAL_CREATE',
          moduleKey: 'database',
          detail: { jobId: job.id, environment, requestUrl: actor.requestUrl } as Prisma.InputJsonValue,
        } });
        return serializeJob(job);
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      await this.db.databaseBackupJob.create({ data: {
        triggerType: BackupTrigger.MANUAL,
        status: 'SKIPPED',
        environment,
        requestedByAdminId: actor.adminId,
        scheduledAt,
        finishedAt: new Date(),
        durationMs: 0,
        errorMessage: '已有备份任务正在执行，本次手动请求已跳过',
      } });
      throw new HttpError(409, '已有备份任务正在执行');
    }
  }

  async getBackupOverview() {
    const environment = safeEnvironmentName();
    const [latestSuccess, latestFailure, activeJob] = await Promise.all([
      this.db.databaseBackupJob.findFirst({ where: { environment, status: 'SUCCESS' }, orderBy: { finishedAt: 'desc' } }),
      this.db.databaseBackupJob.findFirst({ where: { environment, status: 'FAILED' }, orderBy: { finishedAt: 'desc' } }),
      this.db.databaseBackupJob.findFirst({ where: { environment, status: { in: ['PENDING', 'RUNNING'] } }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      latestSuccess: latestSuccess ? serializeJob(latestSuccess) : null,
      latestFailure: latestFailure ? serializeJob(latestFailure) : null,
      activeJob: activeJob ? serializeJob(activeJob) : null,
    };
  }

  async listBackupJobs(page = 1, pageSize = 20) {
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const environment = safeEnvironmentName();
    const [total, list] = await this.db.$transaction([
      this.db.databaseBackupJob.count({ where: { environment } }),
      this.db.databaseBackupJob.findMany({ where: { environment }, orderBy: { createdAt: 'desc' }, skip: (safePage - 1) * safePageSize, take: safePageSize }),
    ]);
    const adminIds = [...new Set(list.map((job) => job.requestedByAdminId).filter((id): id is string => Boolean(id)))];
    const admins = adminIds.length
      ? await this.db.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, username: true } })
      : [];
    const adminNames = new Map(admins.map((admin) => [admin.id, admin.username]));
    return {
      total,
      list: list.map((job) => ({ ...serializeJob(job), requestedByAdminUsername: job.requestedByAdminId ? adminNames.get(job.requestedByAdminId) || null : null })),
    };
  }

  async listTables(keyword = '') {
    const database = currentDatabaseName();
    const rows = await this.db.$queryRawUnsafe<Array<{ tableName: string; rowCount: bigint; dataBytes: bigint; indexBytes: bigint }>>(
      `SELECT TABLE_NAME AS tableName, COALESCE(TABLE_ROWS, 0) AS rowCount,
              COALESCE(DATA_LENGTH, 0) AS dataBytes, COALESCE(INDEX_LENGTH, 0) AS indexBytes
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME`,
      database,
    );
    const normalizedKeyword = String(keyword || '').trim().toLowerCase();
    return rows.map((row) => {
      const meta = tableDescription(row.tableName);
      return {
        tableName: row.tableName,
        module: meta.module,
        description: meta.description,
        rowCount: Number(row.rowCount || 0),
        dataBytes: Number(row.dataBytes || 0),
        indexBytes: Number(row.indexBytes || 0),
      };
    }).filter((row) => !normalizedKeyword || `${row.tableName} ${row.module} ${row.description}`.toLowerCase().includes(normalizedKeyword));
  }

  async getTableStructure(tableName: string) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(tableName)) throw new HttpError(400, '数据表名称无效');
    const database = currentDatabaseName();
    const exists = await this.db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND TABLE_TYPE = 'BASE TABLE'`,
      database,
      tableName,
    );
    if (!Number(exists[0]?.count || 0)) throw new HttpError(404, '数据表不存在');
    const [columns, indexes] = await Promise.all([
      this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType, IS_NULLABLE AS nullable,
                COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey, EXTRA AS extra,
                COLUMN_COMMENT AS comment
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY ORDINAL_POSITION`,
        database,
        tableName,
      ),
      this.db.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT INDEX_NAME AS indexName, COLUMN_NAME AS columnName, SEQ_IN_INDEX AS seqInIndex,
                NON_UNIQUE AS nonUnique, INDEX_TYPE AS indexType
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
          ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        database,
        tableName,
      ),
    ]);
    const meta = tableDescription(tableName);
    return {
      tableName,
      module: meta.module,
      description: meta.description,
      columns,
      indexes: indexes.map((index) => ({
        ...index,
        seqInIndex: Number(index.seqInIndex || 0),
        nonUnique: Number(index.nonUnique || 0),
      })),
    };
  }
}
