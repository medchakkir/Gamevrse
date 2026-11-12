// rooms.js
const COLORS = ["red", "green", "blue", "yellow"];

const rooms = {};

function createRoom(hostSocketId, options = {}) {
  const roomId = generateRoomCode();

  rooms[roomId] = {
    id: roomId,
    hostId: hostSocketId,
    players: {},
    sequence: [],
    round: 0,
    gameStarted: false,
    phase: 'lobby', // lobby, game, postgame
    currentPhase: null, // GET_READY, SEQUENCE, PLAY, ROUND_END (only during game)
    mode: 'NORMAL', // NORMAL or SUDDEN_DEATH - prevents logic leakage
    
    // ROUND SNAPSHOT: Track alive count at round start for decision logic
    aliveAtRoundStart: 0,
    aliveAfterRound: 0,
    
    colorCounter: 0,
    readyTimer: null,
    getReadyTimeout: null, // NEW: Timeout for GET_READY phase auto-advance
    sequenceTimeout: null, // NEW: Timeout for SEQUENCE phase auto-advance (prevents permanent freeze)
    tieBreakerActive: false, // DEPRECATED - will be removed
    tiePlayers: [],
    gameEnding: false,
    // NEW SUDDEN DEATH FLAGS
    isSuddenDeath: false,
    suddenDeathPlayers: null, // FROZEN list - never changes once set
    suddenDeathLength: 5,
    // Second Chance timer pause state
    secondChanceRemainingTime: null,
    secondChancePlayerId: null,
    // New lobby features
    startRequested: false,
    startCountdownTimer: null,
    startCountdownEndsAt: null,
    settings: {
      maxPlayers: options.maxPlayers || 6,
      maxRounds: options.maxRounds || 15,
      powerUpsEnabled: options.powerUpsEnabled !== undefined ? options.powerUpsEnabled : true,
      isPrivate: options.isPrivate ?? true
    }
  };

  return rooms[roomId];
}

function generateRoomCode() {
  // STEP 1: Always generate uppercase room codes for consistency
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  // Ensure uniqueness (room codes are already uppercase)
  if (rooms[result]) {
    return generateRoomCode(); // Recursive retry
  }
  return result; // Already uppercase
}

function getRoom(roomId) {
  return rooms[roomId];
}

function removeRoom(roomId) {
  delete rooms[roomId];
}

// Debug helper to list all rooms
function listRooms() {
  return Object.keys(rooms);
}

// Debug helper to get room count
function getRoomCount() {
  return Object.keys(rooms).length;
}

module.exports = {
  rooms,
  createRoom,
  getRoom,
  removeRoom,
  listRooms,
  getRoomCount
};
