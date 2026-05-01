import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMallItemCommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  content?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  parentCommentId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}
