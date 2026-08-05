import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { PlatformModule } from './platform/platform.module';
import { AccountModule } from './account/account.module';
import { CrawlerModule } from './crawler/crawler.module';
import { PostModule } from './post/post.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    PlatformModule,
    AccountModule,
    CrawlerModule,
    PostModule,
  ],
})
export class AppModule {}
