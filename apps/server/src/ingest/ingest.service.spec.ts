import { Test } from '@nestjs/testing';
import { IngestService } from './ingest.service';
import { PrismaService } from '../prisma/prisma.service';

describe('IngestService', () => {
  const prisma = {
    platform: { upsert: jest.fn() },
    account: { upsert: jest.fn() },
    post: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  const build = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        IngestService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return moduleRef.get(IngestService);
  };

  beforeEach(() => jest.clearAllMocks());

  it('ensures platform + upserts account, creates new posts, converts takenAt', async () => {
    prisma.platform.upsert.mockResolvedValue({});
    prisma.account.upsert.mockResolvedValue({ id: 'a1', handle: 'uksmartgroup' });
    prisma.post.findUnique.mockResolvedValue(null); // both new
    prisma.post.create.mockResolvedValue({});
    prisma.post.count.mockResolvedValue(2);

    const service = await build();
    const res = await service.ingestFacebook({
      handle: 'uksmartgroup',
      account: { displayName: 'The Smart Group', externalId: '100063693364145' },
      posts: [
        { shortcode: '111', url: 'u1', type: 'carousel', coverUrl: 'c1', takenAt: 1786115392 },
        { shortcode: '222', url: 'u2', type: 'video', coverUrl: 'c2' },
      ],
    });

    expect(prisma.platform.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.account.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.post.create).toHaveBeenCalledTimes(2);
    // takenAt(unix 秒) → Date(ms)
    const firstCreate = prisma.post.create.mock.calls[0][0].data;
    expect(firstCreate.takenAt).toEqual(new Date(1786115392 * 1000));
    expect(prisma.post.create.mock.calls[1][0].data.takenAt).toBeNull();
    expect(res).toEqual({
      accountId: 'a1',
      handle: 'uksmartgroup',
      fetched: 2,
      added: 2,
      total: 2,
    });
  });

  it('updates instead of creating when shortcode exists (dedup)', async () => {
    prisma.platform.upsert.mockResolvedValue({});
    prisma.account.upsert.mockResolvedValue({ id: 'a1', handle: 'uksmartgroup' });
    prisma.post.findUnique.mockResolvedValue({ id: 'existing' });
    prisma.post.update.mockResolvedValue({});
    prisma.post.count.mockResolvedValue(1);

    const service = await build();
    const res = await service.ingestFacebook({
      handle: 'uksmartgroup',
      posts: [{ shortcode: '111', url: 'u1', type: 'image', coverUrl: 'c1' }],
    });

    expect(prisma.post.update).toHaveBeenCalledTimes(1);
    expect(prisma.post.create).not.toHaveBeenCalled();
    expect(res.added).toBe(0);
  });
});
