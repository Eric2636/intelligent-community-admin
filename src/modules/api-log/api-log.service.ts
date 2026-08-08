import { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import { describeApiEndpoint } from './api-endpoint.service';

const MAX_PAGE_SIZE = 100;
const MAX_EXPORT = 50_000;
const scalar = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
const int = (v: unknown) => { const n = Number(v); return Number.isInteger(n) ? n : undefined; };

export type ApiLogFilters = {
  page?: number; pageSize?: number; ip?: string; endpointId?: string; method?: string; source?: string;
  httpStatus?: number; statusClass?: string; startAt?: string; endAt?: string; actorId?: string; actorKeyword?: string;
  minDurationMs?: number; maxDurationMs?: number;
};

function dateFilter(filters: ApiLogFilters) {
  const createdAt: Prisma.DateTimeFilter = {};
  if (filters.startAt) { const d = new Date(filters.startAt); if (!Number.isNaN(d.valueOf())) createdAt.gte = d; }
  if (filters.endAt) { const d = new Date(filters.endAt); if (!Number.isNaN(d.valueOf())) createdAt.lte = d; }
  return Object.keys(createdAt).length ? { createdAt } : {};
}
function statusFilter(filters: ApiLogFilters) {
  if (filters.statusClass && /^[2345]xx$/.test(filters.statusClass)) {
    const base = Number(filters.statusClass[0]) * 100; return { gte: base, lt: base + 100 };
  }
  return filters.httpStatus === undefined ? undefined : filters.httpStatus;
}
function whereFor(filters: ApiLogFilters, actor: Prisma.ApiRequestLogWhereInput = {}) {
  const status = statusFilter(filters);
  return {
    ...(filters.ip ? { ip: filters.ip } : {}), ...(filters.endpointId ? { endpointId: filters.endpointId } : {}),
    ...(filters.method ? { method: filters.method.toUpperCase() } : {}), ...(filters.source ? { source: filters.source.toUpperCase() } : {}),
    ...(status ? { httpStatus: status } : {}), ...(filters.minDurationMs !== undefined || filters.maxDurationMs !== undefined ? { durationMs: { ...(filters.minDurationMs !== undefined ? { gte: filters.minDurationMs } : {}), ...(filters.maxDurationMs !== undefined ? { lte: filters.maxDurationMs } : {}) } } : {}),
    ...dateFilter(filters), ...actor,
  } as Prisma.ApiRequestLogWhereInput;
}
const serialize = <T extends { id: bigint; createdAt: Date }>(row: T) => ({ ...row, id: row.id.toString(), createdAt: row.createdAt.toISOString() });

export class ApiLogService {
  constructor(private readonly db: typeof prisma = prisma) {}
  async listEndpoints(params: { page?: number; pageSize?: number; keyword?: string; source?: string }) {
    const page = Math.max(1, params.page ?? 1), pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 20));
    const keyword = scalar(params.keyword); const where: Prisma.ApiEndpointWhereInput = { ...(params.source ? { source: params.source.toUpperCase() } : {}), ...(keyword ? { OR: [{ routePattern: { contains: keyword } }, { description: { contains: keyword } }] } : {}) };
    const [total, list] = await Promise.all([this.db.apiEndpoint.count({ where }), this.db.apiEndpoint.findMany({ where, orderBy: [{ source: 'asc' }, { routePattern: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })]);
    const ids = list.map((item) => item.id);
    const database = this.db as typeof prisma;
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const requestGroups = ids.length && database.apiRequestLog
      ? await database.apiRequestLog.groupBy({ by: ['endpointId'], where: { endpointId: { in: ids }, createdAt: { gte: since } }, _count: { _all: true }, _max: { createdAt: true } })
      : [];
    type EndpointGroupStat = { endpointId: string | null; _count: { _all: number }; _max: { createdAt: Date | null } };
    const access = new Map<string, EndpointGroupStat>();
    for (const item of requestGroups) if (item.endpointId) access.set(item.endpointId, item);
    return {
      total,
      list: list.map((endpoint) => {
        const presentation = describeApiEndpoint({ method: endpoint.method, routePattern: endpoint.routePattern, source: endpoint.source === 'ADMIN' ? 'ADMIN' : 'MINI' });
        const accessStat = access.get(endpoint.id);
        return {
          ...endpoint,
          ...presentation,
          // Existing rows created before the dictionary rollout still render a
          // useful purpose; an administrator's saved description always wins.
          description: endpoint.description || presentation.defaultDescription,
          stats: {
            calls: accessStat?._count._all || 0,
            errors: 0,
            lastCalledAt: accessStat?._max.createdAt?.toISOString() || null,
          },
        };
      }),
    };
  }
  async updateEndpoint(id: string, patch: { description?: string; logEnabled?: boolean }, admin: { adminId: string; adminUsername: string; ip: string; requestUrl?: string }) {
    if (!id || Object.keys(patch).length === 0) throw new HttpError(400, '至少提供 description 或 logEnabled');
    if (patch.description !== undefined && (patch.description.trim().length > 500)) throw new HttpError(400, 'description 不能超过 500 个字符');
    if (patch.logEnabled !== undefined && typeof patch.logEnabled !== 'boolean') throw new HttpError(400, 'logEnabled 必须为布尔值');
    return this.db.$transaction(async (tx) => {
    const before = await tx.apiEndpoint.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, '接口不存在');
    const data: Prisma.ApiEndpointUpdateInput = {};
    if (patch.description !== undefined) data.description = patch.description.trim().slice(0, 500);
    if (patch.logEnabled !== undefined) data.logEnabled = patch.logEnabled;
    const updated = await tx.apiEndpoint.update({ where: { id }, data });
    const logs: Promise<unknown>[] = [];
    if (patch.description !== undefined && patch.description.trim() !== (before.description ?? '')) logs.push(tx.adminSystemLog.create({ data: { adminId: admin.adminId, adminUsername: admin.adminUsername, ip: admin.ip || 'unknown', action: 'API_ENDPOINT_DESCRIPTION_UPDATE', detail: { endpointId: id, before: before.description, after: updated.description, ...(admin.requestUrl ? { requestUrl: admin.requestUrl } : {}) } as Prisma.InputJsonValue } }));
    if (patch.logEnabled !== undefined && patch.logEnabled !== before.logEnabled) logs.push(tx.adminSystemLog.create({ data: { adminId: admin.adminId, adminUsername: admin.adminUsername, ip: admin.ip || 'unknown', action: 'API_ENDPOINT_LOGGING_UPDATE', detail: { endpointId: id, before: before.logEnabled, after: updated.logEnabled, ...(admin.requestUrl ? { requestUrl: admin.requestUrl } : {}) } as Prisma.InputJsonValue } }));
    await Promise.all(logs);
    return updated;
    });
  }
  async listRequests(filters: ApiLogFilters) { return this.listLogs(filters); }
  async listAccess(filters: ApiLogFilters) { return this.listRequests(filters); }
  async listErrors(filters: ApiLogFilters) { return this.listRequests({ ...filters, statusClass: filters.statusClass || '4xx' }); }
  private async listLogs(filters: ApiLogFilters) {
    const page = Math.max(1, filters.page ?? 1), pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? 20));
    const where = whereFor(filters, await this.actorWhere(filters));
    const repo = this.db.apiRequestLog as unknown as { count(args: unknown): Promise<number>; findMany(args: unknown): Promise<Array<{ id: bigint; createdAt: Date; [key: string]: unknown }>> };
    const [total, rows] = await Promise.all([repo.count({ where }), repo.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
    const serialized = rows.map(serialize) as Array<Record<string, unknown>>;
    const adminIds = [...new Set(serialized.map((row) => row.adminId).filter((id): id is string => typeof id === 'string'))];
    const userIds = [...new Set(serialized.map((row) => row.userId).filter((id): id is string => typeof id === 'string'))];
    const db = this.db as typeof prisma;
    const [admins, users] = await Promise.all([
      adminIds.length && db.adminUser ? db.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, username: true } }) : [],
      userIds.length && db.user ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, phoneNumber: true } }) : [],
    ]);
    const adminNames = new Map<string, string>();
    const userNames = new Map<string, string>();
    for (const item of admins as Array<{ id: string; username: string }>) adminNames.set(item.id, item.username);
    for (const item of users as Array<{ id: string; name: string | null; phoneNumber: string | null }>) userNames.set(item.id, item.name || item.phoneNumber || '未命名用户');
    return {
      total,
      list: serialized.map((row) => ({
        ...row,
        actorLabel: typeof row.adminId === 'string'
          ? `后台：${adminNames.get(row.adminId) || '已删除管理员'}`
          : typeof row.userId === 'string'
            ? `用户：${userNames.get(row.userId) || '已删除用户'}`
            : '匿名访问',
      })),
    };
  }
  async exportRequests(filters: ApiLogFilters) {
    const rows = await (this.db.apiRequestLog as unknown as { findMany(args: unknown): Promise<Array<{ id: bigint; createdAt: Date; [key: string]: unknown }>> }).findMany({ where: whereFor(filters, await this.actorWhere(filters)), orderBy: { createdAt: 'desc' }, take: MAX_EXPORT });
    const headers = ['time', 'source', 'method', 'requestUrl', 'ip', 'actorId', 'httpStatus', 'businessCode', 'durationMs', 'requestId'];
    const esc = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const body = rows.map((r) => [r.createdAt.toISOString(), r.source, r.method, r.requestUrl, r.ip, r.userId || r.adminId || '', r.httpStatus, r.businessCode, r.durationMs, r.requestId].map(esc).join(',')).join('\n');
    return `\uFEFF${headers.join(',')}\n${body}`;
  }
  async exportAccess(filters: ApiLogFilters) { return this.exportRequests(filters); }

  private async actorWhere(filters: ApiLogFilters): Promise<Prisma.ApiRequestLogWhereInput> {
    const keyword = scalar(filters.actorKeyword) || scalar(filters.actorId);
    if (!keyword) return {};
    const db = this.db as typeof prisma;
    const [users, admins] = await Promise.all([
      db.user.findMany({
        where: { OR: [{ id: { contains: keyword } }, { name: { contains: keyword } }, { phoneNumber: { contains: keyword } }] },
        select: { id: true },
        take: 100,
      }),
      db.adminUser.findMany({
        where: { OR: [{ id: { contains: keyword } }, { username: { contains: keyword } }] },
        select: { id: true },
        take: 100,
      }),
    ]);
    const conditions: Prisma.ApiRequestLogWhereInput[] = [];
    if (users.length) conditions.push({ userId: { in: users.map((user) => user.id) } });
    if (admins.length) conditions.push({ adminId: { in: admins.map((admin) => admin.id) } });
    return conditions.length ? { OR: conditions } : { OR: [{ userId: keyword }, { adminId: keyword }] };
  }
}

export function parseApiLogFilters(query: Record<string, unknown>): ApiLogFilters {
  const actorKeyword = scalar(query.actorKeyword);
  return {
    page: int(query.page), pageSize: int(query.pageSize), ip: scalar(query.ip), endpointId: scalar(query.endpointId), method: scalar(query.method), source: scalar(query.source), httpStatus: int(query.httpStatus), statusClass: scalar(query.statusClass), startAt: scalar(query.startAt), endAt: scalar(query.endAt), actorId: scalar(query.actorId), minDurationMs: int(query.minDurationMs), maxDurationMs: int(query.maxDurationMs),
    ...(actorKeyword ? { actorKeyword } : {}),
  };
}
