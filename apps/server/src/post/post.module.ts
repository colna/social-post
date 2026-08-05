import { Module } from '@nestjs/common';
import { PostService } from './post.service';
import { PostController } from './post.controller';
import { AccountModule } from '../account/account.module';
import { CrawlerModule } from '../crawler/crawler.module';

@Module({
  imports: [AccountModule, CrawlerModule],
  controllers: [PostController],
  providers: [PostService],
})
export class PostModule {}
