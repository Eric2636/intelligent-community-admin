import { HttpError } from '../http-error';

/** 路径或 URL 上允许的「图片 / 视频」后缀，与小程序 cloudMedia 保持一致 */
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|avi|mkv|webm|3gp|mpeg|mpg|flv)$/i;

function pathnameForMediaCheck(url: string): string {
  const s = String(url || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    return decodeURIComponent(u.pathname || '');
  } catch {
    return decodeURIComponent(s.split('?')[0].split('#')[0]);
  }
}

export function isImageMediaUrl(url: string): boolean {
  const s = String(url || '').trim();
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    if ((u.protocol === 'https:' || u.protocol === 'http:') && (host === 'wx.qlogo.cn' || host.endsWith('.qlogo.cn'))) {
      return true;
    }
  } catch {
    /* fall back to suffix check */
  }
  const p = pathnameForMediaCheck(url);
  return p.length > 0 && IMAGE_EXT_RE.test(p);
}

export function isVideoMediaUrl(url: string): boolean {
  const p = pathnameForMediaCheck(url);
  return p.length > 0 && VIDEO_EXT_RE.test(p);
}

/**
 * 校验 images / videos 字段：仅保留合法图片或视频 URL；非法项直接 400。
 */
export function parseStrictMediaUrlList(
  raw: unknown,
  max: number,
  kind: 'image' | 'video',
  fieldLabel: string,
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new HttpError(400, `${fieldLabel} 须为数组`);
  }
  const check = kind === 'image' ? isImageMediaUrl : isVideoMediaUrl;
  const out: string[] = [];
  for (const x of raw) {
    if (typeof x !== 'string') {
      throw new HttpError(400, `${fieldLabel} 须为字符串 URL 列表`);
    }
    const s = x.trim();
    if (!s) continue;
    if (!check(s)) {
      throw new HttpError(400, `仅支持图片或视频链接：${fieldLabel} 中含有不允许的地址`);
    }
    out.push(s);
    if (out.length > max) {
      throw new HttpError(400, `${fieldLabel} 最多 ${max} 个`);
    }
  }
  return out;
}
