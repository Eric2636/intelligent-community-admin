import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../http-error';

export function verifyWechatCallbackSignature(params: {
  token: string;
  timestamp: string;
  nonce: string;
  signature: string;
}) {
  const expected = createHash('sha1')
    .update([params.token, params.timestamp, params.nonce].sort().join(''))
    .digest();
  const supplied = Buffer.from(String(params.signature || ''), 'hex');
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function validateWechatCallbackConfiguration(
  appEnv?: string,
  token?: string,
  nodeEnv = process.env.NODE_ENV,
) {
  const effectiveEnv = String(appEnv || '').trim() || nodeEnv;
  if (effectiveEnv === 'production' && !String(token || '').trim()) {
    throw new Error('生产环境必须配置 WX_MESSAGE_TOKEN');
  }
}

export function parseWechatMediaCheckResult(body: unknown, expectedAppid: string) {
  const value = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (!expectedAppid || value.appid !== expectedAppid) throw new HttpError(403, '微信回调来源无效');
  const traceId = typeof value.trace_id === 'string' ? value.trace_id.trim() : '';
  const errcode = Number(value.errcode);
  if (!traceId || !Number.isInteger(errcode)) throw new HttpError(400, '微信回调参数无效');
  const result = value.result && typeof value.result === 'object' ? (value.result as Record<string, unknown>) : {};
  const suggest = typeof result.suggest === 'string' ? result.suggest : undefined;
  const parsedLabel = result.label === undefined ? undefined : Number(result.label);
  const label = parsedLabel !== undefined && Number.isInteger(parsedLabel) ? parsedLabel : undefined;
  return { traceId, errcode, suggest, label };
}
