Object.assign(module.exports, { getDisconnectPhaseCategory, startNextRound, transitionToSequencePhase, transitionToPlayPhase, transitionToRoundEndPhase, handleGameEnd, getAliveIds, getTopPlayers, waitForReadies, endGame }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { broadcastMatchStatus, checkAndHandleSinglePlayer, clearGameCountdown, fullReset, generateSequence, resetLobbyState, sendPendingEliminationUI, updatePlayerList } = require('./lobby');
const { resetSecondChanceRoundState } = require('./powerups');
const { PHASE_GET_READY, PHASE_PLAY, PHASE_ROUND_END, PHASE_SEQUENCE, READY_TIMEOUT_MS, ROUND_DURATION_MS, log, playerFreezeTimeouts } = require('./state');
const { resolveSuddenDeathRound, startSuddenDeathRound } = require('./suddenDeath');
const { clearRoundTimer, safeEndGame, startRoundTimer } = require('./timers');


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
  ctx.io.to(room.id).emit("roundStart", {
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
  ctx.io.to(room.id).emit("enterSequencePhase", {
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
    ctx.io.to(id).emit("enterPlayPhase", {
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
  ctx.io.to(room.id).emit("enterRoundEndPhase", {
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
        ctx.io.to(id).emit("eliminated", { is1v1Endgame, round: room.round });
        ctx.io.to(room.id).emit("playerEliminated", { id, name: player.name, colorIndex: player.colorIndex });
        
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
          ctx.io.to(id).emit("eliminated", { is1v1Endgame, round: room.round });
          
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
    ctx.io.to(room.id).emit("suddenDeathStart", { 
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
        ctx.io.to(id).emit("eliminated", { 
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

      ctx.io.to(room.id).emit("suddenDeathStart", { 
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

  ctx.io.to(room.id).emit("prepareNextRound");

  room.readyTimer = setTimeout(() => {
    if (room.gameEnding) return;
    
    // CRITICAL: Re-check player count before starting next round
    if (checkAndHandleSinglePlayer(room, 'waitForReadies timeout')) return;
    
    startNextRound(room);
  }, READY_TIMEOUT_MS);
}


// ---------- Socket handlers ----------


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

  ctx.io.to(room.id).emit("gameOver", {
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
    
    ctx.io.to(room.id).emit("phaseChange", { phase: 'lobby', roomId: room.id });
    
    // Send fresh room state to ensure clean UI with reset ready states
    ctx.io.to(room.id).emit("roomState", {
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
