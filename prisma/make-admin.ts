/**
 * Utility script to promote a user to ADMIN role.
 *
 * Usage:
 *   npx tsx prisma/make-admin.ts <email>
 *
 * Example:
 *   npx tsx prisma/make-admin.ts admin@cosmodex.com
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];

  if (!email) {
    console.error('Usage: npx tsx prisma/make-admin.ts <email>');
    console.error('Example: npx tsx prisma/make-admin.ts admin@cosmodex.com');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.error(`❌ User with email "${email}" not found.`);
    console.error('\nRegistered users:');
    const users = await prisma.user.findMany({ select: { email: true, username: true, role: true } });
    users.forEach(u => console.log(`  ${u.email} (${u.username}) — ${u.role}`));
    process.exit(1);
  }

  if (user.role === 'ADMIN') {
    console.log(`✅ ${user.username} (${user.email}) is already an ADMIN.`);
    return;
  }

  await prisma.user.update({
    where: { email },
    data: { role: 'ADMIN' },
  });

  console.log(`✅ ${user.username} (${user.email}) has been promoted to ADMIN.`);
  console.log(`\nThey can now log in and access /admin.html to manage problems.`);
}

main()
  .catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
