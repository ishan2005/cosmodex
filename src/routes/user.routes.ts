import { Router } from 'express';
import { prisma } from '../config/db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware.js';
import { logger } from '../config/logger.js';

const router = Router();

/**
 * GET /api/users/me
 * Returns the authenticated user's full profile including stats.
 * Requires Bearer token.
 */
router.get('/me', requireAuth, async (req: AuthRequest, res) => {
  const userId = req.user!.userId as string;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      eloRating: true,
      mcqEloRating: true,
      role: true,
      createdAt: true,
    },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  const [wins, totalMatches, totalSubmissions, acceptedSubmissions] = await Promise.all([
    prisma.match.count({ where: { winnerId: userId, status: 'COMPLETED' } }),
    prisma.match.count({
      where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
    }),
    prisma.submission.count({ where: { userId } }),
    prisma.submission.count({ where: { userId, status: 'ACCEPTED' } }),
  ]);

  const losses = totalMatches > 0 ? totalMatches - wins : 0;
  const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : '0.0';
  const acceptanceRate =
    totalSubmissions > 0
      ? ((acceptedSubmissions / totalSubmissions) * 100).toFixed(1)
      : '0.0';

  res.json({
    ...user,
    wins,
    losses,
    totalMatches,
    totalSubmissions,
    acceptedSubmissions,
    winRate: `${winRate}%`,
    acceptanceRate: `${acceptanceRate}%`,
  });
});

/**
 * GET /api/users
 * Public leaderboard — top 50 players sorted by ELO descending.
 */
router.get('/', async (req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      eloRating: true,
      mcqEloRating: true,
      createdAt: true,
    },
    orderBy: { eloRating: 'desc' },
    take: 50,
  });
  res.json(users);
});

/**
 * GET /api/users/:userId
 * Public user profile with ELO.
 */
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      eloRating: true,
      mcqEloRating: true,
      createdAt: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

/**
 * GET /api/users/:userId/stats
 * Win/loss count, win rate, total matches, total submissions.
 */
router.get('/:userId/stats', async (req, res) => {
  const { userId } = req.params;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true, eloRating: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const [wins, totalMatches, totalSubmissions, acceptedSubmissions] = await Promise.all([
    prisma.match.count({ where: { winnerId: userId, status: 'COMPLETED' } }),
    prisma.match.count({
      where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
    }),
    prisma.submission.count({ where: { userId } }),
    prisma.submission.count({ where: { userId, status: 'ACCEPTED' } }),
  ]);

  const losses = totalMatches > 0 ? totalMatches - wins : 0;
  const winRate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : '0.0';
  const acceptanceRate =
    totalSubmissions > 0
      ? ((acceptedSubmissions / totalSubmissions) * 100).toFixed(1)
      : '0.0';

  res.json({
    ...user,
    wins,
    losses,
    totalMatches,
    totalSubmissions,
    acceptedSubmissions,
    winRate: `${winRate}%`,
    acceptanceRate: `${acceptanceRate}%`,
  });
});

/**
 * GET /api/users/:userId/matches
 * Paginated match history for a user. Query: ?page=1&limit=10
 */
router.get('/:userId/matches', async (req, res) => {
  const { userId } = req.params;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const skip = (page - 1) * limit;

  const [matches, total] = await Promise.all([
    prisma.match.findMany({
      where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
      include: {
        player1: { select: { id: true, username: true, eloRating: true } },
        player2: { select: { id: true, username: true, eloRating: true } },
        winner: { select: { id: true, username: true } },
      },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.match.count({
      where: { OR: [{ player1Id: userId }, { player2Id: userId }] },
    }),
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
 * GET /api/users/:userId/submissions
 * Paginated submission history for a user. Query: ?page=1&limit=10
 */
router.get('/:userId/submissions', async (req, res) => {
  const { userId } = req.params;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
  const skip = (page - 1) * limit;

  const [submissions, total] = await Promise.all([
    prisma.submission.findMany({
      where: { userId },
      include: {
        problem: { select: { id: true, title: true, difficulty: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.submission.count({ where: { userId } }),
  ]);

  res.json({
    submissions,
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
 * PATCH /api/users/me
 * Update authenticated user's username. Requires Bearer token.
 */
router.patch('/me', requireAuth, async (req: AuthRequest, res) => {
  const { username } = req.body;
  if (!username || typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'username must be at least 3 characters' });
  }

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing && existing.id !== req.user!.userId) {
    return res.status(409).json({ error: 'Username is already taken' });
  }

  const updated = await prisma.user.update({
    where: { id: req.user!.userId },
    data: { username: username.trim() },
    select: { id: true, username: true, email: true, eloRating: true },
  });

  logger.info(`User ${req.user!.userId} updated username to: ${updated.username}`);
  res.json(updated);
});

export default router;
