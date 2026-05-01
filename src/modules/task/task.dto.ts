import { IsArray, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GetTasksQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 50;
}

export class CreateTaskDto {
  @IsString()
  title!: string;

  @IsString()
  desc!: string;

  @IsString()
  reward!: string;

  @IsString()
  location!: string;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsArray()
  videos?: string[];
}

export class SaveTaskDraftDto {
  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  desc?: string;

  @IsOptional()
  @IsString()
  reward?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsArray()
  videos?: string[];
}

