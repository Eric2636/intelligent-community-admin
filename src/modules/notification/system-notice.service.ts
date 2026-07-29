import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { sanitizeNotificationText } from './notification-text';

const SYSTEM_NOTICE_BATCH_SIZE = 500;
const TITLE_MAX_CODE_POINTS = 191;
const CONTENT_MAX_UTF8_BYTES = 65_535;

type SystemNoticeTransaction = Pick<
  Prisma.TransactionClient,
  'user' | 'notification' | 'adminSystemLog' | 'systemNoticePublication'
>;

export type SystemNoticeDatabase = {
  $transaction<T>(
    work: (tx: SystemNoticeTransaction) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
  systemNoticePublication: Pick<Prisma.SystemNoticePublicationDelegate, 'findUnique'>;
};

export type PublishSystemNoticeInput = {
  title: string;
  content: string;
  adminId: string;
  adminUsername: string;
  ip: string;
  clientRequestId: string;
  requestUrl?: string;
};

function normalizeSystemNoticeText(input: Pick<PublishSystemNoticeInput, 'title' | 'content'>) {
  const title = sanitizeNotificationText(input.title, Number.MAX_SAFE_INTEGER);
  const content = sanitizeNotificationText(input.content, Number.MAX_SAFE_INTEGER);
  if (!title) throw new HttpError(400, '通知标题不能为空或缺少有效文本');
  if (!content) throw new HttpError(400, '通知内容不能为空或缺少有效文本');
  if (Array.from(title).length > TITLE_MAX_CODE_POINTS) {
    throw new HttpError(400, `通知标题不能超过${TITLE_MAX_CODE_POINTS}个字符`);
  }
  if (Buffer.byteLength(content, 'utf8') > CONTENT_MAX_UTF8_BYTES) {
    throw new HttpError(400, `通知内容不能超过${CONTENT_MAX_UTF8_BYTES}字节`);
  }
  return { title, content };
}

function systemNoticePayloadHash(title: string, content: string): string {
  return createHash('sha256').update(JSON.stringify({ title, content }), 'utf8').digest('hex');
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export async function publishSystemNotice(
  database: SystemNoticeDatabase,
  input: PublishSystemNoticeInput,
) {
  const { title, content } = normalizeSystemNoticeText(input);
  const noticeId = input.clientRequestId;
  const adminId = input.adminId.trim();
  const payloadHash = systemNoticePayloadHash(title, content);
  const dedupeKey = `system:${noticeId}`;

  try {
    return await database.$transaction(
      async (tx) => {
        await tx.systemNoticePublication.create({
          data: {
            id: noticeId,
            adminId,
            payloadHash,
          },
        });

        let cursor: string | undefined;
        let recipientCount = 0;

        while (true) {
          const users = await tx.user.findMany({
            where: { enabled: true },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: SYSTEM_NOTICE_BATCH_SIZE,
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (users.length === 0) break;

          const inserted = await tx.notification.createMany({
            data: users.map((user) => ({
              recipientId: user.id,
              actorId: null,
              type: 'SYSTEM_NOTICE',
              bizType: 'system',
              bizId: noticeId,
              title,
              content,
              dedupeKey,
            })),
            skipDuplicates: true,
          });
          recipientCount += inserted.count;
          cursor = users.at(-1)!.id;
          if (users.length < SYSTEM_NOTICE_BATCH_SIZE) break;
        }

        await tx.systemNoticePublication.update({
          where: { id: noticeId },
          data: { recipientCount },
        });
        await tx.adminSystemLog.create({
          data: {
            adminId,
            adminUsername: input.adminUsername.trim(),
            ip: input.ip.trim() || 'unknown',
            action: 'SYSTEM_NOTICE_PUBLISH',
            detail: {
              noticeId,
              titleSummary: sanitizeNotificationText(title, 80),
              recipientCount,
              ...(input.requestUrl ? { requestUrl: input.requestUrl } : {}),
            },
          },
        });

        return { noticeId, recipientCount };
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await database.systemNoticePublication.findUnique({
      where: { id: noticeId },
    });
    if (
      !existing ||
      existing.adminId !== adminId ||
      existing.payloadHash !== payloadHash
    ) {
      throw new HttpError(409, '请求标识已被其他系统通知使用');
    }
    return { noticeId: existing.id, recipientCount: existing.recipientCount };
  }
}
