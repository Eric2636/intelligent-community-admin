import Router from '@koa/router';
import { prisma } from '../../lib/prisma';

export type ApiEndpointSource = 'ADMIN' | 'MINI';

export type RegisteredApiEndpoint = {
  method: string;
  routePattern: string;
  source: ApiEndpointSource;
};

export type ApiEndpointConfig = RegisteredApiEndpoint & {
  id: string | null;
  description: string | null;
  logEnabled: boolean;
};

export type ApiEndpointPresentation = {
  moduleName: string;
  displayName: string;
  defaultDescription: string;
};

/** A stable, human-readable fallback for every route discovered at startup. */
export function describeApiEndpoint(endpoint: Pick<RegisteredApiEndpoint, 'method' | 'routePattern' | 'source'>): ApiEndpointPresentation {
  const path = endpoint.routePattern;
  const moduleName = path.includes('/mall') ? '小区市场'
    : path.includes('/posts') ? '小区留言'
      : path.includes('/tasks') ? '业主互助'
        : path.includes('/notifications') ? '消息通知'
          : path.includes('/feedback') ? '意见反馈'
            : path.startsWith('/api/admin') ? '后台管理'
              : path.includes('/auth') ? '身份认证' : '社区基础服务';
  const action = endpoint.method === 'GET' ? '查询'
    : endpoint.method === 'POST' ? '提交'
      : endpoint.method === 'PATCH' || endpoint.method === 'PUT' ? '更新'
        : endpoint.method === 'DELETE' ? '删除' : '调用';
  const displayName = `${action}${moduleName}数据`;
  return { moduleName, displayName, defaultDescription: `${displayName}（${endpoint.method} ${path}）` };
}

type StoredApiEndpoint = {
  id: string;
  source: string;
  method: string;
  routePattern: string;
  description: string | null;
  logEnabled: boolean;
};

type ApiEndpointRepository = {
  findUnique(args: {
    where: { method_routePattern: { method: string; routePattern: string } };
  }): PromiseLike<StoredApiEndpoint | null>;
  upsert(args: {
    where: { method_routePattern: { method: string; routePattern: string } };
    create: {
      source: ApiEndpointSource;
      method: string;
      routePattern: string;
      logEnabled: true;
      description?: string;
    };
    update: { source: ApiEndpointSource };
  }): PromiseLike<StoredApiEndpoint>;
};

type ApiEndpointDatabase = {
  apiEndpoint: ApiEndpointRepository;
};

type SafeLogger = {
  error(event: string, metadata?: Record<string, unknown>): void;
};

type CachedConfig = {
  expiresAt: number;
  value: ApiEndpointConfig;
};

const CACHE_TTL_MS = 30_000;
const DEFAULT_SYNC_CONCURRENCY = 8;
const MAX_ROUTE_PATTERN_LENGTH = 512;
const registeredHttpMethods = new Set([
  'CONNECT',
  'DELETE',
  'GET',
  'HEAD',
  'OPTIONS',
  'PATCH',
  'POST',
  'PUT',
  'TRACE',
]);

const defaultLogger: SafeLogger = {
  error(event, metadata) {
    console.error(`[${event}]`, metadata);
  },
};

function normalizeMethod(method: string) {
  return method.trim().toUpperCase();
}

function endpointKey(method: string, routePattern: string) {
  return JSON.stringify([normalizeMethod(method), routePattern]);
}

class RoutePatternError extends Error {
  constructor(
    readonly reason:
      | 'ambiguous_regexp_source'
      | 'route_pattern_too_long'
      | 'unsupported_route_pattern',
  ) {
    super(
      reason === 'ambiguous_regexp_source'
        ? 'cannot infer api source from regexp route'
        : reason === 'route_pattern_too_long'
          ? 'api route pattern exceeds 512 characters'
          : 'unsupported api route pattern',
    );
  }
}

export function normalizeRoutePattern(path: unknown) {
  let routePattern: string;
  if (typeof path === 'string') {
    routePattern = path;
  } else if (path instanceof RegExp) {
    routePattern = `REGEXP:${path.source}/${path.flags}`;
  } else {
    throw new RoutePatternError('unsupported_route_pattern');
  }
  if (routePattern.length > MAX_ROUTE_PATTERN_LENGTH) {
    throw new RoutePatternError('route_pattern_too_long');
  }
  return routePattern;
}

