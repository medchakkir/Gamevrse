// server.js (with ready-confirmation & restartGame rematch)
const { rooms, createRoom, getRoom, removeRoom } = require("./rooms");
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

// Socket.IO namespace, assigned by attach() from src/server.js
let io;

// ---------- CENTRALIZED TIMER MANAGEMENT ----------
// This ensures NO timer can fire after room deletion or game ending

function clearAllRoomTimers(room) {
  if (!room) return;
  
  // Round timers
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  if (room.roundTimeout) {
    clearTimeout(room.roundTimeout);
    room.roundTimeout = null;
  }
  if (room.freezeTimeout) {
    clearTimeout(room.freezeTimeout);
    room.freezeTimeout = null;
  }
  
  // Phase timers
  if (room.readyTimer) {
    clearTimeout(room.readyTimer);
    room.readyTimer = null;
  }
  if (room.getReadyTimeout) {
    clearTimeout(room.getReadyTimeout);
    room.getReadyTimeout = null;
  }
  if (room.sequenceTimeout) {
    clearTimeout(room.sequenceTimeout);
    room.sequenceTimeout = null;
  }
  
  // Lobby timers
  if (room.startCountdownTimer) {
    clearTimeout(room.startCountdownTimer);
    room.startCountdownTimer = null;
  }
  
  log(`[clearAllRoomTimers] All timers cleared for room ${room.id}`);
}

// Clear only phase-related timers (for returning to lobby mid-game)
function clearPhaseTimers(room) {
  if (!room) return;
  
  if (room.getReadyTimeout) {
    clearTimeout(room.getReadyTimeout);
    room.getReadyTimeout = null;
  }
  if (room.sequenceTimeout) {
    clearTimeout(room.sequenceTimeout);
    room.sequenceTimeout = null;
  }
  if (room.readyTimer) {
    clearTimeout(room.readyTimer);
    room.readyTimer = null;
  }
  
  log(`[clearPhaseTimers] Phase timers cleared for room ${room.id}`);
}

function safeEndGame(room, winnerId) {
  // IDEMPOTENT GUARD: Prevent duplicate endGame calls
  if (room._endGameFired) {
    log(`[safeEndGame] Already ended - ignoring duplicate call`);
    return false;
  }
  
  room._endGameFired = true;   // NEW idempotent guard
  room.gameEnding = true;
  clearAllRoomTimers(room);
  endGame(room, winnerId);
  return true;
}

// ---------- Helpers ----------
// NEW SECOND CHANCE POWERUP SYSTEM - Server-side functions
function activateSecondChance(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.alive) return false;
  
  // Validation: Second Chance must be available and not already used
  if (!player.powerups.secondChance.available) return false;
  if (player.powerups.secondChance.used) return false;
  if (player.powerups.secondChance.active) return false; // Already active
  
  // Activate Second Chance for current round
  player.powerups.secondChance.active = true;
  
  log(`[${room.id}] ${player.name} activated Second Chance (one-time use)`);
  return true;
}

function processSecondChanceRetry(room, playerId) {
  const player = room.players[playerId];
  if (!player) return false;
  
  // Check if Second Chance can be triggered
  const canTrigger = player.powerups.secondChance.active && 
                    !player.powerups.secondChance.used;
  
  if (canTrigger) {
    // Second Chance triggers - give player a retry
    player.powerups.secondChance.active = false;
    player.powerups.secondChance.used = true; // Permanently used
    
    // Reset player state for retry
    player.answered = false;
    player.time = 0;
    // DO NOT reduce lives or eliminate
    
    log(`[${room.id}] Second Chance triggered for ${player.name} - permanently used`);
    return true;
  }
  
  return false;
}

function resetSecondChanceRoundState(player) {
  // Reset only round-specific state, NOT the used flag
  player.powerups.secondChance.active = false;
  // DO NOT reset player.powerups.secondChance.used - it's permanent
}

function resetSecondChanceForNewMatch(player) {
  // Only reset for completely new match
  player.powerups.secondChance.available = true;
  player.powerups.secondChance.active = false;
  player.powerups.secondChance.used = false;
}

// Server-side timer management functions
function startRoundTimer(room) {
  // Clear any existing timer
  clearRoundTimer(room);
  
  // Set round end timestamp
  room.roundEndTimestamp = Date.now() + ROUND_DURATION_MS;
  room.freezeActive = false;
  room.freezeRemaining = 0;
  
  // Start timer update interval
  room.timerInterval = setInterval(() => {
    updateRoundTimer(room);
  }, TIMER_UPDATE_INTERVAL);
  
  // Set timeout for round end
  room.roundTimeout = setTimeout(() => {
    handleRoundTimeout(room);
  }, ROUND_DURATION_MS);
  
  log(`[${room.id}] Round timer started for ${ROUND_DURATION_MS}ms`);
}

function updateRoundTimer(room) {
  if (!room.roundEndTimestamp) return;
  
  // Calculate base remaining time (global timer)
  const baseRemainingTime = Math.max(0, room.roundEndTimestamp - Date.now());
  const now = Date.now();
  
  // SUDDEN DEATH FILTER: Only send updates to participants
  const eligiblePlayers = room.isSuddenDeath && room.suddenDeathPlayers
    ? room.suddenDeathPlayers
    : Object.keys(room.players);
  
  // Send timer updates to each player individually
  eligiblePlayers.forEach(playerId => {
    const player = room.players[playerId];
    if (!player || !player.alive) return; // Skip eliminated or invalid players
    
    let remainingTime;
    let freezeActive = false;
    
    // Check if this player has freeze active (with safety check)
    if (player.freezeActive === true && typeof player.freezeRemaining === 'number') {
      // This player has freeze active - use their stored remaining time
      remainingTime = player.freezeRemaining;
      freezeActive = true;
    } else if (player.secondChanceActive && typeof player.secondChanceRemaining === 'number') {
      // This player has Second Chance active (timer paused) - show stored remaining time
      remainingTime = player.secondChanceRemaining;
      freezeActive = true; // Use freezeActive flag to indicate timer is paused
    } else if (player.personalDeadline && player.personalDeadline > now) {
      // Player has a personal deadline (used freeze earlier or Second Chance)
      remainingTime = Math.max(0, player.personalDeadline - now);
    } else {
      // Normal timer for this player (no freeze used)
      remainingTime = baseRemainingTime;
    }
    
    // Send timer update to THIS player only
    io.to(playerId).emit("timerUpdate", {
      remainingTime: remainingTime,
      freezeActive: freezeActive
    });
    
    // Check if THIS player's time is up (and they haven't answered)
    if (!player.answered && remainingTime <= 0 && !freezeActive) {
      // Handle timeout differently for sudden death vs normal gameplay
      if (room.isSuddenDeath) {
        // Sudden death timeout - just mark as answered with wrong answer
        player.answered = true;
        player.time = Number.MAX_SAFE_INTEGER;
        player.inputSequence = null;
        log(`[sudden-death] ${player.name} timed out (personal deadline expired)`);
        
        // Check if all sudden death players have answered
        const allAnswered = room.tiePlayers.every(id => room.players[id]?.answered);
        if (allAnswered) {
          log(`[sudden-death] All players answered/timed out - resolving round`);
          clearRoundTimer(room);
          resolveSuddenDeathRound(room);
        }
      } else {
        // Normal gameplay timeout
        handlePlayerTimeout(room, playerId);
      }
    }
  });
  
  // Check if time is up globally (only for players without personal deadlines)
  if (baseRemainingTime <= 0 && !room.isSuddenDeath) {
    // Timeout players who don't have personal deadlines (normal gameplay only)
    Object.entries(room.players).forEach(([playerId, player]) => {
      if (player && player.alive && !player.answered && !player.personalDeadline) {
        handlePlayerTimeout(room, playerId);
      }
    });
  }
}

function clearRoundTimer(room) {
  if (room.timerInterval) {
    clearInterval(room.timerInterval);
    room.timerInterval = null;
  }
  if (room.roundTimeout) {
    clearTimeout(room.roundTimeout);
    room.roundTimeout = null;
  }
  if (room.freezeTimeout) {
    clearTimeout(room.freezeTimeout);
    room.freezeTimeout = null;
  }
}

function handleRoundTimeout(room) {
  if (room.gameEnding || room.freezeActive) return;
  
  log(`[${room.id}] Round ${room.round} global timeout reached`);
  
  // Check if any players still have time on their personal deadlines
  const playersWithTimeLeft = Object.values(room.players).filter(p => 
    p.alive && !p.answered && p.personalDeadline && p.personalDeadline > Date.now()
  );
  
  if (playersWithTimeLeft.length > 0) {
    log(`[${room.id}] ${playersWithTimeLeft.length} player(s) still have time on personal deadlines, not ending round yet`);
    // Don't end the round yet - let the timer interval handle individual timeouts
    return;
  }
  
  log(`[${room.id}] All players finished or timed out`);
  
  // Mark all unanswered alive players as timed out (those without personal deadlines)
  for (const id in room.players) {
    const player = room.players[id];
    if (player.alive && !player.answered && !player.personalDeadline) {
      handlePlayerTimeout(room, id);
    }
  }
}

function activateFreeze(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.alive) {
    log(`[activateFreeze] Player not found or not alive: ${playerId}`);
    return false;
  }
  
  // Validation
  if (!player.powerups || !player.powerups.freeze || !player.powerups.freeze.available) {
    log(`[activateFreeze] Freeze not available for ${player.name}`);
    return false;
  }
  if (player.powerups.freeze.roundUsed === room.round) {
    log(`[activateFreeze] Freeze already used this round by ${player.name}`);
    return false;
  }
  if (player.freezeActive === true) {
    log(`[activateFreeze] Freeze already active for ${player.name}`);
    return false;
  }
  
  // Calculate current remaining time for THIS player
  const currentRemaining = Math.max(0, room.roundEndTimestamp - Date.now());
  if (currentRemaining <= 0) {
    log(`[activateFreeze] Round already ended, cannot activate freeze`);
    return false;
  }
  
  // Store remaining time for THIS player only
  player.freezeRemaining = currentRemaining;
  player.freezeActive = true;
  player.freezeStartTime = Date.now();
  
  // Mark powerup as used
  player.powerups.freeze.used = true;
  player.powerups.freeze.active = true;
  player.powerups.freeze.roundUsed = room.round;
  
  const freezeDuration = 3000; // 3 seconds
  
  // Emit freeze activation ONLY to this player
  io.to(playerId).emit("timerFrozen", { 
    duration: freezeDuration,
    remainingTime: player.freezeRemaining 
  });
  
  // Set timeout to resume timer for THIS player (store in Map to avoid circular reference)
  const timeout = setTimeout(() => {
    resumePlayerTimer(room, playerId);
    playerFreezeTimeouts.delete(playerId);
  }, freezeDuration);
  playerFreezeTimeouts.set(playerId, timeout);
  
  log(`[${room.id}] ${player.name} activated freeze for ${freezeDuration}ms, ${player.freezeRemaining}ms remaining (PERSONAL)`);
  return true;
}

function resumePlayerTimer(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.freezeActive) return;
  
  // Resume timer for THIS player only
  player.freezeActive = false;
  
  // Set personal deadline: current time + remaining time from freeze
  player.personalDeadline = Date.now() + player.freezeRemaining;
  
  // Emit timer resumed ONLY to this player
  io.to(playerId).emit("timerResumed", {
    remainingTime: player.freezeRemaining
  });
  
  log(`[${room.id}] ${player.name}'s freeze ended, timer resumed with ${player.freezeRemaining}ms (deadline: ${new Date(player.personalDeadline).toISOString()})`);
}

function handlePlayerTimeout(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.alive || player.answered) return;
  
  log(`[${room.id}] ${player.name} timed out (personal timer)`);
  
  player.answered = true;
  player.time = Number.MAX_SAFE_INTEGER;
  player.lives = Math.max(0, player.lives - 1);
  player.streak = 0;
  
  if (player.lives > 0) {
    io.to(playerId).emit("lifeLost", { livesLeft: player.lives, reason: "timeout" });
  } else {
    // Player lost their last life due to timeout
    const totalPlayers = Object.keys(room.players).length;
    const aliveCount = Object.values(room.players).filter(p => p.alive).length;
    
    // Check if any OTHER alive players still have lives > 0
    const playersWithLives = Object.values(room.players).filter(p => 
      p.alive && p.lives > 0 && p.id !== playerId
    ).length;
    
    // EDGE CASE: Keep alive with 0 lives if:
    // 1. Multiple players still alive (aliveCount >= 2)
    // 2. No other players have lives > 0 (all at 0 or will be at 0)
    // This defers elimination until ROUND_END can check if Sudden Death should trigger
    if (aliveCount >= 2 && playersWithLives === 0) {
      log(`[${room.id}] ${player.name} timed out but keeping alive=true, lives=0 for potential Sudden Death (${aliveCount} players, ${playersWithLives} with lives)`);
      player.lives = 0;
      // Mark that this player lost their last life THIS round
      player.lastLifeLostRound = room.round;
      io.to(playerId).emit("lifeLost", { livesLeft: 0, reason: "timeout" });
    } else {
      // Normal elimination - either only 1 player left OR other players still have lives
      log(`[${room.id}] ELIMINATING ${player.name} (timeout) - alive=false, round=${room.round}, phase=${room.currentPhase} (playersWithLives=${playersWithLives})`);
      player.alive = false;
      player.roundEliminated = room.round;
      // Mark that this player lost their last life THIS round
      player.lastLifeLostRound = room.round;
      
      // ELIMINATION UI TIMING FIX: Mark for pending elimination
      // Don't show elimination UI immediately - wait for ROUND_END
      player.pendingElimination = true;
      
      const newAliveCount = Object.values(room.players).filter(p => p.alive).length;
      const is1v1Endgame = (totalPlayers === 2 && newAliveCount === 1);
      
      // DEFER elimination UI - will be sent at ROUND_END
      log(`[${room.id}] Elimination UI DEFERRED for ${player.name} (timeout) until ROUND_END (is1v1Endgame=${is1v1Endgame})`);
      
      // Still emit playerEliminated to update scoreboard for other players
      io.to(playerId).emit("playerEliminated", { id: playerId, name: player.name, colorIndex: player.colorIndex });
      
      setTimeout(() => {
        broadcastMatchStatus(room);
      }, 100);
    }
  }
  
  // Check if round should end (all players answered)
  const aliveIds = Object.keys(room.players).filter(id => room.players[id].alive);
  const answeredIds = aliveIds.filter(id => room.players[id].answered);
  if (answeredIds.length === aliveIds.length) {
    transitionToRoundEndPhase(room);
  }
}

