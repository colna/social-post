import type {
  Account,
  CrawlResult,
  Paginated,
  Platform,
  Post,
} from './types';

const BASE = process.env.UMI_APP_API_BASE || '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!resp.ok) {
    let msg = `${resp.status}`;
    try {
      const body = await resp.json();
      msg = body?.message || msg;
    } catch {
      // ignore
    }
    throw new Error(Array.isArray(msg) ? msg.join(', ') : msg);
  }
  // DELETE 可能无 body
  const text = await resp.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  platforms: () => request<Platform[]>('/platforms'),

  accounts: (platform: string) =>
    request<Account[]>(`/accounts?platform=${encodeURIComponent(platform)}`),

  createAccount: (platform: string, handle: string) =>
    request<Account>('/accounts', {
      method: 'POST',
      body: JSON.stringify({ platform, handle }),
    }),

  deleteAccount: (id: string) =>
    request<{ ok: boolean }>(`/accounts/${id}`, { method: 'DELETE' }),

  crawl: (id: string, maxPosts = 30) =>
    request<CrawlResult>(`/accounts/${id}/crawl`, {
      method: 'POST',
      body: JSON.stringify({ maxPosts }),
    }),

  posts: (id: string, page = 1, pageSize = 20) =>
    request<Paginated<Post>>(
      `/accounts/${id}/posts?page=${page}&pageSize=${pageSize}`,
    ),
};
