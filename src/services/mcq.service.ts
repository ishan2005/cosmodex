import { prisma } from '../config/db.js';
import { RedisService } from './redis.service.js';
import { McqQuestion, McqRoomState, McqPlayerState, McqRoundResult } from '../types/index.js';
import { pickRandomQuestions } from '../data/mcq-questions.js';
import { logger } from '../config/logger.js';
import crypto from 'crypto';

const MCQ_ROOM_PREFIX = 'mcq_room:';
const MCQ_ROOM_TTL = 3600; // 1 hour
const ROUND_TIME_SEC = 15;
const REVEAL_TIME_SEC = 3;
const TOTAL_ROUNDS = 10;

export class McqService {
  /**
   * Get questions from the built-in coding question bank.
   * Picks random questions each match — no API dependency.
   */
  static async fetchQuestions(count: number = TOTAL_ROUNDS): Promise<McqQuestion[]> {
    const questions = pickRandomQuestions(count);
    logger.info(`[MCQ] Picked ${questions.length} coding questions from local bank`);
    return questions;
  }

  /**
   * Creates a new MCQ room state in Redis + a DB record.
   */
  static async createMcqRoom(
    roomId: string,
    player1Id: string,
    player2Id: string
  ): Promise<McqRoomState> {
    const p1 = await prisma.user.findUnique({ where: { id: player1Id } });
    const p2 = await prisma.user.findUnique({ where: { id: player2Id } });

    if (!p1 || !p2) throw new Error('One or both players not found in database');

    // Create DB record
    const match = await prisma.mcqMatch.create({
      data: {
        player1Id: p1.id,
        player2Id: p2.id,
        status: 'ACTIVE',
        totalRounds: TOTAL_ROUNDS,
      },
    });

    // Fetch questions
    const questions = await this.fetchQuestions(TOTAL_ROUNDS);

    const players: Record<string, McqPlayerState> = {
      [p1.id]: {
        userId: p1.id,
        username: p1.username,
        score: 0,
        currentAnswer: null,
        answered: false,
        streak: 0,
      },
      [p2.id]: {
        userId: p2.id,
        username: p2.username,
        score: 0,
        currentAnswer: null,
        answered: false,
        streak: 0,
      },
    };

    const now = Date.now();
    const roomState: McqRoomState = {
      matchId: match.id,
      roomId,
      status: 'ACTIVE',
      currentRound: 1,
      totalRounds: TOTAL_ROUNDS,
      roundTimeRemaining: ROUND_TIME_SEC,
      roundEndTime: now + ROUND_TIME_SEC * 1000,
      playerIds: [p1.id, p2.id],
      players,
      currentQuestion: {
        id: questions[0].id,
        question: questions[0].question,
        options: questions[0].options,
        difficulty: questions[0].difficulty,
        category: questions[0].category,
      },
      questions,
      roundResults: [],
    };

    await this.saveMcqRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Handle a player submitting their answer for the current round.
   * Returns updated state + whether both players have now answered.
   */
  static async handleAnswer(
    roomId: string,
    userId: string,
    answerIndex: number
  ): Promise<{ roomState: McqRoomState; bothAnswered: boolean }> {
    const roomState = await this.getMcqRoomState(roomId);
    if (!roomState) throw new Error('MCQ room not found');

    const player = roomState.players[userId];
    if (!player) throw new Error('Player not in MCQ room');

    if (player.answered) {
      logger.warn(`[MCQ] Player ${userId} already answered round ${roomState.currentRound}`);
      return { roomState, bothAnswered: this.bothAnswered(roomState) };
    }

    if (roomState.status !== 'ACTIVE') {
      return { roomState, bothAnswered: false };
    }

    player.currentAnswer = answerIndex;
    player.answered = true;

    // Check if correct
    const currentQ = roomState.questions[roomState.currentRound - 1];
    if (currentQ && answerIndex === currentQ.correctIndex) {
      player.score += 1;
      player.streak += 1;
    } else {
      player.streak = 0;
    }

    await this.saveMcqRoomState(roomId, roomState);

    const bothAnswered = this.bothAnswered(roomState);
    return { roomState, bothAnswered };
  }

  /**
   * Check if both players have answered the current round.
   */
  private static bothAnswered(roomState: McqRoomState): boolean {
    return roomState.playerIds.every(id => roomState.players[id]?.answered);
  }

  /**
   * Produces the round result and transitions to REVEAL status.
   * Called when both players answer or when the timer expires.
   */
  static async revealRound(roomId: string): Promise<McqRoomState> {
    const roomState = await this.getMcqRoomState(roomId);
    if (!roomState) throw new Error('MCQ room not found');

    const currentQ = roomState.questions[roomState.currentRound - 1];

    // Record round result
    const result: McqRoundResult = {
      round: roomState.currentRound,
      questionText: currentQ.question,
      correctIndex: currentQ.correctIndex,
      player1Answer: roomState.players[roomState.playerIds[0]]?.currentAnswer ?? null,
      player2Answer: roomState.players[roomState.playerIds[1]]?.currentAnswer ?? null,
    };
    roomState.roundResults.push(result);

    // Update scores for anyone who didn't answer (timeout)
    for (const pid of roomState.playerIds) {
      const p = roomState.players[pid];
      if (!p.answered) {
        p.streak = 0; // break streak on timeout
      }
    }

    roomState.status = 'REVEAL';
    roomState.roundTimeRemaining = REVEAL_TIME_SEC;
    roomState.roundEndTime = Date.now() + REVEAL_TIME_SEC * 1000;

    await this.saveMcqRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Advances to the next round or ends the match.
   * Called after the reveal phase timer expires.
   */
  static async advanceRound(roomId: string): Promise<McqRoomState> {
    const roomState = await this.getMcqRoomState(roomId);
    if (!roomState) throw new Error('MCQ room not found');

    const nextRound = roomState.currentRound + 1;

    if (nextRound > roomState.totalRounds) {
      // Match is over
      roomState.status = 'COMPLETED';
      await this.saveMcqRoomState(roomId, roomState);

      // Determine winner
      const p1 = roomState.players[roomState.playerIds[0]];
      const p2 = roomState.players[roomState.playerIds[1]];
      const winnerId = p1.score > p2.score ? p1.userId
                     : p2.score > p1.score ? p2.userId
                     : null;

      await this.endMcqMatch(roomId, winnerId);
      return roomState;
    }

    // Reset for next round
    roomState.currentRound = nextRound;
    roomState.status = 'ACTIVE';

    const nextQ = roomState.questions[nextRound - 1];
    roomState.currentQuestion = {
      id: nextQ.id,
      question: nextQ.question,
      options: nextQ.options,
      difficulty: nextQ.difficulty,
      category: nextQ.category,
    };

    roomState.roundTimeRemaining = ROUND_TIME_SEC;
    roomState.roundEndTime = Date.now() + ROUND_TIME_SEC * 1000;

    // Reset player answer state
    for (const pid of roomState.playerIds) {
      const p = roomState.players[pid];
      p.currentAnswer = null;
      p.answered = false;
    }

    await this.saveMcqRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Finalizes the MCQ match — updates DB + MCQ ELO.
   */
  static async endMcqMatch(roomId: string, winnerId: string | null): Promise<void> {
    const roomState = await this.getMcqRoomState(roomId);
    if (!roomState) return;

    logger.info(`[MCQ] Finalizing match ${roomState.matchId}. Winner: ${winnerId}`);

    const p1Id = roomState.playerIds[0];
    const p2Id = roomState.playerIds[1];
    const p1State = roomState.players[p1Id];
    const p2State = roomState.players[p2Id];

    // Update match record
    await prisma.mcqMatch.update({
      where: { id: roomState.matchId },
      data: {
        winnerId,
        endedAt: new Date(),
        status: 'COMPLETED',
        player1Score: p1State.score,
        player2Score: p2State.score,
      },
    });

    // Recalculate MCQ ELO
    const p1 = await prisma.user.findUnique({ where: { id: p1Id } });
    const p2 = await prisma.user.findUnique({ where: { id: p2Id } });

    if (p1 && p2) {
      const elo1 = p1.mcqEloRating;
      const elo2 = p2.mcqEloRating;

      const K = 32;
      const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
      const expected2 = 1 / (1 + Math.pow(10, (elo1 - elo2) / 400));

      let actual1 = 0.5;
      let actual2 = 0.5;

      if (winnerId === p1Id) { actual1 = 1; actual2 = 0; }
      else if (winnerId === p2Id) { actual1 = 0; actual2 = 1; }

      const newElo1 = Math.round(elo1 + K * (actual1 - expected1));
      const newElo2 = Math.round(elo2 + K * (actual2 - expected2));

      await prisma.user.update({ where: { id: p1Id }, data: { mcqEloRating: newElo1 } });
      await prisma.user.update({ where: { id: p2Id }, data: { mcqEloRating: newElo2 } });

      logger.info(`[MCQ] ELO Updated: ${p1.username} (${elo1} → ${newElo1}), ${p2.username} (${elo2} → ${newElo2})`);
    }

    // Clean up Redis
    await this.deleteMcqRoomState(roomId);
  }

  // ── Redis Helpers ────────────────────────────────────────────────

  static async saveMcqRoomState(roomId: string, state: McqRoomState): Promise<void> {
    const { redis } = await import('../config/redis.js');
    await redis.setex(`${MCQ_ROOM_PREFIX}${roomId}`, MCQ_ROOM_TTL, JSON.stringify(state));
  }

  static async getMcqRoomState(roomId: string): Promise<McqRoomState | null> {
    const { redis } = await import('../config/redis.js');
    const raw = await redis.get(`${MCQ_ROOM_PREFIX}${roomId}`);
    if (!raw) return null;
    return JSON.parse(raw) as McqRoomState;
  }

  static async deleteMcqRoomState(roomId: string): Promise<void> {
    const { redis } = await import('../config/redis.js');
    await redis.del(`${MCQ_ROOM_PREFIX}${roomId}`);
    logger.info(`[MCQ] Room ${roomId} state deleted from Redis`);
  }

  /**
   * Sanitize room state before sending to clients —
   * strips out the full question bank and the correctIndex.
   */
  static sanitizeForClient(state: McqRoomState): Omit<McqRoomState, 'questions'> & { questions?: undefined } {
    const { questions, ...rest } = state;
    return rest;
  }
}
