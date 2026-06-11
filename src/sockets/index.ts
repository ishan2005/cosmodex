import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { registerMatchHandlers } from './match.handler.js';
import { RedisService } from '../services/redis.service.js';
import { MatchService } from '../services/match.service.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

let io: Server;

export function initSocketIO(server: HTTPServer): Server {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    logger.info(`New WebSocket client connected: ${socket.id}`);
    
    // Register match/arena listeners
    registerMatchHandlers(io, socket);
  });

  // Start the background server-side room timer scanner (1 tick per second)
  setInterval(async () => {
    try {
      const roomKeys = await redis.keys('room:*');
      for (const key of roomKeys) {
        const roomId = key.replace('room:', '');
        const state = await RedisService.getRoomState(roomId);
        
        if (!state || state.status !== 'ACTIVE') continue;

        // Decrement timer
        state.stageTimeRemaining = Math.max(0, state.stageTimeRemaining - 1);

        if (state.stageTimeRemaining <= 0) {
          // Trigger timeout handling
          logger.info(`Timer expired for Room: ${roomId}, Stage: ${state.currentStage}`);
          try {
            const timedOutState = await MatchService.handleStageTimeout(roomId);
            io.to(roomId).emit('room_state_update', timedOutState);
            
            if (timedOutState.status === 'COMPLETED') {
              io.to(roomId).emit('match_ended', { winnerId: null });
            }
          } catch (err) {
            logger.error(`Error handling stage timeout for room ${roomId}: ${err}`);
          }
        } else {
          // Save and broadcast decremented timer ticks
          await RedisService.saveRoomState(roomId, state);
          io.to(roomId).emit('room_state_update', state);
        }
      }
    } catch (error) {
      logger.error(`Error in Socket.io background timer tick: ${error}`);
    }
  }, 1000);

  logger.info('Socket.io server initialized and background timer ticks started.');
  return io;
}

export { io };
