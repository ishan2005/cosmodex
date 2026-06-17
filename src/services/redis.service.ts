import { redis } from '../config/redis.js';
import { RoomState } from '../types/index.js';
import { logger } from '../config/logger.js';

const ROOM_PREFIX  = 'room:';
const DRAFT_PREFIX = 'draft:';
const ROOM_TTL     = 3600; // 1 hour

export class RedisService {

  /**
   * Persist the full room state to Redis with a 1-hour TTL.
   * Errors propagate to the caller — not silently swallowed.
   */
  static async saveRoomState(roomId: string, state: RoomState): Promise<void> {
    await redis.setex(`${ROOM_PREFIX}${roomId}`, ROOM_TTL, JSON.stringify(state));
  }

  /**
   * Retrieve room state. Returns null when the key is missing or expired.
   */
  static async getRoomState(roomId: string): Promise<RoomState | null> {
    const raw = await redis.get(`${ROOM_PREFIX}${roomId}`);
    if (!raw) return null;
    return JSON.parse(raw) as RoomState;
  }

  /**
   * Delete room state and all associated player drafts.
   * Called when a match ends or is force-closed.
   */
  static async deleteRoomState(roomId: string): Promise<void> {
    await redis.del(`${ROOM_PREFIX}${roomId}`);

    // Clean up all drafts for this room in a single pipeline
    const draftKeys = await redis.keys(`${DRAFT_PREFIX}${roomId}:*`);
    if (draftKeys.length > 0) {
      for (const key of draftKeys) {
        await redis.del(key);
      }
    }

    logger.info(`[Redis] Room ${roomId} state and drafts deleted`);
  }

  /**
   * Autosave a player's code draft (overwrites on each call).
   */
  static async saveDraft(roomId: string, userId: string, draft: string): Promise<void> {
    await redis.setex(`${DRAFT_PREFIX}${roomId}:${userId}`, ROOM_TTL, draft);
  }

  /**
   * Retrieve a player's last saved draft. Returns '' when nothing is cached.
   */
  static async getDraft(roomId: string, userId: string): Promise<string> {
    const draft = await redis.get(`${DRAFT_PREFIX}${roomId}:${userId}`);
    return draft ?? '';
  }

  /**
   * Check whether a room key exists in Redis.
   */
  static async roomExists(roomId: string): Promise<boolean> {
    const count = await redis.exists(`${ROOM_PREFIX}${roomId}`);
    return count === 1;
  }
}
