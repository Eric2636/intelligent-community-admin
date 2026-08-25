import { HttpError } from '../../http-error';

export const ADMIN_FORUM_AUTHOR_ID = '__admin_forum__';
export const ADMIN_ANNOUNCEMENT_AUTHOR_ID = '__admin_announcement__';

export function isAdminForumAuthor(authorId: string) {
  return authorId === ADMIN_FORUM_AUTHOR_ID || authorId === ADMIN_ANNOUNCEMENT_AUTHOR_ID;
}

type OwnershipInput = {
  role: 'ADMIN' | 'SUPERADMIN';
  adminId: string;
  boundUserId?: string | null;
  type: 'posts' | 'items' | 'tasks';
  ownerUserId: string;
  createdByAdminId?: string | null;
};

export function canAdminModifyContent(input: OwnershipInput) {
  if (input.role === 'SUPERADMIN') return true;
  if (input.type === 'posts' && isAdminForumAuthor(input.ownerUserId)) {
    return Boolean(input.createdByAdminId) && input.createdByAdminId === input.adminId;
  }
  const bound = String(input.boundUserId || '').trim();
  return Boolean(bound) && input.ownerUserId === bound;
}

export function assertAdminCanModifyBatch(
  input: Omit<OwnershipInput, 'ownerUserId' | 'createdByAdminId'> & {
    rows: Array<{ ownerUserId: string; createdByAdminId?: string | null }>;
  },
) {
  const allowed = input.rows.every((row) => canAdminModifyContent({ ...input, ...row }));
  if (!allowed) throw new HttpError(403, '批量操作中包含非本人发布的内容');
}
