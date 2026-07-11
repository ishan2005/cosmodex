import { Server, Socket } from 'socket.io';
import { MatchmakingService, QueueEntry, MatchMode } from '../services/matchmaking.service.js';
import { MatchService } from '../services/match.service.js';
import { McqService } from '../services/mcq.service.js';
import { RedisService } from '../services/redis.service.js';
import { prisma } from '../config/db.js';
import { logger } from '../config/logger.js';
import { activeRoomIds, activeMcqRoomIds } from '../shared/activeRooms.js';
import crypto from 'crypto';

/**
 * Socket events for the matchmaking queue:
 *
 * CLIENT → SERVER:
 *   join_queue   { userId, mode? }         — add player to the matchmaking queue ('code' | 'mcq')
 *   leave_queue  { userId }                — remove player from the queue
 *   queue_status {}                        — ask for current queue size/wait
 *
 * SERVER → CLIENT:
 *   queue_joined  { position, size, mode } — confirmed in queue
 *   queue_left    {}                       — confirmed out of queue
 *   match_found   { roomId, opponentId, opponentUsername, opponentElo, mode }
 *   queue_status  { size, avgWaitSeconds }
 *   error         { message }
 */

// ── userId ↔ socketId mapping for disconnect cleanup ─────────────
// Tracks which socket belongs to which user so we can dequeue on disconnect.
const userSocketMap = new Map<string, string>(); // userId → socketId
const socketUserMap = new Map<string, string>(); // socketId → userId

