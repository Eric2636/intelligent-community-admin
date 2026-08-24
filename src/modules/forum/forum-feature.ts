import { HttpError } from '../../http-error';

export type ForumRegistrationStatus = 'OPEN' | 'FULL' | 'CLOSED';

export function assertForumPostTypeFeatureType(
  postType: 'NORMAL' | 'ANNOUNCEMENT',
  featureType: 'CONTENT' | 'REGISTRATION',
) {
  if (postType === 'ANNOUNCEMENT' && featureType === 'REGISTRATION') {
    throw new HttpError(400, '社区公告不支持活动报名');
  }
}

export function registrationStatus(
  input: { deadlineAt: Date; capacity: number; registeredCount: number },
  now = new Date(),
): ForumRegistrationStatus {
  if (input.deadlineAt.getTime() <= now.getTime()) return 'CLOSED';
  if (input.registeredCount >= input.capacity) return 'FULL';
  return 'OPEN';
}