function cleanupTimerState(room) {
  clearRoundTimer(room);
  room.roundEndTimestamp = null;
  room.freezeActive = false;
  room.freezeRemaining = 0;
  
  // Clean up freeze state for all players
  for (const id in room.players) {
    const player = room.players[id];
    player.powerups.freeze.active = false;
    player.powerups.freeze.roundUsed = null;
  }
}

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
  io.to(room.id).emit("roomState", {
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
    io.to(playerId).emit("eliminated", { 
      is1v1Endgame, 
      round: room.round,
      isDraw 
    });
    player.pendingElimination = false;
    return true;
  }
  return false;
}

function log(...args) { console.log.apply(console, args); }

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
      io.to(id).emit("matchStatusUpdate", matchStatus);
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
  io.to(room.id).emit("gameStarting", {
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
  io.to(room.id).emit("gameStartCancelled");
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
    io.to(room.id).emit("gameStartError", "Need at least 2 players to start");
    return;
  }

  room.gameStarted = true;
  room.phase = 'game';
  room.round = 0;
  room.sequence = [];
  room.gameStartTime = Date.now(); // Track game start time

  resetPlayersState(room);
  
  // Notify all players of phase change
  io.to(room.id).emit("phaseChange", { phase: 'game', roomId: room.id });
  
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
  io.to(room.id).emit("playerList", list);
  io.to(room.id).emit("playerCount", Object.keys(room.players).length);
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

function broadcastRound() {
  io.emit("roundStart", { sequence, round });
  log(`Broadcasted round ${round} (len=${sequence.length})`);
}

// End game and broadcast scoreboard/winner with enhanced statistics
function endGame(room, winnerId) {
  log(`[endGame] FINAL CALLED - winner=${winnerId}, room=${room.id}`);
  
  // Check if this is a DRAW (winnerId === null)
  const isDraw = (winnerId === null || winnerId === undefined);
  
  const scoreboard = Object.values(room.players)
    .map(p => ({
      name: p.name,
      score: Math.round(p.score || 0),
      colorIndex: p.colorIndex,
      avgTime: p.avgTime || 0,
      roundsPlayed: p.roundsPlayed || 0,
      fastestTime: p.fastestTime || Infinity
    }))
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ ...p, position: i + 1 }));

  const winnerData = isDraw ? null : room.players[winnerId];
  
  // Calculate game statistics
  const gameStats = {
    totalRounds: room.round || 0,
    fastestTime: Math.min(...Object.values(room.players).map(p => p.fastestTime || Infinity).filter(t => t !== Infinity)),
    totalPlayers: Object.keys(room.players).length,
    eliminations: Object.values(room.players).filter(p => !p.alive).length,
    gameDuration: Date.now() - (room.gameStartTime || Date.now())
  };

  room.gameStarted = false;
  room.phase = 'postgame';
  
  // CRITICAL: Clean up all game state to prevent soft-locks
  room.tieBreakerActive = false; // DEPRECATED
  room.tiePlayers = [];
  room.tieLength = 0;
  room.tieRound = 0;
  
  // NEW: Clean up sudden death state
  room.isSuddenDeath = false;
  room.suddenDeathLength = 5; // Reset to default
  room.suddenDeathPlayers = []; // Clear frozen list
  room.suddenDeathRoundId = 0;
  
  // Clear any countdown state from previous game start
  clearGameCountdown(room);

  io.to(room.id).emit("gameOver", {
    winner: isDraw ? null : winnerId,
    winnerName: isDraw ? null : (winnerData?.name || "Unknown"),
    colorIndex: isDraw ? null : (winnerData?.colorIndex || 0),
    isDraw: isDraw,
    scoreboard,
    gameStats
  });

  if (isDraw) {
    log("Game ended in a DRAW - all players eliminated");
  } else {
    log("Game ended. Winner:", winnerData?.name || winnerId);
  }

  // Return to lobby after 15 seconds (increased for victory screen)
  setTimeout(() => {
    // STEP 7: RESET FLAG BEFORE PHASE CHANGE
    room.gameEnding = false;
    
    room.phase = 'lobby';
    fullReset(room);
    
    // Ensure clean lobby state when returning
    resetLobbyState(room);
    
    io.to(room.id).emit("phaseChange", { phase: 'lobby', roomId: room.id });
    
    // Send fresh room state to ensure clean UI with reset ready states
    io.to(room.id).emit("roomState", {
      roomId: room.id,
      hostId: room.hostId,
      players: Object.values(room.players),
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
      startCountdownEndsAt: null // Explicitly null
    });
    
    log(`[${room.id}] Returned to lobby with clean state - all players unready`);
  }, 15000);
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

// ========== NEW SUDDEN DEATH SYSTEM (OPTION 1: FIXED-LENGTH) ==========

// Start sudden death round with fixed 5-tile sequence
function startSuddenDeathRound(room) {
  log(`[sudden-death] Starting new round with ${room.suddenDeathLength} tiles`);
  
  // MODE ISOLATION: Verify we're in SUDDEN_DEATH mode
  if (room.mode !== 'SUDDEN_DEATH') {
    log(`[sudden-death] ⚠️ ASSERTION FAILED: startSuddenDeathRound called but mode=${room.mode} (expected SUDDEN_DEATH)`);
  }
  
  // CRITICAL SAFETY CHECK: Verify suddenDeathPlayers is set
  if (!room.suddenDeathPlayers || room.suddenDeathPlayers.length === 0) {
    log(`[sudden-death] ERROR: suddenDeathPlayers not set! Aborting.`);
    return;
  }
  
  // SAFETY ASSERTION: Verify no non-participants are alive
  for (const id of Object.keys(room.players)) {
    if (!room.suddenDeathPlayers.includes(id) && room.players[id].alive) {
      log(`[sudden-death] ⚠️ ASSERTION FAILED: Non-participant ${room.players[id].name} is alive!`);
    }
  }
  
  // CRITICAL: Clear all existing timers to prevent collisions
  clearRoundTimer(room);
  if (room.sequenceTimeout) {
    clearTimeout(room.sequenceTimeout);
    room.sequenceTimeout = null;
  }
  if (room.getReadyTimeout) {
    clearTimeout(room.getReadyTimeout);
    room.getReadyTimeout = null;
  }
  
  // Generate unique round ID to prevent old timer callbacks from firing
  room.suddenDeathRoundId = (room.suddenDeathRoundId || 0) + 1;
  const currentRoundId = room.suddenDeathRoundId;
  log(`[sudden-death] Round ID: ${currentRoundId}`);
  
  // Generate fixed-length sequence (always 5 tiles)
  generateSequence(room, room.suddenDeathLength);

  // STRICT ISOLATION: Reset ONLY active participants (tiePlayers = current survivors)
  // During first round: tiePlayers = suddenDeathPlayers (all participants)
  // During later rounds: tiePlayers = survivors only (subset of suddenDeathPlayers)
  for (const id of room.tiePlayers) {
    const player = room.players[id];
    if (player) {
      player.answered = false;
      player.time = 0;
      player.inputSequence = null;
      log(`[sudden-death] Reset participant: ${player.name}`);
    }
  }
  
  // SAFETY GUARD: Ensure non-active participants remain eliminated
  for (const id of room.suddenDeathPlayers) {
    if (!room.tiePlayers.includes(id)) {
      const player = room.players[id];
      if (player && player.alive) {
        log(`[sudden-death] ⚠️ Eliminated participant ${player.name} was alive! Forcing elimination.`);
        player.alive = false;
      }
    }
  }
  
  // SAFETY GUARD: Ensure non-participants remain eliminated
  for (const id of Object.keys(room.players)) {
    if (!room.suddenDeathPlayers.includes(id)) {
      const player = room.players[id];
      if (player.alive) {
        log(`[sudden-death] ⚠️ WARNING: Non-participant ${player.name} was alive! Forcing elimination.`);
        player.alive = false;
      }
    }
  }

  // PHASE 1: GET_READY
  room.currentPhase = PHASE_GET_READY;
  
  // Emit sudden death round start to all players
  io.to(room.id).emit("suddenDeathRoundStart", {
    sequence: room.sequence,
    length: room.suddenDeathLength,
    tiePlayers: room.suddenDeathPlayers, // Use frozen list
    phase: PHASE_GET_READY
  });

  log(`[sudden-death] Round started with ${room.suddenDeathLength}-tile sequence - PHASE 1: GET_READY`);
  
  // Auto-advance to SEQUENCE phase after 3 seconds
  room.getReadyTimeout = setTimeout(() => {
    // Check if this is still the current round
    if (room.suddenDeathRoundId !== currentRoundId) {
      log(`[sudden-death] GET_READY timeout fired for old round ${currentRoundId}, ignoring (current: ${room.suddenDeathRoundId})`);
      return;
    }
    
    if (!room.isSuddenDeath || room.gameEnding) return;
    
    // PHASE 2: SEQUENCE
    room.currentPhase = PHASE_SEQUENCE;
    room.playersWatchedSequence = new Set();
    
    io.to(room.id).emit("enterSequencePhase", {
      sequence: room.sequence,
      round: room.round
    });
    
    log(`[sudden-death] PHASE 2: SEQUENCE - waiting for players to watch`);
    
    // Set timeout for sequence phase (in case players don't respond)
    const sequenceTimeout = 5000 + (room.sequence.length * 1000);
    room.sequenceTimeout = setTimeout(() => {
      // Check if this is still the current round
      if (room.suddenDeathRoundId !== currentRoundId) {
        log(`[sudden-death] SEQUENCE timeout fired for old round ${currentRoundId}, ignoring (current: ${room.suddenDeathRoundId})`);
        return;
      }
      
      if (!room.isSuddenDeath || room.gameEnding || room.currentPhase !== PHASE_SEQUENCE) return;
      
      log(`[sudden-death] Sequence timeout - forcing PLAY phase`);
      enterSuddenDeathPlayPhase(room, currentRoundId);
    }, sequenceTimeout);
  }, 3000);
}

// Enter PLAY phase for sudden death
function enterSuddenDeathPlayPhase(room, expectedRoundId) {
  if (!room.isSuddenDeath || room.gameEnding) return;
  
  // Check if this is still the current round
  if (expectedRoundId && room.suddenDeathRoundId !== expectedRoundId) {
    log(`[sudden-death] enterSuddenDeathPlayPhase called for old round ${expectedRoundId}, ignoring (current: ${room.suddenDeathRoundId})`);
    return;
  }
  
  const currentRoundId = room.suddenDeathRoundId;
  
  log(`[sudden-death] ========== ENTERING PLAY PHASE (Round ID: ${currentRoundId}) ==========`);
  
  // Clear sequence timeout
  if (room.sequenceTimeout) {
    clearTimeout(room.sequenceTimeout);
    room.sequenceTimeout = null;
    log(`[sudden-death] Cleared sequence timeout`);
  }
  
  // PHASE 3: PLAY
  room.currentPhase = PHASE_PLAY;
  const suddenDeathTimeLimit = 20000; // 20 seconds for sudden death (increased from 15)
  room.roundEndTimestamp = Date.now() + suddenDeathTimeLimit;
  
  log(`[sudden-death] Setting roundEndTimestamp to ${new Date(room.roundEndTimestamp).toISOString()}`);
  log(`[sudden-death] Current time: ${new Date().toISOString()}`);
  log(`[sudden-death] Timer will fire in ${suddenDeathTimeLimit}ms (20 seconds)`);
  
  io.to(room.id).emit("enterPlayPhase", {
    round: room.round,
    timeLimit: suddenDeathTimeLimit
  });
  
  log(`[sudden-death] PHASE 3: PLAY - 20s timer started`);
  
  // Start timer interval for updates (every 100ms)
  room.timerInterval = setInterval(() => {
    if (!room.isSuddenDeath || room.gameEnding) {
      clearInterval(room.timerInterval);
      return;
    }
    updateRoundTimer(room);
  }, 100);
  
  // Set round timer (20 seconds for sudden death)
  room.roundTimer = setTimeout(() => {
    // Check if this is still the current round
    if (room.suddenDeathRoundId !== currentRoundId) {
      log(`[sudden-death] Timer fired for old round ${currentRoundId}, ignoring (current: ${room.suddenDeathRoundId})`);
      return;
    }
    
    if (!room.isSuddenDeath || room.gameEnding) {
      log(`[sudden-death] Timer fired but sudden death already ended - ignoring`);
      return;
    }
    
    log(`[sudden-death] ⏰ TIMER FIRED after 20 seconds for round ${currentRoundId}`);
    log(`[sudden-death] Current time: ${new Date().toISOString()}`);
    
    // Mark unanswered players as timed out (but check personal deadlines)
    const now = Date.now();
    let playersWithTimeLeft = [];
    
    for (const id of room.tiePlayers) {
      const player = room.players[id];
      if (player && !player.answered) {
        // Check if player has personal deadline (from freeze or Second Chance)
        if (player.personalDeadline && player.personalDeadline > now) {
          log(`[sudden-death] ${player.name} has personal deadline, NOT timing out yet (${player.personalDeadline - now}ms remaining)`);
          playersWithTimeLeft.push(id);
          continue; // Don't timeout this player yet
        }
        
        player.answered = true;
        player.time = Number.MAX_SAFE_INTEGER;
        player.inputSequence = null;
        log(`[sudden-death] ${player.name} timed out - marked as wrong`);
      } else if (player) {
        log(`[sudden-death] ${player.name} already answered before timeout`);
      }
    }
    
    // Only clear timer interval if NO players have time left
    if (playersWithTimeLeft.length === 0) {
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        log(`[sudden-death] Cleared timer interval - no players with personal deadlines`);
      }
    } else {
      log(`[sudden-death] Keeping timer interval running for ${playersWithTimeLeft.length} player(s) with personal deadlines`);
    }
    
    // Resolve sudden death round
    log(`[sudden-death] Resolving round ${currentRoundId} after timeout`);
    
    // Check if any players still have time on personal deadlines
    const remainingPlayers = room.tiePlayers.filter(id => {
      const player = room.players[id];
      return player && !player.answered && player.personalDeadline && player.personalDeadline > Date.now();
    });
    
    if (remainingPlayers.length > 0) {
      log(`[sudden-death] ${remainingPlayers.length} player(s) still have time on personal deadlines - NOT resolving yet`);
      return; // Don't resolve yet, let updateRoundTimer handle individual timeouts
    }
    
    resolveSuddenDeathRound(room);
  }, suddenDeathTimeLimit);
  
  log(`[sudden-death] Timer set with ID: ${room.roundTimer} for round ${currentRoundId}`);
}

