import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    // 返回全部平台(含禁用),前端把 enabled=false 的置灰展示
    return this.prisma.platform.findMany({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
    });
  }
}
