import { HttpError } from '../../http-error';
import { prisma } from '../../lib/prisma';
import { serializeMallItem } from './mall.serialize';

export class MallFavoriteService {
  async favoriteItem(params: { userId: string; itemId: string }) {
    const itemId = String(params.itemId || '').trim();
    if (!itemId) throw new HttpError(400, '缺少 itemId');
    const exists = await prisma.mallItem.findFirst({
      where: { id: itemId, visibility: 'ONLINE' },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, '商品不存在');

    await prisma.mallItemFavorite.upsert({
      where: { itemId_userId: { itemId, userId: params.userId } },
      create: { itemId, userId: params.userId },
      update: {},
    });
    return { favorited: true };
  }

  async unfavoriteItem(params: { userId: string; itemId: string }) {
    const itemId = String(params.itemId || '').trim();
    if (!itemId) throw new HttpError(400, '缺少 itemId');
    await prisma.mallItemFavorite.deleteMany({ where: { itemId, userId: params.userId } });
    return { favorited: false };
  }

  async getMyFavoriteItems(params: { userId: string }) {
    const favs = await prisma.mallItemFavorite.findMany({
      where: { userId: params.userId },
      orderBy: { createdAt: 'desc' },
    });
    if (favs.length === 0) return [];

    const ids = favs.map((f) => f.itemId);
    const items = await prisma.mallItem.findMany({ where: { id: { in: ids }, visibility: 'ONLINE' } });
    const map = new Map(items.map((i) => [i.id, i]));
    return ids.map((id) => map.get(id)).filter(Boolean).map((r) => serializeMallItem(r!));
  }
}