// Resolve sudden death round with pure survival logic
function resolveSuddenDeathRound(room) {
  // CRITICAL: Clear all timers immediately to prevent collisions
  clearRoundTimer(room);
  
  log(`[sudden-death] ========== RESOLVING ROUND ==========`);
  
  // STRICT: Use frozen participant list
  if (!room.suddenDeathPlayers || room.suddenDeathPlayers.length < 2) {
    log(`[sudden-death] ERROR: Invalid suddenDeathPlayers list`);
    return;
  }

  // Check correctness for all participants (frozen list only)
  const results = room.suddenDeathPlayers.map(id => {
    const player = room.players[id];
    if (!player) return { id, name: 'Unknown', correct: false, answered: false };
    
    const correct = Array.isArray(player.inputSequence) &&
      player.inputSequence.length === room.sequence.length &&
      player.inputSequence.every((c, i) => c === room.sequence[i]);
    
    return {
      id,
      name: player.name,
      correct,
      answered: player.answered,
      inputSequence: player.inputSequence
    };
  });

  // Log all results
  results.forEach(r => {
    log(`[sudden-death] ${r.name}: ${r.correct ? 'CORRECT' : 'WRONG'} (answered: ${r.answered})`);
  });
  log(`[sudden-death] Expected sequence: ${JSON.stringify(room.sequence)}`);

  // Send feedback to all participants
  results.forEach(r => {
    if (r.correct) {
      io.to(r.id).emit("correct", { streak: 0, streakBonus: 0 });
    } else {
      io.to(r.id).emit("lifeLost", { livesLeft: 0 });
    }
  });

  // Count survivors (players who got it correct)
  const survivors = results.filter(r => r.correct);
  
  // CASE 1: Exactly one survivor - WINNER!
  if (survivors.length === 1) {
    log(`[sudden-death] ⭐ WINNER: ${survivors[0].name}`);
    setTimeout(() => {
      endSuddenDeath(room, survivors[0].id);
    }, 1500);
    return;
  }

  // CASE 2: Multiple survivors - Continue sudden death with survivors only
  if (survivors.length > 1) {
    log(`[sudden-death] 🔄 ${survivors.length} survivors - continuing sudden death`);
    
    // CRITICAL: Update tiePlayers but NEVER change suddenDeathPlayers (frozen)
    room.tiePlayers = survivors.map(s => s.id);
    
    // SAFETY: Verify all survivors are in frozen list
    for (const survivor of survivors) {
      if (!room.suddenDeathPlayers.includes(survivor.id)) {
        log(`[sudden-death] ⚠️ CRITICAL ERROR: Survivor ${survivor.name} not in frozen list!`);
      }
    }
    
    setTimeout(() => {
      if (room.isSuddenDeath && !room.gameEnding) {
        clearRoundTimer(room);
        if (room.sequenceTimeout) clearTimeout(room.sequenceTimeout);
        if (room.getReadyTimeout) clearTimeout(room.getReadyTimeout);
        log(`[sudden-death] All timers cleared before starting new round`);
        startSuddenDeathRound(room);
      }
    }, 1500);
    return;
  }

  // CASE 3: Zero survivors - ALL FAILED AGAIN
  // This is the edge case within sudden death - restart with same participants
  log(`[sudden-death] ⚠️ ZERO SURVIVORS - all players failed again, restarting sudden death`);
  
  // CRITICAL: Keep tiePlayers same as frozen list for restart
  room.tiePlayers = [...room.suddenDeathPlayers];
  
  setTimeout(() => {
    if (room.isSuddenDeath && !room.gameEnding) {
      clearRoundTimer(room);
      if (room.sequenceTimeout) clearTimeout(room.sequenceTimeout);
      if (room.getReadyTimeout) clearTimeout(room.getReadyTimeout);
      log(`[sudden-death] All timers cleared, restarting with same participants`);
      startSuddenDeathRound(room);
    }
  }, 1500);
}

// End sudden death and declare winner
function endSuddenDeath(room, winnerId) {
  const winner = room.players[winnerId];
  log(`[sudden-death] WINNER: ${winner.name} (${winnerId})`);

  // Complete isolation when winner detected - clear ALL sudden death state
  room.isSuddenDeath = false;
  room.tiePlayers = [];
  room.suddenDeathPlayers = []; // Clear frozen list
  room.suddenDeathRoundId = 0;
  room.gameStarted = false;
  room.phase = 'postgame';
  
  log(`[sudden-death] Sudden Death state cleared`);
  
  // Clear any timers
  clearPhaseTimers(room);
  clearGameCountdown(room);
  
  // End the game immediately using safeEndGame
  safeEndGame(room, winnerId);
}

// ========== OLD TIE-BREAKER SYSTEM (DEPRECATED) ==========

// Start tie-breaker round with fixed length
function startTieBreakerRound(room) {
  // Generate fixed-length sequence for tie-breaker
  generateSequence(room, room.tieLength);

  // Reset only tie players
  for (const id of room.tiePlayers) {
    if (room.players[id]) {
      room.players[id].answered = false;
      room.players[id].time = 0;
    }
  }

  // Emit tie-breaker round start to all players
  io.to(room.id).emit("tieBreakerRoundStart", {
    sequence: room.sequence,
    tieRound: room.tieRound,
    length: room.tieLength,
    tiePlayers: room.tiePlayers
  });

  log(`[tie-breaker] Round ${room.tieRound} started with ${room.tieLength}-tile sequence`);
}

// Handle tie-breaker submission logic
function handleTieBreakerSubmission(room, playerId, inputSequence, timeTaken) {
  const player = room.players[playerId];
  if (!player || !room.tiePlayers.includes(playerId)) return;

  // CRITICAL FIX: Store the inputSequence for comparison AND mark as answered
  player.answered = true;
  player.time = timeTaken;
  player.inputSequence = inputSequence; // Store the actual input for comparison

  const correct = Array.isArray(inputSequence) &&
    inputSequence.length === room.sequence.length &&
    inputSequence.every((c, i) => c === room.sequence[i]);

  log(`[tie-breaker] ${player.name} submitted: correct=${correct}, time=${timeTaken}`);

  // Check if both tie players have answered
  const tieAnswered = room.tiePlayers.filter(id => room.players[id]?.answered);
  
  if (tieAnswered.length === room.tiePlayers.length) {
    // Both players answered - evaluate results using stored inputSequence
    const results = room.tiePlayers.map(id => {
      const p = room.players[id];
      const playerCorrect = Array.isArray(p.inputSequence) &&
        p.inputSequence.length === room.sequence.length &&
        p.inputSequence.every((c, i) => c === room.sequence[i]);
      
      return {
        id,
        player: p,
        correct: playerCorrect
      };
    });

    const p1 = results[0];
    const p2 = results[1];

    let winnerId = null;

    // CASE A: One correct, one wrong
    if (p1.correct && !p2.correct) {
      winnerId = p1.id;
    } else if (p2.correct && !p1.correct) {
      winnerId = p2.id;
    } else if (p1.correct && p2.correct) {
      // CASE B: Both correct - compare times
      const timeDiff = Math.abs(p1.player.time - p2.player.time);
      if (timeDiff > 5) { // 5ms tolerance
        winnerId = p1.player.time < p2.player.time ? p1.id : p2.id;
      }
    }

    // If we have a winner, end the tie-breaker immediately
    if (winnerId) {
      log(`[tie-breaker] Winner detected: ${room.players[winnerId].name}`);
      
      // STEP 3: COMPLETE ISOLATION WHEN WINNER DETECTED
      room.gameEnding = true;
      room.tieBreakerActive = false;
      room.tiePlayers = [];
      room.gameStarted = false;
      room.phase = 'postgame';
      
      // Clear any timers
      clearPhaseTimers(room);
      clearGameCountdown(room);
      
      // End the game immediately
      endGame(room, winnerId);
      return; // HARD STOP - no further execution
    }

    // CASE C: Both wrong OR times equal - continue tie-breaker
    // Safety limit: Maximum 10 tie-breaker rounds to prevent infinite loops
    if (room.tieRound >= 10) {
      log(`[tie-breaker] Maximum rounds reached, declaring winner by fastest time`);
      const winnerId = p1.player.time <= p2.player.time ? p1.id : p2.id;
      
      // STEP 3: COMPLETE ISOLATION FOR MAX ROUNDS
      room.gameEnding = true;
      room.tieBreakerActive = false;
      room.tiePlayers = [];
      room.gameStarted = false;
      room.phase = 'postgame';
      
      clearPhaseTimers(room);
      clearGameCountdown(room);
      
      endGame(room, winnerId);
      return; // HARD STOP
    }

    room.tieRound++;
    log(`[tie-breaker] Round ${room.tieRound - 1} inconclusive, continuing to round ${room.tieRound}`);
    
    // Reset answered state for next tie-breaker round
    for (const id of room.tiePlayers) {
      if (room.players[id]) {
        room.players[id].answered = false;
        room.players[id].inputSequence = null;
      }
    }
    
    // Brief delay then start next round
    setTimeout(() => {
      // Double-check we're not ending before starting next round
      if (!room.gameEnding) {
        startTieBreakerRound(room);
      }
    }, 1000);
  }
}

// ========== STRICT 4-PHASE ROUND SYSTEM ==========

// Phase constants
const PHASE_GET_READY = "GET_READY";
const PHASE_SEQUENCE = "SEQUENCE";
const PHASE_PLAY = "PLAY";
const PHASE_ROUND_END = "ROUND_END";

// Get disconnect phase category for decision making
function getDisconnectPhaseCategory(room) {
  if (room.phase === 'lobby') return 'LOBBY';
  if (room.phase === 'game') {
    switch (room.currentPhase) {
      case PHASE_GET_READY: return 'GET_READY';
      case PHASE_SEQUENCE: return 'SEQUENCE';
      case PHASE_PLAY: return 'PLAY';
      case PHASE_ROUND_END: return 'ROUND_END';
      default: return 'GAME_UNKNOWN';
    }
  }
  return 'UNKNOWN';
}

