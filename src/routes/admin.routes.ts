import { Router } from 'express';
import { prisma } from '../config/db.js';
import { requireAuth, requireAdmin, AuthRequest } from '../middleware/auth.middleware.js';
import { logger } from '../config/logger.js';

const router = Router();

// All admin routes require authentication + admin role
router.use(requireAuth, requireAdmin);

// ──────────────────────────────────────────────────────────────────
// DASHBOARD STATS
// ──────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/stats
 * Returns counts of problems by difficulty, total users, total matches.
 */
router.get('/stats', async (req: AuthRequest, res) => {
  const [totalProblems, easyCount, mediumCount, hardCount, bossCount, totalUsers, totalMatches] =
    await Promise.all([
      prisma.problem.count(),
      prisma.problem.count({ where: { difficulty: 'EASY' } }),
      prisma.problem.count({ where: { difficulty: 'MEDIUM' } }),
      prisma.problem.count({ where: { difficulty: 'HARD' } }),
      prisma.problem.count({ where: { difficulty: 'BOSS' } }),
      prisma.user.count(),
      prisma.match.count(),
    ]);

  res.json({
    problems: { total: totalProblems, easy: easyCount, medium: mediumCount, hard: hardCount, boss: bossCount },
    users: totalUsers,
    matches: totalMatches,
  });
});

// ──────────────────────────────────────────────────────────────────
// PROBLEM CRUD
// ──────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/problems
 * List all problems with ALL test cases (including private ones).
 */
router.get('/problems', async (req: AuthRequest, res) => {
  const { difficulty } = req.query;

  const problems = await prisma.problem.findMany({
    where: difficulty ? { difficulty: String(difficulty).toUpperCase() } : undefined,
    include: {
      testCases: {
        select: { id: true, input: true, expected: true, isPublic: true },
      },
      _count: { select: { submissions: true } },
    },
    orderBy: [{ difficulty: 'asc' }, { basePoints: 'asc' }],
  });

  res.json(problems);
});

/**
 * GET /api/admin/problems/:id
 * Get a single problem with ALL test cases.
 */
router.get('/problems/:id', async (req: AuthRequest, res) => {
  const id = req.params['id'] as string;
  const problem = await prisma.problem.findUnique({
    where: { id },
    include: {
      testCases: true,
      _count: { select: { submissions: true } },
    },
  });

  if (!problem) return res.status(404).json({ error: 'Problem not found' });
  res.json(problem);
});

/**
 * POST /api/admin/problems
 * Create a new problem with test cases.
 * Body: { title, description, difficulty, basePoints, timeLimitSec?, memoryLimitMb?, testCases: [{input, expected, isPublic}] }
 */
router.post('/problems', async (req: AuthRequest, res) => {
  const { title, description, difficulty, basePoints, timeLimitSec, memoryLimitMb, testCases } = req.body;

  if (!title || !description || !difficulty || basePoints === undefined) {
    return res.status(400).json({ error: 'title, description, difficulty, and basePoints are required' });
  }

  const validDifficulties = ['EASY', 'MEDIUM', 'HARD', 'BOSS'];
  if (!validDifficulties.includes(difficulty.toUpperCase())) {
    return res.status(400).json({ error: `difficulty must be one of: ${validDifficulties.join(', ')}` });
  }

  const problem = await prisma.problem.create({
    data: {
      title,
      description,
      difficulty: difficulty.toUpperCase(),
      basePoints: Number(basePoints),
      timeLimitSec: Number(timeLimitSec) || 2,
      memoryLimitMb: Number(memoryLimitMb) || 128,
      testCases: {
        create: (testCases || []).map((tc: { input: string; expected: string; isPublic?: boolean }) => ({
          input: tc.input,
          expected: tc.expected,
          isPublic: tc.isPublic ?? false,
        })),
      },
    },
    include: { testCases: true },
  });

  logger.info(`[Admin] Problem created: "${problem.title}" (${problem.id}) by ${req.user!.username}`);
  res.status(201).json(problem);
});

