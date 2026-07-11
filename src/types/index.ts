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
  decisionTimeout: number | null;      // Timestamp in ms
  currentStage: number;                // This player's personal stage (1–6); advances independently
  // Per-player independent timer (Sprint stages 1-5 only; Boss Battle uses room-level timer)
  stageStartTime: number;              // ms timestamp when this player began their current stage
  stageDuration: number;              // total seconds allocated for this player's current stage
  stageTimeRemaining: number;         // seconds left — recomputed each tick by the server
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

// ── MCQ Battle Types ─────────────────────────────────────────────

export interface McqQuestion {
  id: string;                    // unique identifier for this question
  question: string;              // HTML-decoded question text
  options: string[];             // 4 shuffled answer choices
  correctIndex: number;          // index of the correct answer in options[]
  difficulty: 'easy' | 'medium' | 'hard';
  category: string;
}

export interface McqPlayerState {
  userId: string;
  username: string;
  score: number;                 // correct answers count
  currentAnswer: number | null;  // index they chose (null = no answer yet)
  answered: boolean;             // have they submitted an answer this round?
  streak: number;                // consecutive correct answers
}

export interface McqRoundResult {
  round: number;
  questionText: string;
  correctIndex: number;
  player1Answer: number | null;
  player2Answer: number | null;
}

export interface McqRoomState {
  matchId: string;
  roomId: string;
  status: 'ACTIVE' | 'REVEAL' | 'COMPLETED';
  currentRound: number;          // 1-based
  totalRounds: number;           // 10
  roundTimeRemaining: number;    // seconds
  roundEndTime: number;          // ms timestamp
  playerIds: string[];
  players: Record<string, McqPlayerState>;
  currentQuestion: {
    id: string;
    question: string;
    options: string[];           // sent WITHOUT correctIndex
    difficulty: string;
    category: string;
  } | null;
  questions: McqQuestion[];      // full question bank (server-only, never sent to client)
  roundResults: McqRoundResult[];
}

