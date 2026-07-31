import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { isImageMediaUrl, parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import { adminDisplayLabelForContent } from '../admin/admin.service';
import { contentIdentityTag } from './user-identity';
import { runUserProfileUpdate } from './user-profile-sync';
import type { UpdateMeDto } from './user.dto';

const MAX_USER_PHOTOS = 20;

export class UserService {
  async getMe(userId: string) {
    const [user, admin] = await Promise.all([
      prisma.user.findUnique({
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
      }),
      prisma.adminUser.findFirst({
        where: { boundUserId: userId, enabled: true },
        select: { role: true, orgName: true },
      }),
    ]);
    if (!user) throw new HttpError(404, '用户不存在');
    const adminLabel = admin ? adminDisplayLabelForContent(admin) : '';
    const tag = contentIdentityTag(user.identityType, adminLabel);
    return {
      ...user,
      adminLabel,
      contentTagLabel: tag.label,
      contentTagType: tag.type,
    };
  }

  async updateMe(userId: string, dto: UpdateMeDto) {
    if (dto.avatar != null && String(dto.avatar).trim() !== '') {
      const a = String(dto.avatar).trim();
      if (!isImageMediaUrl(a)) throw new HttpError(400, '头像仅支持图片链接');
    }
    const photos =
      dto.photos === undefined
        ? undefined
        : (parseStrictMediaUrlList(dto.photos, MAX_USER_PHOTOS, 'image', 'photos') as unknown as Prisma.InputJsonValue);

    return runUserProfileUpdate({
      userId,
      changes: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.avatar !== undefined ? { avatar: dto.avatar } : {}),
        ...(dto.identityType !== undefined ? { identityType: dto.identityType } : {}),
      },
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
