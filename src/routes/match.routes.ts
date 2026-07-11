import { Router } from 'express';
import { prisma } from '../config/db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware.js';

const router = Router();

/**
 * GET /api/matches
 * List recent completed matches (global match feed).
 * Public endpoint. Query: ?page=1&limit=10&status=COMPLETED
 */
router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const skip = (page - 1) * limit;
  const status = (req.query.status as string)?.toUpperCase();

  const where = status ? { status } : undefined;

  const [matches, total] = await Promise.all([
    prisma.match.findMany({
      where,
      include: {
        player1: { select: { id: true, username: true, eloRating: true } },
        player2: { select: { id: true, username: true, eloRating: true } },
        winner: { select: { id: true, username: true } },
      },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.match.count({ where }),
  ]);

  res.json({
    matches,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
    },
  });
});

/**
 * GET /api/matches/mcq/list
 * List recent MCQ matches (global MCQ match feed).
 * Public endpoint. Query: ?page=1&limit=10
 */
router.get('/mcq/list', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const skip = (page - 1) * limit;

  const [matches, total] = await Promise.all([
    prisma.mcqMatch.findMany({
      where: { status: 'COMPLETED' },
      include: {
        player1: { select: { id: true, username: true, mcqEloRating: true } },
        player2: { select: { id: true, username: true, mcqEloRating: true } },
        winner: { select: { id: true, username: true } },
      },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.mcqMatch.count({ where: { status: 'COMPLETED' } }),
  ]);

  res.json({
    matches,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
    },
  });
});

/**
 * GET /api/matches/:matchId
 * Fetch a single match by ID with full details.
 * Public endpoint — useful for match detail/replay screens.
 */
router.get('/:matchId', async (req, res) => {
  const matchId = req.params['matchId'] as string;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      player1: { select: { id: true, username: true, eloRating: true } },
      player2: { select: { id: true, username: true, eloRating: true } },
      winner: { select: { id: true, username: true } },
      submissions: {
        select: {
          id: true,
          userId: true,
          problemId: true,
          language: true,
          status: true,
          passedCount: true,
          totalCount: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json(match);
});

/**
 * GET /api/matches/:matchId/submissions
 * Fetch all submissions for a specific match.
 * Requires auth — only participants can view full submissions.
 */
router.get('/:matchId/submissions', requireAuth, async (req: AuthRequest, res) => {
  const matchId = req.params['matchId'] as string;
  const userId = req.user!.userId as string;

  const match = await prisma.match.findUnique({
    where: { id: matchId },
    select: { player1Id: true, player2Id: true },
  });

  if (!match) return res.status(404).json({ error: 'Match not found' });

  // Only participants can view submissions with code
  const isParticipant = match.player1Id === userId || match.player2Id === userId;

  const submissions = await prisma.submission.findMany({
    where: { matchId },
    select: {
      id: true,
      userId: true,
      problemId: true,
      code: isParticipant, // Only show code to participants
      language: true,
      status: true,
      passedCount: true,
      totalCount: true,
      createdAt: true,
      user: { select: { id: true, username: true } },
      problem: { select: { id: true, title: true, difficulty: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  res.json(submissions);
});

export default router;
