import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2)
  gender?: number;

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

