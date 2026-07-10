import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Skip seeding if problems already exist (idempotent for production deploys)
  const existingCount = await prisma.problem.count();
  if (existingCount > 0) {
    console.log(`Database already has ${existingCount} problems — skipping seed.`);
    return;
  }

  console.log('No problems found. Seeding 20 new problems partitioned by difficulty…');

  const problemsData = [
    // ── EASY PROBLEMS ──
    {
      title: 'Sum of Two Numbers',
      description: 'Given two space-separated integers, print their sum.',
      difficulty: 'EASY',
      basePoints: 100,
      timeLimitSec: 2,
      testCases: [
        { input: '3 5', expected: '8', isPublic: true },
        { input: '-1 1', expected: '0', isPublic: true },
        { input: '0 0', expected: '0', isPublic: false },
        { input: '100 -50', expected: '50', isPublic: false },
      ],
    },
    {
      title: 'Reverse a String',
      description: 'Given a single word string, print the string reversed.',
      difficulty: 'EASY',
      basePoints: 100,
      timeLimitSec: 2,
      testCases: [
        { input: 'hello', expected: 'olleh', isPublic: true },
        { input: 'racecar', expected: 'racecar', isPublic: true },
        { input: 'a', expected: 'a', isPublic: false },
        { input: 'cosmodex', expected: 'xedomsoc', isPublic: false },
      ],
    },
    {
      title: 'Count Vowels',
      description: 'Given a string, count and print the total number of vowels (a, e, i, o, u, case-insensitive) in it.',
      difficulty: 'EASY',
      basePoints: 100,
      timeLimitSec: 2,
      testCases: [
        { input: 'cosmodex', expected: '3', isPublic: true },
        { input: 'AeIoU', expected: '5', isPublic: true },
        { input: 'bcdfg', expected: '0', isPublic: false },
        { input: 'hello world', expected: '3', isPublic: false },
      ],
    },
    {
      title: 'Even or Odd',
      description: 'Given an integer N, print "EVEN" if N is even, or "ODD" if N is odd.',
      difficulty: 'EASY',
      basePoints: 100,
      timeLimitSec: 2,
      testCases: [
        { input: '4', expected: 'EVEN', isPublic: true },
        { input: '7', expected: 'ODD', isPublic: true },
        { input: '0', expected: 'EVEN', isPublic: false },
        { input: '-3', expected: 'ODD', isPublic: false },
      ],
    },
    {
      title: 'Double the Number',
      description: 'Given an integer N, print N multiplied by 2.',
      difficulty: 'EASY',
      basePoints: 100,
      timeLimitSec: 2,
      testCases: [
        { input: '5', expected: '10', isPublic: true },
        { input: '-3', expected: '-6', isPublic: true },
        { input: '0', expected: '0', isPublic: false },
        { input: '1000', expected: '2000', isPublic: false },
      ],
    },

    // ── MEDIUM PROBLEMS ──
    {
      title: 'FizzBuzz List',
      description: 'Given an integer N, print space-separated results from 1 to N. For multiples of 3 print "Fizz", for multiples of 5 print "Buzz", for multiples of both print "FizzBuzz", else print the number.',
      difficulty: 'MEDIUM',
      basePoints: 150,
      timeLimitSec: 2,
      testCases: [
        { input: '3', expected: '1 2 Fizz', isPublic: true },
        { input: '5', expected: '1 2 Fizz 4 Buzz', isPublic: true },
        { input: '1', expected: '1', isPublic: false },
        { input: '15', expected: '1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz', isPublic: false },
      ],
    },
    {
      title: 'Is Prime Number',
      description: 'Given a positive integer N, print "PRIME" if N is prime, or "COMPOSITE" if it is not. Note: 1 is COMPOSITE.',
      difficulty: 'MEDIUM',
      basePoints: 150,
      timeLimitSec: 2,
      testCases: [
        { input: '7', expected: 'PRIME', isPublic: true },
        { input: '4', expected: 'COMPOSITE', isPublic: true },
        { input: '1', expected: 'COMPOSITE', isPublic: false },
        { input: '13', expected: 'PRIME', isPublic: false },
      ],
    },
    {
      title: 'Find Maximum Integer',
      description: 'Given a list of space-separated integers, print the maximum value.',
      difficulty: 'MEDIUM',
      basePoints: 150,
      timeLimitSec: 2,
      testCases: [
        { input: '1 5 3 9 2', expected: '9', isPublic: true },
        { input: '-5 -10 -2 -1', expected: '-1', isPublic: true },
        { input: '100', expected: '100', isPublic: false },
        { input: '42 42 42', expected: '42', isPublic: false },
      ],
    },
    {
      title: 'Factorial',
      description: 'Given a non-negative integer N, print the value of N! (factorial of N). N will be between 0 and 12.',
      difficulty: 'MEDIUM',
      basePoints: 150,
      timeLimitSec: 2,
      testCases: [
        { input: '5', expected: '120', isPublic: true },
        { input: '0', expected: '1', isPublic: true },
        { input: '1', expected: '1', isPublic: false },
        { input: '10', expected: '3628800', isPublic: false },
      ],
    },
    {
      title: 'Palindrome Number',
      description: 'Given an integer N, print "PALINDROME" if it reads the same backward as forward, else "NOT_PALINDROME". Negative numbers are NOT palindromes.',
      difficulty: 'MEDIUM',
      basePoints: 150,
      timeLimitSec: 2,
      testCases: [
        { input: '121', expected: 'PALINDROME', isPublic: true },
        { input: '-121', expected: 'NOT_PALINDROME', isPublic: true },
        { input: '10', expected: 'NOT_PALINDROME', isPublic: false },
        { input: '12321', expected: 'PALINDROME', isPublic: false },
      ],
    },

    // ── HARD PROBLEMS ──
    {
      title: 'Nth Fibonacci Term',
      description: 'Given an index N (0-indexed, where fib(0)=0, fib(1)=1, fib(2)=1, fib(3)=2...), print the Nth Fibonacci number.',
      difficulty: 'HARD',
      basePoints: 200,
      timeLimitSec: 2,
      testCases: [
        { input: '6', expected: '8', isPublic: true },
        { input: '0', expected: '0', isPublic: true },
        { input: '1', expected: '1', isPublic: false },
        { input: '10', expected: '55', isPublic: false },
      ],
    },
    {
      title: 'Binary to Decimal',
      description: 'Given a binary string, print its decimal (base 10) integer representation.',
      difficulty: 'HARD',
      basePoints: 200,
      timeLimitSec: 2,
      testCases: [
        { input: '1101', expected: '13', isPublic: true },
        { input: '0', expected: '0', isPublic: true },
        { input: '11111111', expected: '255', isPublic: false },
        { input: '1000000000', expected: '512', isPublic: false },
      ],
    },
    {
      title: 'Anagram Check',
      description: 'Given two space-separated words, print "ANAGRAM" if they are anagrams of each other (contain the same characters in any order, case-insensitive), or "NOT_ANAGRAM" otherwise.',
      difficulty: 'HARD',
      basePoints: 200,
      timeLimitSec: 2,
      testCases: [
        { input: 'listen silent', expected: 'ANAGRAM', isPublic: true },
        { input: 'apple pale', expected: 'NOT_ANAGRAM', isPublic: true },
        { input: 'Triangle Integral', expected: 'ANAGRAM', isPublic: false },
        { input: 'a a', expected: 'ANAGRAM', isPublic: false },
      ],
    },
    {
      title: 'Leap Year Check',
      description: 'Given a year Y, print "LEAP" if it is a leap year, or "COMMON" if it is a common year.',
      difficulty: 'HARD',
      basePoints: 200,
      timeLimitSec: 2,
      testCases: [
        { input: '2000', expected: 'LEAP', isPublic: true },
        { input: '1900', expected: 'COMMON', isPublic: true },
        { input: '2024', expected: 'LEAP', isPublic: false },
        { input: '2023', expected: 'COMMON', isPublic: false },
      ],
    },
    {
      title: 'Count Words',
      description: 'Given a sentence (words separated by one or more spaces), print the total number of words in it.',
      difficulty: 'HARD',
      basePoints: 200,
      timeLimitSec: 2,
      testCases: [
        { input: 'Hello world from Cosmodex', expected: '4', isPublic: true },
        { input: '  leading and trailing  ', expected: '3', isPublic: true },
        { input: 'one', expected: '1', isPublic: false },
        { input: 'a b c d e', expected: '5', isPublic: false },
      ],
    },

    // ── BOSS PROBLEMS ──
    {
      title: 'Longest Palindromic Substring',
      description: 'Given a single string S, find and print the longest palindromic substring. If there are multiple of equal length, print any one.',
      difficulty: 'BOSS',
      basePoints: 300,
      timeLimitSec: 3,
      testCases: [
        { input: 'babad', expected: 'bab', isPublic: true },
        { input: 'cbbd', expected: 'bb', isPublic: true },
        { input: 'a', expected: 'a', isPublic: false },
        { input: 'forgeeksskeegfor', expected: 'geeksskeeg', isPublic: false },
      ],
    },
    {
      title: 'Two Sum Indices',
      description: 'Given a space-separated list of integers on the first line, and a target sum on the second line, print the 0-based indices of the two numbers that add up to target, space-separated in ascending order.',
      difficulty: 'BOSS',
      basePoints: 300,
      timeLimitSec: 3,
      testCases: [
        { input: "2 7 11 15\n9", expected: '0 1', isPublic: true },
        { input: "3 2 4\n6", expected: '1 2', isPublic: true },
        { input: "3 3\n6", expected: '0 1', isPublic: false },
        { input: "-1 -2 -3 -4 -5\n-8", expected: '2 4', isPublic: false },
      ],
    },
    {
      title: 'Roman to Integer',
      description: 'Given a Roman numeral string, print its integer value.',
      difficulty: 'BOSS',
      basePoints: 300,
      timeLimitSec: 3,
      testCases: [
        { input: 'MCMXCIV', expected: '1994', isPublic: true },
        { input: 'III', expected: '3', isPublic: true },
        { input: 'LVIII', expected: '58', isPublic: false },
        { input: 'IX', expected: '9', isPublic: false },
      ],
    },
    {
      title: 'Length of Longest Substring',
      description: 'Given a string S, print the length of the longest substring without repeating characters.',
      difficulty: 'BOSS',
      basePoints: 300,
      timeLimitSec: 3,
      testCases: [
        { input: 'abcabcbb', expected: '3', isPublic: true },
        { input: 'bbbbb', expected: '1', isPublic: true },
        { input: 'pwwkew', expected: '3', isPublic: false },
        { input: '', expected: '0', isPublic: false },
      ],
    },
    {
      title: 'String Compression',
      description: 'Given a string, perform basic string compression using the counts of repeated characters. For example, "aabcccccaaa" becomes "a2b1c5a3". If the compressed string is not smaller than the original string, print the original string.',
      difficulty: 'BOSS',
      basePoints: 300,
      timeLimitSec: 3,
      testCases: [
        { input: 'aabcccccaaa', expected: 'a2b1c5a3', isPublic: true },
        { input: 'abcd', expected: 'abcd', isPublic: true },
        { input: 'a', expected: 'a', isPublic: false },
        { input: 'aaabbbccc', expected: 'a3b3c3', isPublic: false },
      ],
    },
  ];

  for (const prob of problemsData) {
    const { testCases, ...probFields } = prob;
    const createdProblem = await prisma.problem.create({
      data: probFields,
    });
    
    await prisma.testCase.createMany({
      data: testCases.map(tc => ({
        problemId: createdProblem.id,
        ...tc
      })),
    });
  }

  const count = await prisma.problem.count();
  console.log(`Seeding complete. ${count} problems inside the database.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
