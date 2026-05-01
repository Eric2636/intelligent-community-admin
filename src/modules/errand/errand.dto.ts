import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetErrandsQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(['time', 'hot'])
  orderBy?: 'time' | 'hot';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  pageSize?: number = 10;
}

export class PublishErrandDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsString()
  reward!: string;

  // 前端会传 authorName，但后端将以用户表 name 为准，这里允许传入但会被忽略
  @IsOptional()
  @IsString()
  authorName?: string;
}

export class ClaimErrandDto {
  @IsOptional()
  @IsString()
  claimerName?: string;
}

export class PublishErrandReplyDto {
  @IsString()
  content!: string;

  // 前端会传 authorName，但后端将以用户表 name 为准，这里允许传入但会被忽略
  @IsOptional()
  @IsString()
  authorName?: string;
}

export class GetMyErrandsQueryDto {
  @IsOptional()
  @IsIn(['published', 'claimed'])
  role?: 'published' | 'claimed';
}

