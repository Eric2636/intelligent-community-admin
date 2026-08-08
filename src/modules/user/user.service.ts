import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import { resolveEffectiveUserTags } from './user-identity';
import { runUserProfileUpdate, type UserProfileSnapshotChanges } from './user-profile-sync';
import type { UpdateMeDto } from './user.dto';

const MAX_USER_PHOTOS = 20;

export function editableProfileSnapshotChanges(dto: UpdateMeDto): UserProfileSnapshotChanges {
  return {
    ...(dto.name !== undefined ? { name: dto.name } : {}),
    ...(dto.identityType !== undefined ? { identityType: dto.identityType } : {}),
  };
}

export class UserService {
  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        openid: true,
        phoneNumber: true,
        name: true,
        avatar: true,
        identityType: true,
        gender: true,
        householdNo: true,
        birth: true,
        address: true,
        photos: true,
        brief: true,
        enabled: true,
        disabledAt: true,
        disabledReason: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new HttpError(404, '用户不存在');
    const tag = (await resolveEffectiveUserTags(prisma, [userId])).get(userId) ?? { label: '', type: '' };
    return {
      ...user,
      userTagLabel: tag.label,
      userTagType: tag.type,
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    const photos =
      dto.photos === undefined
        ? undefined
        : (parseStrictMediaUrlList(dto.photos, MAX_USER_PHOTOS, 'image', 'photos') as unknown as Prisma.InputJsonValue);

    return runUserProfileUpdate({
      userId,
      changes: editableProfileSnapshotChanges(dto),
      complete: (tx) =>
        tx.user.update({
          where: { id: userId },
          data: {
            gender: dto.gender,
            householdNo: dto.householdNo,
            birth: dto.birth,
            address: dto.address as Prisma.InputJsonValue | undefined,
            ...(dto.photos === undefined ? {} : { photos }),
            brief: dto.brief,
          },
          select: {
            id: true,
            openid: true,
            phoneNumber: true,
            name: true,
            avatar: true,
            identityType: true,
            gender: true,
            householdNo: true,
            birth: true,
            address: true,
            photos: true,
            brief: true,
            enabled: true,
            disabledAt: true,
            disabledReason: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
    });
  }
}
