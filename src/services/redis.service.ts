import { redis } from '../config/redis.js';
import { RoomState } from '../types/index.js';
import { logger } from '../config/logger.js';

const ROOM_PREFIX = 'room:';
const DRAFT_PREFIX = 'draft:';
const ROOM_TTL = 3600; // 1 hour TTL for active lobbies

export class RedisService {
  /**
   * Save the full active room state to Redis with a 1-hour expiration.
   */
  static async saveRoomState(roomId: string, state: RoomState): Promise<void> {
    try {
      const key = `${ROOM_PREFIX}${roomId}`;
      const value = JSON.stringify(state);
      await redis.setex(key, ROOM_TTL, value);
    } catch (error) {
      logger.error(`Failed to save room state in Redis for room ${roomId}: ${error}`);
    }
  }

  /**
   * Retrieve room state from Redis. Returns null if expired or missing.
   */
  static async getRoomState(roomId: string): Promise<RoomState | null> {
    try {
      const key = `${ROOM_PREFIX}${roomId}`;
      const value = await redis.get(key);
      if (!value) return null;
      return JSON.parse(value) as RoomState;
    } catch (error) {
      logger.error(`Failed to get room state from Redis for room ${roomId}: ${error}`);
      return null;
    }
  }

  /**
   * Delete room state when the match is archived or closed.
   */
  static async deleteRoomState(roomId: string): Promise<void> {
    try {
      const key = `${ROOM_PREFIX}${roomId}`;
      await redis.del(key);
      
      // Clean up drafts for this room
      const draftKeys = await redis.keys(`${DRAFT_PREFIX}${roomId}:*`);
      for (const draftKey of draftKeys) {
        await redis.del(draftKey);
      }
    } catch (error) {
      logger.error(`Failed to delete room state from Redis for room ${roomId}: ${error}`);
    }
  }

  /**
   * Periodically save player code drafts to prevent data loss.
   */
  static async saveDraft(roomId: string, userId: string, draft: string): Promise<void> {
    try {
      const key = `${DRAFT_PREFIX}${roomId}:${userId}`;
      await redis.setex(key, ROOM_TTL, draft);
    } catch (error) {
      logger.error(`Failed to save code draft for user ${userId} in room ${roomId}: ${error}`);
    }
  }

  /**
   * Fetch saved draft for a user. Returns empty string if none exists.
   */
  static async getDraft(roomId: string, userId: string): Promise<string> {
    try {
      const key = `${DRAFT_PREFIX}${roomId}:${userId}`;
      const draft = await redis.get(key);
      return draft || '';
    } catch (error) {
      logger.error(`Failed to get code draft for user ${userId} in room ${roomId}: ${error}`);
      return '';
    }
  }
}
