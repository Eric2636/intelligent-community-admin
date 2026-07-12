import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class GetMallItemsQueryDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsIn(['time', 'price_asc', 'price_desc'])
  orderBy?: 'time' | 'price_asc' | 'price_desc';
}

export class PublishMallItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  price?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  desc?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  contact?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
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
  @IsArray()
  @ArrayMaxSize(1)
  @IsString({ each: true })
  mainImages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subImages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videos?: string[];

  /**
   * 兼容旧字段（历史版本使用 images）
   * 新版请使用 mainImages/subImages
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];
}

export class CreateMallOrderDto {
  @IsString()
  @MinLength(1)
  itemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  itemTitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  itemPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  itemUnit?: string;

  @IsString()
  @MinLength(1)
  sellerId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  contact?: string;
}

export class PatchMallOrderDto {
  @IsString()
  @IsIn(['completed', 'cancelled'])
  status!: 'completed' | 'cancelled';
}
