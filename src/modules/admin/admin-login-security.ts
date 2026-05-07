import { randomBytes } from 'node:crypto';
import type Redis from 'ioredis';

const FAIL_TTL_SEC = 30 * 60;
const CAPTCHA_TTL_SEC = 5 * 60;
const IP_LOCK_5MIN_SEC = 5 * 60;
const IP_LOCK_10MIN_SEC = 10 * 60;
const IP_LOCK_LEVEL_TTL_SEC = 30 * 60;

function safeKeyPart(s: string): string {
  return encodeURIComponent(String(s || '').trim().toLowerCase());
}

export function loginFailCountKey(username: string, ip: string) {
  return `ic:v1:admin:login:fail:${safeKeyPart(username)}:${safeKeyPart(ip)}`;
}
export function loginNeedCaptchaKey(username: string, ip: string) {
  return `ic:v1:admin:login:need-captcha:${safeKeyPart(username)}:${safeKeyPart(ip)}`;
}

export function ipFailCountKey(ip: string) {
  return `ic:v1:admin:login:ip:fail:${safeKeyPart(ip)}`;
}
export function ipLockKey(ip: string) {
  return `ic:v1:admin:login:ip:lock:${safeKeyPart(ip)}`;
}
export function ipLockLevelKey(ip: string) {
  return `ic:v1:admin:login:ip:level:${safeKeyPart(ip)}`;
}

export function adminLastIpKey(adminId: string) {
  return `ic:v1:admin:login:admin-last-ip:${safeKeyPart(adminId)}`;
}

export function captchaKey(captchaId: string) {
  return `ic:v1:admin:login:captcha:${safeKeyPart(captchaId)}`;
}

export async function getIpLockUntil(r: Redis | null, ip: string): Promise<number | null> {
  if (!r) return null;
  const key = ipLockKey(ip);
  const ttl = await r.ttl(key);
  if (ttl > 0) return Date.now() + ttl * 1000;
  return null;
}

export async function markLoginFailed(r: Redis | null, username: string, ip: string) {
  if (!r) return { count: 1, locked: false, lockUntil: null as number | null };
  const failKey = loginFailCountKey(username, ip);
  const needCaptchaKey = loginNeedCaptchaKey(username, ip);

  const count = await r.incr(failKey);
  // 30 分钟滑动窗口
  if (count === 1) await r.expire(failKey, FAIL_TTL_SEC);
  await r.set(needCaptchaKey, '1', 'EX', FAIL_TTL_SEC);

  // IP 级别：3 次错 -> 5 分钟；再错 -> 10 分钟
  const ipFail = await r.incr(ipFailCountKey(ip));
  if (ipFail === 1) await r.expire(ipFailCountKey(ip), FAIL_TTL_SEC);
  const levelRaw = await r.get(ipLockLevelKey(ip));
  const level = Number(levelRaw || '0') || 0;
  const lockUntil = await getIpLockUntil(r, ip);
  if (!lockUntil) {
    if (level <= 0 && ipFail >= 3) {
      await r.set(ipLockKey(ip), '1', 'EX', IP_LOCK_5MIN_SEC);
      await r.set(ipLockLevelKey(ip), '1', 'EX', IP_LOCK_LEVEL_TTL_SEC);
      return { count, locked: true, lockUntil: Date.now() + IP_LOCK_5MIN_SEC * 1000 };
    }
    if (level >= 1 && ipFail >= 4) {
      await r.set(ipLockKey(ip), '1', 'EX', IP_LOCK_10MIN_SEC);
      await r.set(ipLockLevelKey(ip), '2', 'EX', IP_LOCK_LEVEL_TTL_SEC);
      return { count, locked: true, lockUntil: Date.now() + IP_LOCK_10MIN_SEC * 1000 };
    }
  }

  return { count, locked: false, lockUntil: null };
}

export async function clearLoginFailState(r: Redis | null, username: string, ip: string) {
  if (!r) return;
  await r.del(loginFailCountKey(username, ip), loginNeedCaptchaKey(username, ip));
}

export async function clearIpLock(r: Redis | null, ip: string) {
  if (!r) return;
  const x = String(ip || '').trim();
  if (!x) return;
  await r.del(ipLockKey(x));
}

export async function setAdminLastIp(r: Redis | null, adminId: string, ip: string) {
  if (!r) return;
  const id = String(adminId || '').trim();
  const x = String(ip || '').trim();
  if (!id || !x) return;
  // 保存 30 分钟，足够用于“手动解锁”
  await r.set(adminLastIpKey(id), x, 'EX', FAIL_TTL_SEC);
}

export async function getAdminLastIp(r: Redis | null, adminId: string): Promise<string> {
  if (!r) return '';
  const id = String(adminId || '').trim();
  if (!id) return '';
  return (await r.get(adminLastIpKey(id))) ?? '';
}

export async function shouldRequireCaptcha(r: Redis | null, username: string, ip: string) {
  if (!r) return false;
  return (await r.get(loginNeedCaptchaKey(username, ip))) != null;
}

function randomCaptchaText(len = 4): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[bytes[i]! % alphabet.length];
  return s;
}

export async function createCaptcha(r: Redis | null): Promise<{ captchaId: string; svg: string }> {
  const captchaId = randomBytes(12).toString('hex');
  const code = randomCaptchaText(4);

  if (r) {
    await r.set(captchaKey(captchaId), code, 'EX', CAPTCHA_TTL_SEC);
  }

  // 简易 SVG（不引入依赖）
  const w = 120;
  const h = 40;
  const chars = code.split('');
  const textEls = chars
    .map((c, i) => {
      const x = 18 + i * 24 + (i % 2 === 0 ? 1 : -1) * 2;
      const y = 28 + (i % 2 === 0 ? -1 : 1) * 2;
      const rot = (i % 2 === 0 ? -1 : 1) * (8 + i * 2);
      return `<text x="${x}" y="${y}" font-size="22" font-family="monospace" fill="#0052d9" transform="rotate(${rot} ${x} ${y})">${c}</text>`;
    })
    .join('');

  const noise = Array.from({ length: 5 })
    .map((_, i) => {
      const x1 = 5 + i * 20;
      const y1 = 5 + (i % 2) * 10;
      const x2 = 30 + i * 20;
      const y2 = 30 - (i % 2) * 10;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#d9e6ff" stroke-width="2"/>`;
    })
    .join('');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  <rect x="0" y="0" width="${w}" height="${h}" rx="8" ry="8" fill="#f7f8fa"/>\n  ${noise}\n  ${textEls}\n</svg>`;

  return { captchaId, svg };
}

export async function verifyCaptcha(r: Redis | null, captchaIdRaw: string, captchaCodeRaw: string): Promise<boolean> {
  const captchaId = String(captchaIdRaw || '').trim();
  const captchaCode = String(captchaCodeRaw || '').trim().toUpperCase();
  if (!captchaId || !captchaCode) return false;
  if (!r) return true; // 未启用 redis 时不阻塞登录

  const key = captchaKey(captchaId);
  const expected = await r.get(key);
  if (!expected) return false;
  await r.del(key); // 一次性
  return expected.toUpperCase() === captchaCode;
}

