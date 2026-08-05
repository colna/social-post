import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 内置平台。新增平台在此追加一行(并在 crawler 侧实现适配器)。
const PLATFORMS = [
  { key: 'instagram', name: 'Instagram', enabled: true },
  { key: 'facebook', name: 'Facebook', enabled: false }, // 未支持,前端置灰
];

async function main() {
  for (const p of PLATFORMS) {
    await prisma.platform.upsert({
      where: { key: p.key },
      update: { name: p.name, enabled: p.enabled },
      create: p,
    });
    console.log(`seeded platform: ${p.key}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
