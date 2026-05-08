import type { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { ReportMiniApiErrorLogDto } from './client-log.dto';

function clip(raw: unknown, max = 2000) {
  const s = String(raw ?? '').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function toJsonValue(raw: unknown): Prisma.InputJsonValue | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(raw)) as Prisma.InputJsonValue;
  } catch {
    return String(raw) as unknown as Prisma.InputJsonValue;
  }
}

function normalizeMethod(raw: unknown) {
  const method = String(raw || 'GET').trim().toUpperCase();
  return method.slice(0, 16) || 'GET';
}

export class ClientLogService {
  async reportMiniApiErrorLog(params: {
    userId?: string;
    openid?: string;
    ip?: string;
    dto: ReportMiniApiErrorLogDto;
  }) {
    const dto = params.dto;
    const row = await prisma.miniProgramApiErrorLog.create({
      data: {
        userId: clip(params.userId, 191) || null,
        openid: clip(params.openid, 191) || null,
        ip: clip(params.ip, 191) || null,
        method: normalizeMethod(dto.method),
        path: clip(dto.path, 500),
        url: clip(dto.url, 4000) || null,
        statusCode: dto.statusCode ?? null,
        errorMessage: clip(dto.errorMessage, 4000),
        requestData: toJsonValue(dto.requestData),
        responseData: toJsonValue(dto.responseData),
        stack: clip(dto.stack, 4000) || null,
        platform: clip(dto.platform, 191) || null,
        appVersion: clip(dto.appVersion, 191) || null,
        sdkVersion: clip(dto.sdkVersion, 191) || null,
        system: clip(dto.system, 191) || null,
        networkType: clip(dto.networkType, 191) || null,
      },
      select: { id: true },
    });
    return row;
  }

  async listMiniApiErrorLogs(params: {
    page: number;
    pageSize: number;
    keyword?: string;
    method?: string;
    statusCode?: number;
  }) {
    const page = Math.max(1, params.page);
    const pageSize = Math.min(Math.max(1, params.pageSize), 100);
    const keyword = params.keyword?.trim();
    const method = params.method?.trim().toUpperCase();

    const where: Prisma.MiniProgramApiErrorLogWhereInput = {
      ...(method ? { method } : {}),
      ...(Number.isInteger(params.statusCode) ? { statusCode: params.statusCode } : {}),
      ...(keyword
        ? {
            OR: [
              { path: { contains: keyword } },
              { url: { contains: keyword } },
              { errorMessage: { contains: keyword } },
              { userId: { contains: keyword } },
              { openid: { contains: keyword } },
              { ip: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.miniProgramApiErrorLog.count({ where }),
      prisma.miniProgramApiErrorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      list: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
