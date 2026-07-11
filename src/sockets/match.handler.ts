import { Server, Socket } from 'socket.io';
import { MatchService } from '../services/match.service.js';
import { RedisService } from '../services/redis.service.js';
import { ExecutorService } from '../services/executor.service.js';
import { prisma } from '../config/db.js';
import { logger } from '../config/logger.js';

/**
 * Active 15-second "Skip or Stay" decision timers, keyed by `${roomId}:${userId}`.
 * Cleared when the opponent responds or the timer fires.
 */
const decisionTimers = new Map<string, NodeJS.Timeout>();

/**
 * Per-room submission lock to prevent race conditions.
 * When two players submit simultaneously, the second submission waits for the first
 * to complete before reading/writing room state, preventing stale-state overwrites.
 */
const roomSubmitLocks = new Map<string, Promise<void>>();

/**
 * Auto-save throttle: tracks the last save timestamp per userId.
 * Limits Redis writes to at most once per second per user.
 */
const lastSaveTime = new Map<string, number>();
const AUTO_SAVE_THROTTLE_MS = 1000;

function clearDecisionTimer(roomId: string, userId: string): void {
  const key = `${roomId}:${userId}`;
  const timer = decisionTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    decisionTimers.delete(key);
  }
}

function setDecisionTimer(roomId: string, userId: string, io: Server): void {
  const key = `${roomId}:${userId}`;
  // Clear any pre-existing timer for safety
  clearDecisionTimer(roomId, userId);

  const timer = setTimeout(async () => {
    decisionTimers.delete(key);
    logger.info(`[Handler] Decision timer expired for ${userId} in room ${roomId} — force-skipping`);

    const state = await RedisService.getRoomState(roomId);
    if (!state) return;

    const player = state.players[userId];
    if (!player || player.status !== 'WAITING_DECISION') return;

    const timedOutState = await MatchService.handleSkipOrStayDecision(roomId, userId, 'skip');
    io.to(roomId).emit('room_state_update', timedOutState);
    // Unblock the winner who was waiting — their waiting state clears on next stage
    io.to(roomId).emit('stage_advanced', {
      stage: timedOutState.currentStage,
      reason: 'opponent_timed_out',
    });

    // BUG 5 FIX: extract the real winner from state instead of always emitting null
    if (timedOutState.status === 'COMPLETED') {
      const realWinnerId =
        timedOutState.playerIds.find(
          (id) => timedOutState.players[id]?.status !== 'ELIMINATED'
        ) ?? null;
      io.to(roomId).emit('match_ended', { winnerId: realWinnerId, reason: 'opponent_timeout' });
    }
  }, 15_000);

  decisionTimers.set(key, timer);
}