// Start the next round with strict 4-phase system
function startNextRound(room) {
  if (room.gameEnding) {
    log(`[startNextRound] Blocked - game is ending`);
    return;
  }
  
  // MODE ISOLATION: Prevent startNextRound from running in SUDDEN_DEATH mode
  if (room.mode === 'SUDDEN_DEATH') {
    log(`[startNextRound] ⚠️ BLOCKED - Cannot run in SUDDEN_DEATH mode (use startSuddenDeathRound instead)`);
    return;
  }
  
  // CRITICAL SAFETY CHECK: If only 1 player remains, end game instead of starting new round
  if (checkAndHandleSinglePlayer(room, 'startNextRound')) return;
  
  room.round++;
  generateSequence(room, 3 + room.round - 1);

  // 🔥 SNAPSHOT: Capture alive count at round START
  const alivePlayersAtStart = Object.values(room.players).filter(p => p.alive);
  room.aliveAtRoundStart = alivePlayersAtStart.length;
  
  log(`[startNextRound] Round ${room.round}: ${room.aliveAtRoundStart} alive at start, ${Object.keys(room.players).length - room.aliveAtRoundStart} eliminated`);
  
  // SAFETY ASSERTION: Verify no eliminated players will be reset
  for (const id in room.players) {
    const player = room.players[id];
    if (!player.alive && player.answered === false) {
      log(`[startNextRound] ⚠️ ASSERTION FAILED: Eliminated player ${player.name} has answered=false before reset!`);
    }
  }
  
  // STRICT: Reset ONLY alive players for new round
  // NEVER revive eliminated players (alive === false)
  for (const id in room.players) {
    const player = room.players[id];
    
    // 🔥 CRITICAL: Skip eliminated players - do NOT reset their state
    // This prevents revival bug - eliminated players must NEVER play again
    if (!player.alive) {
      log(`[startNextRound] Skipping eliminated player: ${player.name} (alive=false)`);
      continue;
    }
    
    log(`[startNextRound] Resetting alive player: ${player.name}`);
    
    // Reset transient fields for alive players only
    player.answered = false;
    player.time = 0;
    player.readyForSequence = false;
    player.sequenceWatched = false;
    player.inputSequence = [];
    
    // Clear pending elimination flag (if any from previous round)
    player.pendingElimination = false;
    
    // Reset Second Chance round state (but NOT the used flag)
    resetSecondChanceRoundState(player);
    
    // Clean up freeze state at round end
    player.powerups.freeze.active = false;
    player.powerups.freeze.roundUsed = null;
    
    // Clean up per-player freeze timers (from Map)
    const freezeTimeout = playerFreezeTimeouts.get(id);
    if (freezeTimeout) {
      clearTimeout(freezeTimeout);
      playerFreezeTimeouts.delete(id);
    }
    player.freezeActive = false;
    player.freezeRemaining = 0;
    player.personalDeadline = null; // Clear personal deadline
  }

  // PHASE 1: Enter GET_READY phase
  room.currentPhase = PHASE_GET_READY;
  room.getReadyStartTime = Date.now();
  
  log(`[${room.id}] Round ${room.round} - PHASE 1: GET_READY (5 seconds)`);

  // Emit GET_READY phase start
  io.to(room.id).emit("roundStart", {
    round: room.round,
    phase: PHASE_GET_READY,
    getReadyDuration: 5000 // 5 seconds
  });
  
  // Broadcast match status to eliminated players
  broadcastMatchStatus(room);
  
  // Auto-advance to SEQUENCE after 5 seconds OR when all players ready
  room.getReadyTimeout = setTimeout(() => {
    if (room.gameEnding) return;
    
    // CRITICAL: Re-check player count before advancing
    if (checkAndHandleSinglePlayer(room, 'startNextRound GET_READY timeout')) return;
    
    transitionToSequencePhase(room);
  }, 5000);
}


// PHASE 2: Transition to SEQUENCE phase
function transitionToSequencePhase(room) {
  if (!room || room.gameEnding) return;
  
  if (room.gameEnding || room.currentPhase !== PHASE_GET_READY) {
    log(`[${room.id}] ⚠️ Ignoring transition to SEQUENCE - gameEnding=${room.gameEnding}, phase=${room.currentPhase}`);
    return;
  }
  
  room.currentPhase = PHASE_SEQUENCE;
  
  // Clear GET_READY timeout if still active
  if (room.getReadyTimeout) {
    clearTimeout(room.getReadyTimeout);
    room.getReadyTimeout = null;
  }
  
  const aliveIds = Object.keys(room.players).filter(id => room.players[id].alive);
  log(`[${room.id}] Round ${room.round} - PHASE 2: SEQUENCE (playback) - waiting for ${aliveIds.length} players`);
  
  // Emit SEQUENCE phase with full sequence
  io.to(room.id).emit("enterSequencePhase", {
    round: room.round,
    sequence: room.sequence
  });
  
  // CRITICAL FIX: Add timeout fallback to prevent permanent freeze
  // Calculate expected duration: sequence length * delay + buffer
  const sequenceDelay = 600; // Normal speed only
  const expectedDuration = (room.sequence.length * sequenceDelay) + 2000; // +2s buffer
  const maxDuration = Math.max(expectedDuration, 15000); // At least 15s
  
  log(`[${room.id}] SEQUENCE timeout set for ${maxDuration}ms`);
  
  room.sequenceTimeout = setTimeout(() => {
    if (room.gameEnding) return;
    
    if (room.currentPhase === PHASE_SEQUENCE) {
      // CRITICAL: Re-check player count before advancing
      if (checkAndHandleSinglePlayer(room, 'transitionToSequencePhase SEQUENCE timeout')) return;
      
      log(`[${room.id}] ⚠️ SEQUENCE phase timeout (${maxDuration}ms) - auto-advancing to PLAY`);
      
      // Log which players didn't signal
      const notWatched = aliveIds.filter(id => !room.players[id]?.sequenceWatched);
      if (notWatched.length > 0) {
        log(`[${room.id}] Players who didn't signal: ${notWatched.map(id => room.players[id]?.name).join(', ')}`);
      }
      
      transitionToPlayPhase(room);
    }
  }, maxDuration);
}

// PHASE 3: Transition to PLAY phase
function transitionToPlayPhase(room) {
  if (!room || room.gameEnding) return;
  
  if (room.gameEnding || room.currentPhase !== PHASE_SEQUENCE) {
    log(`[${room.id}] ⚠️ Ignoring transition to PLAY - gameEnding=${room.gameEnding}, phase=${room.currentPhase}`);
    return;
  }
  
  room.currentPhase = PHASE_PLAY;
  
  // Clear sequence timeout if it exists
  if (room.sequenceTimeout) {
    clearTimeout(room.sequenceTimeout);
    room.sequenceTimeout = null;
  }
  
  // Reset sequenceWatched flags for ALIVE players only
  for (const id in room.players) {
    if (room.players[id].alive) {
      room.players[id].sequenceWatched = false;
    }
  }
  
  log(`[${room.id}] Round ${room.round} - PHASE 3: PLAY (30s timer) - TILES ENABLED`);
  
  // Start the 30-second timer
  startRoundTimer(room);
  
  // CRITICAL: Only send enterPlayPhase to ALIVE players
  // This enforces server authority - eliminated players never receive play permission
  const aliveIds = getAliveIds(room);
  
  log(`[${room.id}] Sending enterPlayPhase to ${aliveIds.length} alive players: ${aliveIds.map(id => room.players[id].name).join(', ')}`);
  
  // Send to each alive player individually (server authority)
  aliveIds.forEach(id => {
    io.to(id).emit("enterPlayPhase", {
      round: room.round,
      roundDuration: ROUND_DURATION_MS
    });
  });
  
  // SAFETY ASSERTION: Log if any eliminated player would have received the event
  Object.keys(room.players).forEach(id => {
    if (!room.players[id].alive) {
      log(`[${room.id}] ✓ CORRECTLY EXCLUDED eliminated player ${room.players[id].name} from enterPlayPhase`);
    }
  });
}

// PHASE 4: Transition to ROUND_END phase
function transitionToRoundEndPhase(room) {
  if (!room || room.gameEnding) return;
  
  // MODE ISOLATION: Prevent transitionToRoundEndPhase from running in SUDDEN_DEATH mode
  if (room.mode === 'SUDDEN_DEATH' || room.isSuddenDeath) {
    log(`[${room.id}] ⚠️ BLOCKED - transitionToRoundEndPhase cannot run in SUDDEN_DEATH mode (use resolveSuddenDeathRound instead)`);
    return;
  }
  
  if (room.gameEnding || room.currentPhase !== PHASE_PLAY) {
    log(`[${room.id}] ⚠️ Ignoring transition to ROUND_END - gameEnding=${room.gameEnding}, phase=${room.currentPhase}`);
    return;
  }
  
  // INVARIANT CHECK: Verify no eliminated players are in answered state
  for (const id in room.players) {
    const player = room.players[id];
    if (!player.alive && player.answered) {
      log(`[${room.id}] ⚠️ INVARIANT VIOLATION: Eliminated player ${player.name} has answered=true!`);
      player.answered = false; // Force correction
    }
  }
  
  room.currentPhase = PHASE_ROUND_END;
  
  // Clear all timers
  clearRoundTimer(room);
  
  log(`[${room.id}] Round ${room.round} - PHASE 4: ROUND_END`);
  
  // CRITICAL: DO NOT send deferred elimination UI yet
  // We need to check if Sudden Death will trigger first
  // Elimination UI will be sent later if NOT entering Sudden Death
  
  // Notify clients
  io.to(room.id).emit("enterRoundEndPhase", {
    round: room.round
  });
  
  // Short delay before next round or game end
  setTimeout(() => {
    if (room.gameEnding) return;
    
    // CRITICAL: Re-check player count (disconnect may have happened during delay)
    if (checkAndHandleSinglePlayer(room, 'transitionToRoundEndPhase after delay')) return;
    
    const aliveIds = getAliveIds(room);
    const remainingPlayers = Object.keys(room.players);
    
    // CRITICAL: Check if only 1 player remains (instant win)
    if (checkAndHandleSinglePlayer(room, 'transitionToRoundEndPhase')) return;
    
    // EDGE CASE DETECTION: All remaining players lost their last life this round
    // Count players who are alive=true with lives=0 (kept alive for potential Sudden Death)
    const playersWithZeroLives = aliveIds.filter(id => {
      const p = room.players[id];
      return p.lives === 0 && p.lastLifeLostRound === room.round;
    });
    
    if (playersWithZeroLives.length >= 2 && aliveIds.length === playersWithZeroLives.length) {
      // All alive players have 0 lives and lost them THIS round - trigger Sudden Death
      log(`[${room.id}] EDGE CASE: ${playersWithZeroLives.length} players all lost their last life in round ${room.round} - triggering Sudden Death`);
      
      // CRITICAL: Clear pendingElimination flags for players entering Sudden Death
      playersWithZeroLives.forEach(id => {
        room.players[id].pendingElimination = false;
      });
      
      handleGameEnd(room, aliveIds);
      return;
    }
    
    // If some players have 0 lives but not all, eliminate those with 0 lives now
    if (playersWithZeroLives.length > 0 && playersWithZeroLives.length < aliveIds.length) {
      log(`[${room.id}] Eliminating ${playersWithZeroLives.length} player(s) with 0 lives (other players still have lives)`);
      playersWithZeroLives.forEach(id => {
        const player = room.players[id];
        player.alive = false;
        player.roundEliminated = room.round;
        
        const totalPlayers = Object.keys(room.players).length;
        const newAliveCount = Object.values(room.players).filter(p => p.alive).length;
        const is1v1Endgame = (totalPlayers === 2 && newAliveCount === 1);
        
        log(`[${room.id}] Deferred elimination: ${player.name} - alive=false`);
        
        // Send elimination UI immediately (already at ROUND_END)
        io.to(id).emit("eliminated", { is1v1Endgame, round: room.round });
        io.to(room.id).emit("playerEliminated", { id, name: player.name, colorIndex: player.colorIndex });
        
        // Clear pending flag
        player.pendingElimination = false;
      });
      
      setTimeout(() => {
        broadcastMatchStatus(room);
      }, 100);
      
      // Re-check alive count after eliminations
      const newAliveIds = getAliveIds(room);
      if (newAliveIds.length <= 1) {
        handleGameEnd(room, newAliveIds);
        return;
      }
    }
    
    // Check if we're about to enter game end (which might trigger Sudden Death)
    const willEnterGameEnd = (room.round >= room.settings.maxRounds || aliveIds.length <= 1);
    
    if (willEnterGameEnd) {
      // DO NOT send deferred elimination UI yet - handleGameEnd will decide
      // If Sudden Death triggers, it will clear flags and send UI to non-participants
      // If no Sudden Death, handleGameEnd will handle winner declaration
      handleGameEnd(room, aliveIds);
    } else {
      // Normal round progression - send deferred elimination UI now
      for (const id in room.players) {
        const player = room.players[id];
        if (player.pendingElimination) {
          const totalPlayers = Object.keys(room.players).length;
          const aliveCount = Object.values(room.players).filter(p => p.alive).length;
          const is1v1Endgame = (totalPlayers === 2 && aliveCount === 1);
          
          log(`[${room.id}] Sending DEFERRED elimination UI to ${player.name} (is1v1Endgame=${is1v1Endgame})`);
          io.to(id).emit("eliminated", { is1v1Endgame, round: room.round });
          
          // Clear the flag
          player.pendingElimination = false;
        }
      }
      
      // Continue to next round
      waitForReadies(room);
    }
  }, 1500);
}

