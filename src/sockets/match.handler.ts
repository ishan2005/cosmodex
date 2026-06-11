import { Server, Socket } from 'socket.io';
import { MatchService } from '../services/match.service.js';
import { RedisService } from '../services/redis.service.js';
import { ExecutorService } from '../services/executor.service.js';
import { logger } from '../config/logger.js';

// Holds references to active 15s decision timers for "Skip or Stay"
const decisionTimeouts = new Map<string, NodeJS.Timeout>();

export function registerMatchHandlers(io: Server, socket: Socket) {
  
  // 1. JOIN ROOM
  socket.on('join_room', async (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;
    logger.info(`Socket client ${socket.id} (User: ${userId}) joining room: ${roomId}`);
    
    try {
      socket.join(roomId);
      
      const state = await RedisService.getRoomState(roomId);
      if (state) {
        // Retrieve latest code draft from cache if available
        const draft = await RedisService.getDraft(roomId, userId);
        if (draft && state.players[userId]) {
          state.players[userId].currentDraft = draft;
        }
        
        io.to(roomId).emit('room_state_update', state);
      } else {
        socket.emit('error', { message: 'Lobby does not exist or has expired' });
      }
    } catch (error) {
      logger.error(`Error on join_room: ${error}`);
      socket.emit('error', { message: 'Failed to join lobby' });
    }
  });

  // 2. AUTO SAVE DRAFT
  socket.on('auto_save_draft', async (payload: { roomId: string; userId: string; code: string }) => {
    const { roomId, userId, code } = payload;
    try {
      await RedisService.saveDraft(roomId, userId, code);
      
      // Update in memory state
      const state = await RedisService.getRoomState(roomId);
      if (state && state.players[userId]) {
        state.players[userId].currentDraft = code;
        await RedisService.saveRoomState(roomId, state);
      }
    } catch (error) {
      logger.error(`Error auto saving draft: ${error}`);
    }
  });

  // 3. DECIDE SKIP OR STAY
  socket.on('decide_skip_stay', async (payload: { roomId: string; userId: string; choice: 'skip' | 'stay' }) => {
    const { roomId, userId, choice } = payload;
    logger.info(`User ${userId} in Room ${roomId} chose to ${choice.toUpperCase()}`);
    
    try {
      // Clear decision timeout if they respond in time
      const timeoutKey = `${roomId}:${userId}`;
      const existingTimeout = decisionTimeouts.get(timeoutKey);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
        decisionTimeouts.delete(timeoutKey);
      }

      const updatedState = await MatchService.handleSkipOrStayDecision(roomId, userId, choice);
      io.to(roomId).emit('room_state_update', updatedState);
      
      // Notify client if stage transitioned
      if (updatedState.status === 'COMPLETED') {
        io.to(roomId).emit('match_ended', { winnerId: updatedState.problems.length === 6 ? userId : null });
      }
    } catch (error: any) {
      logger.error(`Error in decide_skip_stay: ${error.message}`);
      socket.emit('error', { message: error.message });
    }
  });

  // 4. SUBMIT CODE
  socket.on('submit_code', async (payload: { roomId: string; userId: string; problemId: string; code: string; language: string }) => {
    const { roomId, userId, problemId, code, language } = payload;
    logger.info(`Evaluating submission for room ${roomId}, user ${userId}, problem ${problemId}`);

    try {
      const state = await RedisService.getRoomState(roomId);
      if (!state) return socket.emit('error', { message: 'Match not found' });

      const player = state.players[userId];
      if (!player) return socket.emit('error', { message: 'Player not in room' });

      player.submissionsCount++;
      await RedisService.saveRoomState(roomId, state);

      // Run code execution locally or via Judge0
      const executor = ExecutorService.getExecutor();
      const execResult = await executor.execute(code, language, problemId);

      logger.info(`Execution finished. Status: ${execResult.status}. Passed ${execResult.passedCount}/${execResult.totalCount}`);

      if (execResult.status === 'ACCEPTED') {
        // Correct submission!
        const points = state.currentStage === 6 ? 300 : (state.currentStage <= 2 ? 100 : 150);
        
        const { roomState, firstFinisher } = await MatchService.handleCorrectSubmission(roomId, userId, points);
        
        // Emit result to the sender
        socket.emit('submission_result', {
          status: 'ACCEPTED',
          passedCount: execResult.passedCount,
          totalCount: execResult.totalCount,
          testCases: execResult.testCases.filter(t => t.isPublic), // only send public test cases
          pointsAwarded: points,
          livesRemaining: player.lives,
        });

        // Broadcast state update to everyone
        io.to(roomId).emit('room_state_update', roomState);

        // If Phase 1 Sprint and this user is the FIRST finisher, start 15s timer for the opponent
        if (firstFinisher && roomState.currentStage <= 5) {
          const opponentId = roomState.playerIds.find((id) => id !== userId)!;
          const opponent = roomState.players[opponentId];

          // Notify opponent to make a decision
          io.to(roomId).emit('opponent_completed_stage', {
            opponentId: userId,
            decisionTimeRemaining: 15,
          });

          // Set 15s force-skip timer
          const timeoutKey = `${roomId}:${opponentId}`;
          const timer = setTimeout(async () => {
            logger.info(`Force-skipping opponent ${opponentId} in room ${roomId} due to decision timeout.`);
            try {
              const timedOutState = await MatchService.handleSkipOrStayDecision(roomId, opponentId, 'skip');
              io.to(roomId).emit('room_state_update', timedOutState);
            } catch (err) {
              logger.error(`Failed to force-skip: ${err}`);
            }
          }, 15000);

          decisionTimeouts.set(timeoutKey, timer);
        }
      } else {
        // Incorrect submission
        let updatedState = state;
        
        if (player.status === 'STAYING') {
          // If they chose to STAY, incorrect answer costs 1 life
          updatedState = await MatchService.handleWrongSubmissionInStay(roomId, userId);
        } else if (state.currentStage === 6) {
          // Boss battle: incorrect answer costs 1 life
          player.lives = Math.max(0, player.lives - 1);
          if (player.lives <= 0) {
            player.status = 'ELIMINATED';
          }
          await RedisService.saveRoomState(roomId, state);
          updatedState = state;
        }

        // Emit results to sender
        socket.emit('submission_result', {
          status: execResult.status,
          passedCount: execResult.passedCount,
          totalCount: execResult.totalCount,
          testCases: execResult.testCases.filter(t => t.isPublic),
          pointsAwarded: 0,
          livesRemaining: player.lives,
        });

        // Broadcast state update
        io.to(roomId).emit('room_state_update', updatedState);
      }
    } catch (error: any) {
      logger.error(`Error in submit_code: ${error.message}`);
      socket.emit('error', { message: 'Submission processing failed' });
    }
  });

  // 5. REDEEM LIFE (BOSS BATTLE ONLY)
  socket.on('redeem_life', async (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;
    try {
      const updatedState = await MatchService.handleRedeemLife(roomId, userId);
      io.to(roomId).emit('room_state_update', updatedState);
    } catch (error: any) {
      logger.error(`Error in redeem_life: ${error.message}`);
      socket.emit('error', { message: error.message });
    }
  });

  // 6. CLIENT DISCONNECTION
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
}
