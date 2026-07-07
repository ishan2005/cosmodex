import { prisma } from '../config/db.js';
import { RedisService } from './redis.service.js';
import { RoomState, PlayerState, PlayerStatus } from '../types/index.js';
import { logger } from '../config/logger.js';
import { activeRoomIds } from '../shared/activeRooms.js';

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

    const COUNTDOWN_MS = 5_000; // matches the 5-second client countdown
    const now = Date.now() + COUNTDOWN_MS; // timer starts after countdown ends
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
        currentStage: 1,
        stageStartTime: now,
        stageDuration: STAGE_TIMER_SEC,
        stageTimeRemaining: STAGE_TIMER_SEC,
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
        currentStage: 1,
        stageStartTime: now,
        stageDuration: STAGE_TIMER_SEC,
        stageTimeRemaining: STAGE_TIMER_SEC,
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
    activeRoomIds.add(roomId); // Track for background timer tick
    return roomState;
  }

  /**
   * Handles Player B making a choice of either 'skip' or 'stay' in Phase 1.
   *
   * STAY  → Player A (winner) advances to their next stage immediately as a reward.
   *         Player B stays on the same stage to keep solving.
   * SKIP  → Player B skips (loses 1 life) and both players advance together.
   */
  static async handleSkipOrStayDecision(
    roomId: string,
    userId: string,   // userId = the LOSER (the one deciding)
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
    const winnerId = roomState.playerIds.find((id) => id !== userId)!;
    const winner   = roomState.players[winnerId];

    if (choice === 'skip') {
      // ── SKIP: loser pays 1 life and both advance to winner's next stage ─
      player.lives = Math.max(0, player.lives - 1);
      logger.info(`Player ${userId} chose to SKIP Stage ${player.currentStage}. Lost 1 life. Remaining: ${player.lives}`);

      const nextStage = winner.currentStage + 1;
      const isBoss    = nextStage === 6;
      const limit     = isBoss ? BOSS_TIMER_SEC : STAGE_TIMER_SEC;
      const skipNow   = Date.now();

      if (player.lives <= 0) {
        player.status = 'ELIMINATED';
        logger.info(`Player ${userId} has been ELIMINATED after skipping with 0 lives.`);
      } else {
        player.currentStage       = nextStage;
        player.status             = 'CODING';
        // Both players start the new stage together — reset both personal timers
        player.stageStartTime     = skipNow;
        player.stageDuration      = limit;
        player.stageTimeRemaining = limit;
      }

      winner.currentStage       = nextStage;
      winner.status             = 'CODING';
      winner.decisionTimeout    = null;
      winner.stageStartTime     = skipNow;
      winner.stageDuration      = limit;
      winner.stageTimeRemaining = limit;

      roomState.currentStage       = nextStage;
      roomState.stageTimeRemaining = limit; // kept for Boss Battle shared display
      roomState.stageEndTime       = skipNow + limit * 1000;
      logger.info(`Both players move to Stage ${nextStage} (Boss: ${isBoss})`);

      await RedisService.saveRoomState(roomId, roomState);
      return roomState;
    } else {
      // ── STAY: loser keeps coding; winner advances immediately as reward ─
      player.status = 'STAYING';
      logger.info(`Player ${userId} chose to STAY on Stage ${player.currentStage}.`);
      // Loser's personal timer is NOT touched — they keep their remaining time on this stage

      const winnerNextStage = winner.currentStage + 1;
      if (winnerNextStage > 6) {
        // Winner finished all stages — they win the match
        winner.status    = 'DONE';
        roomState.status = 'COMPLETED';
        await RedisService.saveRoomState(roomId, roomState);
        await this.endMatch(roomId, winnerId);
        return roomState;
      }

      winner.currentStage    = winnerNextStage;
      winner.status          = 'CODING';
      winner.decisionTimeout = null;
      // Winner gets a FRESH timer for their new stage — independent of the loser's remaining time
      winner.stageStartTime     = Date.now();
      winner.stageDuration      = winnerNextStage === 6 ? BOSS_TIMER_SEC : STAGE_TIMER_SEC;
      winner.stageTimeRemaining = winner.stageDuration;
      logger.info(`Winner ${winnerId} advances to Stage ${winnerNextStage} as reward for finishing first.`);

      // Room-level stage = highest personal stage (used for Boss Battle shared clock)
      roomState.currentStage = Math.max(roomState.currentStage, winnerNextStage);

      await RedisService.saveRoomState(roomId, roomState);
      return roomState;
    }
  }

  /**
   * Called after a player solves/fails their personal stage.
   * Advances only the players that have finished THEIR OWN current stage.
   * Does not force the other player to change stage.
   */
  private static async checkAndAdvanceStage(roomId: string, roomState: RoomState): Promise<RoomState> {
    const players       = Object.values(roomState.players);
    const activePlayers = players.filter((p) => p.status !== 'ELIMINATED');

    // All eliminated → draw
    if (activePlayers.length === 0) {
      roomState.status = 'COMPLETED';
      await RedisService.saveRoomState(roomId, roomState);
      await this.endMatch(roomId, null);
      return roomState;
    }

    // Advance each player who is individually done with THEIR stage
    for (const p of activePlayers) {
      if (p.status === 'DONE' || p.status === 'SKIPPED') {
        const nextPersonalStage = p.currentStage + 1;
        if (nextPersonalStage > 6) {
          // This player completed all stages — they win
          roomState.status = 'COMPLETED';
          await RedisService.saveRoomState(roomId, roomState);
          await this.endMatch(roomId, p.userId);
          return roomState;
        }
        p.currentStage    = nextPersonalStage;
        p.status          = 'CODING';
        p.decisionTimeout = null;
        // Give this player a fresh independent timer for their new stage
        p.stageStartTime     = Date.now();
        p.stageDuration      = nextPersonalStage === 6 ? BOSS_TIMER_SEC : STAGE_TIMER_SEC;
        p.stageTimeRemaining = p.stageDuration;
      }
    }

    // Room-level stage = highest personal stage (used for Boss Battle shared clock sync)
    const maxStage = Math.max(...roomState.playerIds.map((id) => roomState.players[id].currentStage));
    if (maxStage !== roomState.currentStage) {
      roomState.currentStage = maxStage;
      if (maxStage === 6) {
        // Boss Battle begins — set shared room-level countdown
        roomState.stageTimeRemaining = BOSS_TIMER_SEC;
        roomState.stageEndTime       = Date.now() + BOSS_TIMER_SEC * 1000;
        logger.info(`Room ${roomId} entered Boss Battle (Stage 6). Shared 20-min timer started.`);
      }
    }

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
      // Lives are GLOBAL (whole-game). ELIMINATED means the player is out for the rest of the match.
      logger.info(`Player ${userId} has been ELIMINATED (0 lives). They are out for the remainder of the match.`);
      return await this.checkAndAdvanceStage(roomId, roomState);
    }

    await RedisService.saveRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Handles a successful code submission (pass 100% test cases).
   * Uses player.currentStage (per-player) not room.currentStage.
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

    const playerStage = player.currentStage;
    const isBoss      = playerStage === 6;

    // ── Boss Battle: first correct answer wins the whole match ────────
    if (isBoss) {
      player.status  = 'DONE';
      player.points += pointsAwarded;
      roomState.status = 'COMPLETED';
      await RedisService.saveRoomState(roomId, roomState);
      await this.endMatch(roomId, userId);
      return { roomState, firstFinisher: true };
    }

    // ── Sprint stage (1–5) ────────────────────────────────────────────
    const opponentId = roomState.playerIds.find((id) => id !== userId)!;
    const opponent   = roomState.players[opponentId];

    // "First finisher on this stage" = opponent is on the SAME stage and hasn't finished yet
    const isFirstOnStage =
      opponent.currentStage === playerStage &&
      opponent.status !== 'DONE' &&
      opponent.status !== 'SKIPPED' &&
      opponent.status !== 'ELIMINATED';

    // BUG 7 FIX: A player in 'STAYING' status who submits correctly must have their status
    // set to 'DONE' BEFORE calling checkAndAdvanceStage. checkAndAdvanceStage only advances
    // players whose status is 'DONE' or 'SKIPPED' — leaving it as 'STAYING' causes them to
    // be permanently skipped by the advance loop and stuck on their stage forever.
    player.status = 'DONE';
    player.stageScores[playerStage] = pointsAwarded;
    player.points += pointsAwarded;

    let firstFinisher = false;

    if (isFirstOnStage) {
      firstFinisher = true;
      logger.info(`Player ${userId} is the first to complete Stage ${playerStage}`);

      // Interrupt opponent with decision window
      if (opponent.status === 'CODING' || opponent.status === 'STAYING') {
        opponent.status          = 'WAITING_DECISION';
        opponent.decisionTimeout = Date.now() + 15 * 1000;
      }

      // ── CRITICAL: do NOT advance the winner's stage yet. ──────────────
      // The winner stays DONE on their current stage.
      // handleSkipOrStayDecision will advance them after the opponent decides.
      await RedisService.saveRoomState(roomId, roomState);
      return { roomState, firstFinisher: true };
    }

    // ── Not first finisher: either B caught up after STAY, or both solved simultaneously ──
    // Advance this player's personal stage (they finished their own stage).
    logger.info(`Player ${userId} completed Stage ${playerStage} (catch-up / async)`);
    const updatedState = await this.checkAndAdvanceStage(roomId, roomState);
    return { roomState: updatedState, firstFinisher: false };
  }

  /**
   * Hard-advances the room to the next stage (used by timer timeout).
   * Resets all player stages to the new room stage.
   */
  private static async advanceStage(roomId: string, roomState: RoomState): Promise<RoomState> {
    roomState.currentStage += 1;
    const isBoss = roomState.currentStage === 6;
    logger.info(`Advancing room ${roomId} to Stage ${roomState.currentStage} (Boss: ${isBoss})`);

    const limit = isBoss ? BOSS_TIMER_SEC : STAGE_TIMER_SEC;
    roomState.stageTimeRemaining = limit;
    roomState.stageEndTime       = Date.now() + limit * 1000;

    for (const pid of roomState.playerIds) {
      const player = roomState.players[pid];
      if (player.status !== 'ELIMINATED') {
        player.currentStage    = roomState.currentStage; // sync per-player stage
        player.status          = 'CODING';
        player.decisionTimeout = null;
      }
    }

    await RedisService.saveRoomState(roomId, roomState);
    return roomState;
  }

  /**
   * Handles BOSS BATTLE timeout only (Stage 6 shared timer).
   * Sprint stage per-player timeouts are handled by handlePlayerTimeouts.
   */
  static async handleStageTimeout(roomId: string): Promise<RoomState> {
    const roomState = await RedisService.getRoomState(roomId);
    if (!roomState) throw new Error('Match session not found');

    logger.info(`Boss Battle TIMEOUT in room ${roomId}. Match ends in a draw.`);
    roomState.status = 'COMPLETED';
    await RedisService.saveRoomState(roomId, roomState);
    await this.endMatch(roomId, null);
    return roomState;
  }

  /**
   * Handles per-player sprint stage timeouts (Stages 1-5).
   * Called by the background timer when any player's personal stageTimeRemaining hits 0.
   * Deducts 1 life from timed-out players and advances their stage.
   */
  static async handlePlayerTimeouts(roomId: string): Promise<RoomState> {
    const roomState = await RedisService.getRoomState(roomId);
    if (!roomState) throw new Error('Match session not found');

    const now = Date.now();
    for (const pid of roomState.playerIds) {
      const player = roomState.players[pid];
      if (['ELIMINATED', 'DONE', 'SKIPPED', 'WAITING_DECISION'].includes(player.status)) continue;

      const elapsed = Math.floor((now - player.stageStartTime) / 1000);
      if (elapsed >= player.stageDuration) {
        player.lives = Math.max(0, player.lives - 1);
        if (player.lives <= 0) {
          player.status = 'ELIMINATED';
          logger.info(`[Timer] Player ${player.username} timed out → ELIMINATED (0 lives).`);
        } else {
          player.status = 'DONE'; // checkAndAdvanceStage will move them to the next stage
          logger.info(`[Timer] Player ${player.username} timed out on Stage ${player.currentStage}. Lives left: ${player.lives}`);
        }
      }
    }

    return this.checkAndAdvanceStage(roomId, roomState);
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
  static async endMatch(roomId: string, winnerId: string | null): Promise<void> { // public — called from match.handler too
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

    // Clean up cache and active tracking
    activeRoomIds.delete(roomId);
    await RedisService.deleteRoomState(roomId);
  }
}
