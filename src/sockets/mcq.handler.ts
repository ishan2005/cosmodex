import { Server, Socket } from 'socket.io';
import { McqService } from '../services/mcq.service.js';
import { logger } from '../config/logger.js';

/**
 * Socket events for MCQ Battle:
 *
 * CLIENT → SERVER:
 *   mcq_join_room   { roomId, userId }           — join the MCQ room
 *   mcq_answer      { roomId, userId, answerIndex } — submit answer (0-3)
 *
 * SERVER → CLIENT:
 *   mcq_room_state  { ...sanitized McqRoomState } — full state update (no correct answers)
 *   mcq_round_reveal { round, correctIndex, players } — correct answer + who got it right
 *   mcq_next_round  { round, question, timeRemaining } — new question pushed
 *   mcq_match_ended { winnerId, reason, finalScores }  — match over
 *   error           { message }
 */

export function registerMcqHandlers(io: Server, socket: Socket) {

  // ── 1. JOIN MCQ ROOM ──────────────────────────────────────────
  socket.on('mcq_join_room', async (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;

    if (!roomId || !userId) {
      socket.emit('error', { message: 'mcq_join_room requires roomId and userId' });
      return;
    }

    const state = await McqService.getMcqRoomState(roomId);
    if (!state) {
      socket.emit('error', { message: 'MCQ room does not exist or has expired' });
      return;
    }

    if (!state.players[userId]) {
      socket.emit('error', { message: 'You are not a participant of this MCQ room' });
      return;
    }

    socket.join(roomId);
    logger.info(`[MCQ Handler] User ${userId} joined MCQ room ${roomId}`);

    // Send sanitized state (no correct answers)
    io.to(roomId).emit('mcq_room_state', McqService.sanitizeForClient(state));
  });

  // ── 2. ANSWER ─────────────────────────────────────────────────
  socket.on('mcq_answer', async (payload: { roomId: string; userId: string; answerIndex: number }) => {
    const { roomId, userId, answerIndex } = payload;

    if (!roomId || !userId || typeof answerIndex !== 'number') {
      socket.emit('error', { message: 'mcq_answer requires roomId, userId, answerIndex' });
      return;
    }

    if (answerIndex < 0 || answerIndex > 3) {
      socket.emit('error', { message: 'answerIndex must be 0-3' });
      return;
    }

    try {
      const { roomState, bothAnswered } = await McqService.handleAnswer(roomId, userId, answerIndex);

      // Broadcast updated state (player.answered = true, but still no correct answer)
      io.to(roomId).emit('mcq_room_state', McqService.sanitizeForClient(roomState));

      // If both players have answered, skip to reveal immediately
      if (bothAnswered) {
        await triggerReveal(io, roomId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[MCQ Handler] mcq_answer error: ${msg}`);
      socket.emit('error', { message: msg });
    }
  });

  // ── 3. LEAVE MCQ BATTLE (forfeit) ─────────────────────────────
  socket.on('mcq_leave_room', async (payload: { roomId: string; userId: string }) => {
    const { roomId, userId } = payload;
    if (!roomId || !userId) return;

    const state = await McqService.getMcqRoomState(roomId);
    if (!state || state.status === 'COMPLETED') return;

    // Determine the opponent as winner
    const opponentId = state.playerIds.find(id => id !== userId) ?? null;

    logger.info(`[MCQ Handler] Player ${userId} forfeited MCQ battle ${roomId}. Winner: ${opponentId}`);

    // End match with opponent as winner
    await McqService.endMcqMatch(roomId, opponentId);

    // Notify all players in the room
    io.to(roomId).emit('mcq_match_ended', {
      winnerId: opponentId,
      reason: 'opponent_forfeit',
      forfeitedBy: userId,
      finalScores: Object.fromEntries(
        state.playerIds.map(id => [id, state.players[id]?.score ?? 0])
      ),
    });
  });
}

/**
 * Trigger the reveal phase for a round.
 * Shows the correct answer + both players' choices.
 */
export async function triggerReveal(io: Server, roomId: string): Promise<void> {
  const state = await McqService.revealRound(roomId);
  const lastResult = state.roundResults[state.roundResults.length - 1];

  // Send the reveal event with correct answer
  io.to(roomId).emit('mcq_round_reveal', {
    round: lastResult.round,
    correctIndex: lastResult.correctIndex,
    players: {
      [state.playerIds[0]]: {
        answer: lastResult.player1Answer,
        correct: lastResult.player1Answer === lastResult.correctIndex,
        score: state.players[state.playerIds[0]].score,
      },
      [state.playerIds[1]]: {
        answer: lastResult.player2Answer,
        correct: lastResult.player2Answer === lastResult.correctIndex,
        score: state.players[state.playerIds[1]].score,
      },
    },
  });

  io.to(roomId).emit('mcq_room_state', McqService.sanitizeForClient(state));
}

/**
 * Called after the reveal timer ends — advance to next round or end match.
 */
export async function triggerNextRound(io: Server, roomId: string): Promise<void> {
  const state = await McqService.advanceRound(roomId);

  if (state.status === 'COMPLETED') {
    const p1 = state.players[state.playerIds[0]];
    const p2 = state.players[state.playerIds[1]];
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
    io.to(roomId).emit('mcq_room_state', McqService.sanitizeForClient(state));
    return;
  }

  // Push new question
  io.to(roomId).emit('mcq_next_round', {
    round: state.currentRound,
    question: state.currentQuestion,
    timeRemaining: state.roundTimeRemaining,
  });

  io.to(roomId).emit('mcq_room_state', McqService.sanitizeForClient(state));
}