// Handle game end logic (extracted for clarity)
function handleGameEnd(room, aliveIds) {
  // CRITICAL: Check if only 1 player remains total (instant win)
  const remainingPlayers = Object.keys(room.players);
  if (remainingPlayers.length === 1) {
    const winnerId = remainingPlayers[0];
    log(`[handleGameEnd] ⚡ Only 1 player remains - instant win for ${winnerId}`);
    safeEndGame(room, winnerId);
    return;
  }
  
  // EDGE CASE: Check if multiple players lost their last life THIS round
  // This includes both alive=true with lives=0 AND alive=false with lastLifeLostRound
  const playersWhoLostLastLifeThisRound = Object.keys(room.players).filter(id => {
    const p = room.players[id];
    // Check if player lost last life this round (either still alive with 0 lives, or eliminated this round)
    return (p.lives === 0 && p.lastLifeLostRound === room.round) || 
           (!p.alive && p.roundEliminated === room.round && p.lastLifeLostRound === room.round);
  });
  
  log(`[handleGameEnd] Players who lost last life this round: ${playersWhoLostLastLifeThisRound.length}`);
  log(`[handleGameEnd] Alive at round start: ${room.aliveAtRoundStart}`);
  log(`[handleGameEnd] Players who lost last life: ${playersWhoLostLastLifeThisRound.map(id => room.players[id].name).join(', ')}`);
  log(`[handleGameEnd] Current mode: ${room.mode || 'NORMAL'}`);
  
  // 🔥 NEW RULE 3: 1v1 Sudden Death ONLY (CHECK THIS FIRST!)
  // Trigger ONLY if exactly 2 players at round start AND both lost last life
  log(`[handleGameEnd] Checking 1v1 sudden death: aliveAtRoundStart=${room.aliveAtRoundStart}, playersWhoLostLastLife=${playersWhoLostLastLifeThisRound.length}`);
  if (room.aliveAtRoundStart === 2 && playersWhoLostLastLifeThisRound.length === 2) {
    log(`[handleGameEnd] 🎯 1v1 SUDDEN DEATH: Both players in 1v1 lost their last life`);
    
    // MODE ISOLATION: Switch to SUDDEN_DEATH mode
    room.mode = 'SUDDEN_DEATH';
    room.isSuddenDeath = true;
    room.tiePlayers = playersWhoLostLastLifeThisRound;
    
    // PARTICIPANT LOCK: Create FROZEN list - ONLY these 2
    room.suddenDeathPlayers = [...playersWhoLostLastLifeThisRound];
    room.suddenDeathLength = 5;
    
    log(`[sudden-death] MODE: ${room.mode}`);
    log(`[sudden-death] LOCKED PARTICIPANTS (1v1 ONLY): ${room.suddenDeathPlayers.map(id => room.players[id].name).join(', ')}`);
    
    // Revive ONLY these 2 participants for Sudden Death
    for (const id of room.suddenDeathPlayers) {
      room.players[id].alive = true;
      room.players[id].lives = 1;
      room.players[id].pendingElimination = false;
    }
    
    // SAFETY GUARD: Ensure all other players remain eliminated
    for (const id of Object.keys(room.players)) {
      if (!room.suddenDeathPlayers.includes(id)) {
        room.players[id].alive = false;
        
        // Send elimination UI to non-participants NOW
        sendPendingEliminationUI(room, id, false, false);
        
        log(`[sudden-death] ${room.players[id].name} remains eliminated (not a participant)`);
      }
    }
    
    const names = room.suddenDeathPlayers.map(id => room.players[id].name);
    io.to(room.id).emit("suddenDeathStart", { 
      players: room.suddenDeathPlayers, 
      names: names,
      length: room.suddenDeathLength,
      reason: "1v1_both_failed"
    });
    
    updatePlayerList(room);
    startSuddenDeathRound(room);
    return;
  }
  
  // 🔥 NEW RULE 1: If ALL remaining players eliminated in same round → DRAW
  // BUT: Skip this check if already in SUDDEN_DEATH mode (1v1 should continue, not draw)
  // NOTE: This check comes AFTER 1v1 sudden death check to prioritize 1v1 scenarios
  if (room.mode !== 'SUDDEN_DEATH' && 
      playersWhoLostLastLifeThisRound.length >= 2 && 
      playersWhoLostLastLifeThisRound.length === room.aliveAtRoundStart) {
    log(`[handleGameEnd] 🎯 DRAW: All ${playersWhoLostLastLifeThisRound.length} players eliminated in same round`);
    
    // Send elimination UI to all players with DRAW flag
    for (const id of playersWhoLostLastLifeThisRound) {
      const player = room.players[id];
      if (player.pendingElimination) {
        log(`[handleGameEnd] Sending elimination UI to ${player.name} (DRAW scenario)`);
        io.to(id).emit("eliminated", { 
          is1v1Endgame: false, 
          round: room.round, 
          isDraw: true 
        });
        player.pendingElimination = false;
      }
    }
    
    // End game as DRAW (no winner)
    log(`[handleGameEnd] Ending game as DRAW - no winner`);
    safeEndGame(room, null); // null = draw
    return;
  }
  
  // 🔥 NEW RULE 3: Check for 1v1 score tie (normal game end)
  // ONLY trigger Sudden Death if exactly 2 players at round start
  if (room.aliveAtRoundStart === 2 && aliveIds.length === 2) {
    const p1 = room.players[aliveIds[0]];
    const p2 = room.players[aliveIds[1]];
    
    if (p1.score === p2.score) {
      log(`[handleGameEnd] 🎯 1v1 SUDDEN DEATH: Score tie between ${p1.name} and ${p2.name}`);

      // MODE ISOLATION: Switch to SUDDEN_DEATH mode
      room.mode = 'SUDDEN_DEATH';
      room.isSuddenDeath = true;
      room.tiePlayers = [p1.id, p2.id];
      
      // PARTICIPANT LOCK: Create FROZEN list
      room.suddenDeathPlayers = [p1.id, p2.id];
      room.suddenDeathLength = 5;
      
      log(`[sudden-death] MODE: ${room.mode}`);
      log(`[sudden-death] LOCKED PARTICIPANTS (1v1 score tie): ${room.suddenDeathPlayers.map(id => room.players[id].name).join(', ')}`);

      // Reset both players for sudden death
      room.players[p1.id].alive = true;
      room.players[p1.id].lives = 1;
      room.players[p1.id].pendingElimination = false;
      room.players[p2.id].alive = true;
      room.players[p2.id].lives = 1;
      room.players[p2.id].pendingElimination = false;
      
      // Ensure all other players remain eliminated and send them elimination UI
      for (const id of Object.keys(room.players)) {
        if (!room.suddenDeathPlayers.includes(id)) {
          room.players[id].alive = false;
          
          // Send elimination UI to non-participants NOW
          sendPendingEliminationUI(room, id, false, false);
          
          log(`[sudden-death] ${room.players[id].name} remains eliminated (not a participant)`);
        }
      }

      io.to(room.id).emit("suddenDeathStart", { 
        players: room.suddenDeathPlayers, 
        names: [p1.name, p2.name],
        length: room.suddenDeathLength,
        reason: "1v1_score_tie"
      });

      updatePlayerList(room);
      startSuddenDeathRound(room);
      return;
    }
  }
  
  // Normal winner selection (no Sudden Death)
  let winnerId = null;

  if (aliveIds.length === 1) {
    winnerId = aliveIds[0];
  } else {
    const sorted = Object.keys(room.players)
      .map(id => ({ id, ...room.players[id] }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return (a.time || 0) - (b.time || 0);
      });
    if (sorted.length > 0) winnerId = sorted[0].id;
  }
  
  // Send deferred elimination UI to any remaining players with pendingElimination
  // This handles cases where no Sudden Death was triggered
  for (const id in room.players) {
    const player = room.players[id];
    if (player.pendingElimination) {
      const totalPlayers = Object.keys(room.players).length;
      const aliveCount = Object.values(room.players).filter(p => p.alive).length;
      const is1v1Endgame = (totalPlayers === 2 && aliveCount === 1);
      
      sendPendingEliminationUI(room, id, is1v1Endgame, false);
    }
  }

  safeEndGame(room, winnerId);
}


// Utility helpers
function getAliveIds(room) {
  // SUDDEN DEATH OVERRIDE: During sudden death, only return participants
  if (room.isSuddenDeath && room.suddenDeathPlayers) {
    const aliveParticipants = room.suddenDeathPlayers.filter(id => room.players[id]?.alive);
    log(`[getAliveIds] Sudden Death mode: ${aliveParticipants.length} alive participants`);
    return aliveParticipants;
  }
  
  return Object.keys(room.players).filter(id => room.players[id].alive);
}
function getTopPlayers(room, n = 2, considerAliveOnly = true) {
  const pool = considerAliveOnly ? getAliveIds(room) : Object.keys(room.players);
  const arr = pool.map(id => ({ id, ...room.players[id] }));
  arr.sort((a,b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (a.time || 0) - (b.time || 0);
  });
  return arr.slice(0, n);
}

// Ready flow: start waiting for ready from all alive players or timeout
function waitForReadies(room) {
  // STEP 5: PROTECT waitForReadies
  if (room.gameEnding) return;
  
  // CRITICAL: Check if only 1 player remains (instant win)
  if (checkAndHandleSinglePlayer(room, 'waitForReadies')) return;
  
  for (const id in room.players) {
    room.players[id].ready = false;
  }

  io.to(room.id).emit("prepareNextRound");

  room.readyTimer = setTimeout(() => {
    if (room.gameEnding) return;
    
    // CRITICAL: Re-check player count before starting next round
    if (checkAndHandleSinglePlayer(room, 'waitForReadies timeout')) return;
    
    startNextRound(room);
  }, READY_TIMEOUT_MS);
}


