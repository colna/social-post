import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccountService } from './account.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AccountService', () => {
  const prisma = {
    account: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    platform: { findUnique: jest.fn() },
  };

  const build = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    return moduleRef.get(AccountService);
  };

  beforeEach(() => jest.clearAllMocks());

  it('create rejects unknown/disabled platform', async () => {
    prisma.platform.findUnique.mockResolvedValue(null);
    const service = await build();
    await expect(
      service.create({ platform: 'nope', handle: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create succeeds on enabled platform', async () => {
    prisma.platform.findUnique.mockResolvedValue({ key: 'instagram', enabled: true });
    prisma.account.create.mockResolvedValue({ id: 'a1', handle: 'nasa' });
    const service = await build();
    const res = await service.create({ platform: 'instagram', handle: 'nasa' });
    expect(res.id).toBe('a1');
    expect(prisma.account.create).toHaveBeenCalledWith({
      data: { platformKey: 'instagram', handle: 'nasa' },
    });
  });

  it('create maps unique violation to ConflictException', async () => {
    prisma.platform.findUnique.mockResolvedValue({ key: 'instagram', enabled: true });
    prisma.account.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );
    const service = await build();
    await expect(
      service.create({ platform: 'instagram', handle: 'nasa' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('findById throws NotFound when missing', async () => {
    prisma.account.findUnique.mockResolvedValue(null);
    const service = await build();
    await expect(service.findById('x')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('remove deletes existing account', async () => {
    prisma.account.findUnique.mockResolvedValue({ id: 'a1' });
    prisma.account.delete.mockResolvedValue({ id: 'a1' });
    const service = await build();
    await expect(service.remove('a1')).resolves.toEqual({ ok: true });
    expect(prisma.account.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });
});
