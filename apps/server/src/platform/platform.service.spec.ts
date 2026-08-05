import { Test } from '@nestjs/testing';
import { PlatformService } from './platform.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PlatformService', () => {
  const findMany = jest.fn();

  const build = async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PlatformService,
        { provide: PrismaService, useValue: { platform: { findMany } } },
      ],
    }).compile();
    return moduleRef.get(PlatformService);
  };

  beforeEach(() => findMany.mockReset());

  it('lists only enabled platforms ordered by createdAt', async () => {
    findMany.mockResolvedValue([{ key: 'instagram', name: 'Instagram' }]);
    const service = await build();
    const res = await service.list();
    expect(res).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });
  });
});
