import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @MinLength(1)
  username!: string;

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
