import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PostService } from './post.service';

@Controller('accounts/:id')
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Post('crawl')
  crawl(
    @Param('id') id: string,
    // 全部选填:maxPosts 不传=不限条数;since/until 为 unix 秒,限定发布时间段
    @Body('maxPosts') maxPosts?: number,
    @Body('since') since?: number,
    @Body('until') until?: number,
  ) {
    return this.postService.crawlAccount(id, { maxPosts, since, until });
  }

  @Get('posts')
  posts(
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.postService.listByAccount(id, page, pageSize);
  }
}
