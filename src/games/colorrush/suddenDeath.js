Object.assign(module.exports, { startSuddenDeathRound, enterSuddenDeathPlayPhase, resolveSuddenDeathRound, endSuddenDeath, startTieBreakerRound, handleTieBreakerSubmission }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { clearGameCountdown, generateSequence } = require('./lobby');
const { endGame } = require('./rounds');
const { PHASE_GET_READY, PHASE_PLAY, PHASE_SEQUENCE, log } = require('./state');
const { clearPhaseTimers, clearRoundTimer, safeEndGame, updateRoundTimer } = require('./timers');
const { safeInterval, safeTimeout } = require('../../shared/timers');


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
  ctx.io.to(room.id).emit("suddenDeathRoundStart", {
    sequence: room.sequence,
    length: room.suddenDeathLength,
    tiePlayers: room.suddenDeathPlayers, // Use frozen list
    phase: PHASE_GET_READY
  });

  log(`[sudden-death] Round started with ${room.suddenDeathLength}-tile sequence - PHASE 1: GET_READY`);
  
  // Auto-advance to SEQUENCE phase after 3 seconds
  room.getReadyTimeout = safeTimeout('colorrush/suddenDeath#1', () => {
    // Check if this is still the current round
    if (room.suddenDeathRoundId !== currentRoundId) {
      log(`[sudden-death] GET_READY timeout fired for old round ${currentRoundId}, ignoring (current: ${room.suddenDeathRoundId})`);
      return;
    }
    
    if (!room.isSuddenDeath || room.gameEnding) return;
    
    // PHASE 2: SEQUENCE
    room.currentPhase = PHASE_SEQUENCE;
    room.playersWatchedSequence = new Set();
    
    ctx.io.to(room.id).emit("enterSequencePhase", {
      sequence: room.sequence,
      round: room.round
    });
    
    log(`[sudden-death] PHASE 2: SEQUENCE - waiting for players to watch`);
    
    // Set timeout for sequence phase (in case players don't respond)
    const sequenceTimeout = 5000 + (room.sequence.length * 1000);
    room.sequenceTimeout = safeTimeout('colorrush/suddenDeath#2', () => {
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
  
  ctx.io.to(room.id).emit("enterPlayPhase", {
    round: room.round,
    timeLimit: suddenDeathTimeLimit
  });
  
  log(`[sudden-death] PHASE 3: PLAY - 20s timer started`);
  
  // Start timer interval for updates (every 100ms)
  room.timerInterval = safeInterval('colorrush/suddenDeath#3', () => {
    if (!room.isSuddenDeath || room.gameEnding) {
      clearInterval(room.timerInterval);
      return;
    }
    updateRoundTimer(room);
  }, 100);
  
  // Set round timer (20 seconds for sudden death)
  room.roundTimer = safeTimeout('colorrush/suddenDeath#4', () => {
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
      ctx.io.to(r.id).emit("correct", { streak: 0, streakBonus: 0 });
    } else {
      ctx.io.to(r.id).emit("lifeLost", { livesLeft: 0 });
    }
  });

  // Count survivors (players who got it correct)
  const survivors = results.filter(r => r.correct);
  
  // CASE 1: Exactly one survivor - WINNER!
  if (survivors.length === 1) {
    log(`[sudden-death] ⭐ WINNER: ${survivors[0].name}`);
    safeTimeout('colorrush/suddenDeath#5', () => {
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
    
    safeTimeout('colorrush/suddenDeath#6', () => {
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
  
  safeTimeout('colorrush/suddenDeath#7', () => {
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
  ctx.io.to(room.id).emit("tieBreakerRoundStart", {
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
    safeTimeout('colorrush/suddenDeath#8', () => {
      // Double-check we're not ending before starting next round
      if (!room.gameEnding) {
        startTieBreakerRound(room);
      }
    }, 1000);
  }
}
