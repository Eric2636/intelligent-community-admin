import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { contentNotDeleted } from '../../lib/content-soft-delete';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import {
  cacheAsideJson,
  invalidateMallItemDetailCache,
  invalidateMallItemsListCache,
  mallItemDetailCacheKey,
  mallItemsListCacheKey,
  MALL_ITEM_DETAIL_TTL_SEC,
  MALL_LIST_TTL_SEC,
} from '../../lib/redis-cache';
import { lockUsersForProfileSnapshot } from '../user/user-profile-sync';
import { effectiveUserTag, resolveEffectiveUserTags } from '../user/user-identity';
import { configuredMediaAssetService } from '../media/media-asset.service';
import { MallCategoryService } from './mall-category.service';
import { MALL_DEFAULT_VISIBILITY, MALL_LIST_CAP } from './mall.constants';
import type { UpdateMallItemDto } from './mall.dto';
import { jsonImages, parsePriceNum, serializeMallItem } from './mall.serialize';
import {
  assertMallItemHasContact,
  normalizeLegacyContact,
  normalizePhoneContact,
  normalizePhoneIsWechat,
  normalizeWechatContact,
} from './mall-contact';

export class MallItemService {
  private readonly categories = new MallCategoryService();

  private async withCurrentUserTags<T extends { publisherId: string; userTagLabel?: string; userTagType?: string }>(items: T[]) {
    const tags = await resolveEffectiveUserTags(prisma, items.map((item) => item.publisherId));
    return items.map((item) => {
      const tag = tags.get(item.publisherId) ?? effectiveUserTag(null);
      return { ...item, userTagLabel: tag.label, userTagType: tag.type };
    });
  }

