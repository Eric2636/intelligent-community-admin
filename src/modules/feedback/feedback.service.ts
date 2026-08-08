import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { avatarOrDefault } from '../user/default-avatar';
import { effectiveUserTag, resolveEffectiveUserTags } from '../user/user-identity';
import {
  normalizeFeedback,
  type CreateFeedbackDto,
  type NormalizedAdminFeedbackQuery,
} from './feedback.dto';

type FeedbackDatabase = Pick<PrismaClient, 'feedback' | 'user' | 'adminUser'>;

export class FeedbackService {
  constructor(private readonly database: FeedbackDatabase = prisma) {}

  async create(params: { userId: string; dto: CreateFeedbackDto }) {
    const feedback = normalizeFeedback(params.dto);
    const row = await this.database.feedback.create({
      data: {
        userId: params.userId,
        content: feedback.content,
      },
      select: { id: true, createdAt: true },
    });
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async listAdmin(params: NormalizedAdminFeedbackQuery) {
    const identityUserIds = params.identity
      ? (
          await this.database.user.findMany({
            where: { identityType: params.identity },
            select: { id: true },
          })
        ).map((user) => user.id)
      : undefined;
    const nicknameUserIds = params.keyword
      ? (
          await this.database.user.findMany({
            where: {
              name: { contains: params.keyword },
              ...(params.identity ? { identityType: params.identity } : {}),
            },
            select: { id: true },
          })
        ).map((user) => user.id)
      : [];

    const conditions: Prisma.FeedbackWhereInput[] = [];
    if (identityUserIds) conditions.push({ userId: { in: identityUserIds } });
    if (params.keyword) {
      conditions.push({
        OR: [
          { content: { contains: params.keyword } },
          { userId: { in: nicknameUserIds } },
        ],
      });
    }
    if (params.startAt || params.endAt) {
      conditions.push({
        createdAt: {
          ...(params.startAt ? { gte: params.startAt } : {}),
          ...(params.endAt ? { lte: params.endAt } : {}),
        },
      });
    }
    const where: Prisma.FeedbackWhereInput = conditions.length ? { AND: conditions } : {};
    const query = {
      where,
      orderBy: { createdAt: 'desc' as const },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      select: { id: true, userId: true, content: true, createdAt: true },
    };
    const [total, rows] = await Promise.all([
      this.database.feedback.count({ where }),
      this.database.feedback.findMany(query),
    ]);
    const profiles = rows.length
      ? await this.database.user.findMany({
          where: { id: { in: rows.map((row) => row.userId) } },
          select: { id: true, name: true, avatar: true, identityType: true },
        })
      : [];
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const tags = await resolveEffectiveUserTags(this.database, rows.map((row) => row.userId));

    return {
      total,
      list: rows.map((row) => {
        const profile = profileById.get(row.userId);
        return {
          id: row.id,
          userId: row.userId,
          nickname: profile?.name?.trim() || '微信用户',
          avatar: avatarOrDefault(profile?.avatar),
          userTagLabel: (tags.get(row.userId) ?? effectiveUserTag(profile?.identityType)).label,
          userTagType: (tags.get(row.userId) ?? effectiveUserTag(profile?.identityType)).type,
          content: row.content,
          createdAt: row.createdAt.toISOString(),
        };
      }),
    };
  }
}
