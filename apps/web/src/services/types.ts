export interface Platform {
  id: string;
  key: string;
  name: string;
  enabled: boolean;
}

export interface Account {
  id: string;
  platformKey: string;
  handle: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  followerCount?: number | null;
  followingCount?: number | null;
  mediaCount?: number | null;
  isVerified: boolean;
  isPrivate: boolean;
  externalUrl?: string | null;
  lastCrawledAt?: string | null;
}

export interface Post {
  id: string;
  accountId: string;
  platformKey: string;
  shortcode: string;
  url: string;
  type: string; // image | video | carousel | reel
  coverUrl: string;
  caption?: string | null;
  likeCount?: number | null;
  commentCount?: number | null;
  shareCount?: number | null;
  takenAt?: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CrawlResult {
  accountId: string;
  fetched: number;
  added: number;
  total: number;
}
