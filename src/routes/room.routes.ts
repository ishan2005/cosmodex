import { Router } from 'express';
import { prisma } from '../config/db.js';
import { requireAuth, AuthRequest } from '../middleware/auth.middleware.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

const router = Router();

// All room routes require authentication
router.use(requireAuth);

// ── Helper: generate 8-char room code ─────────────────────────────
function generateRoomCode(): string {
  return 'COSMO-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

// ──────────────────────────────────────────────────────────────────
// CREATE ROOM
// ──────────────────────────────────────────────────────────────────

/**
 * POST /api/rooms
 * Create a new private room.
 * Body: { name, description?, mode: "code"|"mcq", maxPlayers?, totalRounds? }
 */
router.post('/', async (req: AuthRequest, res) => {
  const { name, description, mode, maxPlayers, totalRounds } = req.body;

  if (!name || !mode) {
    return res.status(400).json({ error: 'name and mode are required' });
  }

  if (!['code', 'mcq'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "code" or "mcq"' });
  }

  // Generate unique room code
  let code = generateRoomCode();
  let attempts = 0;
  while (await prisma.room.findUnique({ where: { code } })) {
    code = generateRoomCode();
    attempts++;
    if (attempts > 10) {
      return res.status(500).json({ error: 'Failed to generate unique room code' });
    }
  }

  const room = await prisma.room.create({
    data: {
      code,
      name,
      description: description || null,
      mode,
      maxPlayers: Math.min(Number(maxPlayers) || 100, 500),
      totalRounds: Number(totalRounds) || 5,
      createdById: req.user!.id,
      // Auto-add creator as participant
      participants: {
        create: {
          userId: req.user!.id,
        },
      },
    },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true, eloRating: true, mcqEloRating: true } } },
      },
      createdBy: { select: { id: true, username: true } },
    },
  });

  logger.info(`[Room] Room "${room.name}" (${room.code}) created by ${req.user!.username}`);
  res.status(201).json(room);
});

// ──────────────────────────────────────────────────────────────────
// GET ROOM BY CODE
// ──────────────────────────────────────────────────────────────────

/**
 * GET /api/rooms/:code
 * Get room details by code.
 */
router.get('/:code', async (req: AuthRequest, res) => {
  const code = (req.params['code'] as string).toUpperCase();

  const room = await prisma.room.findUnique({
    where: { code },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true, eloRating: true, mcqEloRating: true } } },
        orderBy: [{ score: 'desc' }, { wins: 'desc' }],
      },
      createdBy: { select: { id: true, username: true } },
    },
  });

  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(room);
});

// ──────────────────────────────────────────────────────────────────
// JOIN ROOM
// ──────────────────────────────────────────────────────────────────

/**
 * POST /api/rooms/:code/join
 * Join a room by code.
 */
router.post('/:code/join', async (req: AuthRequest, res) => {
  const code = (req.params['code'] as string).toUpperCase();

  const room = await prisma.room.findUnique({
    where: { code },
    include: { participants: true },
  });

  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.status !== 'WAITING') return res.status(400).json({ error: 'Room is no longer accepting participants' });
  if (room.participants.length >= room.maxPlayers) return res.status(400).json({ error: 'Room is full' });

  // Check if already joined
  const existing = room.participants.find(p => p.userId === req.user!.id);
  if (existing) {
    return res.json({ message: 'Already joined', roomId: room.id });
  }

  await prisma.roomParticipant.create({
    data: {
      roomId: room.id,
      userId: req.user!.id,
    },
  });

  // Fetch updated room
  const updatedRoom = await prisma.room.findUnique({
    where: { code },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true, eloRating: true, mcqEloRating: true } } },
        orderBy: { joinedAt: 'asc' },
      },
      createdBy: { select: { id: true, username: true } },
    },
  });

  logger.info(`[Room] ${req.user!.username} joined room "${room.name}" (${room.code})`);
  res.json(updatedRoom);
});

