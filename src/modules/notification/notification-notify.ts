import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';

export type NotificationBizType = 'forum' | 'task' | 'mall' | 'system';

export type NotifyInput = {
  recipientId: string;
  actorId?: string;
  type: string;
  bizType: NotificationBizType;
  bizId?: string;
  title: string;
  content: string;
  dedupeKey: string;
};

export type NotificationTransaction = Pick<Prisma.TransactionClient, 'notification'>;

const VARCHAR_DEFAULT_MAX = 191;
const TYPE_MAX = 48;
const BIZ_TYPE_MAX = 32;
const DEDUPE_KEY_MAX = 255;
const MYSQL_TEXT_MAX_BYTES = 65_535;
const BIZ_TYPES = new Set<NotificationBizType>(['forum', 'task', 'mall', 'system']);

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function requireStringWithin(
  value: unknown,
  fieldName: string,
  maxLength: number,
): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `${fieldName}不能为空`);
  }
  if (codePointLength(value) > maxLength) {
    throw new HttpError(400, `${fieldName}不能超过${maxLength}个字符`);
  }
}

function requireIdentifier(value: unknown, fieldName: string): asserts value is string {
  requireStringWithin(value, fieldName, VARCHAR_DEFAULT_MAX);
  if (value !== value.trim()) {
    throw new HttpError(400, `${fieldName}不能包含首尾空格`);
  }
}

function validateNotificationIdentities(input: NotifyInput): void {
  requireIdentifier(input.recipientId, '通知接收人');
  if (input.actorId !== undefined) {
    requireIdentifier(input.actorId, '通知触发人');
  }
}

function validateNotifyInput(input: NotifyInput): void {
  requireStringWithin(input.type, '通知类型', TYPE_MAX);
  requireStringWithin(input.bizType, '业务类型', BIZ_TYPE_MAX);
  if (!BIZ_TYPES.has(input.bizType)) throw new HttpError(400, '业务类型不支持');
  if (input.bizId !== undefined) {
    requireStringWithin(input.bizId, '业务编号', VARCHAR_DEFAULT_MAX);
  }
  requireStringWithin(input.title, '通知标题', VARCHAR_DEFAULT_MAX);
  requireStringWithin(input.content, '通知内容', MYSQL_TEXT_MAX_BYTES);
  if (Buffer.byteLength(input.content, 'utf8') > MYSQL_TEXT_MAX_BYTES) {
    throw new HttpError(400, `通知内容不能超过${MYSQL_TEXT_MAX_BYTES}字节`);
  }
  requireStringWithin(input.dedupeKey, '通知去重键', DEDUPE_KEY_MAX);
}

/**
 * This function never opens a transaction. Business writers must pass their
 * existing TransactionClient so a notification failure rolls back the
 * corresponding business mutation.
 */
export async function notify(tx: NotificationTransaction, input: NotifyInput) {
  validateNotificationIdentities(input);
  if (input.actorId !== undefined && input.actorId === input.recipientId) {
    return null;
  }
  validateNotifyInput(input);
  return tx.notification.upsert({
    where: {
      recipientId_dedupeKey: {
        recipientId: input.recipientId,
        dedupeKey: input.dedupeKey,
      },
    },
    create: input,
    update: {},
  });
}
