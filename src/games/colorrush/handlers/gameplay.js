const { ctx } = require('../state');
const { broadcastMatchStatus, updatePlayerList } = require('../lobby');
const { processSecondChanceRetry } = require('../powerups');
const { getAliveIds, startNextRound, transitionToPlayPhase, transitionToRoundEndPhase, transitionToSequencePhase } = require('../rounds');
const { PHASE_GET_READY, PHASE_PLAY, PHASE_SEQUENCE, log, playerRoom } = require('../state');
const { enterSuddenDeathPlayPhase, handleTieBreakerSubmission, resolveSuddenDeathRound } = require('../suddenDeath');
const { clearRoundTimer } = require('../timers');
const { getRoom } = require('../rooms');

function register(socket) {
  // Per-socket chat throttle (lives in this closure, so it is released on disconnect)
  let lastChatAt = 0;

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
        ctx.io.to(socket.id).emit("secondChanceTriggered", {
          sequence: room.sequence,
          round: room.round,
          remainingTime: remainingTime
        });
        
        ctx.io.to(socket.id).emit("streakUpdate", { active: false, streak: 0 });
        
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
        ctx.io.to(socket.id).emit("secondChanceTriggered", {
          sequence: room.sequence,
          round: room.round,
          remainingTime: remainingTime
        });
        
        ctx.io.to(socket.id).emit("streakUpdate", { active: false, streak: 0 });
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
          ctx.io.to(socket.id).emit("lifeLost", { livesLeft: player.lives });
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
            ctx.io.to(socket.id).emit("lifeLost", { livesLeft: 0 });
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
            ctx.io.to(room.id).emit("playerEliminated", { id: socket.id, name: player.name, colorIndex: player.colorIndex });
            
            setTimeout(() => {
              broadcastMatchStatus(room);
            }, 100);
          }
        }
        
        log(`${player.name} answered INCORRECT. livesLeft=${player.lives}`);
        ctx.io.to(socket.id).emit("streakUpdate", { active: false, streak: 0 });
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

      ctx.io.to(socket.id).emit("pointsEarned", { points: pointsEarned, total: Math.round(player.score) });
      ctx.io.to(socket.id).emit("correct", { streak: player.streak, streakBonus: player.streak >= 3 ? 5 : 0 });
      ctx.io.to(socket.id).emit("streakUpdate", { active: player.streak >= 3, streak: player.streak });

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
      const text = msg.trim().slice(0, 200);
      if (!text) return;

      const now = Date.now();
      if (now - lastChatAt < 500) return;
      lastChatAt = now;

      ctx.io.to(room.id).emit("chatMessage", { name: p.name, colorIndex: p.colorIndex, text });
    }
  });
}

module.exports = { register };
