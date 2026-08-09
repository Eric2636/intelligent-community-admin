import { HttpError } from '../../http-error';

export type MallContact = {
  type: 'WECHAT' | 'PHONE' | 'PHONE_WECHAT' | 'LEGACY';
  label: '微信号' | '手机号' | '手机号（可添加微信）' | '联系方式';
  value: string;
};

export function normalizeWechatContact(value: unknown): string | null {
  const contact = typeof value === 'string' ? value.trim() : '';
  return contact || null;
}

export function normalizePhoneIsWechat(value: unknown, phoneContact: string | null): boolean {
  const isWechat = value === true;
  if (isWechat && !phoneContact) throw new HttpError(400, '勾选手机号也是微信号前请填写手机号');
  return isWechat;
}

export function normalizePhoneContact(value: unknown): string | null {
  const contact = typeof value === 'string' ? value.trim() : '';
  if (!contact) return null;
  if (!/^1[3-9]\d{9}$/.test(contact)) throw new HttpError(400, '手机号格式不正确');
  return contact;
}

export function normalizeLegacyContact(value: unknown): string | null {
  const contact = typeof value === 'string' ? value.trim() : '';
  return contact && contact !== '保密' ? contact : null;
}

export function assertMallItemHasContact(params: {
  wechatContact?: string | null;
  phoneContact?: string | null;
  legacyContact?: string | null;
}) {
  if (!params.wechatContact && !params.phoneContact && !params.legacyContact) {
    throw new HttpError(400, '请至少填写微信号或手机号');
  }
}

export function serializeMallContacts(params: {
  wechatContact?: string | null;
  phoneContact?: string | null;
  phoneIsWechat?: boolean;
  contact?: string | null;
}): MallContact[] {
  const wechatContact = normalizeWechatContact(params.wechatContact);
  const phoneContact = normalizePhoneContact(params.phoneContact);
  if (wechatContact || phoneContact) {
    return [
      ...(wechatContact ? [{ type: 'WECHAT' as const, label: '微信号' as const, value: wechatContact }] : []),
      ...(phoneContact ? [{
        type: params.phoneIsWechat ? 'PHONE_WECHAT' as const : 'PHONE' as const,
        label: params.phoneIsWechat ? '手机号（可添加微信）' as const : '手机号' as const,
        value: phoneContact,
      }] : []),
    ];
  }
  const legacyContact = normalizeLegacyContact(params.contact);
  return legacyContact ? [{ type: 'LEGACY', label: '联系方式', value: legacyContact }] : [];
}
