import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { registerMatchHandlers } from './match.handler.js';
import { registerMatchmakingHandlers } from './matchmaking.handler.js';
import { RedisService } from '../services/redis.service.js';
import { MatchService } from '../services/match.service.js';
import { MatchmakingService } from '../services/matchmaking.service.js';
import { redis } from '../config/redis.js';
import { decodeToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';

let io: Server;

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

    socket.on('disconnect', (reason) => {
      logger.info(`WebSocket disconnected: ${ident} — reason: ${reason}`);
    });
  });

  // ── BACKGROUND TIMER TICK (1s) ──────────────────────────────
  // Decrements stageTimeRemaining for every active room and broadcasts the
  // updated state. Handles stage timeouts automatically.
  setInterval(async () => {
    const roomKeys = await redis.keys('room:*');

    for (const key of roomKeys) {
      const roomId = key.replace('room:', '');
      const state = await RedisService.getRoomState(roomId);

      if (!state || state.status !== 'ACTIVE') continue;

      const isBossStage = state.currentStage === 6;

      if (isBossStage) {
        // ── Boss Battle: shared room-level countdown ─────────────────────
        state.stageTimeRemaining = Math.max(0, state.stageTimeRemaining - 1);

        if (state.stageTimeRemaining <= 0) {
          logger.info(`[Timer] Boss Battle timed out for room ${roomId}`);
          const timedOutState = await MatchService.handleStageTimeout(roomId);
          io.to(roomId).emit('room_state_update', timedOutState);
          io.to(roomId).emit('match_ended', { winnerId: null, reason: 'timeout' });
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
          }
        } else {
          await RedisService.saveRoomState(roomId, state);
          io.to(roomId).emit('room_state_update', state);
        }
      }
    }
  }, 1000);

  // ── MATCHMAKING PULSE (5s) ──────────────────────────────────
  // Broadcasts real-time queue size to all connected clients.
  setInterval(async () => {
    const status = await MatchmakingService.getQueueStatus();
    if (status.size > 0) {
      io.emit('queue_pulse', status); // broadcast to everyone
    }
  }, 5000);

  logger.info('Socket.IO server initialised with auth middleware, game timer, and matchmaking pulse.');
  return io;
}

export { io };
