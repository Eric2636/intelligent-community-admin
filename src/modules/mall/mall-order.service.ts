import type { PrismaClient } from '@prisma/client';
import { HttpError } from '../../http-error';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { prisma } from '../../lib/prisma';
import { notify } from '../notification/notification-notify';
import { sanitizeNotificationText } from '../notification/notification-text';
import { lockUsersForProfileSnapshot } from '../user/user-profile-sync';
import { serializeMallOrder } from './mall.serialize';

type MallOrderDatabase = Pick<PrismaClient, '$transaction' | 'mallOrder'>;

function safeOrderTitle(value: string) {
  return sanitizeNotificationText(value, 80, '小区市场订单');
}

function normalizeClientRequestId(value: string) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(normalized)) {
    throw new HttpError(400, 'clientRequestId 格式无效');
  }
  return normalized;
}

function normalizeBuyerContact(value?: string) {
  if (value === undefined) return '';
  const normalized = String(value).trim();
  if (!normalized) throw new HttpError(400, 'buyerContact 不能为空');
  if (Array.from(normalized).length > 500) {
    throw new HttpError(400, 'buyerContact 不能超过500个字符');
  }
  if (
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159);
    })
  ) {
    throw new HttpError(400, 'buyerContact 不能包含控制字符');
  }
  return normalized;
}

function assertIdempotentOrderMatches(
  order: { itemId: string; contact: string | null },
  request: { itemId: string; buyerContact: string },
) {
  if (
    order.itemId !== request.itemId ||
    (order.contact ?? '') !== request.buyerContact
  ) {
    throw new HttpError(409, '该幂等键已用于不同的下单请求');
  }
}

export class MallOrderService {
  constructor(private readonly database: MallOrderDatabase = prisma) {}

  async createOrder(params: {
    buyerId: string;
    itemId: string;
    clientRequestId: string;
    buyerContact?: string;
  }) {
    const buyerId = String(params.buyerId || '').trim();
    const itemId = String(params.itemId || '').trim();
    if (!buyerId) throw new HttpError(400, 'buyerId 不能为空');
    if (!itemId) throw new HttpError(400, 'itemId 不能为空');
    const clientRequestId = normalizeClientRequestId(params.clientRequestId);
    const buyerContact = normalizeBuyerContact(params.buyerContact);

    const order = await this.database.$transaction(async (tx) => {
      const existing = await tx.mallOrder.findUnique({
        where: {
          buyerId_clientRequestId: {
            buyerId,
            clientRequestId,
          },
        },
      });
      if (existing) {
        assertIdempotentOrderMatches(existing, { itemId, buyerContact });
        return existing;
      }

      const item = await tx.mallItem.findFirst({
        where: {
          id: itemId,
          visibility: 'ONLINE',
          ...contentNotDeleted,
        },
      });
      if (!item) throw new HttpError(404, '商品不存在');
      if (buyerId === item.publisherId) {
        throw new HttpError(400, '不能购买自己发布的商品');
      }
      await lockUsersForProfileSnapshot(tx, [item.publisherId, buyerId]);
      const seller = await tx.user.findUnique({
        where: { id: item.publisherId },
        select: { name: true, avatar: true },
      });
      const buyer = await tx.user.findUnique({
        where: { id: buyerId },
        select: { name: true, avatar: true },
      });
      const created = await tx.mallOrder.upsert({
        where: {
          buyerId_clientRequestId: {
            buyerId,
            clientRequestId,
          },
        },
        create: {
          itemId: item.id,
          itemTitle: item.title,
          itemPrice: item.price,
          itemUnit: item.unit ?? '元',
          sellerId: item.publisherId,
          sellerName: seller?.name ?? '',
          sellerAvatar: seller?.avatar ?? null,
          buyerId,
          buyerName: buyer?.name ?? '',
          buyerAvatar: buyer?.avatar ?? null,
          contact: buyerContact || null,
          clientRequestId,
          status: 'pending',
        },
        update: {},
      });
      assertIdempotentOrderMatches(created, { itemId, buyerContact });
      await notify(tx, {
        recipientId: created.sellerId,
        actorId: created.buyerId,
        type: 'MALL_ORDER_CREATED',
        bizType: 'mall',
        bizId: created.id,
        title: safeOrderTitle(created.itemTitle),
        content: '买家已下单，请及时处理',
        dedupeKey: `mall:${created.id}:MALL_ORDER_CREATED:${created.version}:recipient:${created.sellerId}`,
      });
      return created;
    });

    return { orderId: order.id };
  }

  async getMyOrders(params: { userId: string }) {
    const [buyRows, sellRows] = await Promise.all([
      this.database.mallOrder.findMany({
        where: { buyerId: params.userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.database.mallOrder.findMany({
        where: { sellerId: params.userId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      buy: buyRows.map((o) => serializeMallOrder(o)),
      sell: sellRows.map((o) => serializeMallOrder(o)),
    };
  }

  async getOrderDetail(params: { userId: string; orderId: string }) {
    const id = String(params.orderId || '').trim();
    if (!id) throw new HttpError(400, '缺少订单 id');
    const row = await this.database.mallOrder.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, '订单不存在');
    if (row.buyerId !== params.userId && row.sellerId !== params.userId) {
      throw new HttpError(403, '无权限查看该订单');
    }
    return serializeMallOrder(row);
  }

  async updateOrderStatus(params: { userId: string; orderId: string; status: 'completed' | 'cancelled' }) {
    const id = String(params.orderId || '').trim();
    if (!id) throw new HttpError(400, '缺少订单 id');

    return this.database.$transaction(async (tx) => {
      const row = await tx.mallOrder.findUnique({ where: { id } });
      if (!row) throw new HttpError(404, '订单不存在');
      if (row.buyerId !== params.userId && row.sellerId !== params.userId) {
        throw new HttpError(403, '无权限操作');
      }
      if (row.status !== 'pending') {
        throw new HttpError(409, '订单状态已变化，请刷新后重试');
      }
      if (params.status === 'completed' && row.sellerId !== params.userId) {
        throw new HttpError(403, '仅卖家可将订单标记为完成');
      }

      const transition = await tx.mallOrder.updateMany({
        where: {
          id,
          status: 'pending',
          version: row.version,
          sellerId: row.sellerId,
          buyerId: row.buyerId,
        },
        data: {
          status: params.status,
          version: { increment: 1 },
        },
      });
      if (transition.count !== 1) {
        throw new HttpError(409, '订单状态已变化，请刷新后重试');
      }
      const updated = await tx.mallOrder.findUnique({ where: { id } });
      if (!updated) throw new HttpError(404, '订单不存在');

      const isBuyer = params.userId === row.buyerId;
      const recipientId = isBuyer ? row.sellerId : row.buyerId;
      const type =
        params.status === 'cancelled'
          ? 'MALL_ORDER_CANCELLED'
          : 'MALL_ORDER_STATUS_CHANGED';
      const content =
        params.status === 'completed'
          ? '卖家已将订单标记为完成'
          : `${isBuyer ? '买家' : '卖家'}已取消订单`;
      await notify(tx, {
        recipientId,
        actorId: params.userId,
        type,
        bizType: 'mall',
        bizId: id,
        title: safeOrderTitle(row.itemTitle),
        content,
        dedupeKey: `mall:${id}:${type}:${updated.version}:recipient:${recipientId}`,
      });
      return serializeMallOrder(updated);
    });
  }
}