// ---------- Socket handlers ----------
const onConnection = socket => {
  log(`========================================`);
  log(`[connection] New client connected`);
  log(`[connection] Socket ID: ${socket.id}`);
  log(`[connection] Client address: ${socket.handshake.address}`);
  log(`[connection] Total connected clients: ${io.server.engine.clientsCount}`);
  log(`[connection] Active rooms: [${Object.keys(rooms).join(', ')}]`);
  log(`========================================`);

  // --------------------
  // CREATE ROOM
  // --------------------
  socket.on("createRoom", ({ name, options } = {}) => {
    const room = createRoom(socket.id, options || {});

    log(`[createRoom] Player ${socket.id} (${name}) creating room ${room.id}`);
    log(`[createRoom] Room settings: maxPlayers=${room.settings.maxPlayers}, isPrivate=${room.settings.isPrivate}`);

    socket.join(room.id);
    playerRoom[socket.id] = room.id;

    room.players[socket.id] = createNewPlayer(socket.id, name);
    room.hostId = socket.id;

    // Send complete room state immediately
    socket.emit("roomCreated", {
      roomId: room.id,
      isHost: true,
      hostId: room.hostId,
      players: Object.values(room.players),
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
      settings: {
        maxPlayers: room.settings.maxPlayers,
        maxRounds: room.settings.maxRounds,
        powerUpsEnabled: room.settings.powerUpsEnabled
      }
    });

    socket.emit("youAreHost");

    log(`[createRoom] SUCCESS: Room ${room.id} created by ${socket.id} (${name})`);
    log(`[createRoom] Total rooms in memory: ${Object.keys(rooms).length}`);
    log(`[createRoom] Available rooms: [${Object.keys(rooms).join(', ')}]`);
  });

  // --------------------
  // JOIN ROOM
  // --------------------
  socket.on("joinRoom", ({ roomId, name }) => {
    // STEP 1: NORMALIZE ROOM CODE INPUT
    // Validate and normalize room code before processing
    if (!roomId || typeof roomId !== 'string') {
      log(`[joinRoom] Invalid room code format from ${socket.id}: ${roomId}`);
      socket.emit("joinError", "Invalid room code format");
      return;
    }
    
    // Normalize: trim whitespace and convert to uppercase
    const normalizedRoomId = roomId.trim().toUpperCase();
    
    // Validate length (must be exactly 6 characters)
    if (normalizedRoomId.length !== 6) {
      log(`[joinRoom] Invalid room code length from ${socket.id}: "${roomId}" (normalized: "${normalizedRoomId}", length: ${normalizedRoomId.length})`);
      socket.emit("joinError", "Room code must be 6 characters");
      return;
    }
    
    // STEP 2: ADD DEBUG LOGGING
    log(`[joinRoom] Player ${socket.id} (${name}) attempting to join room "${normalizedRoomId}"`);
    log(`[joinRoom] Original input: "${roomId}"`);
    log(`[joinRoom] Available rooms: [${Object.keys(rooms).join(', ')}]`);
    log(`[joinRoom] Total rooms in memory: ${Object.keys(rooms).length}`);
    
    // STEP 6: GET ROOM WITH FAILSAFE LOGGING
    const room = getRoom(normalizedRoomId);

    if (!room) {
      // STEP 7: HANDLE SERVER RESTART CASE WITH DETAILED ERROR
      log(`[joinRoom] Room "${normalizedRoomId}" not found`);
      log(`[joinRoom] Available rooms at time of failure: ${JSON.stringify(Object.keys(rooms))}`);
      socket.emit("joinError", "Room not found. It may have expired or the server restarted.");
      return;
    }
    
    // Log room found successfully
    log(`[joinRoom] Room "${normalizedRoomId}" found! Current players: ${Object.keys(room.players).length}/${room.settings.maxPlayers}`);

    // Check if player is already in this room
    if (room.players[socket.id]) {
      log(`[joinRoom] Player ${socket.id} is already in room ${normalizedRoomId}`);
      socket.emit("joinError", "You are already in this room");
      return;
    }

    if (Object.keys(room.players).length >= room.settings.maxPlayers) {
      log(`[joinRoom] Room ${normalizedRoomId} is full (${Object.keys(room.players).length}/${room.settings.maxPlayers})`);
      socket.emit("joinError", "Room is full");
      return;
    }

    if (room.phase === 'game') {
      log(`[joinRoom] Room ${normalizedRoomId} game is already in progress`);
      socket.emit("joinError", "Game is already in progress");
      return;
    }

    socket.join(normalizedRoomId);
    playerRoom[socket.id] = normalizedRoomId;

    room.players[socket.id] = createNewPlayer(socket.id, name);

    // Send complete room state to the joining player immediately
    socket.emit("roomJoined", {
      roomId: room.id,
      isHost: socket.id === room.hostId,
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

    // Broadcast updated state to all players in room
    broadcastRoomState(room);

    log(`[joinRoom] SUCCESS: ${socket.id} (${name}) joined room ${normalizedRoomId}. Total players: ${Object.keys(room.players).length}`);
  });

  // --------------------
  // LEAVE ROOM
  // --------------------
  socket.on("leaveRoom", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    const wasHost = socket.id === room.hostId;
    const playerName = room.players[socket.id]?.name || 'Unknown';
    
    log(`[leaveRoom] Player ${socket.id} (${playerName}) leaving room ${roomId}`);
    
    delete room.players[socket.id];
    delete playerRoom[socket.id];
    socket.leave(roomId);

    if (wasHost) {
      const remainingPlayers = Object.keys(room.players);
      if (remainingPlayers.length > 0) {
        room.hostId = remainingPlayers[0];
        io.to(room.hostId).emit("youAreHost");
        log(`[leaveRoom] Host transferred to ${room.hostId} in room ${roomId}`);
      }
    }

    // STEP 3: SAFE ROOM DELETION WITH TIMER CLEANUP
    if (Object.keys(room.players).length === 0) {
      log(`[leaveRoom] Room ${roomId} is now empty - cleaning up and removing`);
      
      // Use centralized timer cleanup
      clearAllRoomTimers(room);
      
      removeRoom(roomId);
      log(`[leaveRoom] Room ${roomId} deleted (empty)`);
      log(`[leaveRoom] Remaining rooms: [${Object.keys(rooms).join(', ')}]`);
    } else {
      // Broadcast updated state to remaining players
      broadcastRoomState(room);
      
      log(`[leaveRoom] ${socket.id} (${playerName}) left room ${roomId}. Remaining players: ${Object.keys(room.players).length}`);
    }
  });

  // Sync on request
  socket.on("requestSync", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    const me = room.players[socket.id];
    io.to(socket.id).emit("sync", {
      players: Object.entries(room.players).map(([id,p]) => ({
        id, name: p.name, colorIndex: p.colorIndex, alive: p.alive, lives: p.lives, score: Math.round(p.score||0)
      })),
      hostId: room.hostId,
      gameStarted: room.gameStarted,
      round: room.round,
      sequenceLength: room.sequence?.length || 0,
      you: me ? { name: me.name, lives: me.lives, score: Math.round(me.score||0), alive: me.alive } : null
    });
  });

  socket.on("registerName", name => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    if (typeof name === "string" && name.trim().length > 0 && room.players[socket.id]) {
      room.players[socket.id].name = name.trim();
      updatePlayerList(room);
      log(`Player ${socket.id} registered as ${name}`);
    }
  });

  // host starts initial game
  socket.on("startGame", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.hostId) return;
    if (room.gameStarted || room.phase !== 'lobby') return;

    // Check minimum players
    if (Object.keys(room.players).length < 2) {
      socket.emit("gameStartError", "Need at least 2 players to start");
      return;
    }

    // Set the start requested flag
    room.startRequested = true;
    log(`[${room.id}] Host requested game start`);

    // Try to start the game (will start immediately if all ready, or start countdown)
    tryStartGame(room);
  });

  // --------------------
  // UPDATE GAME SETTINGS (HOST ONLY)
  // --------------------
  socket.on("updateGameSettings", (settings) => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    
    // Validation: Room must exist
    if (!room) {
      socket.emit("settingsUpdateError", "Room not found");
      return;
    }
    
    // Validation: Only host can update settings
    if (socket.id !== room.hostId) {
      socket.emit("settingsUpdateError", "Only host can update settings");
      return;
    }
    
    // Validation: Can only update in LOBBY phase
    if (room.phase !== 'lobby') {
      socket.emit("settingsUpdateError", "Settings can only be changed in lobby");
      return;
    }
    
    // Validate and update maxPlayers
    if (settings.maxPlayers !== undefined) {
      const maxPlayers = parseInt(settings.maxPlayers);
      
      if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > 6) {
        socket.emit("settingsUpdateError", "Max players must be between 2 and 6");
        return;
      }
      
      // Cannot lower below current player count
      const currentPlayerCount = Object.keys(room.players).length;
      if (maxPlayers < currentPlayerCount) {
        socket.emit("settingsUpdateError", `Cannot set max players below current count (${currentPlayerCount})`);
        return;
      }
      
      room.settings.maxPlayers = maxPlayers;
      log(`[updateGameSettings] Room ${roomId} maxPlayers set to ${maxPlayers}`);
    }
    
    // Validate and update maxRounds
    if (settings.maxRounds !== undefined) {
      const maxRounds = parseInt(settings.maxRounds);
      
      if (isNaN(maxRounds) || maxRounds < 15 || maxRounds > 30) {
        socket.emit("settingsUpdateError", "Max rounds must be between 15 and 30");
        return;
      }
      
      room.settings.maxRounds = maxRounds;
      log(`[updateGameSettings] Room ${roomId} maxRounds set to ${maxRounds}`);
    }
    
    // Validate and update powerUpsEnabled
    if (settings.powerUpsEnabled !== undefined) {
      if (typeof settings.powerUpsEnabled !== 'boolean') {
        socket.emit("settingsUpdateError", "Power-ups enabled must be true or false");
        return;
      }
      
      room.settings.powerUpsEnabled = settings.powerUpsEnabled;
      log(`[updateGameSettings] Room ${roomId} powerUpsEnabled set to ${settings.powerUpsEnabled}`);
    }
    
    // Broadcast updated settings to all players
    broadcastRoomState(room);
    
    log(`[updateGameSettings] Settings updated successfully for room ${roomId}`);
  });

  // host cancels game start
  socket.on("cancelGameStart", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.hostId) return;
    if (!room.startCountdownTimer && !room.startRequested) return;

    // Reset the start requested flag
    room.startRequested = false;
    
    cancelGameCountdown(room);
  });

  // player toggles ready state
  socket.on("toggleReady", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.phase !== 'lobby') return;

    const player = room.players[socket.id];
    if (!player) return;

    player.isReady = !player.isReady;
    
    log(`[${room.id}] ${player.name} is now ${player.isReady ? 'ready' : 'not ready'}`);
    
    // Broadcast updated room state
    broadcastRoomState(room);

    // Try to start the game (will start immediately if host started + all ready)
    tryStartGame(room);
  });

  // host kicks player
  socket.on("kickPlayer", ({ playerId }) => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.phase !== 'lobby') return;

    // Verify sender is host
    if (socket.id !== room.hostId) return;
    
    // Verify player exists and is not the host
    if (!room.players[playerId] || playerId === room.hostId) return;

    const kickedPlayerName = room.players[playerId].name;
    
    // Remove player from room
    delete room.players[playerId];
    delete playerRoom[playerId];
    
    // Notify kicked player
    io.to(playerId).emit("kicked", {
      message: "You were removed from the room by the host."
    });
    
    // Force disconnect from room
    const kickedSocket = io.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.leave(roomId);
    }

    // Check if we need to cancel countdown due to insufficient players
    if (room.startCountdownTimer && Object.keys(room.players).length < 2) {
      cancelGameCountdown(room);
    }

    // Broadcast updated room state
    broadcastRoomState(room);

    log(`[${room.id}] ${kickedPlayerName} was kicked by host`);
  });


  // host requests rematch (keeps players)
  socket.on("restartGame", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id === room.hostId && Object.keys(room.players).length >= 2) {
      log("Restart requested by host:", socket.id);
      room.gameStarted = true;
      room.phase = 'game';
      // reset scores/lives but keep player list & host
      resetPlayersState(room);
      resetRoundState(room);
      
      // Notify phase change
      io.to(room.id).emit("phaseChange", { phase: 'game', roomId: room.id });
      
      // FIX: Start first round directly instead of using old waitForReadies system
      startNextRound(room);
    }
  });

  // DEPRECATED: Old ready signal from client (replaced by playerReadyForSequence in 4-phase system)
  // This handler is disabled to prevent double startNextRound calls
  // The new system uses GET_READY phase with playerReadyForSequence
  socket.on("playerReady", () => {
    // NO-OP: This event is deprecated and should not trigger anything
    // Client should use playerReadyForSequence instead
    log(`[playerReady] DEPRECATED event received from ${socket.id} - ignoring`);
  });

  // NEW: Client signals GET_READY phase complete (early ready)
  socket.on("playerReadyForSequence", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.currentPhase !== PHASE_GET_READY) return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // 🔥 HARD GUARD: Reject eliminated players
    if (!player.alive) {
      log(`[playerReadyForSequence] ⚠️ HARD GUARD: Eliminated player ${player.name} attempted to signal ready! REJECTED.`);
      return;
    }
    
    player.readyForSequence = true;
    
    const aliveIds = Object.keys(room.players).filter(id => room.players[id].alive);
    const allReady = aliveIds.every(id => room.players[id].readyForSequence);
    
    if (allReady) {
      // All players ready early - skip to SEQUENCE immediately
      if (room.getReadyTimeout) {
        clearTimeout(room.getReadyTimeout);
        room.getReadyTimeout = null;
      }
      
      log(`[${room.id}] All players ready early - advancing to SEQUENCE`);
      transitionToSequencePhase(room);
    }
  });

  // NEW: Client signals SEQUENCE phase complete (finished watching)
  socket.on("sequenceWatched", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.currentPhase !== PHASE_SEQUENCE) {
      log(`[sequenceWatched] Rejected from ${socket.id} - phase: ${room?.currentPhase || 'no room'}`);
      return;
    }
    
    const player = room.players[socket.id];
    
    // In sudden death, only sudden death players can signal watched
    if (room.isSuddenDeath) {
      if (!room.tiePlayers.includes(socket.id)) {
        log(`[sequenceWatched] Rejected from ${socket.id} - not a sudden death participant`);
        return;
      }
      
      if (!room.playersWatchedSequence) {
        room.playersWatchedSequence = new Set();
      }
      room.playersWatchedSequence.add(socket.id);
      
      log(`[sudden-death] ${player.name} finished watching sequence (${room.playersWatchedSequence.size}/${room.tiePlayers.length})`);
      
      if (room.playersWatchedSequence.size === room.tiePlayers.length) {
        log(`[sudden-death] All ${room.tiePlayers.length} active participants finished sequence - PHASE 3: PLAY`);
        enterSuddenDeathPlayPhase(room, room.suddenDeathRoundId);
      } else {
        log(`[sudden-death] Waiting for ${room.tiePlayers.length - room.playersWatchedSequence.size} more participant(s) to finish watching...`);
      }
      return;
    }
    
    // Normal game mode
    // Only alive players can signal watched
    if (!player || !player.alive) {
      log(`[sequenceWatched] Rejected from ${socket.id} - not alive`);
      return;
    }
    
    player.sequenceWatched = true;
    
    const aliveIds = Object.keys(room.players).filter(id => room.players[id].alive);
    const watchedCount = aliveIds.filter(id => room.players[id].sequenceWatched).length;
    
    log(`[${room.id}] ${player.name} finished watching sequence (${watchedCount}/${aliveIds.length})`);
    
    const allWatched = aliveIds.every(id => room.players[id].sequenceWatched);
    
    if (allWatched) {
      // All players finished watching - transition to PLAY phase
      log(`[${room.id}] All players finished sequence - PHASE 3: PLAY`);
      transitionToPlayPhase(room);
    } else {
      log(`[${room.id}] Waiting for other players to finish watching...`);
    }
  });


  socket.on("submitSequence", (data) => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    // HARD EXIT FLAG CHECK AT VERY TOP
    if (room.gameEnding) return;
    
    // PHASE CHECK: Only allow submissions during PLAY phase
    if (room.currentPhase !== PHASE_PLAY) {
      log(`[submitSequence] Rejected from ${socket.id} - wrong phase: ${room.currentPhase}`);
      return;
    }

    const player = room.players[socket.id];
    
    // 🔥 HARD GUARD: Reject eliminated players (server authority)
    if (!player.alive) {
      log(`[submitSequence] ⚠️ HARD GUARD: Eliminated player ${player.name} (${socket.id}) attempted to submit! REJECTED.`);
      return;
    }
    
    // Reject all gameplay from eliminated players
    if (!room.gameStarted) {
      log(`[submitSequence] Rejected from ${socket.id} - game not started`);
      return;
    }

    const { inputSequence = [], timeTaken = 0 } = data || {};

    // CRITICAL: Branch early for sudden death mode - COMPLETE ISOLATION
    if (room.isSuddenDeath) {
      // STRICT ENFORCEMENT: Only process suddenDeathPlayers (frozen list)
      if (!room.suddenDeathPlayers || !room.suddenDeathPlayers.includes(socket.id)) {
        log(`[sudden-death] ⚠️ REJECTED submission from non-participant ${socket.id} (${player.name})`);
        return;
      }
      
      // Additional safety check
      if (!room.tiePlayers.includes(socket.id)) {
        log(`[sudden-death] ⚠️ WARNING: Participant ${player.name} not in tiePlayers - they may have been eliminated`);
        return;
      }

      // Check correctness first
      const isCorrect = Array.isArray(inputSequence) &&
        inputSequence.length === room.sequence.length &&
        inputSequence.every((c, i) => c === room.sequence[i]);

      // SECOND CHANCE LOGIC for sudden death
      const canTriggerSecondChance = player.powerups?.secondChance?.active && 
                                      !player.powerups?.secondChance?.used;
      
      if (!isCorrect && canTriggerSecondChance) {
        log(`[sudden-death] ${player.name} got wrong answer but has Second Chance available`);
        
        // Second Chance triggers - give player a retry
        player.powerups.secondChance.active = false;
        player.powerups.secondChance.used = true; // Permanently used
        
        // Calculate remaining time for THIS player
        let remainingTime;
        if (player.personalDeadline) {
          remainingTime = Math.max(0, player.personalDeadline - Date.now());
        } else {
          remainingTime = Math.max(0, room.roundEndTimestamp - Date.now());
        }
        
        // PAUSE timer for this player by storing remaining time
        player.secondChanceRemaining = remainingTime;
        player.secondChanceActive = true;
        
        // Set personal deadline to far future to effectively pause timer
        player.personalDeadline = Date.now() + 999999999;
        
        // Notify player of Second Chance trigger
        io.to(socket.id).emit("secondChanceTriggered", {
          sequence: room.sequence,
          round: room.round,
          remainingTime: remainingTime
        });
        
        io.to(socket.id).emit("streakUpdate", { active: false, streak: 0 });
        
        log(`[sudden-death] ${player.name} Second Chance activated - timer PAUSED at ${remainingTime}ms`);
        
        // DO NOT mark as answered - player gets to retry
        return;
      }

      // Mark as answered and store input
      player.answered = true;
      player.time = timeTaken;
      player.inputSequence = inputSequence;
      
      // If player had Second Chance active (timer paused), resume their timer
      if (player.secondChanceActive) {
        player.secondChanceActive = false;
        // Restore personal deadline with remaining time from when Second Chance triggered
        player.personalDeadline = Date.now() + player.secondChanceRemaining;
        log(`[sudden-death] ${player.name} timer RESUMED with ${player.secondChanceRemaining}ms remaining`);
      }

      log(`[sudden-death] ${player.name} submitted sequence`);
      log(`[sudden-death] ${player.name} answer is ${isCorrect ? 'CORRECT' : 'WRONG'}`);

      // Check if both sudden death players have answered
      const answeredPlayers = room.tiePlayers.filter(id => room.players[id]?.answered);
      
      if (answeredPlayers.length === room.tiePlayers.length) {
        // Both players answered - clear timers and resolve sudden death
        log(`[sudden-death] Both players answered - resolving round`);
        clearRoundTimer(room);
        resolveSuddenDeathRound(room);
      } else {
        // Only one player answered so far
        // If this player got it WRONG, we can resolve immediately (they lost)
        if (!isCorrect) {
          log(`[sudden-death] ${player.name} got it wrong - waiting for other player to finish (they will win)`);
          // Don't resolve yet - let the other player finish to show their result
          // But we know the outcome already
        } else {
          log(`[sudden-death] ${player.name} got it correct - waiting for other player`);
          // This player got it right, wait for the other player
        }
      }
      
      return; // HARD STOP - prevent normal game logic from executing
    }

    // CRITICAL: Branch early for tie-breaker mode - STOP normal logic
    if (room.tieBreakerActive) {
      handleTieBreakerSubmission(room, socket.id, inputSequence, timeTaken);
      return; // STOP - prevent normal game logic from executing
    }
    
    log(`[submitSequence] ${player.name} (${socket.id}) submitted: len=${inputSequence.length} time=${timeTaken}`);

    // Store input sequence for Pattern Peek (before validation)
    player.inputSequence = inputSequence;

    const correct =
      Array.isArray(inputSequence) &&
      inputSequence.length === room.sequence.length &&
      inputSequence.every((c, i) => c === room.sequence[i]);

    // NEW SECOND CHANCE LOGIC - Failure interception
    if (!correct) {
      // Check if Second Chance can be triggered
      if (processSecondChanceRetry(room, socket.id)) {
        // Second Chance triggered - PAUSE TIMER and replay sequence
        log(`[${room.id}] Second Chance triggered for ${player.name} - pausing timer`);
        
        // Store remaining time
        const remainingTime = Math.max(0, room.roundEndTimestamp - Date.now());
        room.secondChanceRemainingTime = remainingTime;
        room.secondChancePlayerId = socket.id;
        
        // Pause timer
        if (room.timerInterval) {
          clearInterval(room.timerInterval);
          room.timerInterval = null;
        }
        if (room.roundTimeout) {
          clearTimeout(room.roundTimeout);
          room.roundTimeout = null;
        }
        
        // Notify player of Second Chance trigger
        io.to(socket.id).emit("secondChanceTriggered", {
          sequence: room.sequence,
          round: room.round,
          remainingTime: remainingTime
        });
        
        io.to(socket.id).emit("streakUpdate", { active: false, streak: 0 });
        updatePlayerList(room);
        
        // CRITICAL: DO NOT mark answered, DO NOT advance round
        // Player gets to retry - timer will resume after they watch sequence again
        return;
      } else {
        // Normal failure logic - Second Chance not available or already used
        player.answered = true;
        player.time = typeof timeTaken === "number" ? timeTaken : 0;
        player.lives = Math.max(0, player.lives - 1);
        player.streak = 0;

        if (player.lives > 0) {
          io.to(socket.id).emit("lifeLost", { livesLeft: player.lives });
        } else {
          // Player lost their last life
          const totalPlayers = Object.keys(room.players).length;
          const aliveCount = Object.values(room.players).filter(p => p.alive).length;
          
          // Check if any OTHER alive players still have lives > 0
          const playersWithLives = Object.values(room.players).filter(p => 
            p.alive && p.lives > 0 && p.id !== socket.id
          ).length;
          
          // EDGE CASE: Keep alive with 0 lives if:
          // 1. Multiple players still alive (aliveCount >= 2)
          // 2. No other players have lives > 0 (all at 0 or will be at 0)
          // This defers elimination until ROUND_END can check if Sudden Death should trigger
          if (aliveCount >= 2 && playersWithLives === 0) {
            log(`[${room.id}] ${player.name} lost last life but keeping alive=true, lives=0 for potential Sudden Death (${aliveCount} players, ${playersWithLives} with lives)`);
            player.lives = 0;
            // Mark that this player lost their last life THIS round
            player.lastLifeLostRound = room.round;
            io.to(socket.id).emit("lifeLost", { livesLeft: 0 });
          } else {
            // Normal elimination - either only 1 player left OR other players still have lives
            log(`[${room.id}] ELIMINATING ${player.name} - alive=false, round=${room.round}, phase=${room.currentPhase} (playersWithLives=${playersWithLives})`);
            player.alive = false;
            player.time = Number.MAX_SAFE_INTEGER;
            player.roundEliminated = room.round;
            // Mark that this player lost their last life THIS round
            player.lastLifeLostRound = room.round;
            
            // ELIMINATION UI TIMING FIX: Mark for pending elimination
            // Don't show elimination UI immediately - wait for ROUND_END
            // This allows eliminated players to see round-end animations
            player.pendingElimination = true;
            
            const newAliveCount = Object.values(room.players).filter(p => p.alive).length;
            const is1v1Endgame = (totalPlayers === 2 && newAliveCount === 1);
            
            // DEFER elimination UI - will be sent at ROUND_END
            log(`[${room.id}] Elimination UI DEFERRED for ${player.name} until ROUND_END (is1v1Endgame=${is1v1Endgame})`);
            
            // Still emit playerEliminated to update scoreboard for other players
            io.to(room.id).emit("playerEliminated", { id: socket.id, name: player.name, colorIndex: player.colorIndex });
            
            setTimeout(() => {
              broadcastMatchStatus(room);
            }, 100);
          }
        }
        
        log(`${player.name} answered INCORRECT. livesLeft=${player.lives}`);
        io.to(socket.id).emit("streakUpdate", { active: false, streak: 0 });
        updatePlayerList(room);
      }
    } else {
      // Correct answer - mark as answered and track statistics
      player.answered = true;
      player.time = typeof timeTaken === "number" ? timeTaken : 0;
      
      // Track player statistics
      player.totalTime += player.time;
      player.roundsPlayed++;
      player.avgTime = player.totalTime / player.roundsPlayed;
      if (player.time > 0 && player.time < player.fastestTime) {
        player.fastestTime = player.time;
      }
      player.streak = (player.streak || 0) + 1;

      let pointsPerTile = 5;
      if (player.streak >= 3) pointsPerTile = 10;

      const pointsEarned = room.sequence.length * pointsPerTile;
      player.score += pointsEarned;

      io.to(socket.id).emit("pointsEarned", { points: pointsEarned, total: Math.round(player.score) });
      io.to(socket.id).emit("correct", { streak: player.streak, streakBonus: player.streak >= 3 ? 5 : 0 });
      io.to(socket.id).emit("streakUpdate", { active: player.streak >= 3, streak: player.streak });

      updatePlayerList(room);

      log(`${player.name} correct for round ${room.round} (+${pointsEarned}) streak=${player.streak}`);
    }

    // Check if all alive players have answered
    const aliveIds = getAliveIds(room);
    const answeredIds = aliveIds.filter(id => room.players[id].answered);

    log(`[round check] round=${room.round} alive=${aliveIds.length} answered=${answeredIds.length}`);

    // CRITICAL: Only advance round when ALL alive players are resolved
    if (!room.tieBreakerActive && !room.gameEnding && answeredIds.length === aliveIds.length) {
      // All players resolved - transition to ROUND_END phase
      transitionToRoundEndPhase(room);
    }
  });

  socket.on("chatMessage", msg => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    const p = room.players[socket.id];
    if (p && typeof msg === "string") {
      io.to(room.id).emit("chatMessage", { name: p.name, colorIndex: p.colorIndex, text: msg });
    }
  });

  // NEW: Client finished watching Second Chance replay
  socket.on("secondChanceReplayComplete", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // Handle sudden death Second Chance replay completion
    if (room.isSuddenDeath) {
      if (!player.secondChanceActive) {
        log(`[sudden-death] ${player.name} replay complete but secondChanceActive already false`);
        return;
      }
      
      log(`[sudden-death] ${player.name} finished Second Chance replay - resuming timer from ${player.secondChanceRemaining}ms`);
      
      // Clear Second Chance active flag and restore personal deadline
      player.secondChanceActive = false;
      player.personalDeadline = Date.now() + player.secondChanceRemaining;
      
      log(`[sudden-death] ${player.name} timer RESUMED, personal deadline set to ${new Date(player.personalDeadline).toISOString()}`);
      return;
    }
    
    // Normal gameplay Second Chance
    if (room.currentPhase !== PHASE_PLAY) return;
    if (socket.id !== room.secondChancePlayerId) return;
    
    log(`[${room.id}] ${player.name} finished Second Chance replay - resuming timer from ${room.secondChanceRemainingTime}ms`);
    
    // Resume timer from stored remaining time
    room.roundEndTimestamp = Date.now() + room.secondChanceRemainingTime;
    room.freezeActive = false;
    
    // Restart timer interval
    room.timerInterval = setInterval(() => {
      updateRoundTimer(room);
    }, TIMER_UPDATE_INTERVAL);
    
    // Restart round timeout with remaining time
    room.roundTimeout = setTimeout(() => {
      handleRoundTimeout(room);
    }, room.secondChanceRemainingTime);
    
    // Notify client to resume
    io.to(socket.id).emit("secondChanceTimerResume", {
      remainingTime: room.secondChanceRemainingTime
    });
    
    // Clear Second Chance state
    room.secondChanceRemainingTime = null;
    room.secondChancePlayerId = null;
  });

  // Power-up activation handlers
  // NEW SECOND CHANCE ACTIVATION HANDLER
  socket.on("activateSecondChance", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.phase !== "game") return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // 🔥 HARD GUARD: Reject eliminated players
    if (!player.alive) {
      log(`[activateSecondChance] ⚠️ HARD GUARD: Eliminated player ${player.name} attempted to use Second Chance! REJECTED.`);
      return;
    }
    
    // CRITICAL: Check if power-ups are enabled
    if (!room.settings.powerUpsEnabled) {
      log(`[activateSecondChance] Rejected - power-ups disabled in room ${roomId}`);
      return;
    }
    
    // PHASE CHECK: Only allow Second Chance during PLAY phase
    if (room.currentPhase !== PHASE_PLAY) {
      log(`[activateSecondChance] Rejected from ${socket.id} - wrong phase: ${room.currentPhase}`);
      return;
    }

    // Use Second Chance activation
    const success = activateSecondChance(room, socket.id);
    
    if (success) {
      io.to(socket.id).emit("secondChanceActivated");
      io.to(room.id).emit("powerUpUsed", { playerId: socket.id, type: "secondChance" });

      // Broadcast updated room state
      io.to(room.id).emit("roomState", {
        roomId: room.id,
        hostId: room.hostId,
        players: Object.values(room.players),
        maxPlayers: room.settings.maxPlayers,
        phase: room.phase
      });

      log(`[${room.id}] ${player.name} activated Second Chance (one-time use)`);
    }
  });

  socket.on("activateFreeze", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.phase !== "game") return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // 🔥 HARD GUARD: Reject eliminated players
    if (!player.alive) {
      log(`[activateFreeze] ⚠️ HARD GUARD: Eliminated player ${player.name} attempted to use freeze! REJECTED.`);
      return;
    }
    
    // CRITICAL: Check if power-ups are enabled
    if (!room.settings.powerUpsEnabled) {
      log(`[activateFreeze] Rejected - power-ups disabled in room ${roomId}`);
      return;
    }
    
    // PHASE CHECK: Only allow freeze during PLAY phase
    if (room.currentPhase !== PHASE_PLAY) {
      log(`[activateFreeze] Rejected from ${socket.id} - wrong phase: ${room.currentPhase}`);
      return;
    }

    // Use server-side freeze activation
    const success = activateFreeze(room, socket.id);
    
    if (success) {
      io.to(socket.id).emit("freezeActivated");
      io.to(room.id).emit("powerUpUsed", { playerId: socket.id, type: "freeze" });

      // Broadcast updated room state
      io.to(room.id).emit("roomState", {
        roomId: room.id,
        hostId: room.hostId,
        players: Object.values(room.players),
        maxPlayers: room.settings.maxPlayers,
        phase: room.phase
      });

      log(`[${room.id}] ${player.name} activated Time Freeze power-up`);
    }
  });

  // Pattern Peek power-up activation
  socket.on("activatePatternPeek", (data) => {
    log(`[activatePatternPeek] ========== START ==========`);
    log(`[activatePatternPeek] Received from ${socket.id}`);
    log(`[activatePatternPeek] Data received:`, JSON.stringify(data));
    
    const roomId = playerRoom[socket.id];
    log(`[activatePatternPeek] Room ID: ${roomId}`);
    
    const room = getRoom(roomId);
    log(`[activatePatternPeek] Room found: ${!!room}, room.phase: ${room?.phase}`);
    
    if (!room || room.phase !== "game") {
      log(`[activatePatternPeek] Early exit - no room or wrong phase`);
      return;
    }
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // 🔥 HARD GUARD: Reject eliminated players
    if (!player.alive) {
      log(`[activatePatternPeek] ⚠️ HARD GUARD: Eliminated player ${player.name} attempted to use Pattern Peek! REJECTED.`);
      return;
    }
    
    // CRITICAL: Check if power-ups are enabled
    if (!room.settings.powerUpsEnabled) {
      log(`[activatePatternPeek] Rejected - power-ups disabled in room ${roomId}`);
      return;
    }
    
    log(`[activatePatternPeek] Current phase: ${room.currentPhase}, PHASE_PLAY: ${PHASE_PLAY}`);
    
    // PHASE CHECK: Pattern Peek can only be activated during PLAY phase
    if (room.currentPhase !== PHASE_PLAY) {
      log(`[activatePatternPeek] Rejected from ${socket.id} - wrong phase: ${room.currentPhase}`);
      return;
    }
    
    log(`[activatePatternPeek] Player found: ${!!player}, alive: ${player?.alive}`);
    log(`[activatePatternPeek] Player powerups:`, JSON.stringify(player.powerups));
    
    // Check if already used
    if (player.powerups.patternPeek.used) {
      log(`[activatePatternPeek] Rejected from ${socket.id} - already used`);
      return;
    }
    
    // Check if player has already submitted
    if (player.answered) {
      log(`[activatePatternPeek] Rejected from ${socket.id} - already answered`);
      return;
    }
    
    // Use client's current input length (more accurate than server's stored value)
    const currentInputLength = data?.currentInputLength ?? 0;
    const nextIndex = currentInputLength;
    
    log(`[activatePatternPeek] Client's current input length: ${currentInputLength}`);
    log(`[activatePatternPeek] Next index to reveal: ${nextIndex}`);
    log(`[activatePatternPeek] Room sequence:`, room.sequence);
    log(`[activatePatternPeek] Room sequence length: ${room.sequence.length}`);
    
    // Check if player already finished sequence
    if (nextIndex >= room.sequence.length) {
      log(`[activatePatternPeek] Rejected from ${socket.id} - sequence already complete (nextIndex=${nextIndex}, length=${room.sequence.length})`);
      return;
    }
    
    const nextColor = room.sequence[nextIndex];
    
    log(`[activatePatternPeek] Next color at index ${nextIndex}: ${nextColor}`);
    
    // Mark as used
    player.powerups.patternPeek.used = true;
    
    log(`[${room.id}] ${player.name} activated Pattern Peek - revealing tile ${nextIndex}: ${nextColor}`);
    
    // Emit to ONLY this player
    io.to(socket.id).emit("peekReveal", {
      index: nextIndex,
      color: nextColor
    });
    
    log(`[activatePatternPeek] Emitted peekReveal to ${socket.id}: index=${nextIndex}, color=${nextColor}`);
    
    // Broadcast that power-up was used (but not what was revealed)
    io.to(room.id).emit("powerUpUsed", { playerId: socket.id, type: "peek" });
    
    log(`[activatePatternPeek] ========== END ==========`);
  });

