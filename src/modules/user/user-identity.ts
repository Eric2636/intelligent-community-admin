export const USER_IDENTITY_TYPES = ['OWNER', 'OUTSIDER'] as const;

export type UserIdentityType = (typeof USER_IDENTITY_TYPES)[number];

export function normalizeIdentityType(value: unknown): UserIdentityType | null {
  const text = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return USER_IDENTITY_TYPES.includes(text as UserIdentityType)
    ? (text as UserIdentityType)
    : null;
}

export function identityTypeLabel(value: unknown) {
  const type = normalizeIdentityType(value);
  if (type === 'OWNER') return '业主';
  if (type === 'OUTSIDER') return '小区外人员';
  return '';
}
