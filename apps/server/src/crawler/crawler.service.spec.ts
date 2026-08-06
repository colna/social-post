import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { CrawlerService } from './crawler.service';

describe('CrawlerService', () => {
  const config = {
    get: (k: string) =>
      ({ CRAWLER_BASE_URL: 'http://crawler:8000', CRAWLER_TOKEN: 'secret' })[k],
  };

  const build = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        CrawlerService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    return moduleRef.get(CrawlerService);
  };

  afterEach(() => jest.restoreAllMocks());

  it('POSTs to /crawl/{platform} with bearer token and returns json', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ account: { handle: 'nasa' }, posts: [], fetchedAt: 'x' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const service = await build();
    const res = await service.crawl('instagram', 'nasa', { maxPosts: 10 });
    expect(res.account.handle).toBe('nasa');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://crawler:8000/crawl/instagram');
    expect(init.headers.Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body)).toEqual({ handle: 'nasa', maxPosts: 10 });
  });

  it('throws ServiceUnavailable on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => 'bad gateway',
    }) as unknown as typeof fetch;
    const service = await build();
    await expect(service.crawl('instagram', 'nasa')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
