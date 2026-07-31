import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { HttpError } from '../../http-error';

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
export const MAX_NOTIFICATION_SKIP = 1_000_000;
export const MAX_NOTIFICATION_PAGE = Math.floor(MAX_NOTIFICATION_SKIP / MAX_PAGE_SIZE) + 1;

export type NotificationPagination = {
  page: number;
  pageSize: number;
};

export function normalizeNotificationPagination(input: {
  page?: number;
  pageSize?: number;
}): NotificationPagination {
  const page = input.page ?? DEFAULT_PAGE;
  const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(page) || page < 1 || page > MAX_NOTIFICATION_PAGE) {
    throw new HttpError(400, `页码必须是1到${MAX_NOTIFICATION_PAGE}之间的安全整数`);
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new HttpError(400, `每页数量必须是1到${MAX_PAGE_SIZE}之间的整数`);
  }
  return { page, pageSize };
}

export class NotificationListQueryDto {
  @Type(() => Number)
  @IsInt({ message: '页码必须是整数' })
  @Min(1, { message: '页码不能小于1' })
  @Max(MAX_NOTIFICATION_PAGE, { message: `页码不能超过${MAX_NOTIFICATION_PAGE}` })
  page: number = DEFAULT_PAGE;

  @Type(() => Number)
  @IsInt({ message: '每页数量必须是整数' })
  @Min(1, { message: '每页数量不能小于1' })
  @Max(MAX_PAGE_SIZE, { message: `每页数量不能超过${MAX_PAGE_SIZE}` })
  pageSize: number = DEFAULT_PAGE_SIZE;
}
