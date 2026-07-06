import type { Prisma } from '@prisma/client';

export function jsonImages(arr: string[]): Prisma.InputJsonValue {
  return arr as unknown as Prisma.InputJsonValue;
}

export function parsePriceNum(p: string | null | undefined): number {
  const n = parseFloat(String(p ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function serializeMallItem(
  row: {
    id: string;
    categoryId: string;
    title: string;
    price: string | null;
    unit: string;
    desc: string;
    contact: string | null;
    locationName?: string | null;
    locationAddress?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    mainImages: Prisma.JsonValue | null;
    subImages: Prisma.JsonValue | null;
    videos: Prisma.JsonValue | null;
    images: Prisma.JsonValue | null;
    publisherId: string;
    adminLabel?: string | null;
    visibility?: string;
    pinned?: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  extra?: { isFavorited: boolean },
) {
  const legacyImages = Array.isArray(row.images)
    ? (row.images as unknown[]).filter((x) => typeof x === 'string')
    : [];
  const mainImages = Array.isArray(row.mainImages)
    ? (row.mainImages as unknown[]).filter((x) => typeof x === 'string')
    : [];
  const subImages = Array.isArray(row.subImages) ? (row.subImages as unknown[]).filter((x) => typeof x === 'string') : [];
  const videos = Array.isArray(row.videos) ? (row.videos as unknown[]).filter((x) => typeof x === 'string') : [];

  // 兼容：若新字段为空，但旧 images 有值，则首张视为主图
  const mainRaw = mainImages.length ? mainImages : legacyImages;
  const subRaw = mainImages.length ? subImages : [];
  // 主图仅一张：历史多条主图或旧 images 多图时，首张为主图，其余并入副图
  const normalizedMainImages = mainRaw.slice(0, 1);
  const normalizedSubImages = mainRaw.slice(1).concat(subRaw);
  const coverImage = normalizedMainImages[0] || normalizedSubImages[0] || '';

  const allImages = normalizedMainImages.concat(normalizedSubImages);
  const base = {
    id: row.id,
    _id: row.id,
    categoryId: row.categoryId,
    title: row.title,
    price: row.price ?? '',
    unit: row.unit,
    desc: row.desc,
    contact: row.contact ?? '',
    locationName: row.locationName ?? '',
    locationAddress: row.locationAddress ?? '',
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    // 新字段（推荐）
    mainImages: normalizedMainImages,
    subImages: normalizedSubImages,
    videos,
    coverImage,
    // 兼容字段：把主图+副图合并输出
    images: allImages,
    publisherId: row.publisherId,
    adminLabel: row.adminLabel ?? '',
    visibility: row.visibility ?? 'ONLINE',
    pinned: Boolean(row.pinned),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (extra && 'isFavorited' in extra) {
    return { ...base, isFavorited: extra.isFavorited };
  }
  return base;
}

export function serializeMallOrder(row: {
  id: string;
  itemId: string;
  itemTitle: string;
  itemPrice: string | null;
  itemUnit: string;
  sellerId: string;
  buyerId: string;
  contact: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    _id: row.id,
    itemId: row.itemId,
    itemTitle: row.itemTitle,
    itemPrice: row.itemPrice ?? '',
    itemUnit: row.itemUnit,
    sellerId: row.sellerId,
    buyerId: row.buyerId,
    contact: row.contact ?? '',
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
