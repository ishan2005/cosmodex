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
