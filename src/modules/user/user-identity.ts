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

export type EffectiveUserTag = {
  label: string;
  type: 'owner' | 'outsider' | 'admin' | '';
};

type BoundAdminForTag = {
  role: 'ADMIN' | 'SUPERADMIN';
  orgName?: string | null;
  enabled?: boolean | null;
};

type UserTagDatabase = Pick<PrismaClient, 'user' | 'adminUser'>;

/**
 * The current user identity is the sole source of every visible user tag.
 * Content records do not store identity or administrator label snapshots.
 */
export function effectiveUserTag(identityType: unknown, admin?: BoundAdminForTag | null): EffectiveUserTag {
  if (admin && admin.enabled !== false) {
    if (admin.role === 'SUPERADMIN') return { label: '平台管理员', type: 'admin' };
    return { label: admin.orgName?.trim() || '网站管理员', type: 'admin' };
  }

  const type = normalizeIdentityType(identityType);
  if (type === 'OWNER') return { label: '业主', type: 'owner' };
  if (type === 'OUTSIDER') return { label: '小区外人员', type: 'outsider' };
  return { label: '', type: '' };
}

export async function resolveEffectiveUserTags(
  database: UserTagDatabase,
  userIds: readonly string[],
): Promise<Map<string, EffectiveUserTag>> {
  const ids = [...new Set(userIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const [users, admins] = await Promise.all([
    database.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, identityType: true },
    }),
    database.adminUser.findMany({
      where: { boundUserId: { in: ids }, enabled: true },
      select: { boundUserId: true, role: true, orgName: true, enabled: true },
    }),
  ]);
  const adminByUserId = new Map(
    admins
      .filter((admin) => admin.boundUserId)
      .map((admin) => [admin.boundUserId!, admin] as const),
  );
  return new Map(users.map((user) => [user.id, effectiveUserTag(user.identityType, adminByUserId.get(user.id))]));
}

import type { PrismaClient } from '@prisma/client';
