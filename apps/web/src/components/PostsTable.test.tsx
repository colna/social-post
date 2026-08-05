import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PostsTable from './PostsTable';
import type { Post } from '@/services/types';

const posts: Post[] = [
  {
    id: '1',
    accountId: 'a1',
    platformKey: 'instagram',
    shortcode: 'abc',
    url: 'https://www.instagram.com/p/abc/',
    type: 'image',
    coverUrl: 'https://x/cover.jpg',
    caption: 'hello world',
    likeCount: 12,
    commentCount: 3,
    takenAt: '2024-01-02T03:04:05Z',
    createdAt: '2024-01-02T03:04:05Z',
  },
];

describe('PostsTable', () => {
  it('renders post caption, type tag and likes', () => {
    render(
      <PostsTable
        posts={posts}
        total={1}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('hello world')).toBeInTheDocument();
    expect(screen.getByText('image')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // 原帖链接指向正确 url
    expect(screen.getByText('打开').closest('a')).toHaveAttribute(
      'href',
      'https://www.instagram.com/p/abc/',
    );
  });

  it('shows placeholder when caption empty', () => {
    render(
      <PostsTable
        posts={[{ ...posts[0], id: '2', caption: null }]}
        total={1}
        page={1}
        pageSize={20}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByText('(无文案)')).toBeInTheDocument();
  });
});
