import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CosCredentialsDto {
  @IsString()
  @MinLength(1)
  @IsIn(['forum', 'task', 'mall', 'avatar'])
  module!: string;

  @IsOptional()
  @IsString()
  @IsIn(['img', 'vid'])
  type?: string;
}

export class PresignDto {
  @IsString()
  @MinLength(1)
  key!: string;
}
