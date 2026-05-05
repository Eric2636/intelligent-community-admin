import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import { serializeMallOrder } from './mall.serialize';

export class MallOrderService {
  async createOrder(params: {
    buyerId: string;
    itemId: string;
    itemTitle?: string;
    itemPrice?: string;
    itemUnit?: string;
    sellerId: string;
    contact?: string;
  }) {
    if (params.buyerId === params.sellerId) {
      throw new HttpError(400, '不能购买自己发布的商品');
    }

    const item = await prisma.mallItem.findFirst({ where: { id: params.itemId, visibility: 'ONLINE' } });
    if (!item) throw new HttpError(404, '商品不存在');
    if (item.publisherId !== params.sellerId) {
      throw new HttpError(400, '卖家信息与商品不一致');
    }

    const order = await prisma.mallOrder.create({
      data: {
        itemId: item.id,
        itemTitle: (params.itemTitle ?? item.title).slice(0, 500),
        itemPrice: params.itemPrice ?? item.price,
        itemUnit: (params.itemUnit ?? item.unit ?? '元').slice(0, 16),
        sellerId: params.sellerId,
        buyerId: params.buyerId,
        contact: params.contact?.trim() || item.contact || '',
        status: 'pending',
      },
    });

    return { orderId: order.id };
  }

  async getMyOrders(params: { userId: string }) {
    const [buyRows, sellRows] = await Promise.all([
      prisma.mallOrder.findMany({
        where: { buyerId: params.userId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.mallOrder.findMany({
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
    const row = await prisma.mallOrder.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, '订单不存在');
    if (row.buyerId !== params.userId && row.sellerId !== params.userId) {
      throw new HttpError(403, '无权限查看该订单');
    }
    return serializeMallOrder(row);
  }

  async updateOrderStatus(params: {
    userId: string;
    orderId: string;
    status: 'completed' | 'cancelled';
  }) {
    const id = String(params.orderId || '').trim();
    if (!id) throw new HttpError(400, '缺少订单 id');

    const row = await prisma.mallOrder.findUnique({ where: { id } });
    if (!row) throw new HttpError(404, '订单不存在');
    if (row.buyerId !== params.userId && row.sellerId !== params.userId) {
      throw new HttpError(403, '无权限操作');
    }
    if (row.status !== 'pending') {
      throw new HttpError(400, '订单状态不可变更');
    }

    await prisma.mallOrder.update({
      where: { id },
      data: { status: params.status },
    });
    return {};
  }
}
