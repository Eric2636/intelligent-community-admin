import { IsInt, IsObject, IsOptional, IsString, MinLength } from 'class-validator';

export class ReportMiniApiErrorLogDto {
  @IsString()
  @MinLength(1)
  method!: string;

  @IsString()
  @MinLength(1)
  path!: string;

  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsInt()
  statusCode?: number;

  @IsString()
  @MinLength(1)
  errorMessage!: string;

  @IsOptional()
  @IsObject()
  requestData?: Record<string, unknown>;

  @IsOptional()
  responseData?: unknown;

  @IsOptional()
  @IsString()
  stack?: string;

  @IsOptional()
  @IsString()
  platform?: string;

  @IsOptional()
  @IsString()
  appVersion?: string;

  @IsOptional()
  @IsString()
  sdkVersion?: string;

  @IsOptional()
  @IsString()
  system?: string;

  @IsOptional()
  @IsString()
  networkType?: string;
}

export class MiniApiErrorLogQueryDto {
  @IsOptional()
  page?: number;

  @IsOptional()
  pageSize?: number;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @IsInt()
  statusCode?: number;
}
