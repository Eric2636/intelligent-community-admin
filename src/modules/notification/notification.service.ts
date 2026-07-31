import { HttpError } from '../../http-error';
import type { NotificationTransaction } from './notification-notify';
import { normalizeNotificationPagination } from './notification.dto';
export {
  notify,
  type NotificationBizType,
  type NotificationTransaction,
  type NotifyInput,
} from './notification-notify';

type NotificationRow = Awaited<
  ReturnType<NotificationTransaction['notification']['findFirst']>
>;

function serializeNotification(row: NonNullable<NotificationRow>) {
  return {
    id: row.id,
    recipientId: row.recipientId,
    actorId: row.actorId,
    type: row.type,
    bizType: row.bizType,
    bizId: row.bizId,
    title: row.title,
    content: row.content,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  tx: NotificationTransaction,
  params: {
    recipientId: string;
    page?: number;
    pageSize?: number;
  },
) {
  const { page, pageSize } = normalizeNotificationPagination(params);
  const where = { recipientId: params.recipientId, deletedAt: null };
  const [rows, total] = await Promise.all([
    tx.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    tx.notification.count({ where }),
  ]);
  return {
    list: rows.map(serializeNotification),
    total,
    page,
    pageSize,
  };
}

export async function getUnreadNotificationCount(
  tx: NotificationTransaction,
  recipientId: string,
) {
  return tx.notification.count({
    where: { recipientId, readAt: null, deletedAt: null },
  });
}

export async function markNotificationRead(
  tx: NotificationTransaction,
  params: {
    recipientId: string;
    notificationId: string;
    now?: Date;
  },
) {
  const result = await tx.notification.updateMany({
    where: {
      id: params.notificationId,
      recipientId: params.recipientId,
      readAt: null,
      deletedAt: null,
    },
    data: { readAt: params.now ?? new Date() },
  });
  if (result.count > 0) return {};

  const visibleCount = await tx.notification.count({
    where: {
      id: params.notificationId,
      recipientId: params.recipientId,
      deletedAt: null,
    },
  });
  if (visibleCount === 0) throw new HttpError(404, '通知不存在');
  return {};
}

export async function markAllNotificationsRead(
  tx: NotificationTransaction,
  params: {
    recipientId: string;
    now?: Date;
  },
) {
  return tx.notification.updateMany({
    where: {
      recipientId: params.recipientId,
      readAt: null,
      deletedAt: null,
    },
    data: { readAt: params.now ?? new Date() },
  });
}

export async function softDeleteNotification(
  tx: NotificationTransaction,
  params: {
    recipientId: string;
    notificationId: string;
    now?: Date;
  },
) {
  const result = await tx.notification.updateMany({
    where: {
      id: params.notificationId,
      recipientId: params.recipientId,
      deletedAt: null,
    },
    data: { deletedAt: params.now ?? new Date() },
  });
  if (result.count === 0) throw new HttpError(404, '通知不存在');
  return {};
}
