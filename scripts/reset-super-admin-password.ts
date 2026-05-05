import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const password = 'admin123456';
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await prisma.adminUser.updateMany({
    where: { role: 'SUPERADMIN' },
    data: { passwordHash },
  });
  if (result.count === 0) {
    console.error('未找到 role 为 SUPERADMIN 的管理员，请先创建超级管理员。');
    process.exitCode = 1;
    return;
  }
  console.log(`已重置 ${result.count} 个超级管理员密码（bcrypt cost=10）。`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
