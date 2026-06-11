import { prisma } from '../config/db.js';
import { RedisService } from './redis.service.js';
import { RoomState, PlayerState, PlayerStatus } from '../types/index.js';
import { logger } from '../config/logger.js';

const STAGE_TIMER_SEC = 180; // 3 minutes per Sprint stage
const BOSS_TIMER_SEC = 1200; // 20 minutes for Boss Battle
const POINTS_FOR_LIFE_REDEMPTION = 100;

export class MatchService {
  /**
   * Initializes a room state in Redis.
   */
  static async createRoomState(
    roomId: string,
    player1Id: string,
    player2Id: string,
    problemIds: string[]
  ): Promise<RoomState> {
    const p1 = await prisma.user.findUnique({ where: { id: player1Id } });
    const p2 = await prisma.user.findUnique({ where: { id: player2Id } });

    if (!p1 || !p2) {
      throw new Error('One or both players not found in database');
    }

    const match = await prisma.match.create({
      data: {
        player1Id: p1.id,
        player2Id: p2.id,
        status: 'ACTIVE',
      },
    });

    const players: Record<string, PlayerState> = {
      [p1.id]: {
        userId: p1.id,
        username: p1.username,
        lives: 5,
        points: 0,
        status: 'CODING',
        currentDraft: '',
        submissionsCount: 0,
        stageScores: {},
        decisionTimeout: null,
      },
      [p2.id]: {
        userId: p2.id,
        username: p2.username,
        lives: 5,
        points: 0,
        status: 'CODING',
        currentDraft: '',
        submissionsCount: 0,
        stageScores: {},
        decisionTimeout: null,
      },
    };

    const roomState: RoomState = {
      matchId: match.id,
      roomId,
      status: 'ACTIVE',
      currentStage: 1,
      stageTimeRemaining: STAGE_TIMER_SEC,
      stageEndTime: Date.now() + STAGE_TIMER_SEC * 1000,
      playerIds: [p1.id, p2.id],
      problems: problemIds,
      players,
    };

    await RedisService.saveRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Handles Player B making a choice of either 'skip' or 'stay' in Phase 1
   */
  static async handleSkipOrStayDecision(
    roomId: string,
    userId: string,
    choice: 'skip' | 'stay'
  ): Promise<RoomState> {
    const roomState = await RedisService.getRoomState(roomId);
    if (!roomState) throw new Error('Match session not found');

    const player = roomState.players[userId];
    if (!player) throw new Error('Player not in room');

    if (player.status !== 'WAITING_DECISION') {
      logger.warn(`Player ${userId} tried to decide ${choice} but is in status ${player.status}`);
      return roomState;
    }

    player.decisionTimeout = null;

    if (choice === 'skip') {
      player.status = 'SKIPPED';
      player.lives = Math.max(0, player.lives - 1);
      logger.info(`Player ${userId} chose to SKIP Stage ${roomState.currentStage}. Lost 1 life. Remaining: ${player.lives}`);
      
      // Since they skipped, they are ready to advance.
      // Check if both players are ready to transition
      return await this.checkAndAdvanceStage(roomId, roomState);
    } else {
      player.status = 'STAYING';
      logger.info(`Player ${userId} chose to STAY on Stage ${roomState.currentStage}.`);
      await RedisService.saveRoomState(roomId, roomState);
      return roomState;
    }
  }

  /**
   * Evaluates if we need to transition the match to the next stage.
   */
  private static async checkAndAdvanceStage(roomId: string, roomState: RoomState): Promise<RoomState> {
    const players = Object.values(roomState.players);
    const allDoneOrSkipped = players.every(
      (p) => p.status === 'DONE' || p.status === 'SKIPPED' || p.status === 'ELIMINATED'
    );

    if (allDoneOrSkipped) {
      return await this.advanceStage(roomId, roomState);
    }
    // Save mutated player statuses in Redis cache
    await RedisService.saveRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Deducts 1 life for incorrect submissions during the high-risk "Stay" period.
   */
  static async handleWrongSubmissionInStay(roomId: string, userId: string): Promise<RoomState> {
    const roomState = await RedisService.getRoomState(roomId);
    if (!roomState) throw new Error('Match session not found');

    const player = roomState.players[userId];
    if (!player) throw new Error('Player not in room');

    if (player.status !== 'STAYING') {
      return roomState;
    }

    player.lives = Math.max(0, player.lives - 1);
    logger.info(`Player ${userId} submitted INCORRECT during Stay. Lost 1 life. Remaining: ${player.lives}`);

    if (player.lives <= 0) {
      player.status = 'ELIMINATED';
      logger.info(`Player ${userId} has been ELIMINATED from this stage (out of lives).`);
      return await this.checkAndAdvanceStage(roomId, roomState);
    }

    await RedisService.saveRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Handles a successful code submission (pass 100% test cases)
   */
  static async handleCorrectSubmission(
    roomId: string,
    userId: string,
    pointsAwarded: number
  ): Promise<{ roomState: RoomState; firstFinisher: boolean }> {
    const roomState = await RedisService.getRoomState(roomId);
    if (!roomState) throw new Error('Match session not found');

    const player = roomState.players[userId];
    if (!player) throw new Error('Player not in room');

    const isPhase1 = roomState.currentStage <= 5;
    
    if (isPhase1) {
      // In Phase 1 (Sprint):
      // Check if they are the first to finish
      const opponentId = roomState.playerIds.find((id) => id !== userId)!;
      const opponent = roomState.players[opponentId];
      
      const isFirst = Object.values(roomState.players).every((p) => p.status !== 'DONE');

      player.status = 'DONE';
      player.stageScores[roomState.currentStage] = pointsAwarded;
      player.points += pointsAwarded;

      let firstFinisher = false;

      if (isFirst) {
        firstFinisher = true;
        logger.info(`Player ${userId} is the first to complete Stage ${roomState.currentStage}`);
        
        // Interrupt opponent, putting them into WAITING_DECISION
        if (opponent.status === 'CODING') {
          opponent.status = 'WAITING_DECISION';
          // 15 seconds decision window
          opponent.decisionTimeout = Date.now() + 15 * 1000;
        }
      } else {
        logger.info(`Player ${userId} completed Stage ${roomState.currentStage} after choosing STAY`);
      }

      const updatedState = await this.checkAndAdvanceStage(roomId, roomState);
      return { roomState: updatedState, firstFinisher };
    } else {
      // In Phase 2 (Boss Battle):
      // Correct submission means immediate victory!
      player.status = 'DONE';
      player.points += pointsAwarded;
      roomState.status = 'COMPLETED';
      
      await RedisService.saveRoomState(roomId, roomState);
      await this.endMatch(roomId, userId);

      return { roomState, firstFinisher: true };
    }
  }

  /**
   * Increments stage, resetting player states. Transitions to Boss Battle if stage > 5.
   */
  private static async advanceStage(roomId: string, roomState: RoomState): Promise<RoomState> {
    roomState.currentStage += 1;
    const isBoss = roomState.currentStage === 6;

    logger.info(`Advancing room ${roomId} to Stage ${roomState.currentStage} (Boss: ${isBoss})`);

    const limit = isBoss ? BOSS_TIMER_SEC : STAGE_TIMER_SEC;
    roomState.stageTimeRemaining = limit;
    roomState.stageEndTime = Date.now() + limit * 1000;

    for (const pid of roomState.playerIds) {
      const player = roomState.players[pid];
      
      // Reset statuses for the next stage (unless they are already dead)
      if (isBoss) {
        player.status = 'CODING';
        player.decisionTimeout = null;
      } else {
        player.status = 'CODING';
        player.decisionTimeout = null;
      }
    }

    await RedisService.saveRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Handles stage timeouts. Deducts lives from anyone who hasn't completed/skipped.
   */
  static async handleStageTimeout(roomId: string): Promise<RoomState> {
    const roomState = await RedisService.getRoomState(roomId);
    if (!roomState) throw new Error('Match session not found');

    const isBoss = roomState.currentStage === 6;
    logger.info(`Stage ${roomState.currentStage} TIMEOUT in room ${roomId}.`);

    if (isBoss) {
      // Boss battle timeout: match ends in a draw (or no winner)
      roomState.status = 'COMPLETED';
      await RedisService.saveRoomState(roomId, roomState);
      await this.endMatch(roomId, null);
      return roomState;
    }

    // Phase 1 Sprint timeout
    for (const pid of roomState.playerIds) {
      const player = roomState.players[pid];
      if (player.status !== 'DONE' && player.status !== 'SKIPPED') {
        // Did not finish: lost a life
        player.lives = Math.max(0, player.lives - 1);
        player.status = player.lives <= 0 ? 'ELIMINATED' : 'DONE';
        logger.info(`Player ${player.username} failed to finish before timeout. Lost 1 life. Remaining: ${player.lives}`);
      }
    }

    // Force transition to next stage
    return await this.advanceStage(roomId, roomState);
  }

  /**
   * Redems 100 points for an extra life during the Boss Battle.
   */
  static async handleRedeemLife(roomId: string, userId: string): Promise<RoomState> {
    const roomState = await RedisService.getRoomState(roomId);
    if (!roomState) throw new Error('Match session not found');

    const player = roomState.players[userId];
    if (!player) throw new Error('Player not in room');

    if (roomState.currentStage !== 6) {
      throw new Error('Life redemption is only allowed in the Boss Battle phase');
    }

    if (player.points < POINTS_FOR_LIFE_REDEMPTION) {
      throw new Error('Insufficient points to redeem a life');
    }

    player.points -= POINTS_FOR_LIFE_REDEMPTION;
    player.lives += 1;
    logger.info(`Player ${userId} redeemed ${POINTS_FOR_LIFE_REDEMPTION} points for 1 life. Current lives: ${player.lives}, points: ${player.points}`);

    await RedisService.saveRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Finalizes the match, updates ELO, and deletes Redis cache.
   */
  static async endMatch(roomId: string, winnerId: string | null): Promise<void> {
    const roomState = await RedisService.getRoomState(roomId);
    if (!roomState) return;

    logger.info(`Finalizing match ${roomState.matchId} in database. Winner: ${winnerId}`);

    const player1Id = roomState.playerIds[0];
    const player2Id = roomState.playerIds[1];

    const p1State = roomState.players[player1Id];
    const p2State = roomState.players[player2Id];

    // Update match logs in SQLite
    await prisma.match.update({
      where: { id: roomState.matchId },
      data: {
        winnerId,
        endedAt: new Date(),
        status: 'COMPLETED',
        player1Score: p1State.points,
        player2Score: p2State.points,
      },
    });

    // Recalculate ELO
    const p1 = await prisma.user.findUnique({ where: { id: player1Id } });
    const p2 = await prisma.user.findUnique({ where: { id: player2Id } });

    if (p1 && p2) {
      const elo1 = p1.eloRating;
      const elo2 = p2.eloRating;

      const K = 32;
      const expected1 = 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
      const expected2 = 1 / (1 + Math.pow(10, (elo1 - elo2) / 400));

      let actual1 = 0.5;
      let actual2 = 0.5;

      if (winnerId === player1Id) {
        actual1 = 1;
        actual2 = 0;
      } else if (winnerId === player2Id) {
        actual1 = 0;
        actual2 = 1;
      }

      const newElo1 = Math.round(elo1 + K * (actual1 - expected1));
      const newElo2 = Math.round(elo2 + K * (actual2 - expected2));

      await prisma.user.update({
        where: { id: player1Id },
        data: { eloRating: newElo1 },
      });

      await prisma.user.update({
        where: { id: player2Id },
        data: { eloRating: newElo2 },
      });

      logger.info(`ELO Updated: ${p1.username} (${elo1} -> ${newElo1}), ${p2.username} (${elo2} -> ${newElo2})`);
    }

    // Clean up cache
    await RedisService.deleteRoomState(roomId);
  }
}
