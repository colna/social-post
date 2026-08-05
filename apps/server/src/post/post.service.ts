import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountService } from '../account/account.service';
import { CrawlerService } from '../crawler/crawler.service';
import { CrawlerPostItem } from '../crawler/crawler.types';

@Injectable()
export class PostService {
  private readonly logger = new Logger(PostService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountService: AccountService,
    private readonly crawler: CrawlerService,
  ) {}

  /**
   * 触发抓取:调用 crawler → 回填账户画像 → upsert 帖子(按 shortcode 去重)。
   */
  async crawlAccount(accountId: string, maxPosts = 30) {
    const account = await this.accountService.findById(accountId);
    const result = await this.crawler.crawl(
      account.platformKey,
      account.handle,
      maxPosts,
    );

    // 回填账户画像
    const p = result.account;
    await this.prisma.account.update({
      where: { id: account.id },
      data: {
        displayName: p.displayName ?? undefined,
        avatarUrl: p.avatarUrl ?? undefined,
        bio: p.bio ?? undefined,
        followerCount: p.followerCount ?? undefined,
        followingCount: p.followingCount ?? undefined,
        mediaCount: p.mediaCount ?? undefined,
        isVerified: p.isVerified ?? false,
        isPrivate: p.isPrivate ?? false,
        externalUrl: p.externalUrl ?? undefined,
        externalId: p.externalId ?? undefined,
        lastCrawledAt: new Date(),
      },
    });

    // upsert 帖子
    let added = 0;
    for (const item of result.posts) {
      const created = await this.upsertPost(account.id, account.platformKey, item);
      if (created) added += 1;
    }

    const total = await this.prisma.post.count({
      where: { accountId: account.id },
    });
    this.logger.log(
      `crawled ${account.platformKey}/${account.handle}: +${added}, total ${total}`,
    );
    return { accountId: account.id, fetched: result.posts.length, added, total };
  }

  private async upsertPost(
    accountId: string,
    platformKey: string,
    item: CrawlerPostItem,
  ): Promise<boolean> {
    const existing = await this.prisma.post.findUnique({
      where: {
        platformKey_shortcode: { platformKey, shortcode: item.shortcode },
      },
      select: { id: true },
    });
    const data = {
      accountId,
      platformKey,
      shortcode: item.shortcode,
      url: item.url,
      type: item.type,
      coverUrl: item.coverUrl,
      caption: item.caption ?? null,
      likeCount: item.likeCount ?? null,
      commentCount: item.commentCount ?? null,
      takenAt: item.takenAt ? new Date(item.takenAt) : null,
      raw: (item.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    };
    if (existing) {
      await this.prisma.post.update({ where: { id: existing.id }, data });
      return false;
    }
    await this.prisma.post.create({ data });
    return true;
  }

  async listByAccount(accountId: string, page = 1, pageSize = 20) {
    await this.accountService.findById(accountId);
    const skip = (Math.max(1, page) - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where: { accountId },
        orderBy: [{ takenAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.post.count({ where: { accountId } }),
    ]);
    return { items, total, page, pageSize };
  }
}
