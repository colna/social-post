import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CrawlerProfileResult } from './crawler.types';

/**
 * 调用 Python 爬虫服务(services/crawler)。
 * server 不直接爬,统一透传 platform,新增平台无需改这里。
 */
@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return (
      this.config.get<string>('CRAWLER_BASE_URL') || 'http://localhost:8000'
    );
  }

  private get token(): string {
    return this.config.get<string>('CRAWLER_TOKEN') || '';
  }

  async crawl(
    platform: string,
    handle: string,
    maxPosts = 30,
  ): Promise<CrawlerProfileResult> {
    const url = `${this.baseUrl}/crawl/${platform}`;
    this.logger.log(`crawl ${platform}/${handle} (maxPosts=${maxPosts})`);
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ handle, maxPosts }),
      });
    } catch (e) {
      throw new ServiceUnavailableException(
        `crawler unreachable: ${(e as Error).message}`,
      );
    }
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new ServiceUnavailableException(
        `crawler error ${resp.status}: ${text.slice(0, 200)}`,
      );
    }
    return (await resp.json()) as CrawlerProfileResult;
  }
}
