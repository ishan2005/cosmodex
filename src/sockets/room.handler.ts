import { Server, Socket } from 'socket.io';
import { prisma } from '../config/db.js';
import { MatchService } from '../services/match.service.js';
import { McqService } from '../services/mcq.service.js';
import { logger } from '../config/logger.js';
import { activeRoomIds, activeMcqRoomIds } from '../shared/activeRooms.js';
import crypto from 'crypto';

/**
 * Socket events for Private Rooms:
 *
 * CLIENT → SERVER:
 *   room:join        { roomCode }                       — join socket room for real-time updates
 *   room:leave       { roomCode }                       — leave socket room
 *   room:start_round { roomCode }                       — creator starts the next round
 *
 * SERVER → CLIENT:
 *   room:player_joined  { userId, username, participantCount }
 *   room:player_left    { userId, username, participantCount }
 *   room:state          { room, participants, leaderboard }  — full room state refresh
 *   room:round_starting { round, totalRounds, pairings, byeUserId? }
 *   room:match_assigned { matchRoomId, opponentId, opponentUsername, mode }
 *   room:round_ended    { round, leaderboard }
 *   room:competition_ended { finalLeaderboard, winnerId, winnerUsername }
 *   error              { message }
 */

// Track which socket is in which room code for cleanup on disconnect
const socketRoomMap = new Map<string, string>(); // socketId → roomCode

