import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

export type MatchMode = 'code' | 'mcq';

const QUEUE_KEY_PREFIX_CODE = 'matchmaking:queue:code:';
const QUEUE_KEY_PREFIX_MCQ  = 'matchmaking:queue:mcq:';
const QUEUE_TTL = 120; // 2 minutes — player auto-dequeues if server dies

function prefix(mode: MatchMode): string {
  return mode === 'mcq' ? QUEUE_KEY_PREFIX_MCQ : QUEUE_KEY_PREFIX_CODE;
}

export interface QueueEntry {
  userId: string;
  username: string;
  eloRating: number;
  joinedAt: number;
  mode: MatchMode;
}

export class MatchmakingService {
  /**
   * Adds a player to the matchmaking queue for a specific mode.
   * Idempotent — calling twice for the same user is safe.
   */
  static async enqueue(entry: QueueEntry): Promise<void> {
    const key = `${prefix(entry.mode)}${entry.userId}`;
    await redis.setex(key, QUEUE_TTL, JSON.stringify(entry));
    logger.info(`[Matchmaking] ${entry.username} (ELO ${entry.eloRating}) joined ${entry.mode.toUpperCase()} queue`);
  }

  /**
   * Removes a player from the matchmaking queue.
   * Checks both queues if mode is not specified.
   */
  static async dequeue(userId: string, mode?: MatchMode): Promise<void> {
    if (mode) {
      await redis.del(`${prefix(mode)}${userId}`);
    } else {
      // Remove from both queues (safe — del is a no-op on missing keys)
      await redis.del(`${QUEUE_KEY_PREFIX_CODE}${userId}`);
      await redis.del(`${QUEUE_KEY_PREFIX_MCQ}${userId}`);
    }
    logger.info(`[Matchmaking] Player ${userId} left queue${mode ? ` (${mode})` : ''}`);
  }

  /**
   * Checks if a player is currently in any queue.
   */
  static async isInQueue(userId: string): Promise<boolean> {
    const codeExists = await redis.exists(`${QUEUE_KEY_PREFIX_CODE}${userId}`);
    if (codeExists === 1) return true;
    const mcqExists = await redis.exists(`${QUEUE_KEY_PREFIX_MCQ}${userId}`);
    return mcqExists === 1;
  }

  /**
   * Returns the current queue entry for a player, or null.
   */
  static async getEntry(userId: string): Promise<QueueEntry | null> {
    let raw = await redis.get(`${QUEUE_KEY_PREFIX_CODE}${userId}`);
    if (raw) return JSON.parse(raw);
    raw = await redis.get(`${QUEUE_KEY_PREFIX_MCQ}${userId}`);
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Fetches all players currently waiting in a specific queue.
   */
  static async getAllQueued(mode: MatchMode = 'code'): Promise<QueueEntry[]> {
    const keys = await redis.keys(`${prefix(mode)}*`);
    if (keys.length === 0) return [];

    const entries: QueueEntry[] = [];
    for (const key of keys) {
      const raw = await redis.get(key);
      if (raw) entries.push(JSON.parse(raw) as QueueEntry);
    }

    // Sort by join time — longest waiting player matched first
    return entries.sort((a, b) => a.joinedAt - b.joinedAt);
  }

  /**
   * Finds the best opponent for a given player within the same mode queue.
   * Strategy: ELO proximity within tolerance, then wait time as tiebreaker.
   * If no one is within ELO_TOLERANCE, the system widens and takes the longest-waiting player.
   */
  static async findOpponent(userId: string, userElo: number, mode: MatchMode = 'code'): Promise<QueueEntry | null> {
    const queue = await this.getAllQueued(mode);
    const candidates = queue.filter((e) => e.userId !== userId);
    if (candidates.length === 0) return null;

    const ELO_TOLERANCE = 200;
    const withinRange = candidates.filter(
      (e) => Math.abs(e.eloRating - userElo) <= ELO_TOLERANCE
    );

    // Prefer closest ELO within range, fallback to longest-waiting overall
    const pool = withinRange.length > 0 ? withinRange : candidates;
    return pool.reduce((best, curr) =>
      Math.abs(curr.eloRating - userElo) < Math.abs(best.eloRating - userElo) ? curr : best
    );
  }

  /**
   * Returns queue size and average wait time for a specific mode.
   */
  static async getQueueStatus(mode: MatchMode = 'code'): Promise<{ size: number; avgWaitSeconds: number }> {
    const queue = await this.getAllQueued(mode);
    if (queue.length === 0) return { size: 0, avgWaitSeconds: 0 };

    const now = Date.now();
    const avgWait = queue.reduce((sum, e) => sum + (now - e.joinedAt), 0) / queue.length;

    return { size: queue.length, avgWaitSeconds: Math.round(avgWait / 1000) };
  }
}