  async listItems(params: {
    userId?: string;
    categoryId?: string;
    keyword?: string;
    orderBy?: 'time' | 'price_asc' | 'price_desc';
  }) {
    const { categoryId, keyword, orderBy = 'time' } = params;
    const k = keyword?.trim() || '';
    const cacheKey = await mallItemsListCacheKey(categoryId, k, orderBy);
    const base = await cacheAsideJson(cacheKey, MALL_LIST_TTL_SEC, async () => {
      const where: Prisma.MallItemWhereInput = {
        visibility: 'ONLINE',
        ...contentNotDeleted,
      };
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
    if (!params.userId || base.length === 0) {
      return this.withCurrentUserTags(base.map((item) => ({ ...item, isFavorited: false })));
    }

    const favorites = await prisma.mallItemFavorite.findMany({
      where: { userId: params.userId, itemId: { in: base.map((item) => item.id) } },
      select: { itemId: true },
    });
    const favoriteItemIds = new Set(favorites.map((favorite) => favorite.itemId));
    return this.withCurrentUserTags(base.map((item) => ({ ...item, isFavorited: favoriteItemIds.has(item.id) })));
  }

  async getItemDetail(params: { userId?: string; itemId: string }) {
    const id = String(params.itemId || '').trim();
    if (!id) throw new HttpError(400, '商品 id 不能为空');

    const base = await cacheAsideJson(mallItemDetailCacheKey(id), MALL_ITEM_DETAIL_TTL_SEC, async () => {
      const row = await prisma.mallItem.findFirst({
        where: { id, ...contentNotDeleted },
      });
      if (!row) throw new HttpError(404, '商品不存在');
      return serializeMallItem(row);
    });
    if (base.visibility !== 'ONLINE' && base.publisherId !== params.userId) {
      throw new HttpError(404, '商品不存在');
    }

    const fav = params.userId
      ? await prisma.mallItemFavorite.findUnique({
          where: { itemId_userId: { itemId: id, userId: params.userId } },
        })
      : null;

    return (await this.withCurrentUserTags([{ ...base, isFavorited: Boolean(fav) }]))[0];
  }

  async publishItem(params: {
    userId: string;
    categoryId: string;
    title: string;
    price?: string;
    unit?: string;
    desc?: string;
    wechatContact?: string;
    phoneContact?: string;
    phoneIsWechat?: boolean;
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

    const categoryId = await this.categories.assertEnabledCategoryId(params.categoryId);
    const wechatContact = normalizeWechatContact(params.wechatContact);
    const phoneContact = normalizePhoneContact(params.phoneContact);
    const phoneIsWechat = normalizePhoneIsWechat(params.phoneIsWechat, phoneContact);
    const legacyContact = normalizeLegacyContact(params.contact);
    assertMallItemHasContact({ wechatContact, phoneContact, legacyContact });
    const row = await prisma.$transaction(async (tx) => {
      await lockUsersForProfileSnapshot(tx, [params.userId]);
      const publisher = await tx.user.findUnique({
        where: { id: params.userId },
        select: { name: true, avatar: true },
      });
      const created = await tx.mallItem.create({
        data: {
          categoryId,
          title: params.title.trim(),
          price: params.price?.trim() || null,
          unit: (params.unit?.trim() || '元').slice(0, 16),
          desc: params.desc?.trim() || '',
          wechatContact,
          phoneContact,
          phoneIsWechat,
          contact: wechatContact || phoneContact ? null : legacyContact,
          locationName: params.locationName?.trim() || null,
          locationAddress: params.locationAddress?.trim() || null,
          latitude: Number.isFinite(params.latitude) ? params.latitude : null,
          longitude: Number.isFinite(params.longitude) ? params.longitude : null,
          mainImages: normalizedMainImages.length ? jsonImages(normalizedMainImages) : undefined,
          subImages: normalizedSubImages.length ? jsonImages(normalizedSubImages) : undefined,
          videos: videos.length ? jsonImages(videos) : undefined,
          images: legacyImages.length ? jsonImages(legacyImages) : undefined,
          publisherId: params.userId,
          publisherName: publisher?.name ?? '',
          publisherAvatar: publisher?.avatar ?? null,
          visibility: MALL_DEFAULT_VISIBILITY,
        },
      });
      const media = configuredMediaAssetService(tx);
      await media?.attachUrls(tx, {
        uploaderId: params.userId,
        urls: [...normalizedMainImages, ...normalizedSubImages, ...videos],
      });
      return created;
    });
    const s = (await this.withCurrentUserTags([serializeMallItem(row)]))[0];
    await invalidateMallItemsListCache();
    return { ...s, id: row.id, _id: row.id };
  }

  async getMyItems(params: { userId: string }) {
    const rows = await prisma.mallItem.findMany({
      where: { publisherId: params.userId, ...contentNotDeleted },
      orderBy: { createdAt: 'desc' },
    });
    return this.withCurrentUserTags(rows.map((r) => serializeMallItem(r)));
  }

  private async getOwnedItem(userIdRaw: string, itemIdRaw: string) {
    const userId = String(userIdRaw || '').trim();
    const itemId = String(itemIdRaw || '').trim();
    if (!itemId) throw new HttpError(400, '商品 id 不能为空');
    const row = await prisma.mallItem.findFirst({
      where: { id: itemId, ...contentNotDeleted },
    });
    if (!row) throw new HttpError(404, '商品不存在');
    if (row.publisherId !== userId) throw new HttpError(403, '只能操作自己发布的信息');
    return row;
  }

  async updateItem(params: { userId: string; itemId: string; dto: UpdateMallItemDto }) {
    const current = await this.getOwnedItem(params.userId, params.itemId);
    const dto = params.dto;
    const data: Prisma.MallItemUpdateInput = {};

    if (dto.categoryId !== undefined) {
      data.categoryId = await this.categories.assertEnabledCategoryId(dto.categoryId);
    }
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new HttpError(400, '标题不能为空');
      data.title = title;
    }
    if (dto.price !== undefined) data.price = dto.price?.trim() || null;
    if (dto.unit !== undefined) data.unit = (dto.unit.trim() || '元').slice(0, 16);
    if (dto.desc !== undefined) data.desc = dto.desc.trim();
    const hasStructuredContactUpdate = dto.wechatContact !== undefined || dto.phoneContact !== undefined || dto.phoneIsWechat !== undefined;
    if (hasStructuredContactUpdate) {
      const wechatContact = dto.wechatContact === undefined
        ? current.wechatContact
        : normalizeWechatContact(dto.wechatContact);
      const phoneContact = dto.phoneContact === undefined
        ? current.phoneContact
        : normalizePhoneContact(dto.phoneContact);
      const phoneIsWechat = normalizePhoneIsWechat(
        dto.phoneIsWechat === undefined ? current.phoneIsWechat : dto.phoneIsWechat,
        phoneContact,
      );
      const legacyContact = normalizeLegacyContact(current.contact);
      assertMallItemHasContact({ wechatContact, phoneContact, legacyContact });
      data.wechatContact = wechatContact;
      data.phoneContact = phoneContact;
      data.phoneIsWechat = phoneIsWechat;
      if (wechatContact || phoneContact) data.contact = null;
    }
    if (dto.contact !== undefined && !hasStructuredContactUpdate) data.contact = normalizeLegacyContact(dto.contact);
    if (dto.locationName !== undefined) data.locationName = dto.locationName?.trim() || null;
    if (dto.locationAddress !== undefined) data.locationAddress = dto.locationAddress?.trim() || null;
    if (dto.latitude !== undefined) data.latitude = Number.isFinite(dto.latitude) ? dto.latitude : null;
    if (dto.longitude !== undefined) data.longitude = Number.isFinite(dto.longitude) ? dto.longitude : null;

    const serializedCurrent = serializeMallItem(current);
    const mainImages = dto.mainImages === undefined
      ? serializedCurrent.mainImages
      : parseStrictMediaUrlList(dto.mainImages, 1, 'image', 'mainImages');
    const subImages = dto.subImages === undefined
      ? serializedCurrent.subImages
      : parseStrictMediaUrlList(dto.subImages, 6, 'image', 'subImages');
    if (mainImages.length + subImages.length > 6) {
      throw new HttpError(400, '图片最多上传 6 张（主图+副图合计）');
    }
    if (dto.mainImages !== undefined) data.mainImages = jsonImages(mainImages);
    if (dto.subImages !== undefined) data.subImages = jsonImages(subImages);
    if (dto.videos !== undefined) {
      data.videos = jsonImages(parseStrictMediaUrlList(dto.videos, 2, 'video', 'videos'));
    }

    if (Object.keys(data).length === 0) throw new HttpError(400, '没有可更新的内容');
    const lifecycle = configuredMediaAssetService(prisma);
    const applyUpdate = async (tx: typeof prisma) => {
      const updated = await tx.mallItem.update({ where: { id: current.id }, data });
      const next = serializeMallItem(updated);
      const oldUrls = [...serializedCurrent.mainImages, ...serializedCurrent.subImages, ...serializedCurrent.videos];
      const nextUrls = [...next.mainImages, ...next.subImages, ...next.videos];
      await lifecycle?.attachUrls(tx, { uploaderId: params.userId, urls: nextUrls });
      await lifecycle?.requestDeleteUrls(tx, oldUrls.filter((url) => !nextUrls.includes(url)));
      return updated;
    };
    const row = lifecycle
      ? await prisma.$transaction((tx) => applyUpdate(tx as typeof prisma))
      : await applyUpdate(prisma);
    await Promise.all([
      invalidateMallItemsListCache(),
      invalidateMallItemDetailCache(current.id),
    ]);
    return (await this.withCurrentUserTags([serializeMallItem(row)]))[0];
  }

  async setItemVisibility(params: {
    userId: string;
    itemId: string;
    visibility: 'ONLINE' | 'OFFLINE';
  }) {
    const current = await this.getOwnedItem(params.userId, params.itemId);
    const row = current.visibility === params.visibility
      ? current
      : await prisma.mallItem.update({
          where: { id: current.id },
          data: { visibility: params.visibility },
        });
    await Promise.all([
      invalidateMallItemsListCache(),
      invalidateMallItemDetailCache(current.id),
    ]);
    return (await this.withCurrentUserTags([serializeMallItem(row)]))[0];
  }

  async deleteItem(params: { userId: string; itemId: string }) {
    const current = await this.getOwnedItem(params.userId, params.itemId);
    const lifecycle = configuredMediaAssetService(prisma);
    const applyDelete = async (tx: typeof prisma) => {
      const comments = await tx.mallItemComment.findMany({
        where: { itemId: current.id },
        select: { images: true },
      });
      await tx.mallItem.update({
        where: { id: current.id },
        data: { deletedAt: new Date() },
      });
      const currentMedia = serializeMallItem(current);
      await lifecycle?.requestDeleteUrls(tx, [
        ...currentMedia.mainImages,
        ...currentMedia.subImages,
        ...currentMedia.videos,
        ...comments.flatMap((comment) => Array.isArray(comment.images) ? comment.images as string[] : []),
      ]);
    };
    if (lifecycle) await prisma.$transaction((tx) => applyDelete(tx as typeof prisma));
    else await applyDelete(prisma);
    await Promise.all([
      invalidateMallItemsListCache(),
      invalidateMallItemDetailCache(current.id),
    ]);
    return { id: current.id, _id: current.id };
  }
}
