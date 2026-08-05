import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PlatformService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.platform.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
