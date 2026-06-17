import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

const QUEUE_KEY_PREFIX = 'matchmaking:queue:';
const QUEUE_TTL = 120; // 2 minutes — player auto-dequeues if server dies

export interface QueueEntry {
  userId: string;
  username: string;
  eloRating: number;
  joinedAt: number;
}

export class MatchmakingService {
  /**
   * Adds a player to the matchmaking queue.
   * Idempotent — calling twice for the same user is safe.
   */
  static async enqueue(entry: QueueEntry): Promise<void> {
    const key = `${QUEUE_KEY_PREFIX}${entry.userId}`;
    await redis.setex(key, QUEUE_TTL, JSON.stringify(entry));
    logger.info(`[Matchmaking] ${entry.username} (ELO ${entry.eloRating}) joined queue`);
  }

  /**
   * Removes a player from the matchmaking queue.
   */
  static async dequeue(userId: string): Promise<void> {
    await redis.del(`${QUEUE_KEY_PREFIX}${userId}`);
    logger.info(`[Matchmaking] Player ${userId} left queue`);
  }

  /**
   * Checks if a player is currently in the queue.
   */
  static async isInQueue(userId: string): Promise<boolean> {
    const count = await redis.exists(`${QUEUE_KEY_PREFIX}${userId}`);
    return count === 1;
  }

  /**
   * Returns the current queue entry for a player, or null.
   */
  static async getEntry(userId: string): Promise<QueueEntry | null> {
    const raw = await redis.get(`${QUEUE_KEY_PREFIX}${userId}`);
    return raw ? JSON.parse(raw) : null;
  }

  /**
   * Fetches all players currently waiting in the queue.
   */
  static async getAllQueued(): Promise<QueueEntry[]> {
    const keys = await redis.keys(`${QUEUE_KEY_PREFIX}*`);
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
   * Finds the best opponent for a given player.
   * Strategy: ELO proximity within tolerance, then wait time as tiebreaker.
   * If no one is within ELO_TOLERANCE, the system widens and takes the longest-waiting player.
   */
  static async findOpponent(userId: string, userElo: number): Promise<QueueEntry | null> {
    const queue = await this.getAllQueued();
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
   * Returns queue size and average wait time.
   */
  static async getQueueStatus(): Promise<{ size: number; avgWaitSeconds: number }> {
    const queue = await this.getAllQueued();
    if (queue.length === 0) return { size: 0, avgWaitSeconds: 0 };

    const now = Date.now();
    const avgWait = queue.reduce((sum, e) => sum + (now - e.joinedAt), 0) / queue.length;

    return { size: queue.length, avgWaitSeconds: Math.round(avgWait / 1000) };
  }
}
