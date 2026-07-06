import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import {
  cacheAsideJson,
  invalidateMallItemsListCache,
  mallItemDetailCacheKey,
  mallItemsListCacheKey,
  MALL_ITEM_DETAIL_TTL_SEC,
  MALL_LIST_TTL_SEC,
} from '../../lib/redis-cache';
import { MALL_CATEGORIES, MALL_LIST_CAP } from './mall.constants';
import { jsonImages, parsePriceNum, serializeMallItem } from './mall.serialize';

export class MallItemService {
  listCategories() {
    return MALL_CATEGORIES;
  }

  async listItems(params: {
    categoryId?: string;
    keyword?: string;
    orderBy?: 'time' | 'price_asc' | 'price_desc';
  }) {
    const { categoryId, keyword, orderBy = 'time' } = params;
    const k = keyword?.trim() || '';
    const cacheKey = await mallItemsListCacheKey(categoryId, k, orderBy);
    return cacheAsideJson(cacheKey, MALL_LIST_TTL_SEC, async () => {
      const where: Prisma.MallItemWhereInput = { visibility: 'ONLINE', ...contentNotDeleted };
      if (categoryId && categoryId !== 'all') {
        where.categoryId = categoryId;
      }
      if (k) {
        where.OR = [{ title: { contains: k } }, { desc: { contains: k } }];
      }

      const rows = await prisma.mallItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: MALL_LIST_CAP,
      });

      let list = rows;
      if (orderBy === 'price_asc') {
        list = [...rows].sort((a, b) => parsePriceNum(a.price) - parsePriceNum(b.price));
      } else if (orderBy === 'price_desc') {
        list = [...rows].sort((a, b) => parsePriceNum(b.price) - parsePriceNum(a.price));
      }

      return list.map((r) => serializeMallItem(r));
    });
  }

  async getItemDetail(params: { userId: string; itemId: string }) {
    const id = String(params.itemId || '').trim();
    if (!id) throw new HttpError(400, '商品 id 不能为空');

    const base = await cacheAsideJson(mallItemDetailCacheKey(id), MALL_ITEM_DETAIL_TTL_SEC, async () => {
      const row = await prisma.mallItem.findFirst({ where: { id, ...contentNotDeleted } });
      if (!row) throw new HttpError(404, '商品不存在');
      return serializeMallItem(row);
    });
    if (base.visibility !== 'ONLINE' && base.publisherId !== params.userId) {
      throw new HttpError(404, '商品不存在');
    }

    const fav = await prisma.mallItemFavorite.findUnique({
      where: { itemId_userId: { itemId: id, userId: params.userId } },
    });

    return { ...base, isFavorited: Boolean(fav) };
  }

  async publishItem(params: {
    userId: string;
    categoryId: string;
    title: string;
    price?: string;
    unit?: string;
    desc: string;
    contact?: string;
    locationName?: string;
    locationAddress?: string;
    latitude?: number;
    longitude?: number;
    mainImages?: string[];
    subImages?: string[];
    videos?: string[];
    images?: string[]; // legacy
  }) {
    const legacyImages = parseStrictMediaUrlList(params.images, 9, 'image', 'images');
    const mainImages = parseStrictMediaUrlList(params.mainImages, 1, 'image', 'mainImages');
    const subImages = parseStrictMediaUrlList(params.subImages, 6, 'image', 'subImages');
    const videos = parseStrictMediaUrlList(params.videos, 2, 'video', 'videos');

    // 兼容：若新字段没传，但旧 images 有值：首张为主图，其余并入副图（合计仍最多 6 张）
    const normalizedMainImages = mainImages.length ? mainImages : legacyImages.slice(0, 1);
    const normalizedSubImages = mainImages.length ? subImages : legacyImages.slice(1, 6);

    const imgTotal = normalizedMainImages.length + normalizedSubImages.length;
    if (imgTotal > 6) throw new HttpError(400, '图片最多上传 6 张（主图+副图合计）');

    const row = await prisma.mallItem.create({
      data: {
        categoryId: params.categoryId.trim(),
        title: params.title.trim(),
        price: params.price?.trim() || null,
        unit: (params.unit?.trim() || '元').slice(0, 16),
        desc: params.desc.trim(),
        contact: params.contact?.trim() || null,
        locationName: params.locationName?.trim() || null,
        locationAddress: params.locationAddress?.trim() || null,
        latitude: Number.isFinite(params.latitude) ? params.latitude : null,
        longitude: Number.isFinite(params.longitude) ? params.longitude : null,
        mainImages: normalizedMainImages.length ? jsonImages(normalizedMainImages) : undefined,
        subImages: normalizedSubImages.length ? jsonImages(normalizedSubImages) : undefined,
        videos: videos.length ? jsonImages(videos) : undefined,
        images: legacyImages.length ? jsonImages(legacyImages) : undefined,
        publisherId: params.userId,
        visibility: 'OFFLINE',
      },
    });
    const s = serializeMallItem(row);
    await invalidateMallItemsListCache();
    return { ...s, id: row.id, _id: row.id };
  }

  async getMyItems(params: { userId: string }) {
    const rows = await prisma.mallItem.findMany({
      where: { publisherId: params.userId, ...contentNotDeleted },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => serializeMallItem(r));
  }
}
