// Shared runtime state and constants for Blackjack.
// `ctx.io` is the Socket.IO namespace, assigned by attach() in index.js.
const ctx = { io: null };

const READY_COUNTDOWN_MS = 60000;

const ACTION_COOLDOWN_MS = 400;

const TURN_MS = 15000;

const TURN_EMIT_BUFFER_MS = 50;

const ELIM_THRESHOLD = 2;

const RECONNECT_WINDOW_MS = 60 * 1000;

const RETURN_TO_LOBBY_SECONDS = 10;

const NEXT_ROUND_COUNTDOWN_MS = 10000;

const ROULETTE_CHOICE_TIMEOUT_MS = 30000; // 30 seconds to make roulette choices

const rooms = {};

const playersByToken = {};

// Bot management
const bots = new Map(); // botId -> bot data

module.exports = { ctx, READY_COUNTDOWN_MS, ACTION_COOLDOWN_MS, TURN_MS, TURN_EMIT_BUFFER_MS, ELIM_THRESHOLD, RECONNECT_WINDOW_MS, RETURN_TO_LOBBY_SECONDS, NEXT_ROUND_COUNTDOWN_MS, ROULETTE_CHOICE_TIMEOUT_MS, rooms, playersByToken, bots };
