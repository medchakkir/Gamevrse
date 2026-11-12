// =============================================================
// config.js — Configuration constants
// =============================================================

export const DISCONNECT_GRACE_PERIOD = 60000; // 60 seconds (increased for better reconnection)
export const JUDGE_BONUS_POINTS = 5;
export const RANKING_TIME = 60000; // 60 seconds for judge to rank answers

// SECURITY: Remove insecure fallback - require explicit ADMIN_TOKEN in production
export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (process.env.NODE_ENV === 'production' ? null : "local-dev-token");

export const DEFAULT_RULES = {
  minPlayers: 3,
  turnTime: 45000,
  multiplier: 1,
  numRounds: 5
};

export const BUILT_IN_QUESTIONS = [
  { text: "Name something people forget to pack.", difficulty: "easy" },
  { text: "Name a reason someone might be late.", difficulty: "easy" },
  { text: "Name something people argue about.", difficulty: "medium" },
  { text: "Name something with a double meaning.", difficulty: "hard" }
];

// Phase constants for explicit state machine
export const ROUND_PHASES = {
  ANSWERING: "answering",
  RANKING: "ranking",
  RESULTS: "results"
};

export const ROOM_STATES = {
  LOBBY: "lobby",
  STARTING: "starting",
  IN_ROUND: "in_round",
  BETWEEN_ROUNDS: "between_rounds",
  GAME_ENDED: "game_ended" // Winner ceremony with 30s auto-return timer
};
