// ========== UNIFIED GAME ENGINE FOR MULTIPLAYER AND PRACTICE ==========

// Create unified player state (works for both multiplayer and practice)
function createUnifiedPlayer(socketId, name, isLocal = false) {
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
        available: true,
        active: false,
        used: false
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
    },
    // Practice mode specific
    isLocal: isLocal
  };
}

// Create practice room (fake room object for unified logic)
function createPracticeRoom(playerName) {
  const playerId = 'practice-player';
  const player = createUnifiedPlayer(playerId, playerName, true);
  
  return {
    id: 'practice',
    hostId: playerId,
    players: { [playerId]: player },
    sequence: [],
    round: 0,
    gameStarted: true,
    phase: 'game',
    gameEnding: false,
    isSuddenDeath: false,
    suddenDeathLength: 5,
    tiePlayers: [],
    // Practice specific
    isPractice: true,
    maxRounds: 15
  };
}

// ========== SECOND CHANCE POWERUP SYSTEM (REDESIGNED FROM SCRATCH) ==========

// NEW SECOND CHANCE POWERUP SYSTEM - Client-side functions
function activateSecondChance(room, playerId) {
  const player = room.players[playerId];
  if (!player) return false;

  // Validation: Second Chance must be available and not already used
  if (!player.alive) return false;
  if (!player.powerups.secondChance.available) return false;
  if (player.powerups.secondChance.used) return false;
  if (player.powerups.secondChance.active) return false;

  // Activate Second Chance
  player.powerups.secondChance.active = true;

  // Show activation feedback
  const message = document.createElement('div');
  message.className = 'power-up-notification';
  message.textContent = '🔁 Second Chance Armed! You will get one retry if you fail (one-time use).';
  document.body.appendChild(message);
  
  setTimeout(() => {
    if (message.parentNode) {
      message.parentNode.removeChild(message);
    }
  }, 3000);

  // Update UI
  updatePowerUpButtons();
  
  console.log(`Second Chance activated for ${player.name} (one-time use)`);
  return true;
}

function processSecondChanceRetryClient(room, playerId) {
  const player = room.players[playerId];
  if (!player) return false;

  // Check if Second Chance can be triggered
  const canTrigger = player.powerups.secondChance.active && 
                    !player.powerups.secondChance.used;

  if (canTrigger) {
    // Second Chance triggers
    player.powerups.secondChance.active = false;
    player.powerups.secondChance.used = true; // Permanently used
    
    // Reset player state for retry
    player.answered = false;
    player.time = 0;
    // DO NOT reduce lives

    console.log(`Second Chance triggered for ${player.name} - permanently used`);
    return true;
  }

  return false;
}

function resetSecondChanceRoundStateClient(player) {
  // Reset only round-specific state, NOT the used flag
  player.powerups.secondChance.active = false;
  // DO NOT reset player.powerups.secondChance.used - it's permanent
}

function resetSecondChanceForNewMatchClient(player) {
  // Only reset for completely new match
  player.powerups.secondChance.available = true;
  player.powerups.secondChance.active = false;
  player.powerups.secondChance.used = false;
}

// Shared internal function for wrong tile processing
// NEW SECOND CHANCE SYSTEM - Client-side wrong tile processing
function processWrongTile(room, playerId, inputSequence, timeTaken) {
  const player = room.players[playerId];
  if (!player || !player.alive) return null;

  // Check if Second Chance can be triggered
  const canTrigger = player.powerups.secondChance.active && 
                    !player.powerups.secondChance.used;

  if (canTrigger) {
    // Second Chance triggers - give player a retry
    player.powerups.secondChance.active = false;
    player.powerups.secondChance.used = true; // Permanently used
    
    // Reset for retry - DO NOT reduce lives
    player.answered = false;
    player.time = 0;
    player.streak = 0;

    console.log(`Second Chance triggered for ${player.name} - permanently used`);
    return 'secondChanceTriggered';
  } else {
    // Normal failure logic
    player.answered = true;
    player.time = typeof timeTaken === "number" ? timeTaken : 0;
    player.lives = Math.max(0, player.lives - 1);
    player.streak = 0;

    if (player.lives > 0) {
      console.log(`${player.name} lost life. Lives left: ${player.lives}`);
      return 'lifeLost';
    } else {
      player.alive = false;
      console.log(`${player.name} eliminated`);
      return 'eliminated';
    }
  }
}

// NEW SECOND CHANCE SYSTEM - Client-side cleanup functions
function cleanupSecondChanceState(player) {
  // Reset only round-specific state, NOT the used flag
  player.powerups.secondChance.active = false;
  // DO NOT reset player.powerups.secondChance.used - it's permanent
  console.log(`Second Chance round state cleaned up for ${player.name}`);
}

function resetSecondChanceAvailability(player) {
  // Only reset for completely new match
  player.powerups.secondChance.available = true;
  player.powerups.secondChance.active = false;
  player.powerups.secondChance.used = false;
  console.log(`Second Chance availability reset for ${player.name}`);
}

