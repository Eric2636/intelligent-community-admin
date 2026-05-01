import { IsString, MinLength } from 'class-validator';

export class WechatLoginDto {
  @IsString()
  @MinLength(1)
  code!: string;
}

