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
    @Body('maxPosts', new DefaultValuePipe(30), ParseIntPipe) maxPosts: number,
  ) {
    return this.postService.crawlAccount(id, maxPosts);
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