// ========== END SECOND CHANCE SYSTEM ==========

function activateFreeze(room, playerId) {
  // Use practice-specific freeze logic for local mode
  return activatePracticeFreeze(room, playerId);
}

function activatePatternPeek(room, playerId) {
  console.log('activatePatternPeek called:', { room, playerId });
  
  const player = room.players[playerId];
  console.log('Player:', player);
  console.log('Player powerups:', player?.powerups);
  
  if (!player || !player.powerups.patternPeek.available || player.powerups.patternPeek.used) {
    console.log('Pattern Peek validation failed:', {
      hasPlayer: !!player,
      available: player?.powerups.patternPeek.available,
      used: player?.powerups.patternPeek.used
    });
    return false;
  }

  // Mark as used
  player.powerups.patternPeek.used = true;
  
  // Determine next correct tile
  const inputSequence = playerSequence || [];
  const nextIndex = inputSequence.length;
  
  console.log('Pattern Peek state:', {
    playerSequence,
    sequence,
    nextIndex,
    sequenceLength: sequence.length
  });
  
  // Check if already finished
  if (nextIndex >= sequence.length) {
    console.log('Pattern Peek: sequence already complete');
    return false;
  }
  
  const nextColor = sequence[nextIndex];
  
  console.log(`Pattern Peek revealing: index=${nextIndex}, color=${nextColor}`);
  
  // Reveal the tile visually
  revealPeekTile(nextColor);
  
  updatePowerUpButtons();
  
  console.log(`Pattern Peek activated - revealing tile ${nextIndex}: ${nextColor}`);
  return true;
}

function revealPeekTile(color) {
  console.log(`🧠 Pattern Peek revealing: ${color}`);

  // Show compact message with close button
  const message = document.createElement('div');
  message.className = 'peek-message-overlay';
  message.innerHTML = `
    <div class="peek-message-content">
      <button class="peek-close-btn" onclick="this.closest('.peek-message-overlay').remove()">×</button>
      <div class="peek-icon">🧠</div>
      <div class="peek-text">Next tile: <span class="peek-color">${color.toUpperCase()}</span></div>
    </div>
  `;
  document.body.appendChild(message);

  // Auto-remove after 5 seconds if not manually closed
  setTimeout(() => {
    if (message.parentNode) {
      message.classList.add('fade-out');
      setTimeout(() => {
        if (message.parentNode) {
          message.parentNode.removeChild(message);
        }
      }, 300);
    }
  }, 5000);

  // Allow clicking outside to close
  message.addEventListener('click', (e) => {
    if (e.target === message) {
      message.remove();
    }
  });
}



// Unified submission processing (REDESIGNED WITH SECOND CHANCE SYSTEM)
function processSubmission(room, playerId, inputSequence, timeTaken) {
  const player = room.players[playerId];
  if (!player || !player.alive) return;

  console.log(`[processSubmission] ${player.name} submitted: ${inputSequence.length} tiles, time: ${timeTaken}`);

  const correct = Array.isArray(inputSequence) &&
    inputSequence.length === room.sequence.length &&
    inputSequence.every((c, i) => c === room.sequence[i]);

  if (!correct) {
    // Use shared wrong tile processing logic
    const result = processWrongTile(room, playerId, inputSequence, timeTaken);
    
    // For lifeLost or eliminated, player is already marked as answered in processWrongTile
  } else {
    // Correct answer
    player.answered = true;
    player.time = typeof timeTaken === "number" ? timeTaken : 0;
    player.streak = (player.streak || 0) + 1;

    let pointsPerTile = 5;
    if (player.streak >= 3) pointsPerTile = 10;

    const pointsEarned = room.sequence.length * pointsPerTile;
    player.score += pointsEarned;

    console.log(`${player.name} correct for round ${room.round} (+${pointsEarned}) streak=${player.streak}`);
  }
  
  // Track player statistics
  if (player.answered) {
    player.totalTime += player.time;
    player.roundsPlayed++;
    player.avgTime = player.totalTime / player.roundsPlayed;
    if (player.time > 0 && player.time < player.fastestTime) {
      player.fastestTime = player.time;
    }
  }

  // For practice mode, handle round progression
  if (room.isPractice) {
    if (correct) {
      // Clean up powerups before next round
      cleanupSecondChanceState(player);
      cleanupRoundPowerups(player, room.round);
      
      // Continue to next round
      setTimeout(() => {
        startUnifiedRound(room);
      }, 1200);
    }
  }
}

