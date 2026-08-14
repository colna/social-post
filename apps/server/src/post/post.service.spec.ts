import { Test } from '@nestjs/testing';
import { PostService } from './post.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../account/account.service';
import { CrawlerService } from '../crawler/crawler.service';

describe('PostService', () => {
  const prisma = {
    account: { update: jest.fn() },
    post: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const accountService = { findById: jest.fn() };
  const crawler = { crawl: jest.fn() };

  const build = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PostService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountService, useValue: accountService },
        { provide: CrawlerService, useValue: crawler },
      ],
    }).compile();
    return moduleRef.get(PostService);
  };

  beforeEach(() => jest.clearAllMocks());

  it('crawlAccount backfills profile and upserts new posts', async () => {
    accountService.findById.mockResolvedValue({
      id: 'a1',
      platformKey: 'instagram',
      handle: 'nasa',
    });
    crawler.crawl.mockResolvedValue({
      account: { handle: 'nasa', displayName: 'NASA', followerCount: 100 },
      posts: [
        {
          shortcode: 'p1',
          url: 'u1',
          type: 'image',
          coverUrl: 'c1',
          shareCount: 7,
          takenAt: '2024-01-01T00:00:00Z',
        },
        { shortcode: 'p2', url: 'u2', type: 'video', coverUrl: 'c2', takenAt: null },
      ],
      fetchedAt: 'x',
    });
    prisma.account.update.mockResolvedValue({});
    prisma.post.findUnique.mockResolvedValue(null); // both new
    prisma.post.create.mockResolvedValue({});
    prisma.post.count.mockResolvedValue(2);

    const service = await build();
    const res = await service.crawlAccount('a1', { maxPosts: 30 });

    expect(crawler.crawl).toHaveBeenCalledWith('instagram', 'nasa', {
      maxPosts: 30,
    });
    expect(prisma.account.update).toHaveBeenCalledTimes(1);
    expect(prisma.post.create).toHaveBeenCalledTimes(2);
    // 转发数按序写入:p1=7、p2 无 → null
    expect(prisma.post.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ shareCount: 7 }),
    });
    expect(prisma.post.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ shareCount: null }),
    });
    expect(res).toEqual({ accountId: 'a1', fetched: 2, added: 2, total: 2 });
  });

  it('crawlAccount updates instead of creating when shortcode exists', async () => {
    accountService.findById.mockResolvedValue({
      id: 'a1',
      platformKey: 'instagram',
      handle: 'nasa',
    });
    crawler.crawl.mockResolvedValue({
      account: { handle: 'nasa' },
      posts: [{ shortcode: 'p1', url: 'u1', type: 'image', coverUrl: 'c1' }],
      fetchedAt: 'x',
    });
    prisma.account.update.mockResolvedValue({});
    prisma.post.findUnique.mockResolvedValue({ id: 'existing' });
    prisma.post.update.mockResolvedValue({});
    prisma.post.count.mockResolvedValue(1);

    const service = await build();
    const res = await service.crawlAccount('a1');
    expect(prisma.post.update).toHaveBeenCalledTimes(1);
    expect(prisma.post.create).not.toHaveBeenCalled();
    expect(res.added).toBe(0);
  });

  it('listByAccount paginates', async () => {
    accountService.findById.mockResolvedValue({ id: 'a1' });
    prisma.post.findMany.mockResolvedValue([{ id: 'x' }]);
    prisma.post.count.mockResolvedValue(1);
    const service = await build();
    const res = await service.listByAccount('a1', 2, 10);
    expect(prisma.post.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
    expect(res).toEqual({ items: [{ id: 'x' }], total: 1, page: 2, pageSize: 10 });
  });
});