export function registerMatchmakingHandlers(io: Server, socket: Socket) {
  // ── JOIN QUEUE ────────────────────────────────────────────────
  socket.on('join_queue', async (payload: { userId: string; mode?: MatchMode }) => {
    const { userId, mode = 'code' } = payload;
    if (!userId) {
      socket.emit('error', { message: 'userId is required to join the queue' });
      return;
    }

    // Validate mode
    if (mode !== 'code' && mode !== 'mcq') {
      socket.emit('error', { message: 'mode must be "code" or "mcq"' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, eloRating: true, mcqEloRating: true },
    });

    if (!user) {
      socket.emit('error', { message: 'User not found' });
      return;
    }

    // ── GUARD: prevent duplicate queue entry ─────────────────────
    const alreadyQueued = await MatchmakingService.isInQueue(userId);
    if (alreadyQueued) {
      socket.emit('error', { message: 'You are already in the matchmaking queue' });
      return;
    }

    // ── GUARD: prevent joining queue while in an active match ────
    const activeRoomId = await RedisService.findActiveRoomForUser(userId);
    if (activeRoomId) {
      socket.emit('error', { message: 'You are already in an active match. Finish or leave it first.' });
      return;
    }

    // Track userId ↔ socketId mapping for disconnect cleanup
    userSocketMap.set(userId, socket.id);
    socketUserMap.set(socket.id, userId);

    // Always join the personal user room BEFORE the opponent check.
    socket.join(`user:${userId}`);

    // Use the appropriate ELO for the mode
    const relevantElo = mode === 'mcq' ? user.mcqEloRating : user.eloRating;

    // Check if an opponent is already waiting in the SAME mode queue
    const opponent = await MatchmakingService.findOpponent(userId, relevantElo, mode);

    if (opponent) {
      // ── MATCH FOUND ──────────────────────────────────────────
      logger.info(`[Matchmaking] ${mode.toUpperCase()} match found: ${user.username} vs ${opponent.username}`);

      // Remove both players from the queue
      await Promise.all([
        MatchmakingService.dequeue(userId, mode),
        MatchmakingService.dequeue(opponent.userId, mode),
      ]);

      const roomId = `room-${crypto.randomUUID()}`;

      if (mode === 'mcq') {
        // ── MCQ Battle: create MCQ room ──────────────────────────
        await McqService.createMcqRoom(roomId, userId, opponent.userId);
        activeMcqRoomIds.add(roomId); // Track for MCQ background timer
        logger.info(`[Matchmaking] MCQ Room ${roomId} created for ${user.username} vs ${opponent.username}`);
      } else {
        // ── Code Battle: create Code room (existing logic) ──────
        // Fetch partitioned problems and select randomly for the 6-stage match:
        // Stage 1-2: EASY | Stage 3: MEDIUM | Stage 4-5: HARD | Stage 6: BOSS
        const [easyProblems, mediumProblems, hardProblems, bossProblems] = await Promise.all([
          prisma.problem.findMany({ where: { difficulty: 'EASY' }, select: { id: true } }),
          prisma.problem.findMany({ where: { difficulty: 'MEDIUM' }, select: { id: true } }),
          prisma.problem.findMany({ where: { difficulty: 'HARD' }, select: { id: true } }),
          prisma.problem.findMany({ where: { difficulty: 'BOSS' }, select: { id: true } }),
        ]);

        function pickRandomUnique(arr: { id: string }[], n: number): string[] {
          const shuffled = [...arr].sort(() => 0.5 - Math.random());
          return shuffled.slice(0, n).map(p => p.id);
        }

        const stage1And2 = pickRandomUnique(easyProblems, 2);   // 2 EASY
        const stage3     = pickRandomUnique(mediumProblems, 1);  // 1 MEDIUM
        const stage4And5 = pickRandomUnique(hardProblems, 2);    // 2 HARD
        const stage6     = pickRandomUnique(bossProblems, 1);    // 1 BOSS

        const problemIds = [
          ...stage1And2,
          ...stage3,
          ...stage4And5,
          ...stage6
        ];

        // Fallback: If for any reason we don't have 6 problems, select any problems ordered by difficulty
        if (problemIds.length < 6 || problemIds.some(id => !id)) {
          logger.warn('[Matchmaking] Database does not contain enough problems for random selection. Using fallback.');
          const allProbs = await prisma.problem.findMany({
            select: { id: true, difficulty: true },
          });
          const DIFFICULTY_RANK: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3, BOSS: 4 };
          allProbs.sort((a, b) => (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99));
          problemIds.length = 0;
          problemIds.push(...allProbs.map(p => p.id).slice(0, 6));
        }

        await MatchService.createRoomState(roomId, userId, opponent.userId, problemIds);
        logger.info(`[Matchmaking] Code Room ${roomId} created for ${user.username} vs ${opponent.username}`);
      }

      // Notify both players (include mode so client knows which arena to open)
      const matchPayloadForCurrent = {
        roomId,
        opponentId: opponent.userId,
        opponentUsername: opponent.username,
        opponentElo: opponent.eloRating,
        mode,
      };

      const matchPayloadForOpponent = {
        roomId,
        opponentId: userId,
        opponentUsername: user.username,
        opponentElo: relevantElo,
        mode,
      };

      // Emit to this socket
      socket.emit('match_found', matchPayloadForCurrent);

      // Emit to opponent's socket (if still connected)
      io.to(`user:${opponent.userId}`).emit('match_found', matchPayloadForOpponent);

    } else {
      // ── ADDED TO QUEUE ───────────────────────────────────────
      const entry: QueueEntry = {
        userId: user.id,
        username: user.username,
        eloRating: relevantElo,
        joinedAt: Date.now(),
        mode,
      };

      await MatchmakingService.enqueue(entry);

      // Personal room join already done above (before findOpponent check)
      const status = await MatchmakingService.getQueueStatus(mode);
      socket.emit('queue_joined', {
        position: status.size,
        size: status.size,
        mode,
        message: `Searching for a ${mode === 'mcq' ? 'MCQ' : 'Code'} opponent near ELO ${relevantElo}...`,
      });
    }
  });

  // ── LEAVE QUEUE ───────────────────────────────────────────────
  socket.on('leave_queue', async (payload: { userId: string }) => {
    const { userId } = payload;
    await MatchmakingService.dequeue(userId); // removes from both queues
    socket.leave(`user:${userId}`);

    // Clean up tracking maps
    userSocketMap.delete(userId);
    socketUserMap.delete(socket.id);

    socket.emit('queue_left', { message: 'Left the matchmaking queue' });
  });

  // ── QUEUE STATUS ──────────────────────────────────────────────
  socket.on('queue_status', async (payload?: { mode?: MatchMode }) => {
    const mode = payload?.mode || 'code';
    const status = await MatchmakingService.getQueueStatus(mode);
    socket.emit('queue_status', { ...status, mode });
  });

  // ── AUTO DEQUEUE ON DISCONNECT ────────────────────────────────
  // Explicitly dequeue the player instead of relying on 2-minute TTL.
  // This prevents ghost players from matching with real ones.
  socket.on('disconnect', async () => {
    const userId = socketUserMap.get(socket.id);
    if (userId) {
      const wasQueued = await MatchmakingService.isInQueue(userId);
      if (wasQueued) {
        await MatchmakingService.dequeue(userId);
        logger.info(`[Matchmaking] Auto-dequeued ${userId} on socket disconnect`);
      }
      userSocketMap.delete(userId);
      socketUserMap.delete(socket.id);
    }
  });
}