// Unified round start (works for both multiplayer and practice)
function startUnifiedRound(room) {
  if (room.gameEnding) return;
  
  // Cancel old playback
  currentPlaybackId++;
  isSequencePlaying = false;
  console.log(`startUnifiedRound: Cancelled old playback, new ID: ${currentPlaybackId}`);
  
  room.round++;
  round = room.round;
  
  // Generate sequence
  const sequenceLength = 3 + (room.round - 1);
  room.sequence = [];
  for (let i = 0; i < sequenceLength; i++) {
    room.sequence.push(COLORS[Math.floor(Math.random() * COLORS.length)]);
  }
  sequence = room.sequence;
  
  // Reset player states and clean up powerups from previous rounds
  for (const id in room.players) {
    const player = room.players[id];
    player.answered = false;
    player.time = 0;
    
    // PART 6: Clean up powerups from previous rounds
    cleanupRoundPowerups(player, room.round);
  }

  // PART 2: Pattern Peek doesn't need round-based state
  // It's one-time use per match, not per round

  console.log(`Starting unified round ${room.round} with ${sequenceLength} tiles`);
  
  // PRACTICE MODE: Don't use phase system, use old playSequence
  // This keeps practice mode simple and working
  updateGamePhase(`Round ${room.round}: Watch Closely`, '👀');
  try { if (audioEnabled) fx.roundStart.play(); } catch(e){}
  
  // Use the old playSequence function for practice mode
  playSequence(sequence);
}

// PART 6: Powerup cleanup functions (UPDATED FOR SECOND CHANCE SYSTEM)
function cleanupRoundPowerups(player, currentRound) {
  // Clean up Second Chance round state (but NOT the used flag)
  cleanupSecondChanceState(player);
  
  // Clean up freeze
  if (player.powerups.freeze.active && player.powerups.freeze.round !== currentRound) {
    player.powerups.freeze.active = false;
    player.powerups.freeze.round = null;
    player.powerups.freeze.startTime = null;
  }
  
  // Pattern Peek doesn't need cleanup - it's one-time use per match
  
  console.log(`Cleaned up powerups for ${player.name} after round ${currentRound}`);
}

function resetAllPowerups(player) {
  // PART 6: Complete powerup reset (UPDATED FOR SECOND CHANCE SYSTEM)
  resetSecondChanceAvailability(player);
  
  player.powerups.freeze = {
    available: true,
    used: false,
    active: false,
    round: null,
    startTime: null,
    duration: 3000
  };
  
  player.powerups.patternPeek = {
    available: true,
    used: false
  };
  
  console.log(`Reset all powerups for ${player.name}`);
}
function endPracticeGame(room, playerId) {
  const player = room.players[playerId];
  
  // Show practice victory screen
  const practiceData = {
    winner: playerId,
    winnerName: player.name,
    scoreboard: [{
      name: player.name,
      score: Math.round(player.score || 0),
      position: 1,
      avgTime: player.avgTime || 0,
      roundsPlayed: player.roundsPlayed || 0,
      fastestTime: player.fastestTime === Infinity ? 0 : player.fastestTime
    }],
    gameStats: {
      totalRounds: room.round,
      fastestTime: player.fastestTime === Infinity ? 0 : player.fastestTime,
      totalPlayers: 1,
      eliminations: 0
    }
  };
  
  room.gameEnding = true;
  disableTiles();
  showVictoryScreen(practiceData);
  try { if (audioEnabled) fx.fail.play(); } catch(e){}
  
  console.log(`Practice game ended. Final score: ${player.score}, Rounds: ${room.round}`);
  
  // The victory screen countdown will handle the return to intro automatically
  // No manual exit needed - let the countdown system control the flow
}

// Global practice room instance
let practiceRoom = null;

// Colors array for sequence generation
const COLORS = ["red", "green", "blue", "yellow"];

// ========== END UNIFIED GAME ENGINE ==========
// ========== UNIFIED PRACTICE MODE FUNCTIONS ==========

async function localStartRound() {
  // Initialize practice room if not exists
  if (!practiceRoom) {
    practiceRoom = createPracticeRoom(myName);
    console.log('Created practice room:', practiceRoom);
  }
  
  // Use unified round start
  startUnifiedRound(practiceRoom);
}

function localSubmitSequence(data) {
  // Use unified submission processing
  if (practiceRoom) {
    const playerId = 'practice-player';
    processSubmission(practiceRoom, playerId, data.inputSequence, data.timeTaken);
  }
}

// Reset practice mode cleanly
function resetPracticeMode() {
  // Clear all timers - no more roundTimer to clear
  clearTimerDisplay();
  clearPracticeTimer();
  clearTimeout(readyTimeout);
  if (localTimer) {
    clearTimeout(localTimer);
    localTimer = null;
  }
  
  // Reset flags
  isSequencePlaying = false;
  waitingForInput = false;
  
  // Reset UI
  disableTiles();
  inputTimerEl.textContent = "";
  countdownEl.textContent = "";
  
  // Reset all powerup UI
  if (timeFreezeBtn) {
    timeFreezeBtn.classList.remove('active');
    timeFreezeBtn.style.boxShadow = '';
  }
  if (shieldBtn) {
    shieldBtn.classList.remove('active');
    shieldBtn.style.boxShadow = '';
  }
  
  // Reset practice room
  practiceRoom = null;
  localRound = 0;
  
  // Reset power-ups
  resetPowerUps();
  
  console.log('Practice mode reset');
}

// ========== END UNIFIED PRACTICE FUNCTIONS ==========
