Object.assign(module.exports, { checkAndHandleSinglePlayer, broadcastRoomState, sendPendingEliminationUI, broadcastMatchStatus, startGameCountdown, clearGameCountdown, cancelGameCountdown, canStartGame, tryStartGame, checkAllPlayersReady, actuallyStartGame, generateSequence, updatePlayerList, createNewPlayer, resetPlayersState, resetRoundState, fullReset, resetLobbyState }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { resetSecondChanceForNewMatch } = require('./powerups');
const { startNextRound, waitForReadies } = require('./rounds');
const { COLORS, log } = require('./state');
const { cleanupTimerState, clearPhaseTimers, safeEndGame } = require('./timers');


// Utility: Check if only one player remains and end game
function checkAndHandleSinglePlayer(room, context = '') {
  const remainingPlayers = Object.keys(room.players);
  if (remainingPlayers.length === 1) {
    const winnerId = remainingPlayers[0];
    log(`[${context}] ⚡ Only 1 player remains - instant win for ${winnerId}`);
    safeEndGame(room, winnerId);
    return true;
  }
  return false;
}


// Utility: Broadcast room state to all players
function broadcastRoomState(room) {
  ctx.io.to(room.id).emit("roomState", {
    roomId: room.id,
    hostId: room.hostId,
    players: Object.values(room.players),
    maxPlayers: room.settings.maxPlayers,
    phase: room.phase,
    startCountdownEndsAt: room.startCountdownEndsAt,
    settings: {
      maxPlayers: room.settings.maxPlayers,
      maxRounds: room.settings.maxRounds,
      powerUpsEnabled: room.settings.powerUpsEnabled
    }
  });
}


// Utility: Send pending elimination UI to player
function sendPendingEliminationUI(room, playerId, is1v1Endgame = false, isDraw = false) {
  const player = room.players[playerId];
  if (player && player.pendingElimination) {
    log(`[elimination] Sending elimination UI to ${player.name} (1v1=${is1v1Endgame}, draw=${isDraw})`);
    ctx.io.to(playerId).emit("eliminated", { 
      is1v1Endgame, 
      round: room.round,
      isDraw 
    });
    player.pendingElimination = false;
    return true;
  }
  return false;
}


// Broadcast match status to eliminated players
function broadcastMatchStatus(room) {
  log(`[broadcastMatchStatus] Called for room ${room ? room.id : 'null'}`);
  
  if (!room) {
    log('[broadcastMatchStatus] No room provided');
    return;
  }
  
  if (!room.gameStarted) {
    log(`[broadcastMatchStatus] Game not started in room ${room.id}`);
    return;
  }
  
  const alivePlayers = Object.values(room.players).filter(p => p.alive);
  const aliveCount = alivePlayers.length;
  const totalPlayers = Object.keys(room.players).length;
  const eliminatedCount = totalPlayers - aliveCount;
  
  log(`[${room.id}] Match status: ${aliveCount} alive, ${eliminatedCount} eliminated, round ${room.round}`);
  
  // Build leaderboard snapshot (all players, sorted by score)
  const leaderboard = Object.values(room.players)
    .map(p => ({
      id: p.id,
      name: p.name,
      score: Math.round(p.score || 0),
      alive: p.alive,
      roundEliminated: p.alive ? null : (p.roundEliminated || room.round)
    }))
    .sort((a, b) => b.score - a.score);
  
  // Determine status message
  let statusMessage = 'Game in progress...';
  if (aliveCount === 2) {
    statusMessage = '⚔️ Final duel underway!';
  } else if (aliveCount === 1) {
    statusMessage = '🏆 Winner will be announced shortly';
  } else if (room.round >= room.settings.maxRounds - 2) {
    statusMessage = '🔥 Final rounds approaching!';
  }
  
  const matchStatus = {
    roundNumber: room.round,
    alivePlayerCount: aliveCount,
    leaderboard,
    statusMessage,
    isFinalDuel: aliveCount === 2
  };
  
  // Send to all eliminated players
  let sentCount = 0;
  Object.entries(room.players).forEach(([id, player]) => {
    if (!player.alive) {
      ctx.io.to(id).emit("matchStatusUpdate", matchStatus);
      log(`[${room.id}] ✉️ Sent match status to ${player.name} (${id}): Round ${room.round}, ${aliveCount} alive`);
      sentCount++;
    }
  });
  
  if (sentCount === 0) {
    log(`[${room.id}] ⚠️ No eliminated players to send match status to`);
  } else {
    log(`[${room.id}] ✅ Sent match status to ${sentCount} eliminated player(s)`);
  }
}



// Lobby management functions
function startGameCountdown(room) {
  // Clear any existing countdown
  clearGameCountdown(room);
  
  const COUNTDOWN_DURATION = 30000; // 30 seconds
  room.startCountdownEndsAt = Date.now() + COUNTDOWN_DURATION;
  
  room.startCountdownTimer = setTimeout(() => {
    // Auto-start game when countdown reaches 0
    if (room.phase === 'lobby' && Object.keys(room.players).length >= 2) {
      actuallyStartGame(room);
    }
  }, COUNTDOWN_DURATION);
  
  // Broadcast countdown start
  ctx.io.to(room.id).emit("gameStarting", {
    endsAt: room.startCountdownEndsAt,
    duration: COUNTDOWN_DURATION
  });
  
  log(`[${room.id}] Game countdown started, ends at ${new Date(room.startCountdownEndsAt)}`);
}


function clearGameCountdown(room) {
  if (room.startCountdownTimer) {
    clearTimeout(room.startCountdownTimer);
    room.startCountdownTimer = null;
  }
  room.startCountdownEndsAt = null;
}


function cancelGameCountdown(room) {
  clearGameCountdown(room);
  ctx.io.to(room.id).emit("gameStartCancelled");
  log(`[${room.id}] Game countdown cancelled`);
}


// Authoritative gate: Can the game start now?
function canStartGame(room) {
  // Must be in lobby phase
  if (room.phase !== 'lobby') return false;
  
  // Game must not already be started
  if (room.gameStarted) return false;
  
  // Must have minimum players
  if (Object.keys(room.players).length < 2) return false;
  
  // Host must have requested start
  if (!room.startRequested) return false;
  
  // All non-host players must be ready
  return checkAllPlayersReady(room);
}


// Try to start the game (called from both host and player ready handlers)
function tryStartGame(room) {
  if (canStartGame(room)) {
    // Both conditions met - start immediately
    log(`[${room.id}] ✅ Both conditions met (host started + all ready) - starting immediately`);
    clearGameCountdown(room);
    actuallyStartGame(room);
  } else if (room.startRequested && !room.startCountdownTimer && !room.gameStarted) {
    // Host has started but not all players ready - start countdown
    log(`[${room.id}] ⏳ Host started but not all ready - starting countdown`);
    startGameCountdown(room);
  }
}


function checkAllPlayersReady(room) {
  const players = Object.values(room.players);
  if (players.length < 2) return false;
  
  // Only check non-host players for ready status
  const nonHostPlayers = players.filter(p => p.id !== room.hostId);
  if (nonHostPlayers.length === 0) return false;
  
  return nonHostPlayers.every(p => p.isReady);
}


function actuallyStartGame(room) {
  // Clear countdown
  clearGameCountdown(room);
  
  // Check minimum players
  if (Object.keys(room.players).length < 2) {
    ctx.io.to(room.id).emit("gameStartError", "Need at least 2 players to start");
    return;
  }

  room.gameStarted = true;
  room.phase = 'game';
  room.round = 0;
  room.sequence = [];
  room.gameStartTime = Date.now(); // Track game start time

  resetPlayersState(room);
  
  // Notify all players of phase change
  ctx.io.to(room.id).emit("phaseChange", { phase: 'game', roomId: room.id });
  
  // FIX: Start first round directly instead of using old waitForReadies system
  // This prevents double increment bug where both waitForReadies timer and playerReady handler call startNextRound
  startNextRound(room);

  log(`Game started in room ${room.id}`);
}


function generateSequence(room, length) {
  room.sequence = [];
  for (let i = 0; i < length; i++) {
    room.sequence.push(COLORS[Math.floor(Math.random() * COLORS.length)]);
  }
  log(`[generateSequence] round=${room.round} len=${length} seq=${room.sequence.join(',')}`);
}


function updatePlayerList(room) {
  if (!room) return;
  const list = Object.entries(room.players).map(([id, p]) => ({
    id,
    name: p.name,
    colorIndex: p.colorIndex,
    alive: p.alive,
    lives: p.lives,
    score: Math.round(p.score || 0),
    powerups: p.powerups || {}
  }));
  ctx.io.to(room.id).emit("playerList", list);
  ctx.io.to(room.id).emit("playerCount", Object.keys(room.players).length);
}


function createNewPlayer(socketId, name) {
  return {
    id: socketId,
    name: name || `Player-${socketId.slice(0, 4)}`,
    alive: true,
    lives: 2,
    score: 0,
    streak: 0,
    time: 0,
    answered: false,
    ready: false,
    isReady: false, // Lobby ready state
    colorIndex: Math.floor(Math.random() * 4),
    // Statistics tracking
    totalTime: 0,
    roundsPlayed: 0,
    avgTime: 0,
    fastestTime: Infinity,
    // NEW SECOND CHANCE POWERUP SYSTEM
    powerups: {
      secondChance: {
        available: true,    // Can be activated
        active: false,      // Currently armed
        used: false         // Permanently used (one-time per match)
      },
      freeze: {
        available: true,
        used: false,
        active: false,
        round: null,
        startTime: null,
        duration: 3000
      },
      patternPeek: {
        available: true,
        used: false
      }
    }
  };
}



// Reset player runtime state
function resetPlayersState(room) {
  for (const id in room.players) {
    const p = room.players[id];
    p.alive = true;
    p.lives = 2;
    p.score = 0;
    p.streak = 0;
    p.time = 0;
    p.answered = false;
    p.ready = false;
    
    // Reset Second Chance for new match (complete reset)
    resetSecondChanceForNewMatch(p);
    
    // Reset other power-ups
    p.powerups.freeze.available = true;
    p.powerups.freeze.used = false;
    p.powerups.freeze.active = false;
    p.powerups.freeze.round = null;
    p.powerups.freeze.startTime = null;
    
    p.powerups.patternPeek.available = true;
    p.powerups.patternPeek.used = false;
    
    // Do NOT reset isReady here - that's lobby state, handled separately
  }
}


// Reset round variables
function resetRoundState(room) {
  room.round = 0;
  room.sequence = [];
  room.roundInProgress = false;
  room.tieBreakerActive = false;
  room.tiePlayers = [];
  clearPhaseTimers(room);
}


// Full reset after game
function fullReset(room) {
  resetPlayersState(room);
  resetRoundState(room);
  resetLobbyState(room); // Add lobby state reset
  room.gameStarted = false;
  room.gameEnding = false; // Reset the ending flag
  
  // Reset sudden death state
  room.isSuddenDeath = false;
  room.suddenDeathLength = 5;
  room.suddenDeathPlayers = []; // Clear frozen list
  room.suddenDeathRoundId = 0;
  room.tiePlayers = [];
  
  // Clean up timer state
  cleanupTimerState(room);
  
  updatePlayerList(room);
}


// Reset lobby state to clean condition
function resetLobbyState(room) {
  // Clear all countdown-related state
  clearGameCountdown(room);
  
  // Reset start requested flag
  room.startRequested = false;
  
  // Reset ALL player ready states to false
  for (const id in room.players) {
    room.players[id].isReady = false;
    room.players[id].ready = false; // Also reset game ready state
  }
  
  // Ensure phase is lobby
  room.phase = 'lobby';
  
  // Reset any other lobby-specific state
  room.gameInProgress = false;
  room.isStarting = false;
  
  log(`[${room.id}] Lobby state reset - all players unready, countdown cleared, start request cleared`);
}
