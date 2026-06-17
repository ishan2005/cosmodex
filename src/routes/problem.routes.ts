import { Router } from 'express';
import { prisma } from '../config/db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware.js';

const router = Router();

/**
 * GET /api/problems
 * Lists all seeded coding challenges. Public test cases only.
 * Query: ?difficulty=EASY|MEDIUM|HARD|BOSS
 */
router.get('/', async (req, res) => {
  const { difficulty } = req.query;

  const problems = await prisma.problem.findMany({
    where: difficulty ? { difficulty: String(difficulty).toUpperCase() } : undefined,
    include: {
      testCases: {
        where: { isPublic: true }, // Never expose private test cases via API
        select: { id: true, input: true, expected: true, isPublic: true },
      },
    },
    orderBy: [
      { difficulty: 'asc' }, // BOSS last
      { basePoints: 'asc' },
    ],
  });

  res.json(problems);
});

/**
 * GET /api/problems/:problemId
 * Get a single problem with its public test cases.
 */
router.get('/:problemId', async (req, res) => {
  const { problemId } = req.params;

  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    include: {
      testCases: {
        where: { isPublic: true },
        select: { id: true, input: true, expected: true, isPublic: true },
      },
    },
  });

  if (!problem) return res.status(404).json({ error: 'Problem not found' });
  res.json(problem);
});

/**
 * GET /api/problems/:problemId/submissions
 * Get all accepted submissions for a problem. Requires auth.
 */
router.get('/:problemId/submissions', requireAuth, async (req: AuthRequest, res) => {
  const problemId = req.params['problemId'] as string;

  const submissions = await prisma.submission.findMany({
    where: { problemId, userId: req.user!.userId as string },
    select: {
      id: true,
      status: true,
      language: true,
      passedCount: true,
      totalCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  res.json(submissions);
});

export default router;