// ============================================================================
// CENTRALIZED DISCONNECT SYSTEM - PRODUCTION GRADE
// ============================================================================

/**
 * Centralized disconnect decision system
 * This is the ONLY place where disconnect logic should exist
 * All state recalculation happens here in deterministic order
 */
function handlePlayerDisconnect(socket, room, roomId) {
  // ========================================
  // STEP 1: CAPTURE INITIAL STATE
  // ========================================
  const disconnectedId = socket.id;
  const wasHost = disconnectedId === room.hostId;
  const playerName = room.players[disconnectedId]?.name || 'Unknown';
  const wasAlive = room.players[disconnectedId]?.alive || false;
  const colorIndex = room.players[disconnectedId]?.colorIndex ?? 0;
  const wasSuddenDeathParticipant = room.tiePlayers?.includes(disconnectedId);
  
  log(`========================================`);
  log(`[DISCONNECT] Player: ${disconnectedId} (${playerName})`);
  log(`[DISCONNECT] Room: ${roomId}`);
  log(`[DISCONNECT] Phase: ${room.phase}/${room.currentPhase}`);
  log(`[DISCONNECT] Before: ${Object.keys(room.players).length} players`);
  log(`[DISCONNECT] Was Host: ${wasHost}, Alive: ${wasAlive}`);
  log(`[DISCONNECT] Sudden Death: ${room.isSuddenDeath}, Participant: ${wasSuddenDeathParticipant}`);
  
  // ========================================
  // STEP 2: ATOMIC PLAYER REMOVAL
  // ========================================
  delete room.players[disconnectedId];
  delete playerRoom[disconnectedId];
  
  // Remove from sudden death participants
  if (room.tiePlayers?.includes(disconnectedId)) {
    room.tiePlayers = room.tiePlayers.filter(id => id !== disconnectedId);
  }
  
  // ========================================
  // STEP 3: RECALCULATE ROOM STATE
  // ========================================
  const state = calculateRoomState(room);
  
  log(`[DISCONNECT] After: ${state.totalPlayers} players, ${state.alivePlayers} alive`);
  log(`[DISCONNECT] Sudden Death Players: ${state.suddenDeathPlayers}`);
  
  // Emit playerEliminated if they were alive
  if (wasAlive) {
    io.to(roomId).emit("playerEliminated", {
      id: disconnectedId,
      name: playerName,
      colorIndex: colorIndex
    });
  }
  
  // ========================================
  // STEP 4: MAKE DECISION
  // ========================================
  const decision = makeDisconnectDecision(room, state, wasHost);
  
  log(`[DISCONNECT] Decision: ${decision.action}`);
  log(`[DISCONNECT] Reason: ${decision.reason}`);
  
  // ========================================
  // STEP 5: EXECUTE DECISION
  // ========================================
  executeDisconnectDecision(room, roomId, decision, disconnectedId, playerName);
  
  log(`========================================`);
}

