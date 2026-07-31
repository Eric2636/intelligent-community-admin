import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { USER_IDENTITY_TYPES, type UserIdentityType } from './user-identity';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  name?: string;

  /** 兼容旧版小程序请求；服务端不会据此更新头像。 */
  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsIn(USER_IDENTITY_TYPES)
  identityType?: UserIdentityType;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1)
  gender?: number;

  @IsOptional()
  @IsString()
  householdNo?: string;

  @IsOptional()
  @IsString()
  birth?: string;

  @IsOptional()
  @IsArray()
  address?: unknown[];

  @IsOptional()
  @IsArray()
  photos?: unknown[];

  @IsOptional()
  @IsString()
  brief?: string;
}