export function sourceForRoutePattern(routePattern: string): ApiEndpointSource {
  return routePattern === '/api/admin' || routePattern.startsWith('/api/admin/')
    ? 'ADMIN'
    : 'MINI';
}

function sourceForRouterPath(path: unknown, routePattern: string): ApiEndpointSource {
  if (!(path instanceof RegExp)) return sourceForRoutePattern(routePattern);

  const literalSource = path.source.replaceAll('\\/', '/');
  if (literalSource === '^/api$') return 'MINI';
  const firstSegment = /^\^\/api\/([A-Za-z0-9._~-]+)(?=\/|\$)/.exec(literalSource)?.[1];
  if (!firstSegment) throw new RoutePatternError('ambiguous_regexp_source');
  return firstSegment.toLowerCase() === 'admin' ? 'ADMIN' : 'MINI';
}

type ApiEndpointDiscoveryFailure = {
  layerIndex: number;
  method: string;
  reason: RoutePatternError['reason'];
};

function discoverRegisteredApiEndpoints(router: Router) {
  const endpoints = new Map<string, RegisteredApiEndpoint>();
  const failures: ApiEndpointDiscoveryFailure[] = [];

  for (const [layerIndex, layer] of router.stack.entries()) {
    const layerMethods = new Set((layer.methods ?? []).map(normalizeMethod));
    for (const rawMethod of layer.methods ?? []) {
      const method = normalizeMethod(rawMethod);
      // A GET layer receives HEAD automatically. A standalone router.head() layer
      // is intentional and remains registered.
      if (method === 'HEAD' && layerMethods.has('GET')) continue;
      if (!registeredHttpMethods.has(method)) continue;
      let routePattern: string;
      try {
        routePattern = normalizeRoutePattern(layer.path);
      } catch (error) {
        failures.push({
          layerIndex,
          method,
          reason:
            error instanceof RoutePatternError
              ? error.reason
              : 'unsupported_route_pattern',
        });
        continue;
      }
      let source: ApiEndpointSource;
      try {
        source = sourceForRouterPath(layer.path, routePattern);
      } catch (error) {
        failures.push({
          layerIndex,
          method,
          reason:
            error instanceof RoutePatternError
              ? error.reason
              : 'ambiguous_regexp_source',
        });
        continue;
      }
      const endpoint = { method, routePattern, source };
      const key = endpointKey(method, routePattern);
      if (!endpoints.has(key)) endpoints.set(key, endpoint);
    }
  }

  return { endpoints: [...endpoints.values()], failures };
}

export function extractRegisteredApiEndpoints(router: Router): RegisteredApiEndpoint[] {
  const discovery = discoverRegisteredApiEndpoints(router);
  if (discovery.failures.length > 0) {
    const first = discovery.failures[0];
    throw new RoutePatternError(first.reason);
  }
  return discovery.endpoints;
}

export type ApiEndpointSyncResult = {
  ok: boolean;
  discovered: number;
  synced: number;
  failed: number;
};

export async function syncRegisteredApiEndpoints(
  router: Router,
  dependencies: {
    db?: ApiEndpointDatabase;
    logger?: SafeLogger;
    maxConcurrency?: number;
  } = {},
): Promise<ApiEndpointSyncResult> {
  const db = dependencies.db ?? (prisma as unknown as ApiEndpointDatabase);
  const logger = dependencies.logger ?? defaultLogger;
  const { endpoints, failures: discoveryFailures } = discoverRegisteredApiEndpoints(router);
  const maxConcurrency = Math.max(
    1,
    Math.min(
      Math.floor(dependencies.maxConcurrency ?? DEFAULT_SYNC_CONCURRENCY),
      endpoints.length || 1,
    ),
  );
  let synced = 0;
  let failed = discoveryFailures.length;

  for (const failure of discoveryFailures) {
    try {
      logger.error('api_endpoint_discovery_failed', failure);
    } catch {
      // Logging must never turn route discovery into a startup dependency.
    }
  }

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < endpoints.length) {
      const endpoint = endpoints[nextIndex];
      nextIndex += 1;
      try {
        const presentation = describeApiEndpoint(endpoint);
        await db.apiEndpoint.upsert({
          where: {
            method_routePattern: {
              method: endpoint.method,
              routePattern: endpoint.routePattern,
            },
          },
          create: {
            ...endpoint,
            logEnabled: true,
            description: presentation.defaultDescription,
          },
          // Startup discovery owns only the computed source. Administrator-authored
          // descriptions and switches must survive every restart.
          update: {
            source: endpoint.source,
          },
        });
        synced += 1;
      } catch {
        failed += 1;
        try {
          logger.error('api_endpoint_sync_failed', endpoint);
        } catch {
          // A custom logger is observational and may not break synchronization.
        }
      }
    }
  }

  await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));

  return {
    ok: failed === 0,
    discovered: endpoints.length,
    synced,
    failed,
  };
}

