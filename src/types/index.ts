export type MatchStatus = 'LOBBY' | 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
export type PlayerStatus = 'CODING' | 'WAITING_DECISION' | 'STAYING' | 'SKIPPED' | 'DONE' | 'ELIMINATED';

export interface PlayerState {
  userId: string;
  username: string;
  lives: number;
  points: number;
  status: PlayerStatus;
  currentDraft: string;
  submissionsCount: number;
  stageScores: Record<number, number>; // Maps stageIndex (1-5) to score
  decisionTimeout: number | null; // Timestamp in ms
}

export interface RoomState {
  matchId: string;
  roomId: string;
  status: MatchStatus;
  currentStage: number; // 1 to 5 = Sprint stages, 6 = Boss Battle
  stageTimeRemaining: number; // in seconds
  stageEndTime: number; // Timestamp in ms
  playerIds: string[];
  problems: string[]; // List of Problem UUIDs (index 0-4 are sprint, index 5 is boss)
  players: Record<string, PlayerState>;
}

export interface TestCaseResult {
  passed: boolean;
  input: string;
  expected: string;
  actual: string;
  isPublic: boolean;
}

export interface ExecutionResult {
  status: 'ACCEPTED' | 'WRONG_ANSWER' | 'TIME_LIMIT_EXCEEDED' | 'RUNTIME_ERROR';
  passedCount: number;
  totalCount: number;
  testCases: TestCaseResult[];
}