/**
 * Calculate current room state after player removal
 * This is a pure function - no side effects
 */
function calculateRoomState(room) {
  const playerIds = Object.keys(room.players);
  const aliveIds = playerIds.filter(id => room.players[id].alive);
  
  return {
    totalPlayers: playerIds.length,
    alivePlayers: aliveIds.length,
    playerIds: playerIds,
    aliveIds: aliveIds,
    suddenDeathPlayers: room.tiePlayers?.length || 0,
    phase: room.phase,
    currentPhase: room.currentPhase,
    isSuddenDeath: room.isSuddenDeath,
    gameEnding: room.gameEnding,
    hasCountdown: !!room.startCountdownTimer
  };
}

/**
 * Make disconnect decision based on room state
 * This is a pure function - returns decision object
 */
function makeDisconnectDecision(room, state, wasHost) {
  const phaseCategory = getDisconnectPhaseCategory(room);
  
  // DECISION 1: Empty room
  if (state.totalPlayers === 0) {
    return { action: 'DELETE_ROOM', reason: 'Room empty' };
  }
  
  // DECISION 2: Lobby phase
  if (phaseCategory === 'LOBBY') {
    if (state.hasCountdown && state.totalPlayers < 2) {
      return { action: 'CANCEL_COUNTDOWN', reason: 'Not enough players', needsHostTransfer: wasHost };
    }
    return { action: 'UPDATE_LOBBY', reason: 'Lobby update', needsHostTransfer: wasHost };
  }
  
  // DECISION 3: GET_READY phase with < 2 players - cancel round and return to lobby
  if (phaseCategory === 'GET_READY' && state.totalPlayers < 2) {
    return { action: 'CANCEL_ROUND_TO_LOBBY', reason: 'GET_READY < 2 players', needsHostTransfer: wasHost };
  }
  
  // DECISION 4: Sudden death with 1 player remaining
  if (state.isSuddenDeath && state.suddenDeathPlayers === 1) {
    return { 
      action: 'END_SUDDEN_DEATH', 
      reason: 'Sudden death - 1 player remains',
      winnerId: room.tiePlayers[0]
    };
  }
  
  // DECISION 5: Sudden death with 0 players remaining
  if (state.isSuddenDeath && state.suddenDeathPlayers === 0) {
    const top = getTopPlayers(room, 1, false)[0];
    return { 
      action: 'END_GAME', 
      reason: 'Sudden death - all participants disconnected',
      winnerId: top?.id
    };
  }
  
  // DECISION 6: 1v1 becomes 1v0
  if (state.phase === 'game' && state.totalPlayers === 1) {
    return { 
      action: 'INSTANT_VICTORY', 
      reason: '1v1 → 1v0',
      winnerId: state.playerIds[0]
    };
  }
  
  // DECISION 7: Only 1 alive player remains
  if (state.phase === 'game' && state.alivePlayers === 1 && !state.gameEnding) {
    return { 
      action: 'END_GAME', 
      reason: 'Only 1 alive player',
      winnerId: state.aliveIds[0]
    };
  }
  
  // DECISION 8: PLAY phase - check if all alive players answered
  if (phaseCategory === 'PLAY') {
    const allAnswered = state.aliveIds.every(id => room.players[id].answered);
    if (allAnswered) {
      return { 
        action: 'END_ROUND', 
        reason: 'All remaining players answered',
        needsHostTransfer: wasHost
      };
    }
  }
  
  // DECISION 9: Continue game
  return { 
    action: 'CONTINUE_GAME', 
    reason: 'Game continues',
    needsHostTransfer: wasHost
  };
}

/**
 * Execute the disconnect decision
 * This is where side effects happen
 */
function executeDisconnectDecision(room, roomId, decision, disconnectedId, playerName) {
  // Transfer host if needed (do this first, before any other actions)
  if (decision.needsHostTransfer && Object.keys(room.players).length > 0) {
    const newHostId = Object.keys(room.players)[0];
    room.hostId = newHostId;
    io.to(newHostId).emit("youAreHost");
    log(`[DISCONNECT] Host transferred → ${newHostId}`);
  }
  
  // Execute action
  switch (decision.action) {
    case 'DELETE_ROOM':
      clearAllRoomTimers(room);
      removeRoom(roomId);
      log(`[DISCONNECT] Room deleted`);
      break;
      
    case 'CANCEL_COUNTDOWN':
      clearGameCountdown(room);
      io.to(roomId).emit("gameStartCancelled", { reason: "Not enough players" });
      io.to(roomId).emit("roomState", buildRoomState(room));
      log(`[DISCONNECT] Countdown cancelled`);
      break;
      
    case 'UPDATE_LOBBY':
      io.to(roomId).emit("roomState", buildRoomState(room));
      log(`[DISCONNECT] Lobby updated`);
      break;
      
    case 'CANCEL_ROUND_TO_LOBBY':
      clearPhaseTimers(room);
      clearAllRoomTimers(room);
      room.phase = 'lobby';
      room.currentPhase = null;
      room.gameStarted = false;
      io.to(roomId).emit("phaseChange", { phase: 'lobby', roomId });
      io.to(roomId).emit("roomState", buildRoomState(room));
      log(`[DISCONNECT] Round cancelled → returned to lobby`);
      break;
      
    case 'END_SUDDEN_DEATH':
      // Emit feedback to winner
      io.to(decision.winnerId).emit("correct", { streak: 0, streakBonus: 0 });
      
      // Notify of disconnect
      io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      log(`[DISCONNECT] Sudden death instant win - winner: ${decision.winnerId}`);
      endSuddenDeath(room, decision.winnerId);
      break;
      
    case 'INSTANT_VICTORY':
      // Notify of disconnect
      io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      log(`[DISCONNECT] Instant victory - winner: ${decision.winnerId}`);
      // Fire immediately (no delay, no pre-setting gameEnding)
      safeEndGame(room, decision.winnerId);
      break;
      
    case 'END_GAME':
      room.gameEnding = true;
      clearAllRoomTimers(room);
      
      // Notify of disconnect
      io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      safeEndGame(room, decision.winnerId);
      log(`[DISCONNECT] Game ended - winner: ${decision.winnerId}`);
      break;
      
    case 'END_ROUND':
      // Notify of disconnect
      io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      updatePlayerList(room);
      clearRoundTimer(room);
      transitionToRoundEndPhase(room);
      log(`[DISCONNECT] Round ended - all answered`);
      break;
      
    case 'CONTINUE_GAME':
      // Notify of disconnect
      io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      updatePlayerList(room);
      log(`[DISCONNECT] Game continues`);
      break;
      
    case 'UPDATE_ROOM':
      io.to(roomId).emit("roomState", buildRoomState(room));
      log(`[DISCONNECT] Room state updated`);
      break;
      
    default:
      log(`[DISCONNECT] Unknown action: ${decision.action}`);
  }
}

/**
 * Build room state object for emission
 */
function buildRoomState(room) {
  return {
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
  };
}

// ============================================================================
// DISCONNECT SOCKET HANDLER
// ============================================================================

  socket.on("disconnect", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    
    if (!room) {
      // Clean up orphaned playerRoom entry
      delete playerRoom[socket.id];
      return;
    }
    
    // Use centralized disconnect handler
    handlePlayerDisconnect(socket, room, roomId);
  });

};

function attach(namespace) {
  io = namespace;
  io.on("connection", onConnection);

  // Periodic room health check (every 5 minutes)
    setInterval(() => {
      const roomCount = Object.keys(rooms).length;
      const roomList = Object.keys(rooms);
      log(`[health-check] Active rooms: ${roomCount}`);
      if (roomCount > 0) {
        log(`[health-check] Room IDs: [${roomList.join(', ')}]`);
        roomList.forEach(roomId => {
          const room = rooms[roomId];
          if (room) {
            log(`[health-check]   ${roomId}: ${Object.keys(room.players).length} players, phase: ${room.phase}`);
          }
        });
      }
    }, 300000); // 5 minutes
  log("[colorrush] ready");
}

module.exports = { attach };
