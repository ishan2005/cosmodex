import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing existing data...');
  await prisma.testCase.deleteMany({});
  await prisma.submission.deleteMany({});
  await prisma.match.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.problem.deleteMany({});

  console.log('Seeding users...');
  const player1 = await prisma.user.create({
    data: {
      username: 'CodeNinja',
      email: 'ninja@cosmodex.com',
      passwordHash: '$2b$10$hashedpassword123', // dummy hash
      eloRating: 1000,
    },
  });

  const player2 = await prisma.user.create({
    data: {
      username: 'AlgoMaster',
      email: 'master@cosmodex.com',
      passwordHash: '$2b$10$hashedpassword123', // dummy hash
      eloRating: 1000,
    },
  });

  console.log('Seeding problems & test cases...');

  // Problem 1: Sum of Two Numbers (EASY)
  const p1 = await prisma.problem.create({
    data: {
      title: 'Sum of Two Numbers',
      description: 'Given two space-separated integers, print their sum.',
      difficulty: 'EASY',
      basePoints: 100,
      timeLimitSec: 2,
    },
  });

  await prisma.testCase.createMany({
    data: [
      { problemId: p1.id, input: '3 5', expected: '8', isPublic: true },
      { problemId: p1.id, input: '-1 1', expected: '0', isPublic: true },
      { problemId: p1.id, input: '0 0', expected: '0', isPublic: false },
      { problemId: p1.id, input: '100 -50', expected: '50', isPublic: false },
    ],
  });

  // Problem 2: Reverse a String (EASY)
  const p2 = await prisma.problem.create({
    data: {
      title: 'Reverse a String',
      description: 'Given a single word string, print the string reversed.',
      difficulty: 'EASY',
      basePoints: 100,
      timeLimitSec: 2,
    },
  });

  await prisma.testCase.createMany({
    data: [
      { problemId: p2.id, input: 'hello', expected: 'olleh', isPublic: true },
      { problemId: p2.id, input: 'racecar', expected: 'racecar', isPublic: true },
      { problemId: p2.id, input: 'a', expected: 'a', isPublic: false },
      { problemId: p2.id, input: 'cosmodex', expected: 'xedomsoc', isPublic: false },
    ],
  });

  // Problem 3: FizzBuzz List (MEDIUM)
  const p3 = await prisma.problem.create({
    data: {
      title: 'FizzBuzz List',
      description: 'Given an integer N, print space-separated results from 1 to N. For multiples of 3 print "Fizz", for multiples of 5 print "Buzz", for multiples of both print "FizzBuzz", else print the number.',
      difficulty: 'MEDIUM',
      basePoints: 150,
      timeLimitSec: 2,
    },
  });

  await prisma.testCase.createMany({
    data: [
      { problemId: p3.id, input: '3', expected: '1 2 Fizz', isPublic: true },
      { problemId: p3.id, input: '5', expected: '1 2 Fizz 4 Buzz', isPublic: true },
      { problemId: p3.id, input: '1', expected: '1', isPublic: false },
      { problemId: p3.id, input: '15', expected: '1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz', isPublic: false },
    ],
  });

  // Problem 4: Is Prime Number (MEDIUM)
  const p4 = await prisma.problem.create({
    data: {
      title: 'Is Prime Number',
      description: 'Given a positive integer N, print "PRIME" if N is prime, or "COMPOSITE" if it is not prime. Note: 1 is COMPOSITE.',
      difficulty: 'MEDIUM',
      basePoints: 150,
      timeLimitSec: 2,
    },
  });

  await prisma.testCase.createMany({
    data: [
      { problemId: p4.id, input: '7', expected: 'PRIME', isPublic: true },
      { problemId: p4.id, input: '4', expected: 'COMPOSITE', isPublic: true },
      { problemId: p4.id, input: '1', expected: 'COMPOSITE', isPublic: false },
      { problemId: p4.id, input: '13', expected: 'PRIME', isPublic: false },
      { problemId: p4.id, input: '25', expected: 'COMPOSITE', isPublic: false },
    ],
  });

  // Problem 5: Find Maximum Integer (MEDIUM)
  const p5 = await prisma.problem.create({
    data: {
      title: 'Find Maximum Integer',
      description: 'Given a list of space-separated integers, print the maximum value in the list.',
      difficulty: 'MEDIUM',
      basePoints: 150,
      timeLimitSec: 2,
    },
  });

  await prisma.testCase.createMany({
    data: [
      { problemId: p5.id, input: '1 5 3 9 2', expected: '9', isPublic: true },
      { problemId: p5.id, input: '-5 -10 -2 -1', expected: '-1', isPublic: true },
      { problemId: p5.id, input: '100', expected: '100', isPublic: false },
      { problemId: p5.id, input: '42 42 42', expected: '42', isPublic: false },
    ],
  });

  // Problem 6: Boss Challenge: Longest Palindromic Substring (BOSS)
  const p6 = await prisma.problem.create({
    data: {
      title: 'Longest Palindromic Substring',
      description: 'Given a single string S, find and print the longest palindromic substring in S. If there are multiple, print any of them.',
      difficulty: 'BOSS',
      basePoints: 300,
      timeLimitSec: 3,
    },
  });

  await prisma.testCase.createMany({
    data: [
      { problemId: p6.id, input: 'babad', expected: 'bab', isPublic: true }, // 'aba' is also correct, handled in evaluation logic
      { problemId: p6.id, input: 'cbbd', expected: 'bb', isPublic: true },
      { problemId: p6.id, input: 'a', expected: 'a', isPublic: false },
      { problemId: p6.id, input: 'forgeeksskeegfor', expected: 'geeksskeeg', isPublic: false },
    ],
  });

  console.log('Seeding finished successfully.');
  console.log(`Players seeded: ${player1.username} (${player1.id}), ${player2.username} (${player2.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
