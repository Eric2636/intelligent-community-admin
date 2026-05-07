import Redis from 'ioredis';

export const SETTINGS_MODULE_TABS_KEY = 'ic:v1:settings:module-tabs';
export const SETTINGS_MODULE_TABS_TTL_SEC = 300;

const TASK_PENDING_VER_KEY = 'ic:v1:task:pending-list:ver';
export const TASK_PENDING_LIST_TTL_SEC = 120;

let client: Redis | null = null;
let clientInit = false;

function redisEnabled(): boolean {
  const off = process.env.REDIS_ENABLED === '0' || process.env.REDIS_ENABLED === 'false';
  if (off) return false;
  return Boolean(process.env.REDIS_HOST?.trim());
}

function getRedis(): Redis | null {
  if (clientInit) return client;
  clientInit = true;
  if (!redisEnabled()) return null;

  const host = process.env.REDIS_HOST!.trim();
  const port = Number(process.env.REDIS_PORT) || 6379;
  const db = Number(process.env.REDIS_DB) || 0;
  const password = process.env.REDIS_PASSWORD?.trim();
  const connectTimeout = Number(process.env.REDIS_COMMAND_TIMEOUT_MS) || 5000;

  client = new Redis({
    host,
    port,
    db,
    connectTimeout,
    maxRetriesPerRequest: 2,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 200, 2000);
    },
    ...(password ? { password } : {}),
  });

  client.on('error', (err) => {
    console.warn('[redis]', err.message);
  });

  return client;
}

/** 仅供少数场景（如登录安全）直接使用 Redis。 */
export function getRedisClient(): Redis | null {
  return getRedis();
}

export async function cacheAsideJson<T>(key: string, ttlSec: number, loader: () => Promise<T>): Promise<T> {
  const r = getRedis();
  if (!r) return loader();

  try {
    const cached = await r.get(key);
    if (cached != null) return JSON.parse(cached) as T;
  } catch (e) {
    console.warn('[redis] get', key, e);
  }

  const data = await loader();

  try {
    await r.set(key, JSON.stringify(data), 'EX', ttlSec);
  } catch (e) {
    console.warn('[redis] set', key, e);
  }

  return data;
}

export async function invalidateModuleEntryTabsCache(): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(SETTINGS_MODULE_TABS_KEY);
  } catch (e) {
    console.warn('[redis] del module-tabs', e);
  }
}

async function getTaskPendingListVersion(): Promise<string> {
  const r = getRedis();
  if (!r) return '0';
  try {
    const v = await r.get(TASK_PENDING_VER_KEY);
    return v ?? '0';
  } catch {
    return '0';
  }
}

export async function taskPendingListCacheKey(
  page: number,
  pageSize: number,
  keyword: string,
): Promise<string> {
  const ver = await getTaskPendingListVersion();
  const kw = (keyword || '').trim();
  return `ic:v1:task:pending-list:${ver}:${page}:${pageSize}:${encodeURIComponent(kw)}`;
}

export async function invalidatePendingTasksListCache(): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.incr(TASK_PENDING_VER_KEY);
  } catch (e) {
    console.warn('[redis] incr pending-list ver', e);
  }
}

function forumPostRepliesVerKey(postId: string): string {
  return `ic:v1:forum:post:${postId}:replies-ver`;
}

export const FORUM_POST_REPLIES_TTL_SEC = 120;

export async function forumPostRepliesDataCacheKey(postId: string): Promise<string> {
  const r = getRedis();
  let ver = '0';
  if (r) {
    try {
      ver = (await r.get(forumPostRepliesVerKey(postId))) ?? '0';
    } catch {
      ver = '0';
    }
  }
  return `ic:v1:forum:post:${postId}:replies:${ver}`;
}

export async function invalidateForumPostRepliesCache(postId: string): Promise<void> {
  const id = String(postId || '').trim();
  if (!id) return;
  const r = getRedis();
  if (!r) return;
  try {
    await r.incr(forumPostRepliesVerKey(id));
  } catch (e) {
    console.warn('[redis] forum post replies ver', e);
  }
}

function errandRepliesVerKey(errandId: string): string {
  return `ic:v1:errand:${errandId}:replies-ver`;
}

export const ERRAND_REPLIES_TTL_SEC = 120;

export async function errandRepliesDataCacheKey(errandId: string): Promise<string> {
  const r = getRedis();
  let ver = '0';
  if (r) {
    try {
      ver = (await r.get(errandRepliesVerKey(errandId))) ?? '0';
    } catch {
      ver = '0';
    }
  }
  return `ic:v1:errand:${errandId}:replies:${ver}`;
}

export async function invalidateErrandRepliesCache(errandId: string): Promise<void> {
  const id = String(errandId || '').trim();
  if (!id) return;
  const r = getRedis();
  if (!r) return;
  try {
    await r.incr(errandRepliesVerKey(id));
  } catch (e) {
    console.warn('[redis] errand replies ver', e);
  }
}

const MALL_LIST_VER_KEY = 'ic:v1:mall:items:ver';

export const MALL_LIST_TTL_SEC = 120;

async function getMallListVersion(): Promise<string> {
  const r = getRedis();
  if (!r) return '0';
  try {
    return (await r.get(MALL_LIST_VER_KEY)) ?? '0';
  } catch {
    return '0';
  }
}

export async function mallItemsListCacheKey(
  categoryId: string | undefined,
  keyword: string,
  orderBy: string,
): Promise<string> {
  const ver = await getMallListVersion();
  const cat = (categoryId || 'all').trim() || 'all';
  const k = (keyword || '').trim();
  const ord = orderBy || 'time';
  return `ic:v1:mall:items:${ver}:${cat}:${ord}:${encodeURIComponent(k)}`;
}

export async function invalidateMallItemsListCache(): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.incr(MALL_LIST_VER_KEY);
  } catch (e) {
    console.warn('[redis] mall list ver', e);
  }
}

export function mallItemDetailCacheKey(itemId: string): string {
  return `ic:v1:mall:item:${String(itemId || '').trim()}`;
}

export const MALL_ITEM_DETAIL_TTL_SEC = 180;

export async function invalidateMallItemDetailCache(itemId: string): Promise<void> {
  const id = String(itemId || '').trim();
  if (!id) return;
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(mallItemDetailCacheKey(id));
  } catch (e) {
    console.warn('[redis] del mall item', e);
  }
}
