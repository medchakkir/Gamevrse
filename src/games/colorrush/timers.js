Object.assign(module.exports, { clearAllRoomTimers, clearPhaseTimers, safeEndGame, startRoundTimer, updateRoundTimer, clearRoundTimer, handleRoundTimeout, handlePlayerTimeout, cleanupTimerState }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { broadcastMatchStatus } = require('./lobby');
const { endGame, transitionToRoundEndPhase } = require('./rounds');
const { ROUND_DURATION_MS, TIMER_UPDATE_INTERVAL, log } = require('./state');
const { resolveSuddenDeathRound } = require('./suddenDeath');


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
    ctx.io.to(playerId).emit("timerUpdate", {
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


function handlePlayerTimeout(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.alive || player.answered) return;
  
  log(`[${room.id}] ${player.name} timed out (personal timer)`);
  
  player.answered = true;
  player.time = Number.MAX_SAFE_INTEGER;
  player.lives = Math.max(0, player.lives - 1);
  player.streak = 0;
  
  if (player.lives > 0) {
    ctx.io.to(playerId).emit("lifeLost", { livesLeft: player.lives, reason: "timeout" });
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
      ctx.io.to(playerId).emit("lifeLost", { livesLeft: 0, reason: "timeout" });
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
      ctx.io.to(playerId).emit("playerEliminated", { id: playerId, name: player.name, colorIndex: player.colorIndex });
      
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
