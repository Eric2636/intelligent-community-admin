import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class GetForumPostsQueryDto {
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

export class GetForumAnnouncementsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  @Type(() => Number)
  limit?: number = 5;
}

export class PublishForumPostDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videos?: string[];

  @IsOptional()
  @IsString()
  authorName?: string;

  @IsOptional()
  @IsIn(['NORMAL', 'ANNOUNCEMENT'])
  postType?: 'NORMAL' | 'ANNOUNCEMENT';

  @IsOptional()
  @IsIn(['CONTENT', 'REGISTRATION'])
  featureType?: 'CONTENT' | 'REGISTRATION';

  @IsOptional()
  @IsInt()
  @Min(1)
  registrationCapacity?: number;

  @IsOptional()
  @IsDateString()
  registrationDeadlineAt?: string;

  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsArray()
  attachments?: { mediaAssetId: string }[];
}

export class UpdateForumPostDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videos?: string[];

  @IsOptional()
  @IsArray()
  attachments?: { mediaAssetId: string }[];
}

export class PublishForumReplyDto {
  @IsOptional()
  @IsString()
  parentReplyId?: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  videos?: string[];

  @IsOptional()
  @IsString()
  authorName?: string;
}

export class SetForumReplyReactionDto {
  /** 传空字符串或省略表示取消表情 */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  emoji?: string;
}

export class SetForumPostPinnedDto {
  @IsBoolean()
  pinned!: boolean;
}