export function registerMatchHandlers(io: Server, socket: Socket) {

  // ── 1. JOIN ROOM ──────────────────────────────────────────────
  socket.on('join_room', async (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;

    if (!roomId || !userId) {
      socket.emit('error', { message: 'join_room requires roomId and userId' });
      return;
    }

    const state = await RedisService.getRoomState(roomId);
    if (!state) {
      socket.emit('error', { message: 'Room does not exist or has expired' });
      return;
    }

    if (!state.players[userId]) {
      socket.emit('error', { message: 'You are not a participant of this room' });
      return;
    }

    socket.join(roomId);
    logger.info(`[Handler] User ${userId} joined room ${roomId}`);

    // Restore latest draft from cache
    const draft = await RedisService.getDraft(roomId, userId);
    if (draft) state.players[userId].currentDraft = draft;

    io.to(roomId).emit('room_state_update', state);
  });

  // ── 2. AUTO SAVE DRAFT (throttled: max 1/sec per user) ────────
  socket.on('auto_save_draft', async (payload: { roomId: string; userId: string; code: string }) => {
    const { roomId, userId, code } = payload;

    if (!roomId || !userId || typeof code !== 'string') return;

    // Throttle: skip if called within AUTO_SAVE_THROTTLE_MS of the last save
    const now = Date.now();
    const lastTime = lastSaveTime.get(userId) ?? 0;
    if (now - lastTime < AUTO_SAVE_THROTTLE_MS) return;
    lastSaveTime.set(userId, now);

    // Save draft + update the live state in one go
    await RedisService.saveDraft(roomId, userId, code);

    const state = await RedisService.getRoomState(roomId);
    if (!state || !state.players[userId]) return;

    state.players[userId].currentDraft = code;
    await RedisService.saveRoomState(roomId, state);
  });

  // ── 3. SUBMIT CODE (with per-room lock) ───────────────────────
  socket.on(
    'submit_code',
    async (payload: {
      roomId: string;
      userId: string;
      problemId: string;
      code: string;
      language: string;
    }) => {
      const { roomId, userId, problemId, code, language } = payload;

      if (!roomId || !userId || !problemId || !code || !language) {
        socket.emit('error', { message: 'submit_code requires roomId, userId, problemId, code, language' });
        return;
      }

      // ── Per-room submission lock ───────────────────────────────
      // Prevents race conditions: if both players submit at the same time,
      // the second submission waits for the first to finish updating room state.
      const prevLock = roomSubmitLocks.get(roomId) ?? Promise.resolve();
      let releaseLock: () => void;
      const myLock = new Promise<void>((resolve) => { releaseLock = resolve; });
      roomSubmitLocks.set(roomId, prevLock.then(() => myLock));

      try {
        await prevLock; // wait for any previous submission on this room to finish

        const state = await RedisService.getRoomState(roomId);
        if (!state) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const player = state.players[userId];
        if (!player) {
          socket.emit('error', { message: 'You are not a participant of this room' });
          return;
        }

        if (state.status !== 'ACTIVE') {
          socket.emit('error', { message: 'Match is not active' });
          return;
        }

        if (player.status === 'ELIMINATED' || player.status === 'DONE') {
          socket.emit('error', { message: `Cannot submit — you are ${player.status}` });
          return;
        }

        logger.info(`[Handler] submit_code | room=${roomId} user=${userId} problem=${problemId} lang=${language}`);

        // Track submission count
        player.submissionsCount++;
        await RedisService.saveRoomState(roomId, state);

        // Run the code through the executor (always catch so client always gets a result)
        const executor = ExecutorService.getExecutor();
        let execResult;
        try {
          execResult = await executor.execute(code, language, problemId);
        } catch (execErr) {
          const errMsg = execErr instanceof Error ? execErr.message : String(execErr);
          logger.error(`[Handler] Execution failed for user ${userId}: ${errMsg}`);
          socket.emit('submission_result', {
            status: 'RUNTIME_ERROR',
            passedCount: 0,
            totalCount: 0,
            testCases: [],
            pointsAwarded: 0,
            livesRemaining: player.lives,
            error: `Execution service error: ${errMsg.substring(0, 200)}`,
          });
          return;
        }

        logger.info(
          `[Handler] Execution result: ${execResult.status} (${execResult.passedCount}/${execResult.totalCount})`
        );

        // Persist submission to DB (async — don't await to avoid blocking real-time response)
        prisma.submission
          .create({
            data: {
              userId,
              problemId,
              code,
              language,
              status: execResult.status,
              passedCount: execResult.passedCount,
              totalCount: execResult.totalCount,
              matchId: state.matchId,
            },
          })
          .then(() => logger.debug(`[Handler] Submission saved to DB for user ${userId}`))
          .catch((err: Error) => logger.error(`[Handler] Failed to save submission: ${err.message}`));

        // ── ACCEPTED ──────────────────────────────────────────────
        if (execResult.status === 'ACCEPTED') {
          // BUG 3 FIX: use player's personal stage, not the room-level stage.
          // Players can be on different stages (STAY mechanic), so room stage != player stage.
          const playerStage = player.currentStage;
          const points = playerStage === 6 ? 300 : playerStage <= 2 ? 100 : 150;

          const { roomState, firstFinisher } = await MatchService.handleCorrectSubmission(
            roomId,
            userId,
            points
          );

          socket.emit('submission_result', {
            status: 'ACCEPTED',
            passedCount: execResult.passedCount,
            totalCount: execResult.totalCount,
            testCases: execResult.testCases.filter((t) => t.isPublic),
            pointsAwarded: points,
            livesRemaining: roomState.players[userId]?.lives ?? player.lives,
          });

          io.to(roomId).emit('room_state_update', roomState);

          if (roomState.status === 'COMPLETED') {
            io.to(roomId).emit('match_ended', { winnerId: userId, reason: 'correct_submission' });
            return;
          }

          // Sprint phase: if first finisher, trigger decision window on OPPONENT only
          if (firstFinisher && roomState.currentStage <= 5) {
            const opponentId = roomState.playerIds.find((id) => id !== userId)!;

            // ── Tell the OPPONENT they need to decide (SKIP or STAY) ──
            // socket.to() sends to everyone in the room EXCEPT the sender
            socket.to(roomId).emit('opponent_completed_stage', {
              opponentId: userId,
              decisionTimeRemaining: 15,
            });

            // ── Tell the WINNER to wait while opponent decides ────────
            socket.emit('waiting_for_opponent', {
              message: 'Opponent is deciding whether to skip or stay…',
              decisionTimeRemaining: 15,
            });

            setDecisionTimer(roomId, opponentId, io);
          }
          return;
        }

        // ── WRONG / TLE / RUNTIME ERROR ───────────────────────────
        let updatedState = state;

        if (player.status === 'STAYING') {
          // Player chose STAY → wrong answer costs 1 global life
          updatedState = await MatchService.handleWrongSubmissionInStay(roomId, userId);
        } else if (player.currentStage === 6) {
          // Boss Battle: wrong answer costs 1 life
          player.lives = Math.max(0, player.lives - 1);
          logger.info(`[Handler] Boss Battle wrong answer — ${userId} lives: ${player.lives}`);

          if (player.lives <= 0) {
            player.status = 'ELIMINATED';

            // BUG 4 FIX: check who is still alive — emit the surviving opponent as the winner.
            // Previously always emitted winnerId: null even if only one player was eliminated.
            const survivingId = state.playerIds.find(
              (id) => id !== userId && state.players[id]?.status !== 'ELIMINATED'
            );

            if (survivingId) {
              // One player eliminated, opponent still alive → opponent wins
              state.status = 'COMPLETED';
              await RedisService.saveRoomState(roomId, state);
              await MatchService.endMatch(roomId, survivingId);

              socket.emit('submission_result', {
                status: execResult.status,
                passedCount: execResult.passedCount,
                totalCount: execResult.totalCount,
                testCases: execResult.testCases.filter((t) => t.isPublic),
                pointsAwarded: 0,
                livesRemaining: 0,
              });

              io.to(roomId).emit('room_state_update', state);
              io.to(roomId).emit('match_ended', { winnerId: survivingId, reason: 'opponent_eliminated' });
              return;
            } else {
              // Both players are now eliminated → draw
              state.status = 'COMPLETED';
              await RedisService.saveRoomState(roomId, state);
              await MatchService.endMatch(roomId, null);

              socket.emit('submission_result', {
                status: execResult.status,
                passedCount: execResult.passedCount,
                totalCount: execResult.totalCount,
                testCases: execResult.testCases.filter((t) => t.isPublic),
                pointsAwarded: 0,
                livesRemaining: 0,
              });

              io.to(roomId).emit('room_state_update', state);
              io.to(roomId).emit('match_ended', { winnerId: null, reason: 'both_eliminated' });
              return;
            }
          } else {
            await RedisService.saveRoomState(roomId, state);
          }
          updatedState = state;
        }

        socket.emit('submission_result', {
          status: execResult.status,
          passedCount: execResult.passedCount,
          totalCount: execResult.totalCount,
          testCases: execResult.testCases.filter((t) => t.isPublic),
          pointsAwarded: 0,
          livesRemaining: updatedState.players[userId]?.lives ?? player.lives,
        });

        io.to(roomId).emit('room_state_update', updatedState);

      } finally {
        releaseLock!();
      }
    }
  );

  // ── 4. DECIDE SKIP OR STAY ────────────────────────────────────
  socket.on(
    'decide_skip_stay',
    async (payload: { roomId: string; userId: string; choice: 'skip' | 'stay' }) => {
      const { roomId, userId, choice } = payload;

      if (!roomId || !userId || (choice !== 'skip' && choice !== 'stay')) {
        socket.emit('error', { message: 'decide_skip_stay requires roomId, userId, choice (skip|stay)' });
        return;
      }

      // Cancel the auto-skip timer since the player responded in time
      clearDecisionTimer(roomId, userId);

      logger.info(`[Handler] ${userId} chose ${choice.toUpperCase()} in room ${roomId}`);

      const updatedState = await MatchService.handleSkipOrStayDecision(roomId, userId, choice);
      io.to(roomId).emit('room_state_update', updatedState);

      // Both players advance — emit stage_advanced so the winner's waiting state clears
      io.to(roomId).emit('stage_advanced', {
        stage: updatedState.currentStage,
        reason: choice === 'skip' ? 'opponent_skipped' : 'opponent_stayed',
      });

      // BUG 1 FIX: extract the real winner from state instead of always emitting null.
      // When a player chooses STAY and the winner has beaten all stages, the real winner
      // is the non-eliminated player — not null.
      if (updatedState.status === 'COMPLETED') {
        const realWinnerId =
          updatedState.playerIds.find(
            (id) => updatedState.players[id]?.status !== 'ELIMINATED'
          ) ?? null;
        io.to(roomId).emit('match_ended', { winnerId: realWinnerId, reason: 'stage_complete' });
      }
    }
  );

  // ── 5. REDEEM LIFE (BOSS BATTLE) ──────────────────────────────
  socket.on('redeem_life', async (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;

    if (!roomId || !userId) {
      socket.emit('error', { message: 'redeem_life requires roomId and userId' });
      return;
    }

    const state = await RedisService.getRoomState(roomId);
    if (!state) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }

    if (state.currentStage !== 6) {
      socket.emit('error', { message: 'Life redemption is only available in the Boss Battle' });
      return;
    }

    const player = state.players[userId];
    if (!player) {
      socket.emit('error', { message: 'Player not in room' });
      return;
    }

    if (player.points < 100) {
      socket.emit('error', { message: `Need at least 100 points to redeem a life (you have ${player.points})` });
      return;
    }

    const updatedState = await MatchService.handleRedeemLife(roomId, userId);
    io.to(roomId).emit('room_state_update', updatedState);

    logger.info(`[Handler] ${userId} redeemed a life — now has ${updatedState.players[userId].lives} lives`);
  });

  // ── 6. RUN CODE (custom stdin — no match state changes) ──────
  socket.on(
    'run_code',
    async (payload: { code: string; language: string; stdin: string }) => {
      const { code, language, stdin = '' } = payload;
      logger.info(`[Handler] run_code | user=${socket.data?.userId ?? 'unknown'} lang=${language}`);

      if (!code || !language) {
        socket.emit('run_result', { stdout: '', stderr: 'Missing code or language', timedOut: false });
        return;
      }

      try {
        const result = await ExecutorService.runSingle(code, language, stdin);
        socket.emit('run_result', result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[Handler] run_code error: ${msg}`);
        socket.emit('run_result', { stdout: '', stderr: `Runner error: ${msg.substring(0, 200)}`, timedOut: false });
      }
    }
  );


  // ── 7. LEAVE MATCH (forfeit) ───────────────────────────────────
  socket.on('leave_match', async (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;
    if (!roomId || !userId) return;

    const state = await RedisService.getRoomState(roomId);
    if (!state || state.status === 'COMPLETED') return;

    // Determine the opponent as winner
    const opponentId = state.playerIds.find(id => id !== userId) ?? null;

    logger.info(`[Handler] Player ${userId} forfeited match ${roomId}. Winner: ${opponentId}`);

    // End match with opponent as winner
    await MatchService.endMatch(roomId, opponentId);
    io.to(roomId).emit('match_ended', { winnerId: opponentId, reason: 'opponent_forfeit', forfeitedBy: userId });
  });


  // ── 8. DISCONNECT ─────────────────────────────────────────────
  socket.on('disconnect', async (reason) => {
    const userId = socket.data?.userId;
    logger.info(`[Handler] Socket ${socket.id} disconnected: ${reason}`);

    if (!userId) return;

    // Check if this user was in an active room — if so, forfeit
    const activeRoom = await RedisService.findActiveRoomForUser(userId);
    if (activeRoom) {
      const state = await RedisService.getRoomState(activeRoom);
      if (state && state.status !== 'COMPLETED') {
        // Check if opponent is still connected
        const opponentId = state.playerIds.find(id => id !== userId) ?? null;
        if (opponentId) {
          // Wait 10 seconds to allow reconnection before forfeiting
          setTimeout(async () => {
            const currentState = await RedisService.getRoomState(activeRoom);
            if (currentState && currentState.status !== 'COMPLETED') {
              // Check if the user reconnected
              const room = io.sockets.adapter.rooms.get(activeRoom);
              const userSocketIds = await io.in(activeRoom).fetchSockets();
              const userReconnected = userSocketIds.some(s => s.data?.userId === userId);

              if (!userReconnected) {
                logger.info(`[Handler] Player ${userId} did not reconnect in 10s — auto-forfeit`);
                await MatchService.endMatch(activeRoom, opponentId);
                io.to(activeRoom).emit('match_ended', { winnerId: opponentId, reason: 'opponent_disconnect', forfeitedBy: userId });
              }
            }
          }, 10_000);
        }
      }
    }
  });
}

