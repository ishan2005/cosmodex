import { prisma } from '../src/config/db.js';
import { redis } from '../src/config/redis.js';
import { logger } from '../src/config/logger.js';

const PASS = '\u2705';
const FAIL = '\u274C';
const WARN = '\u26A0\uFE0F ';

interface CheckResult {
  check: string;
  pass: boolean;
  detail: string;
}

async function runChecks(): Promise<void> {
  console.log('\n============================================================');
  console.log('  COSMODEX \u2014 Infrastructure & Database Health Check');
  console.log('============================================================\n');

  const results: CheckResult[] = [];

  // --- CHECK 1: Redis Connection ---
  try {
    const pong = await redis.ping();
    results.push({
      check: 'Redis Connection (localhost:6379)',
      pass: pong === 'PONG',
      detail: pong === 'PONG'
        ? 'Redis responded PONG \u2714'
        : `Unexpected response: ${pong}`,
    });
  } catch (err: any) {
    results.push({
      check: 'Redis Connection (localhost:6379)',
      pass: false,
      detail: `FAILED: ${err.message}. Redis is not running \u2014 start it with: docker-compose up -d redis`,
    });
  }

  // --- CHECK 2: Redis Write/Read Round-trip ---
  try {
    await redis.set('cosmodex:healthcheck', 'ok', 'EX', 10);
    const val = await redis.get('cosmodex:healthcheck');
    results.push({
      check: 'Redis Read/Write Round-trip',
      pass: val === 'ok',
      detail: val === 'ok' ? 'Wrote and read key successfully' : `Expected "ok", got "${val}"`,
    });
  } catch (err: any) {
    results.push({ check: 'Redis Read/Write Round-trip', pass: false, detail: err.message });
  }

  // --- CHECK 3: Prisma / SQLite DB Connection ---
  try {
    await prisma.$connect();
    results.push({ check: 'Database (SQLite) Connection', pass: true, detail: 'Prisma connected to dev.db successfully' });
  } catch (err: any) {
    results.push({ check: 'Database (SQLite) Connection', pass: false, detail: `${err.message} \u2014 Run: npx prisma migrate dev` });
  }

  // --- CHECK 4: Users seeded ---
  try {
    const users = await prisma.user.findMany();
    const ninja = users.find((u: any) => u.username === 'CodeNinja');
    const algo = users.find((u: any) => u.username === 'AlgoMaster');
    const seeded = !!ninja && !!algo;
    results.push({
      check: 'Seed \u2014 Users (CodeNinja & AlgoMaster)',
      pass: seeded,
      detail: seeded
        ? `CodeNinja (ELO: ${ninja!.eloRating})  |  AlgoMaster (ELO: ${algo!.eloRating})`
        : `Found only: [${users.map((u: any) => u.username).join(', ') || 'NONE'}] \u2014 Run: npx tsx prisma/seed.ts`,
    });
  } catch (err: any) {
    results.push({ check: 'Seed \u2014 Users', pass: false, detail: err.message });
  }

  // --- CHECK 5: Problems seeded ---
  try {
    const problems = await prisma.problem.findMany({ include: { testCases: true } });
    const pass = problems.length >= 6;
    results.push({
      check: `Seed \u2014 Problems (found ${problems.length}/6)`,
      pass,
      detail: pass
        ? problems.map((p: any) => `${p.title} [${p.difficulty}] \u2014 ${p.testCases.length} test cases`).join('\n   ')
        : `Only ${problems.length} problem(s). Run: npx tsx prisma/seed.ts`,
    });
  } catch (err: any) {
    results.push({ check: 'Seed \u2014 Problems', pass: false, detail: err.message });
  }

  // --- CHECK 6: Test Cases seeded ---
  try {
    const tc = await prisma.testCase.findMany();
    const pass = tc.length >= 20;
    results.push({
      check: `Seed \u2014 Test Cases (found ${tc.length}/20+)`,
      pass,
      detail: pass
        ? `${tc.length} test cases present (${tc.filter((t: any) => t.isPublic).length} public, ${tc.filter((t: any) => !t.isPublic).length} hidden)`
        : `Too few test cases. Run: npx tsx prisma/seed.ts`,
    });
  } catch (err: any) {
    results.push({ check: 'Seed \u2014 Test Cases', pass: false, detail: err.message });
  }

  // --- CHECK 7: Python available (for code execution) ---
  try {
    const { exec } = await import('child_process');
    const pythonVersion = await new Promise<string>((resolve, reject) => {
      exec('python --version', (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve((stdout || stderr).trim());
      });
    });
    results.push({
      check: 'Python Runtime (for code execution)',
      pass: true,
      detail: `Found: ${pythonVersion}`,
    });
  } catch (err: any) {
    results.push({
      check: 'Python Runtime (for code execution)',
      pass: false,
      detail: `Python not found in PATH \u2014 code submissions will fail! Install from https://python.org`,
    });
  }

  // --- PRINT RESULTS ---
  console.log('Results:\n');
  let allPass = true;
  for (const r of results) {
    if (!r.pass) allPass = false;
    const icon = r.pass ? PASS : FAIL;
    console.log(`${icon}  ${r.check}`);
    const lines = r.detail.split('\n');
    for (const line of lines) {
      console.log(`   \u2514\u2500 ${line}`);
    }
    console.log();
  }

  const passed = results.filter(r => r.pass).length;
  console.log('============================================================');
  console.log(`Score: ${passed}/${results.length} checks passed`);
  console.log('');
  if (allPass) {
    console.log('\uD83C\uDF89  ALL CHECKS PASSED \u2014 System is ready!');
    console.log('');
    console.log('Run the full integration test:');
    console.log('  npx tsx scratch/verify_match.ts');
  } else {
    console.log(`${WARN} SOME CHECKS FAILED \u2014 Fix the issues above first.`);
  }
  console.log('============================================================\n');

  await prisma.$disconnect();
  try { redis.disconnect(); } catch (_) {}
  process.exit(allPass ? 0 : 1);
}

runChecks().catch((err: any) => {
  console.error('Health check crashed:', err.message);
  process.exit(1);
});
