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

  it('lists all platforms (enabled first) so disabled ones can be greyed', async () => {
    findMany.mockResolvedValue([
      { key: 'instagram', name: 'Instagram', enabled: true },
      { key: 'facebook', name: 'Facebook', enabled: false },
    ]);
    const service = await build();
    const res = await service.list();
    expect(res).toHaveLength(2);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
    });
  });
});
