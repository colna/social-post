import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';

// 单条帖子(浏览器脚本抓到、字段已归一为与 crawler 一致的形状)
export class IngestPostDto {
  @IsString()
  @MinLength(1)
  shortcode!: string;

  @IsString()
  url!: string;

  @IsString()
  type!: string; // image | video | carousel | reel

  @IsString()
  coverUrl!: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsInt()
  likeCount?: number;

  @IsOptional()
  @IsInt()
  commentCount?: number;

  @IsOptional()
  @IsInt()
  shareCount?: number; // 转发数

  @IsOptional()
  @IsInt()
  takenAt?: number; // unix 秒
}

export class IngestAccountDto {
  @IsOptional()
  @IsString()
  displayName?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsInt()
  followerCount?: number;

  @IsOptional()
  @IsInt()
  followingCount?: number;

  @IsOptional()
  @IsInt()
  mediaCount?: number;

  @IsOptional()
  @IsString()
  externalId?: string;

  @IsOptional()
  @IsString()
  externalUrl?: string;
}

export class IngestFacebookDto {
  @IsString()
  @MinLength(1)
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'invalid handle' })
  handle!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IngestAccountDto)
  account?: IngestAccountDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestPostDto)
  posts!: IngestPostDto[];
}