// ──────────────────────────────────────────────────────────────────
// START ROOM (creator only)
// ──────────────────────────────────────────────────────────────────

/**
 * POST /api/rooms/:code/start
 * Start the competition. Only the room creator can do this.
 */
router.post('/:code/start', async (req: AuthRequest, res) => {
  const code = (req.params['code'] as string).toUpperCase();

  const room = await prisma.room.findUnique({
    where: { code },
    include: { participants: true },
  });

  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.createdById !== req.user!.id) return res.status(403).json({ error: 'Only the room creator can start' });
  if (room.status !== 'WAITING') return res.status(400).json({ error: 'Room has already started or completed' });
  if (room.participants.length < 2) return res.status(400).json({ error: 'Need at least 2 participants to start' });

  const updatedRoom = await prisma.room.update({
    where: { code },
    data: {
      status: 'ACTIVE',
      currentRound: 1,
      startedAt: new Date(),
    },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true, eloRating: true, mcqEloRating: true } } },
        orderBy: { joinedAt: 'asc' },
      },
      createdBy: { select: { id: true, username: true } },
    },
  });

  logger.info(`[Room] Room "${room.name}" (${room.code}) started by ${req.user!.username} with ${room.participants.length} participants`);
  res.json(updatedRoom);
});

// ──────────────────────────────────────────────────────────────────
// LEADERBOARD
// ──────────────────────────────────────────────────────────────────

/**
 * GET /api/rooms/:code/leaderboard
 * Get the live leaderboard for a room.
 */
router.get('/:code/leaderboard', async (req: AuthRequest, res) => {
  const code = (req.params['code'] as string).toUpperCase();

  const room = await prisma.room.findUnique({
    where: { code },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true } } },
        orderBy: [{ score: 'desc' }, { wins: 'desc' }, { losses: 'asc' }],
      },
    },
  });

  if (!room) return res.status(404).json({ error: 'Room not found' });

  // Assign ranks
  const leaderboard = room.participants.map((p, i) => ({
    rank: i + 1,
    userId: p.userId,
    username: p.user.username,
    score: p.score,
    wins: p.wins,
    losses: p.losses,
    isActive: p.isActive,
  }));

  res.json({ roomCode: room.code, roomName: room.name, status: room.status, currentRound: room.currentRound, totalRounds: room.totalRounds, leaderboard });
});

// ──────────────────────────────────────────────────────────────────
// MY ROOMS
// ──────────────────────────────────────────────────────────────────

/**
 * GET /api/rooms/my/list
 * List rooms the user has created or joined.
 */
router.get('/my/list', async (req: AuthRequest, res) => {
  const userId = req.user!.id;

  const rooms = await prisma.room.findMany({
    where: {
      OR: [
        { createdById: userId },
        { participants: { some: { userId } } },
      ],
    },
    include: {
      _count: { select: { participants: true } },
      createdBy: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  res.json(rooms);
});

// ──────────────────────────────────────────────────────────────────
// END ROOM (creator only)
// ──────────────────────────────────────────────────────────────────

/**
 * POST /api/rooms/:code/end
 * End the competition. Only the room creator can do this.
 */
router.post('/:code/end', async (req: AuthRequest, res) => {
  const code = (req.params['code'] as string).toUpperCase();

  const room = await prisma.room.findUnique({ where: { code } });
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.createdById !== req.user!.id) return res.status(403).json({ error: 'Only the room creator can end' });

  const updatedRoom = await prisma.room.update({
    where: { code },
    data: { status: 'COMPLETED', endedAt: new Date() },
    include: {
      participants: {
        include: { user: { select: { id: true, username: true } } },
        orderBy: [{ score: 'desc' }, { wins: 'desc' }],
      },
    },
  });

  logger.info(`[Room] Room "${room.name}" (${room.code}) ended by ${req.user!.username}`);
  res.json(updatedRoom);
});

export default router;
