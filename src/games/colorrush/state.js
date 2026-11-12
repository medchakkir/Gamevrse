// Shared runtime state and constants for ColorRush.
// `ctx.io` is the Socket.IO namespace, assigned by attach() in index.js.
const ctx = { io: null };

const playerRoom = {}; // socket.id -> roomId

// Store freeze timeouts separately to avoid circular references
const playerFreezeTimeouts = new Map(); // playerId -> timeout

// REMOVED: const MAX_ROUNDS = 15; // Now dynamic per room via room.settings.maxRounds
const COLORS = ["red", "green", "blue", "yellow"];

// Default game settings (used when creating new rooms)
const DEFAULT_GAME_SETTINGS = {
  maxPlayers: 6,
  maxRounds: 15,
  powerUpsEnabled: true,
  isPrivate: true
};

// Ready timeout (ms)
const READY_TIMEOUT_MS = 8000;

// Round timer settings
const ROUND_DURATION_MS = 30000; // 30 seconds per round

const TIMER_UPDATE_INTERVAL = 100; // Update timer every 100ms

// ========== STRICT 4-PHASE ROUND SYSTEM ==========

// Phase constants
const PHASE_GET_READY = "GET_READY";

const PHASE_SEQUENCE = "SEQUENCE";

const PHASE_PLAY = "PLAY";

const PHASE_ROUND_END = "ROUND_END";

function log(...args) { console.log.apply(console, args); }

module.exports = { ctx, log, playerRoom, playerFreezeTimeouts, COLORS, DEFAULT_GAME_SETTINGS, READY_TIMEOUT_MS, ROUND_DURATION_MS, TIMER_UPDATE_INTERVAL, PHASE_GET_READY, PHASE_SEQUENCE, PHASE_PLAY, PHASE_ROUND_END };