export function registerRoomHandlers(io: Server, socket: Socket) {

  // ── JOIN ROOM (Socket.IO room for real-time updates) ───────────
  socket.on('room:join', async (payload: { roomCode: string }) => {
    const { roomCode } = payload;
    if (!roomCode) {
      socket.emit('error', { message: 'roomCode is required' });
      return;
    }

    const code = roomCode.toUpperCase();
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

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    // Join the Socket.IO room named after the room code
    const socketRoomName = `private-room:${code}`;
    socket.join(socketRoomName);
    socketRoomMap.set(socket.id, code);

    logger.info(`[Room Handler] Socket ${socket.id} joined room ${code}`);

    // Send full state to the joining client
    socket.emit('room:state', {
      room: {
        id: room.id,
        code: room.code,
        name: room.name,
        description: room.description,
        mode: room.mode,
        status: room.status,
        maxPlayers: room.maxPlayers,
        totalRounds: room.totalRounds,
        currentRound: room.currentRound,
        createdById: room.createdById,
        createdBy: room.createdBy,
        createdAt: room.createdAt,
        startedAt: room.startedAt,
      },
      participants: room.participants.map(p => ({
        userId: p.userId,
        username: p.user.username,
        eloRating: room.mode === 'mcq' ? p.user.mcqEloRating : p.user.eloRating,
        score: p.score,
        wins: p.wins,
        losses: p.losses,
        isActive: p.isActive,
      })),
    });

    // Notify others in the room
    const userId = socket.data.userId;
    const username = socket.data.username;
    if (userId && username) {
      socket.to(socketRoomName).emit('room:player_joined', {
        userId,
        username,
        participantCount: room.participants.length,
      });
    }
  });

  // ── LEAVE ROOM ─────────────────────────────────────────────────
  socket.on('room:leave', async (payload: { roomCode: string }) => {
    const { roomCode } = payload;
    if (!roomCode) return;

    const code = roomCode.toUpperCase();
    const socketRoomName = `private-room:${code}`;
    socket.leave(socketRoomName);
    socketRoomMap.delete(socket.id);

    const userId = socket.data.userId;
    const username = socket.data.username;
    if (userId && username) {
      const room = await prisma.room.findUnique({
        where: { code },
        include: { _count: { select: { participants: true } } },
      });

      io.to(socketRoomName).emit('room:player_left', {
        userId,
        username,
        participantCount: room?._count.participants ?? 0,
      });
    }

    logger.info(`[Room Handler] Socket ${socket.id} left room ${code}`);
  });

  // ── START ROUND (creator only) ─────────────────────────────────
  socket.on('room:start_round', async (payload: { roomCode: string }) => {
    const { roomCode } = payload;
    if (!roomCode) {
      socket.emit('error', { message: 'roomCode is required' });
      return;
    }

    const code = roomCode.toUpperCase();
    const userId = socket.data.userId;
    if (!userId) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const room = await prisma.room.findUnique({
      where: { code },
      include: {
        participants: {
          where: { isActive: true },
          include: { user: { select: { id: true, username: true, eloRating: true, mcqEloRating: true } } },
        },
      },
    });

    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (room.createdById !== userId) {
      socket.emit('error', { message: 'Only the room creator can start rounds' });
      return;
    }

    if (room.status === 'COMPLETED') {
      socket.emit('error', { message: 'Competition has already ended' });
      return;
    }

    const activeParticipants = room.participants.filter(p => p.isActive);
    if (activeParticipants.length < 2) {
      socket.emit('error', { message: 'Need at least 2 active participants' });
      return;
    }

    const nextRound = room.currentRound + 1;

    if (nextRound > room.totalRounds) {
      socket.emit('error', { message: 'All rounds have been completed' });
      return;
    }

    // Update room status and round
    await prisma.room.update({
      where: { code },
      data: {
        status: 'ACTIVE',
        currentRound: nextRound,
        ...(nextRound === 1 ? { startedAt: new Date() } : {}),
      },
    });

    // ── PAIRING LOGIC ────────────────────────────────────────────
    // Shuffle participants and pair them
    const shuffled = [...activeParticipants].sort(() => Math.random() - 0.5);
    const pairings: { player1: typeof shuffled[0]; player2: typeof shuffled[0]; matchRoomId: string }[] = [];
    let byeParticipant: typeof shuffled[0] | null = null;

    for (let i = 0; i < shuffled.length - 1; i += 2) {
      const matchRoomId = `room-${crypto.randomUUID()}`;
      pairings.push({
        player1: shuffled[i],
        player2: shuffled[i + 1],
        matchRoomId,
      });
    }

    // Odd player gets a bye
    if (shuffled.length % 2 !== 0) {
      byeParticipant = shuffled[shuffled.length - 1];
    }

    const socketRoomName = `private-room:${code}`;

    // Notify everyone of round starting
    io.to(socketRoomName).emit('room:round_starting', {
      round: nextRound,
      totalRounds: room.totalRounds,
      pairings: pairings.map(p => ({
        player1: { userId: p.player1.userId, username: p.player1.user.username },
        player2: { userId: p.player2.userId, username: p.player2.user.username },
      })),
      byeUserId: byeParticipant?.userId ?? null,
      byeUsername: byeParticipant?.user.username ?? null,
    });

    // ── CREATE MATCHES for each pair ─────────────────────────────
    for (const pair of pairings) {
      const { player1, player2, matchRoomId } = pair;

      try {
        if (room.mode === 'mcq') {
          // MCQ match
          await McqService.createMcqRoom(matchRoomId, player1.userId, player2.userId);
          activeMcqRoomIds.add(matchRoomId);
          logger.info(`[Room] MCQ match ${matchRoomId} created: ${player1.user.username} vs ${player2.user.username}`);
        } else {
          // Code match — fetch problems for a 6-stage match
          const [easyProblems, mediumProblems, hardProblems, bossProblems] = await Promise.all([
            prisma.problem.findMany({ where: { difficulty: 'EASY' }, select: { id: true } }),
            prisma.problem.findMany({ where: { difficulty: 'MEDIUM' }, select: { id: true } }),
            prisma.problem.findMany({ where: { difficulty: 'HARD' }, select: { id: true } }),
            prisma.problem.findMany({ where: { difficulty: 'BOSS' }, select: { id: true } }),
          ]);

          function pickRandom(arr: { id: string }[], n: number): string[] {
            const shuffled = [...arr].sort(() => 0.5 - Math.random());
            return shuffled.slice(0, n).map(p => p.id);
          }

          const problemIds = [
            ...pickRandom(easyProblems, 2),
            ...pickRandom(mediumProblems, 1),
            ...pickRandom(hardProblems, 2),
            ...pickRandom(bossProblems, 1),
          ];

          // Fallback if not enough problems
          if (problemIds.length < 6 || problemIds.some(id => !id)) {
            const allProbs = await prisma.problem.findMany({ select: { id: true, difficulty: true } });
            const DIFFICULTY_RANK: Record<string, number> = { EASY: 1, MEDIUM: 2, HARD: 3, BOSS: 4 };
            allProbs.sort((a, b) => (DIFFICULTY_RANK[a.difficulty] ?? 99) - (DIFFICULTY_RANK[b.difficulty] ?? 99));
            problemIds.length = 0;
            problemIds.push(...allProbs.map(p => p.id).slice(0, 6));
          }

          await MatchService.createRoomState(matchRoomId, player1.userId, player2.userId, problemIds);
          activeRoomIds.add(matchRoomId);
          logger.info(`[Room] Code match ${matchRoomId} created: ${player1.user.username} vs ${player2.user.username}`);
        }

        // Notify both players of their match assignment
        const assignPayload1 = {
          matchRoomId,
          opponentId: player2.userId,
          opponentUsername: player2.user.username,
          opponentElo: room.mode === 'mcq' ? player2.user.mcqEloRating : player2.user.eloRating,
          mode: room.mode,
          round: nextRound,
          roomCode: code,
        };

        const assignPayload2 = {
          matchRoomId,
          opponentId: player1.userId,
          opponentUsername: player1.user.username,
          opponentElo: room.mode === 'mcq' ? player1.user.mcqEloRating : player1.user.eloRating,
          mode: room.mode,
          round: nextRound,
          roomCode: code,
        };

        io.to(`user:${player1.userId}`).emit('room:match_assigned', assignPayload1);
        io.to(`user:${player2.userId}`).emit('room:match_assigned', assignPayload2);
      } catch (err) {
        logger.error(`[Room] Failed to create match for ${player1.user.username} vs ${player2.user.username}: ${err}`);
      }
    }

    logger.info(`[Room] Room ${code} round ${nextRound} started with ${pairings.length} matches`);
  });

  // ── REPORT MATCH RESULT (called when a match within a room ends) ──
  socket.on('room:match_result', async (payload: {
    roomCode: string;
    winnerId: string | null;
    loserId: string | null;
    winnerScore?: number;
    loserScore?: number;
  }) => {
    const { roomCode, winnerId, loserId, winnerScore, loserScore } = payload;
    if (!roomCode) return;

    const code = roomCode.toUpperCase();
    const socketRoomName = `private-room:${code}`;

    try {
      // Update winner's stats
      if (winnerId) {
        await prisma.roomParticipant.updateMany({
          where: { room: { code }, userId: winnerId },
          data: {
            score: { increment: winnerScore ?? 10 },
            wins: { increment: 1 },
          },
        });
      }

      // Update loser's stats
      if (loserId) {
        await prisma.roomParticipant.updateMany({
          where: { room: { code }, userId: loserId },
          data: {
            score: { increment: loserScore ?? 0 },
            losses: { increment: 1 },
          },
        });
      }

      // Draw case — both get some points
      if (!winnerId && !loserId) {
        // No-op for draws in terms of win/loss
      }

      // Fetch updated leaderboard
      const room = await prisma.room.findUnique({
        where: { code },
        include: {
          participants: {
            include: { user: { select: { id: true, username: true } } },
            orderBy: [{ score: 'desc' }, { wins: 'desc' }, { losses: 'asc' }],
          },
        },
      });

      if (!room) return;

      const leaderboard = room.participants.map((p, i) => ({
        rank: i + 1,
        userId: p.userId,
        username: p.user.username,
        score: p.score,
        wins: p.wins,
        losses: p.losses,
        isActive: p.isActive,
      }));

      // Broadcast updated leaderboard
      io.to(socketRoomName).emit('room:round_ended', {
        round: room.currentRound,
        leaderboard,
      });

      // Check if all rounds are done
      if (room.currentRound >= room.totalRounds) {
        // End competition
        await prisma.room.update({
          where: { code },
          data: { status: 'COMPLETED', endedAt: new Date() },
        });

        const winner = leaderboard[0];
        io.to(socketRoomName).emit('room:competition_ended', {
          finalLeaderboard: leaderboard,
          winnerId: winner?.userId ?? null,
          winnerUsername: winner?.username ?? null,
        });

        logger.info(`[Room] Competition ${code} ended. Winner: ${winner?.username}`);
      }

      logger.info(`[Room] Match result recorded in room ${code}: winner=${winnerId}, loser=${loserId}`);
    } catch (err) {
      logger.error(`[Room] Error recording match result: ${err}`);
    }
  });

  // ── DISCONNECT CLEANUP ─────────────────────────────────────────
  socket.on('disconnect', () => {
    const roomCode = socketRoomMap.get(socket.id);
    if (roomCode) {
      const socketRoomName = `private-room:${roomCode}`;
      const userId = socket.data.userId;
      const username = socket.data.username;

      if (userId && username) {
        io.to(socketRoomName).emit('room:player_left', {
          userId,
          username,
          participantCount: -1, // client should refetch
        });
      }

      socketRoomMap.delete(socket.id);
      logger.info(`[Room Handler] Socket ${socket.id} disconnected from room ${roomCode}`);
    }
  });
}
