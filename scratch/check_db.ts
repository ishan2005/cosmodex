import { prisma } from '../src/config/db.js';

const users = await prisma.user.findMany();
const problems = await prisma.problem.findMany();
const testCases = await prisma.testCase.findMany();

console.log('\n=== DATABASE STATE ===');
console.log(`Users (${users.length}):`, users.map(u => `${u.username} [ELO: ${u.eloRating}]`).join(', ') || 'NONE');
console.log(`Problems (${problems.length}):`, problems.map(p => `${p.title} [${p.difficulty}]`).join(' | ') || 'NONE');
console.log(`Test Cases (${testCases.length})`);
console.log('======================\n');

if (users.length < 2) console.log('⚠️  MISSING: Run seed — npx tsx prisma/seed.ts');
else if (problems.length < 6) console.log('⚠️  MISSING: Run seed — npx tsx prisma/seed.ts');
else console.log('✅ Database seeded correctly!');

await prisma.$disconnect();
