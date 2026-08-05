// 与 services/crawler 的 HTTP 契约(camelCase)保持一致

export interface CrawlerAccountProfile {
  handle: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  followerCount?: number | null;
  followingCount?: number | null;
  mediaCount?: number | null;
  isVerified?: boolean;
  isPrivate?: boolean;
  externalUrl?: string | null;
  externalId?: string | null;
}

export interface CrawlerPostItem {
  shortcode: string;
  url: string;
  type: string; // image | video | carousel | reel
  coverUrl: string;
  caption?: string | null;
  likeCount?: number | null;
  commentCount?: number | null;
  takenAt?: string | null; // ISO
  raw?: Record<string, unknown> | null;
}

export interface CrawlerProfileResult {
  account: CrawlerAccountProfile;
  posts: CrawlerPostItem[];
  fetchedAt: string;
}
