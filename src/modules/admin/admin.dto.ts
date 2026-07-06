import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  /** 首次输错密码后，下一次登录必须带验证码 */
  @IsOptional()
  @IsString()
  captchaId?: string;

  @IsOptional()
  @IsString()
  captchaCode?: string;
}

export class AdminChangeMyPasswordDto {
  @IsString()
  @MinLength(6)
  password!: string;
}

export class AdminListQueryDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  pageSize?: number;

  @IsOptional()
  @IsString()
  keyword?: string;
}

export class AdminSystemLogQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsString()
  action?: string;
}

export class CreateAdminUserDto {
  @IsString()
  @MinLength(3)
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsOptional()
  @IsString()
  orgName?: string;

  @IsOptional()
  @IsIn(['OFFICIAL', 'THIRD_PARTY'])
  type?: 'OFFICIAL' | 'THIRD_PARTY';

  /** 绑定的小程序 User.id */
  @IsOptional()
  @IsString()
  boundUserId?: string;
}

export class UpdateAdminUserDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsString()
  orgName?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['OFFICIAL', 'THIRD_PARTY'])
  type?: 'OFFICIAL' | 'THIRD_PARTY';

  /** 传空字符串表示解除绑定 */
  @IsOptional()
  @IsString()
  boundUserId?: string;
}

export class UpdateUserEnabledDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminContentQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsIn(['ONLINE', 'OFFLINE'])
  visibility?: 'ONLINE' | 'OFFLINE';
}

export class UpdateContentStateDto {
  @IsOptional()
  @IsIn(['ONLINE', 'OFFLINE'])
  visibility?: 'ONLINE' | 'OFFLINE';

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;
}

export class BatchUpdateContentStateDto extends UpdateContentStateDto {
  @IsString({ each: true })
  ids!: string[];
}

/** 管理端新建内容（字段按 type 在 service 中校验） */
export class AdminCreateContentDto {
  @IsOptional()
  @IsString()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  desc?: string;

  @IsOptional()
  @IsString()
  reward?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  price?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsString()
  locationAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsIn(['ONLINE', 'OFFLINE'])
  visibility?: 'ONLINE' | 'OFFLINE';

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsIn(['NORMAL', 'ANNOUNCEMENT'])
  postType?: 'NORMAL' | 'ANNOUNCEMENT';

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videos?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mainImages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subImages?: string[];
}

/** 管理端更新内容正文（不含单独的上架/置顶接口时可一并提交） */
export class AdminUpdateContentDto {
  @IsOptional()
  @IsString()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsString()
  desc?: string;

  @IsOptional()
  @IsString()
  reward?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  price?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  contact?: string;

  @IsOptional()
  @IsString()
  locationName?: string;

  @IsOptional()
  @IsString()
  locationAddress?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsIn(['ONLINE', 'OFFLINE'])
  visibility?: 'ONLINE' | 'OFFLINE';

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsIn(['NORMAL', 'ANNOUNCEMENT'])
  postType?: 'NORMAL' | 'ANNOUNCEMENT';

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  /** errands: PENDING_TAKE | IN_PROGRESS | COMPLETED；tasks: TaskStatus 枚举字符串 */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videos?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  mainImages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subImages?: string[];
}
