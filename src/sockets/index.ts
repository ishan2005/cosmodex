import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { registerMatchHandlers } from './match.handler.js';
import { registerMatchmakingHandlers } from './matchmaking.handler.js';
import { registerMcqHandlers, triggerReveal, triggerNextRound } from './mcq.handler.js';
import { RedisService } from '../services/redis.service.js';
import { MatchService } from '../services/match.service.js';
import { McqService } from '../services/mcq.service.js';
import { MatchmakingService } from '../services/matchmaking.service.js';
import { decodeToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import { activeRoomIds, activeMcqRoomIds } from '../shared/activeRooms.js';

let io: Server;

// Re-export so existing consumers still work
export { activeRoomIds, activeMcqRoomIds };

export function initSocketIO(server: HTTPServer): Server {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    // Ping timeout / interval for connection health detection
    pingTimeout: 20000,
    pingInterval: 25000,
  });

  // ── SOCKET AUTH MIDDLEWARE ──────────────────────────────────
  // Optionally verify JWT if provided in handshake auth.
  // Non-authenticated connections are still allowed (for backward compat with demo).
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;

    if (token) {
      const payload = decodeToken(token);
      if (payload) {
        // Attach user info to socket data for downstream handlers
        socket.data.userId = payload.userId;
        socket.data.username = payload.username;
        logger.debug(`Socket authenticated: ${payload.username} (${socket.id})`);
      } else {
        logger.warn(`Socket provided invalid token — proceeding as guest (${socket.id})`);
      }
    }

    next(); // Always allow connection
  });

  // ── CONNECTION HANDLER ──────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const ident = socket.data.username
      ? `${socket.data.username} (${socket.id})`
      : socket.id;

    logger.info(`WebSocket connected: ${ident}`);

    // Register all event namespaces
    registerMatchHandlers(io, socket);
    registerMatchmakingHandlers(io, socket);
    registerMcqHandlers(io, socket);

    socket.on('disconnect', (reason) => {
      logger.info(`WebSocket disconnected: ${ident} — reason: ${reason}`);
    });
  });

  // ── BACKGROUND TIMER TICK (1s) ──────────────────────────────
  // Decrements stageTimeRemaining for every active room and broadcasts the
  // updated state. Handles stage timeouts automatically.
  //
  // Uses the in-memory activeRoomIds set instead of scanning all Redis keys
  // every second (redis.keys is O(N) and blocks the Redis event loop).
  setInterval(async () => {
    for (const roomId of activeRoomIds) {
      try {
        const state = await RedisService.getRoomState(roomId);

        if (!state || state.status !== 'ACTIVE') {
          // Room no longer active or expired — stop tracking it
          activeRoomIds.delete(roomId);
          continue;
        }

        const isBossStage = state.currentStage === 6;

        if (isBossStage) {
          // ── Boss Battle: shared room-level countdown ─────────────────────
          state.stageTimeRemaining = Math.max(0, state.stageTimeRemaining - 1);

          // Check if both players are eliminated (match should end immediately)
          const allEliminated = state.playerIds.every(
            (id) => state.players[id]?.status === 'ELIMINATED'
          );

          if (state.stageTimeRemaining <= 0 || allEliminated) {
            logger.info(`[Timer] Boss Battle ended for room ${roomId} — ${allEliminated ? 'both eliminated' : 'timed out'}`);
            const timedOutState = await MatchService.handleStageTimeout(roomId);
            io.to(roomId).emit('room_state_update', timedOutState);
            io.to(roomId).emit('match_ended', { winnerId: null, reason: allEliminated ? 'both_eliminated' : 'timeout' });
            activeRoomIds.delete(roomId);
          } else {
            await RedisService.saveRoomState(roomId, state);
            io.to(roomId).emit('room_state_update', state);
          }
        } else {
          // ── Sprint stages: each player has their own independent timer ───
          const now = Date.now();
          let anyTimedOut = false;

          for (const pid of state.playerIds) {
            const player = state.players[pid];
            // Only active coders need a timer check
            if (['ELIMINATED', 'DONE', 'SKIPPED', 'WAITING_DECISION'].includes(player.status)) continue;

            // Recompute from start time (avoids drift from sleep/lag)
            const elapsed = Math.floor((now - player.stageStartTime) / 1000);
            player.stageTimeRemaining = Math.max(0, player.stageDuration - elapsed);

            if (player.stageTimeRemaining <= 0) anyTimedOut = true;
          }

          if (anyTimedOut) {
            const updatedState = await MatchService.handlePlayerTimeouts(roomId);
            io.to(roomId).emit('room_state_update', updatedState);
            if (updatedState.status === 'COMPLETED') {
              const survivorId = updatedState.playerIds.find(
                (id) => updatedState.players[id]?.status !== 'ELIMINATED'
              ) ?? null;
              io.to(roomId).emit('match_ended', { winnerId: survivorId, reason: 'timeout' });
              activeRoomIds.delete(roomId);
            }
          } else {
            await RedisService.saveRoomState(roomId, state);
            io.to(roomId).emit('room_state_update', state);
          }
        }
      } catch (err) {
        logger.error(`[Timer] Error processing room ${roomId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }, 1000);

  // ── MCQ BACKGROUND TIMER TICK (1s) ─────────────────────────
  // Handles round countdowns for MCQ battles.
  // Separate from the code battle timer to keep logic clean.
  setInterval(async () => {
    for (const roomId of activeMcqRoomIds) {
      try {
        const state = await McqService.getMcqRoomState(roomId);

        if (!state || state.status === 'COMPLETED') {
          activeMcqRoomIds.delete(roomId);
          continue;
        }

        const now = Date.now();
        const elapsed = Math.floor((now - (state.roundEndTime - state.roundTimeRemaining * 1000)) / 1000);
        const remaining = Math.max(0, Math.ceil((state.roundEndTime - now) / 1000));

        if (remaining <= 0) {
          if (state.status === 'ACTIVE') {
            // Round timer expired — trigger reveal
            await triggerReveal(io, roomId);
          } else if (state.status === 'REVEAL') {
            // Reveal timer expired — advance to next round
            const nextState = await McqService.advanceRound(roomId);

            if (nextState.status === 'COMPLETED') {
              const p1 = nextState.players[nextState.playerIds[0]];
              const p2 = nextState.players[nextState.playerIds[1]];
              const winnerId = p1.score > p2.score ? p1.userId
                             : p2.score > p1.score ? p2.userId
                             : null;

              io.to(roomId).emit('mcq_match_ended', {
                winnerId,
                reason: 'all_rounds_complete',
                finalScores: {
                  [p1.userId]: p1.score,
                  [p2.userId]: p2.score,
                },
              });
              io.to(roomId).emit('mcq_room_state', McqService.sanitizeForClient(nextState));
              activeMcqRoomIds.delete(roomId);
            } else {
              // Push new question
              io.to(roomId).emit('mcq_next_round', {
                round: nextState.currentRound,
                question: nextState.currentQuestion,
                timeRemaining: nextState.roundTimeRemaining,
              });
              io.to(roomId).emit('mcq_room_state', McqService.sanitizeForClient(nextState));
            }
          }
        } else {
          // Just update the countdown
          state.roundTimeRemaining = remaining;
          await McqService.saveMcqRoomState(roomId, state);
          io.to(roomId).emit('mcq_room_state', McqService.sanitizeForClient(state));
        }
      } catch (err) {
        logger.error(`[MCQ Timer] Error processing room ${roomId}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }, 1000);

  // ── MATCHMAKING PULSE (5s) ──────────────────────────────────
  // Broadcasts real-time queue size to all connected clients.
  setInterval(async () => {
    const [codeStatus, mcqStatus] = await Promise.all([
      MatchmakingService.getQueueStatus('code'),
      MatchmakingService.getQueueStatus('mcq'),
    ]);
    if (codeStatus.size > 0 || mcqStatus.size > 0) {
      io.emit('queue_pulse', {
        code: codeStatus,
        mcq: mcqStatus,
      });
    }
  }, 5000);

  logger.info('Socket.IO server initialised with auth middleware, game timer, MCQ timer, and matchmaking pulse.');
  return io;
}

export { io };
