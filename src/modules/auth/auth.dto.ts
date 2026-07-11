import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class WechatLoginDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsOptional()
  @IsString()
  nickName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  gender?: number;
}

export class WechatPhoneLoginDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsString()
  @MinLength(1)
  phoneCode!: string;
}
