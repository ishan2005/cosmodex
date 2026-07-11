/**
 * Shared in-memory set of active room IDs.
 *
 * Populated when a room is created (MatchService.createRoomState),
 * removed when a match ends (MatchService.endMatch) or the timer tick
 * detects a stale/completed room.
 *
 * Lives in its own module to avoid circular imports between
 * services/match.service.ts ↔ sockets/index.ts.
 */
export const activeRoomIds = new Set<string>();

/**
 * Shared in-memory set of active MCQ room IDs.
 *
 * Populated when an MCQ match is created (matchmaking handler),
 * removed when the MCQ match ends or the MCQ timer tick
 * detects a completed room.
 */
export const activeMcqRoomIds = new Set<string>();
