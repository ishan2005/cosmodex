import { Server, Socket } from 'socket.io';
import { MatchmakingService, QueueEntry } from '../services/matchmaking.service.js';
import { MatchService } from '../services/match.service.js';
import { prisma } from '../config/db.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

/**
 * Socket events for the matchmaking queue:
 *
 * CLIENT → SERVER:
 *   join_queue   { userId }              — add player to the matchmaking queue
 *   leave_queue  { userId }              — remove player from the queue
 *   queue_status {}                      — ask for current queue size/wait
 *
 * SERVER → CLIENT:
 *   queue_joined  { position, size }     — confirmed in queue
 *   queue_left    {}                     — confirmed out of queue
 *   match_found   { roomId, opponentId, opponentUsername, opponentElo }
 *   queue_status  { size, avgWaitSeconds }
 *   error         { message }
 */
export function registerMatchmakingHandlers(io: Server, socket: Socket) {
  // ── JOIN QUEUE ────────────────────────────────────────────────
  socket.on('join_queue', async (payload: { userId: string }) => {
    const { userId } = payload;
    if (!userId) {
      socket.emit('error', { message: 'userId is required to join the queue' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true, eloRating: true },
    });

    if (!user) {
      socket.emit('error', { message: 'User not found' });
      return;
    }

    // BUG 6 FIX: Always join the personal user room BEFORE the opponent check.
    // Previously this only happened in the else-branch (queued path). If an opponent was
    // found immediately, this socket never joined 'user:{userId}' — meaning any future
    // match_found events targeted at this user room (e.g. from a second tab) would be missed.
    socket.join(`user:${userId}`);

    // Check if an opponent is already waiting
    const opponent = await MatchmakingService.findOpponent(userId, user.eloRating);

    if (opponent) {
      // ── MATCH FOUND ──────────────────────────────────────────
      logger.info(`[Matchmaking] Match found: ${user.username} vs ${opponent.username}`);

      // Remove both players from the queue
      await Promise.all([
        MatchmakingService.dequeue(userId),
        MatchmakingService.dequeue(opponent.userId),
      ]);

      // Fetch partitioned problems and select randomly for the 6-stage match:
      // Stage 1-2: EASY | Stage 3-4: MEDIUM | Stage 5: HARD | Stage 6: BOSS
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

      const stage1And2 = pickRandomUnique(easyProblems, 2);
      const stage3And4 = pickRandomUnique(mediumProblems, 2);
      const stage5 = pickRandomUnique(hardProblems, 1);
      const stage6 = pickRandomUnique(bossProblems, 1);

      const problemIds = [
        ...stage1And2,
        ...stage3And4,
        ...stage5,
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


      // Create the room
      const roomId = `room-${crypto.randomUUID()}`;
      const roomState = await MatchService.createRoomState(
        roomId,
        userId,
        opponent.userId,
        problemIds
      );

      // Notify both players
      const matchPayloadForCurrent = {
        roomId,
        opponentId: opponent.userId,
        opponentUsername: opponent.username,
        opponentElo: opponent.eloRating,
      };

      const matchPayloadForOpponent = {
        roomId,
        opponentId: userId,
        opponentUsername: user.username,
        opponentElo: user.eloRating,
      };

      // Emit to this socket
      socket.emit('match_found', matchPayloadForCurrent);

      // Emit to opponent's socket (if still connected)
      io.to(`user:${opponent.userId}`).emit('match_found', matchPayloadForOpponent);

      logger.info(`[Matchmaking] Room ${roomId} created for ${user.username} vs ${opponent.username}`);
    } else {
      // ── ADDED TO QUEUE ───────────────────────────────────────
      const entry: QueueEntry = {
        userId: user.id,
        username: user.username,
        eloRating: user.eloRating,
        joinedAt: Date.now(),
      };

      await MatchmakingService.enqueue(entry);

      // Personal room join already done above (before findOpponent check)
      const status = await MatchmakingService.getQueueStatus();
      socket.emit('queue_joined', {
        position: status.size,
        size: status.size,
        message: `Searching for an opponent near ELO ${user.eloRating}...`,
      });
    }
  });

  // ── LEAVE QUEUE ───────────────────────────────────────────────
  socket.on('leave_queue', async (payload: { userId: string }) => {
    const { userId } = payload;
    await MatchmakingService.dequeue(userId);
    socket.leave(`user:${userId}`);
    socket.emit('queue_left', { message: 'Left the matchmaking queue' });
  });

  // ── QUEUE STATUS ──────────────────────────────────────────────
  socket.on('queue_status', async () => {
    const status = await MatchmakingService.getQueueStatus();
    socket.emit('queue_status', status);
  });

  // ── AUTO DEQUEUE ON DISCONNECT ────────────────────────────────
  // Note: match.handler.ts handles the main disconnect event.
  // Matchmaking dequeue happens via TTL if the player disconnects without emitting leave_queue.
}
