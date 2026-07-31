const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'authorization',
  'cookie',
  'code',
  'phonecode',
  'refreshtoken',
  'phone',
  'openid',
  'idcard',
  'bankcard',
  'secret',
  'clientsecret',
]);

const MAX_SNAPSHOT_DEPTH = 6;
const MAX_SNAPSHOT_KEYS = 30;
const MAX_SNAPSHOT_ARRAY_ITEMS = 20;
const MAX_SNAPSHOT_STRING_LENGTH = 500;
const MAX_SNAPSHOT_BYTES = 8 * 1024;

function maskPhone(value: string) {
  return value.replace(/(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)/g, '$1****$2');
}

/** Redacts sensitive query parameters while retaining enough path for diagnosis. */
export function redactPath(input: string) {
  const hashIndex = input.indexOf('#');
  const withoutHash = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const queryIndex = withoutHash.indexOf('?');
  if (queryIndex < 0) return withoutHash;
  const base = withoutHash.slice(0, queryIndex);
  const rawQuery = withoutHash.slice(queryIndex + 1);
  const params = new URLSearchParams(rawQuery);
  for (const [key, value] of params.entries()) {
    params.set(key, SENSITIVE_KEYS.has(key.toLowerCase()) && key.toLowerCase() !== 'phone' ? '[REDACTED]' : maskPhone(value));
  }
  const result = params.toString().replaceAll('%2A', '*');
  return result ? `${base}?${result}` : base;
}

export function safeErrorSummary(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : JSON.stringify(error);
  return redactSecrets(message || '').slice(0, 1000) || 'Unknown error';
}

function isSensitiveKey(key: string) {
  return SENSITIVE_KEYS.has(key.toLowerCase().replaceAll(/[_-]/g, ''));
}

function isOmittedValue(value: string) {
  return /^data:/i.test(value) || /^base64,/i.test(value) || value.length > MAX_SNAPSHOT_STRING_LENGTH;
}

function sanitizeSnapshotValue(value: unknown, key = '', depth = 0): unknown {
  if (isSensitiveKey(key) && key.toLowerCase() !== 'phone') return '[REDACTED]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    if (isOmittedValue(value)) return value.length > MAX_SNAPSHOT_STRING_LENGTH ? `${value.slice(0, MAX_SNAPSHOT_STRING_LENGTH)}…[TRUNCATED]` : '[OMITTED]';
    return key.toLowerCase() === 'phone' ? maskPhone(value) : maskPhone(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return '[OMITTED]';
  if (depth >= MAX_SNAPSHOT_DEPTH) return '[TRUNCATED]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_SNAPSHOT_ARRAY_ITEMS).map((item) => sanitizeSnapshotValue(item, '', depth + 1));
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, MAX_SNAPSHOT_KEYS);
    return Object.fromEntries(entries.map(([entryKey, entryValue]) => [entryKey, sanitizeSnapshotValue(entryValue, entryKey, depth + 1)]));
  }
  return '[OMITTED]';
}

/** Builds a safe diagnostic-only snapshot; credentials, media and oversized values are never persisted. */
export function safeRequestSnapshot(input: { params?: unknown; query?: unknown; body?: unknown }) {
  const snapshot = {
    params: sanitizeSnapshotValue(input.params),
    query: sanitizeSnapshotValue(input.query),
    body: sanitizeSnapshotValue(input.body),
  };
  try {
    return Buffer.byteLength(JSON.stringify(snapshot), 'utf8') <= MAX_SNAPSHOT_BYTES ? snapshot : { truncated: true };
  } catch {
    return { truncated: true };
  }
}

function redactSecrets(input: string) {
  let value = input;
  // Handles common log/error forms without echoing credentials or tokens.
  value = value.replace(/(["']?(?:password|token|access_token|authorization|cookie|code|phoneCode|refreshToken|client_secret)["']?\s*[=:]\s*["']?)([^\s,"';&}]+)/gi, '$1[REDACTED]');
  value = value.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]');
  return maskPhone(value);
}

export const sensitiveQueryKeys = [...SENSITIVE_KEYS];