/**
 * PUT /api/admin/problems/:id
 * Update a problem's fields (does NOT touch test cases — use separate endpoints for those).
 * Body: { title?, description?, difficulty?, basePoints?, timeLimitSec?, memoryLimitMb? }
 */
router.put('/problems/:id', async (req: AuthRequest, res) => {
  const id = req.params['id'] as string;
  const { title, description, difficulty, basePoints, timeLimitSec, memoryLimitMb } = req.body;

  const data: Record<string, any> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (difficulty !== undefined) data.difficulty = difficulty.toUpperCase();
  if (basePoints !== undefined) data.basePoints = Number(basePoints);
  if (timeLimitSec !== undefined) data.timeLimitSec = Number(timeLimitSec);
  if (memoryLimitMb !== undefined) data.memoryLimitMb = Number(memoryLimitMb);

  const problem = await prisma.problem.update({
    where: { id },
    data,
    include: { testCases: true },
  });

  logger.info(`[Admin] Problem updated: "${problem.title}" (${problem.id}) by ${req.user!.username}`);
  res.json(problem);
});

/**
 * DELETE /api/admin/problems/:id
 * Delete a problem and its test cases (cascade).
 */
router.delete('/problems/:id', async (req: AuthRequest, res) => {
  const id = req.params['id'] as string;
  const problem = await prisma.problem.findUnique({ where: { id } });
  if (!problem) return res.status(404).json({ error: 'Problem not found' });

  await prisma.problem.delete({ where: { id } });

  logger.info(`[Admin] Problem deleted: "${problem.title}" (${problem.id}) by ${req.user!.username}`);
  res.json({ message: `Problem "${problem.title}" deleted` });
});

// ──────────────────────────────────────────────────────────────────
// TEST CASE MANAGEMENT
// ──────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/problems/:id/test-cases
 * Add a test case to a problem.
 * Body: { input, expected, isPublic? }
 */
router.post('/problems/:id/test-cases', async (req: AuthRequest, res) => {
  const id = req.params['id'] as string;
  const { input, expected, isPublic } = req.body;

  if (input === undefined || expected === undefined) {
    return res.status(400).json({ error: 'input and expected are required' });
  }

  const problem = await prisma.problem.findUnique({ where: { id } });
  if (!problem) return res.status(404).json({ error: 'Problem not found' });

  const testCase = await prisma.testCase.create({
    data: {
      problemId: id,
      input: String(input),
      expected: String(expected),
      isPublic: isPublic ?? false,
    },
  });

  logger.info(`[Admin] Test case added to "${problem.title}" by ${req.user!.username}`);
  res.status(201).json(testCase);
});

/**
 * DELETE /api/admin/test-cases/:id
 * Delete a single test case.
 */
router.delete('/test-cases/:id', async (req: AuthRequest, res) => {
  const id = req.params['id'] as string;
  const tc = await prisma.testCase.findUnique({ where: { id } });
  if (!tc) return res.status(404).json({ error: 'Test case not found' });

  await prisma.testCase.delete({ where: { id } });

  logger.info(`[Admin] Test case ${id} deleted by ${req.user!.username}`);
  res.json({ message: 'Test case deleted' });
});

// ──────────────────────────────────────────────────────────────────
// USER ROLE MANAGEMENT
// ──────────────────────────────────────────────────────────────────

/**
 * PATCH /api/admin/users/:userId/role
 * Promote or demote a user. Body: { role: "ADMIN" | "USER" }
 */
router.patch('/users/:userId/role', async (req: AuthRequest, res) => {
  const userId = req.params['userId'] as string;
  const { role } = req.body;
  if (!role || !['USER', 'ADMIN'].includes(role.toUpperCase())) {
    return res.status(400).json({ error: 'role must be "USER" or "ADMIN"' });
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: { role: role.toUpperCase() },
    select: { id: true, username: true, email: true, role: true },
  });

  logger.info(`[Admin] User ${user.username} role changed to ${user.role} by ${req.user!.username}`);
  res.json(user);
});

/**
 * GET /api/admin/users
 * List all users with their roles.
 */
router.get('/users', async (req: AuthRequest, res) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, email: true, role: true, eloRating: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(users);
});

export default router;