export class ApiEndpointService {
  private readonly cache = new Map<string, CachedConfig>();
  private readonly inFlight = new Map<string, Promise<ApiEndpointConfig>>();
  private readonly keyVersions = new Map<string, number>();
  private cacheEpoch = 0;
  private readonly db: ApiEndpointDatabase;
  private readonly clock: () => number;
  private readonly logger: SafeLogger;
  private readonly cacheTtlMs: number;

  constructor(
    dependencies: {
      db?: ApiEndpointDatabase;
      clock?: () => number;
      logger?: SafeLogger;
      cacheTtlMs?: number;
    } = {},
  ) {
    this.db = dependencies.db ?? (prisma as unknown as ApiEndpointDatabase);
    this.clock = dependencies.clock ?? Date.now;
    this.logger = dependencies.logger ?? defaultLogger;
    this.cacheTtlMs = dependencies.cacheTtlMs ?? CACHE_TTL_MS;
  }

  getConfig(methodInput: string, routePattern: string): Promise<ApiEndpointConfig> {
    const method = normalizeMethod(methodInput);
    const key = endpointKey(method, routePattern);
    const now = this.clock();
    const cached = this.cache.get(key);
    if (cached && now < cached.expiresAt) return Promise.resolve(cached.value);
    const existingLoad = this.inFlight.get(key);
    if (existingLoad) return existingLoad;

    const source = sourceForRoutePattern(routePattern);
    const epoch = this.cacheEpoch;
    const keyVersion = this.keyVersions.get(key) ?? 0;
    const pending = this.loadConfig({ key, method, routePattern, source, epoch, keyVersion }).finally(
      () => {
        if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
      },
    );
    this.inFlight.set(key, pending);
    return pending;
  }

  private async loadConfig(input: {
    key: string;
    method: string;
    routePattern: string;
    source: ApiEndpointSource;
    epoch: number;
    keyVersion: number;
  }): Promise<ApiEndpointConfig> {
    const { key, method, routePattern, source, epoch, keyVersion } = input;
    try {
      let row = await this.db.apiEndpoint.findUnique({
        where: { method_routePattern: { method, routePattern } },
      });
      if (!row) {
        row = await this.db.apiEndpoint.upsert({
          where: { method_routePattern: { method, routePattern } },
          create: { source, method, routePattern, logEnabled: true },
          update: { source },
        });
      }
      const value: ApiEndpointConfig = {
        id: row.id,
        source: sourceForRoutePattern(row.routePattern),
        method: normalizeMethod(row.method),
        routePattern: row.routePattern,
        description: row.description,
        logEnabled: row.logEnabled,
      };
      if (
        this.cacheEpoch === epoch &&
        (this.keyVersions.get(key) ?? 0) === keyVersion
      ) {
        this.cache.set(key, {
          expiresAt: this.clock() + this.cacheTtlMs,
          value,
        });
      }
      return value;
    } catch {
      const value: ApiEndpointConfig = {
        id: null,
        source,
        method,
        routePattern,
        description: null,
        logEnabled: true,
      };
      try {
        this.logger.error('api_endpoint_config_read_failed', {
          method,
          routePattern,
          source,
        });
      } catch {
        // Configuration fallback must remain enabled even if logging is unavailable.
      }
      return value;
    }
  }

  invalidate(method: string, routePattern: string) {
    const key = endpointKey(method, routePattern);
    this.keyVersions.set(key, (this.keyVersions.get(key) ?? 0) + 1);
    this.cache.delete(key);
    this.inFlight.delete(key);
  }

  invalidateAll() {
    this.cacheEpoch += 1;
    this.cache.clear();
    this.inFlight.clear();
  }
}

// All runtime consumers must import this singleton so an administrator update
// invalidates the same cache observed by the logging middleware.
export const apiEndpointService = new ApiEndpointService();
