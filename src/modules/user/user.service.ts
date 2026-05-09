import type { Prisma } from '@prisma/client';
import { HttpError } from '../../http-error';
import { isImageMediaUrl, parseStrictMediaUrlList } from '../../lib/media-url';
import { prisma } from '../../lib/prisma';
import type { UpdateMeDto } from './user.dto';

const MAX_USER_PHOTOS = 20;

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
        gender: true,
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
    return user;
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

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        avatar: dto.avatar,
        gender: dto.gender,
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
        gender: true,
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
    return user;
  }
}
