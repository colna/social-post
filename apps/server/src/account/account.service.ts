import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountService {
  constructor(private readonly prisma: PrismaService) {}

  list(platform?: string) {
    return this.prisma.account.findMany({
      where: platform ? { platformKey: platform } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account) throw new NotFoundException(`account ${id} not found`);
    return account;
  }

  async create(dto: CreateAccountDto) {
    const platform = await this.prisma.platform.findUnique({
      where: { key: dto.platform },
    });
    if (!platform || !platform.enabled) {
      throw new BadRequestException(`platform ${dto.platform} not available`);
    }
    try {
      return await this.prisma.account.create({
        data: { platformKey: dto.platform, handle: dto.handle },
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `account ${dto.platform}/${dto.handle} already exists`,
        );
      }
      throw e;
    }
  }

  async remove(id: string) {
    await this.findById(id);
    await this.prisma.account.delete({ where: { id } });
    return { ok: true };
  }
}
