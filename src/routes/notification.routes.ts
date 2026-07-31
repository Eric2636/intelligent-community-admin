import type Router from '@koa/router';
import { prisma } from '../lib/prisma';
import { jwtAuth } from '../middleware/jwt-auth';
import { NotificationListQueryDto } from '../modules/notification/notification.dto';
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationTransaction,
  softDeleteNotification,
} from '../modules/notification/notification.service';
import { parseDto } from '../validate';

export function registerNotificationRoutes(
  router: Router,
  database: NotificationTransaction = prisma,
  authMiddleware: typeof jwtAuth = jwtAuth,
) {
  router.get('/api/notifications', authMiddleware, async (ctx) => {
    const query = await parseDto(NotificationListQueryDto, ctx.query);
    const data = await listNotifications(database, {
      recipientId: ctx.state.user!.userId,
      page: query.page,
      pageSize: query.pageSize,
    });
    ctx.body = { code: 200, data };
  });

  router.get('/api/notifications/unread-count', authMiddleware, async (ctx) => {
    const count = await getUnreadNotificationCount(database, ctx.state.user!.userId);
    ctx.body = { code: 200, data: { count } };
  });

  // These writes each update only the notifications table and are atomic
  // updateMany operations, so a route-level interactive transaction would add
  // no consistency guarantee. Business mutations that also create a
  // notification must instead pass their existing TransactionClient to notify.
  router.patch('/api/notifications/read-all', authMiddleware, async (ctx) => {
    await markAllNotificationsRead(database, {
      recipientId: ctx.state.user!.userId,
    });
    ctx.body = { code: 200, data: {} };
  });

  router.patch('/api/notifications/:id/read', authMiddleware, async (ctx) => {
    const data = await markNotificationRead(database, {
      recipientId: ctx.state.user!.userId,
      notificationId: ctx.params.id,
    });
    ctx.body = { code: 200, data };
  });

  router.delete('/api/notifications/:id', authMiddleware, async (ctx) => {
    const data = await softDeleteNotification(database, {
      recipientId: ctx.state.user!.userId,
      notificationId: ctx.params.id,
    });
    ctx.body = { code: 200, data };
  });
}
