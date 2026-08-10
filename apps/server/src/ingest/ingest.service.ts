import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IngestFacebookDto, IngestPostDto } from './dto/ingest-facebook.dto';

/**
 * 浏览器脚本采集入库:与 server→crawler 的拉取路径互补。
 * 由用户在已登录的 facebook.com 标签页里跑脚本,把抓到的帖子 POST 进来,
 * 走真实会话 → 规避 FB 对服务器侧自动化 GraphQL 的软封。
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestFacebook(dto: IngestFacebookDto) {
    const platformKey = 'facebook';
    // 保证 platform 行存在(ingest 自足,不依赖是否 seed 过)
    await this.prisma.platform.upsert({
      where: { key: platformKey },
      update: {},
      create: { key: platformKey, name: 'Facebook', enabled: true },
    });

    const acc = dto.account ?? {};
    const account = await this.prisma.account.upsert({
      where: { platformKey_handle: { platformKey, handle: dto.handle } },
      update: {
        displayName: acc.displayName ?? undefined,
        avatarUrl: acc.avatarUrl ?? undefined,
        externalId: acc.externalId ?? undefined,
        externalUrl: acc.externalUrl ?? undefined,
        lastCrawledAt: new Date(),
      },
      create: {
        platformKey,
        handle: dto.handle,
        displayName: acc.displayName ?? null,
        avatarUrl: acc.avatarUrl ?? null,
        externalId: acc.externalId ?? null,
        externalUrl: acc.externalUrl ?? null,
        lastCrawledAt: new Date(),
      },
    });

    let added = 0;
    for (const item of dto.posts) {
      const created = await this.upsertPost(account.id, platformKey, item);
      if (created) added += 1;
    }
    const total = await this.prisma.post.count({
      where: { accountId: account.id },
    });
    this.logger.log(
      `ingest facebook/${account.handle}: +${added}, total ${total}`,
    );
    return {
      accountId: account.id,
      handle: account.handle,
      fetched: dto.posts.length,
      added,
      total,
    };
  }

  private async upsertPost(
    accountId: string,
    platformKey: string,
    item: IngestPostDto,
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
      takenAt: item.takenAt ? new Date(item.takenAt * 1000) : null,
      raw: undefined as Prisma.InputJsonValue | undefined,
    };
    if (existing) {
      await this.prisma.post.update({ where: { id: existing.id }, data });
      return false;
    }
    await this.prisma.post.create({ data });
    return true;
  }
}
