// client.js
// Defensive socket init (avoid error when socket.io client not present)
const socket = (typeof io !== 'undefined') ? io('/colorrush') : null;

// DOM
const status = document.getElementById("status"); // This will be null now, using phase banner instead
const gamePhaseBanner = document.getElementById("gamePhaseBanner");
const phaseIcon = document.getElementById("phaseIcon");
const phaseText = document.getElementById("phaseText");
const startBtn = document.getElementById("startBtn");
const countdownEl = document.getElementById("countdown");
const inputTimerEl = document.getElementById("inputTimer");
const lobbyPlayersEl = document.getElementById("lobbyPlayers");
const playersEl = document.getElementById("players");
const buttonsContainer = document.getElementById("buttons");
const audioToggle = document.getElementById("audioToggle");
const nameInput = document.getElementById("nameInput");
const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const howToBtn = document.getElementById("howToBtn");
const howToContent = document.getElementById("howToContent");
const lobbyToggle = document.getElementById("lobbyToggle");
const lobbyPlayers = document.getElementById("lobbyPlayers");

// ========== STRICT INPUT LOCKING SYSTEM ==========

// Phase constants (must match server)
const PHASE_GET_READY = "GET_READY";
const PHASE_SEQUENCE = "SEQUENCE";
const PHASE_PLAY = "PLAY";
const PHASE_ROUND_END = "ROUND_END";

// Current phase tracking
let currentPhase = null;
let currentRound = 0;

// Input lock state
let inputLocked = true; // Start locked


// Timer management (STRICT: only one active at a time)
let getReadyInterval = null;
let mainTimerInterval = null;
let getReadyCountdown = 0;

// Second Chance state
let secondChanceReplayActive = false;

// Sudden death state
let isSuddenDeath = false;

// Tips rotation system
const quickTips = [
  "Use keyboard shortcuts (1-4) for faster input!",
  "Save your Second Chance power-up for difficult rounds.",
  "Freeze power-up pauses your timer for 3 seconds - use it wisely!",
  "Pattern Peek reveals the sequence during play phase.",
  "3+ players all fail in same round = DRAW",
  "2 players both fail in same round = SUDDEN DEATH",
  "In Sudden Death, if both players fail, it continues (not a draw)!",
  "Watch the scoreboard to track eliminated players' progress.",
  "You start with 2 lives - lose one for each mistake or timeout.",
  "The sequence gets longer each round - stay focused!",
  "Power-ups work in Sudden Death mode too!",
  "Second Chance timer pauses in Sudden Death until you replay.",
  "Eliminated players can watch the match but cannot rejoin.",
  "Only the last player standing or highest score wins!",
  "Ready up to signal you're prepared to start the game."
];

let tipsRotationInterval = null;
let currentTipIndex = 0;

function startTipsRotation() {
  const tipTextEl = document.getElementById('tipText');
  if (!tipTextEl) return;
  
  // Clear any existing interval
  if (tipsRotationInterval) {
    clearInterval(tipsRotationInterval);
  }
  
  // Show first random tip immediately
  currentTipIndex = Math.floor(Math.random() * quickTips.length);
  tipTextEl.textContent = quickTips[currentTipIndex];
  
  // Rotate tips every 30 seconds
  tipsRotationInterval = setInterval(() => {
    // Get next tip (cycle through all tips)
    currentTipIndex = (currentTipIndex + 1) % quickTips.length;
    
    // Fade out
    tipTextEl.style.opacity = '0';
    
    setTimeout(() => {
      // Change text
      tipTextEl.textContent = quickTips[currentTipIndex];
      // Fade in
      tipTextEl.style.opacity = '1';
    }, 300);
  }, 30000); // 30 seconds
}

function stopTipsRotation() {
  if (tipsRotationInterval) {
    clearInterval(tipsRotationInterval);
    tipsRotationInterval = null;
  }
}

// Disable tiles completely - HARD LOCK
function disableTiles() {
  inputLocked = true;
  
  // Add disabled class for visual feedback
  Object.values(tiles).forEach(tile => {
    if (tile) {
      tile.disabled = true;
      tile.classList.add('disabled');
      tile.style.pointerEvents = 'none';
    }
  });
  
  console.log('🔒 TILES LOCKED - Input disabled');
}


// Enable tiles - UNLOCK
function enableTiles() {
  inputLocked = false;
  
  console.log('🔓 enableTiles() called - UNLOCKING TILES');
  console.log('   Tiles object:', tiles);
  
  // Remove disabled class
  Object.values(tiles).forEach((tile, index) => {
    if (tile) {
      console.log(`   Tile ${index}:`, {
        id: tile.id,
        disabled: tile.disabled,
        classList: tile.classList.toString(),
        pointerEvents: tile.style.pointerEvents
      });
      
      tile.disabled = false;
      tile.classList.remove('disabled');
      tile.style.pointerEvents = 'auto';
      
      console.log(`   After enable:`, {
        disabled: tile.disabled,
        classList: tile.classList.toString(),
        pointerEvents: tile.style.pointerEvents
      });
    } else {
      console.log(`   Tile ${index}: NULL`);
    }
  });
  
  console.log('🔓 TILES UNLOCKED - Input enabled');
}

// Clear ALL timers to prevent overlap
function clearAllRoundTimers() {
  if (getReadyInterval) {
    clearInterval(getReadyInterval);
    getReadyInterval = null;
  }
  if (mainTimerInterval) {
    clearInterval(mainTimerInterval);
    mainTimerInterval = null;
  }
  console.log('All round timers cleared');
}

// Enter GET_READY phase (PHASE 1)
function enterGetReadyPhase(roundData) {
  console.log(`PHASE 1: GET_READY for round ${roundData.round}`);
  console.log('⏰ Get ready to watch the sequence!');
  
  // Clear any existing timers
  clearAllRoundTimers();
  
  // Set phase to GET_READY
  currentPhase = PHASE_GET_READY;
  round = roundData.round;
  
  // HARD LOCK tiles
  disableTiles();
  
  // Update UI
  updateGamePhase(`Round ${roundData.round}: Watch Closely`, '👀');
  
  // Update powerup buttons
  updatePowerUpButtons();
  
  // Show "Ready?" prompt with 5-second countdown
  getReadyCountdown = 5;
  countdownEl.textContent = `Get ready: ${getReadyCountdown}`;
  inputTimerEl.textContent = ''; // Clear main timer display
  
  getReadyInterval = setInterval(() => {
    getReadyCountdown--;
    if (getReadyCountdown > 0) {
      countdownEl.textContent = `Get ready: ${getReadyCountdown}`;
    } else {
      countdownEl.textContent = '';
      clearInterval(getReadyInterval);
      getReadyInterval = null;
      
      // CRITICAL FIX: Add 100ms delay before signaling ready
      // This prevents race conditions with power-up activations
      setTimeout(() => {
        console.log('GET_READY timeout - signaling ready for sequence');
        emitSafe("playerReadyForSequence");
      }, 100);
    }
  }, 1000);
}

// Enter SEQUENCE phase (PHASE 2) - dedicated phase for sequence playback
function enterSequencePhase(phaseData) {
  console.log(`PHASE 2: SEQUENCE for round ${phaseData.round}`);
  console.log('Sequence data:', phaseData);
  
  // Clear any existing timers
  clearAllRoundTimers();
  
  // Set phase to SEQUENCE
  currentPhase = PHASE_SEQUENCE;
  sequence = phaseData.sequence;
  round = phaseData.round;
  
  // HARD LOCK tiles during sequence
  disableTiles();
  
  // Update UI
  updateGamePhase(`Round ${round}: Watch Closely`, '👀');
  
  // CRITICAL FIX: Add client-side timeout fallback
  const sequenceDelay = 600; // Normal speed only
  const expectedDuration = (phaseData.sequence.length * sequenceDelay) + 2000;
  const maxWaitTime = Math.max(expectedDuration, 15000) + 5000; // +5s grace period
  
  console.log(`📺 Expected sequence duration: ~${expectedDuration/1000}s, max wait: ${maxWaitTime/1000}s`);
  
  const fallbackTimeout = setTimeout(() => {
    if (currentPhase === PHASE_SEQUENCE) {
      console.error('⚠️ CLIENT TIMEOUT: Never received enterPlayPhase - forcing PLAY phase locally');
      // Force transition to PLAY phase locally as fallback
      enterPlayPhase({ round: round, roundDuration: 30000 });
    }
  }, maxWaitTime);
  
  // Store timeout for cleanup
  window.sequenceFallbackTimeout = fallbackTimeout;
  
  // Play sequence and notify server when complete
  playSequenceForPhase(phaseData.sequence)
    .then(() => {
      console.log('✅ Sequence playback complete - notifying server via sequenceWatched');
      emitSafe("sequenceWatched");
      updateGamePhase(`Round ${round}: Waiting for players...`, '⏳');
    })
    .catch(err => {
      console.error('❌ Sequence playback error:', err);
      // CRITICAL: Still signal completion even on error to prevent game freeze
      console.log('⚠️ Signaling sequenceWatched despite error to prevent game freeze');
      emitSafe("sequenceWatched");
      updateGamePhase(`Round ${round}: Waiting for players...`, '⏳');
    });
}

// Play sequence during SEQUENCE phase - returns Promise
async function playSequenceForPhase(seq) {
  // Cancel old playback
  currentPlaybackId++;
  isSequencePlaying = true;
  const localPlaybackId = currentPlaybackId;
  
  const delay = 600; // Normal speed only
  console.log(`🎬 Playing sequence in SEQUENCE phase, ID: ${localPlaybackId}, delay: ${delay}ms`);
  
  // CRITICAL: Ensure tiles are HARD LOCKED
  disableTiles();
  
  try { if (audioEnabled) fx.roundStart.play(); } catch(e){}
  
  for (const color of seq) {
    if (localPlaybackId !== currentPlaybackId) {
      console.log(`Playback ${localPlaybackId} cancelled`);
      // CRITICAL FIX: Don't return early - let promise resolve
      break; // Exit loop but continue to end of function
    }
    
    lightUp(color, delay * 0.7);
    await sleep(delay);
  }
  
  console.log(`✅ Sequence playback complete for ID ${localPlaybackId}`);
  isSequencePlaying = false;
  
  // Promise always resolves, even if cancelled
  // Sequence complete - tiles remain LOCKED until server signals PLAY phase
}

// Enter PLAY phase (PHASE 3) - triggered by server
function enterPlayPhase(phaseData) {
  console.log(`✅ PHASE 3: PLAY for round ${round} - TILES UNLOCKING NOW`);
  
  // Clear fallback timeout
  if (window.sequenceFallbackTimeout) {
    clearTimeout(window.sequenceFallbackTimeout);
    window.sequenceFallbackTimeout = null;
    console.log('✅ Cleared sequence fallback timeout');
  }
  
  // Clear any existing timers
  clearAllRoundTimers();
  
  // Set phase to PLAY
  currentPhase = PHASE_PLAY;
  
  // Update UI
  updateGamePhase(`Round ${round}: Your Turn!`, '🎯');
  countdownEl.textContent = ''; // Clear get ready countdown
  
  // UNLOCK tiles - input now allowed
  enableTiles();
  setInputState("playing");
  playerSequence = [];
  startTime = Date.now();
  
  // Update powerup buttons (freeze and second chance now enabled)
  updatePowerUpButtons();
  
  // Main timer is managed by server via timerUpdate events
  console.log('✅ PLAY phase active - tiles UNLOCKED, input enabled');
  console.log(`🔓 State check: inputLocked=${inputLocked}, currentPhase=${currentPhase}, inputState=${inputState}`);
}

// Enter ROUND_END phase (PHASE 4)
function enterRoundEndPhase() {
  console.log(`PHASE 4: ROUND_END`);
  
  // Clear all timers
  clearAllRoundTimers();
  
  // Set phase to ROUND_END
  currentPhase = PHASE_ROUND_END;
  
  // HARD LOCK tiles
  disableTiles();
  setInputState("idle");
  
  // Disable powerups
  updatePowerUpButtons();
  
  console.log('ROUND_END phase - tiles LOCKED, waiting for server');
}

// Game phase management
function updateGamePhase(phase, icon = '🎮') {
  if (phaseIcon) phaseIcon.textContent = icon;
  if (phaseText) phaseText.textContent = phase;
  
  // Add phase change animation
  if (gamePhaseBanner) {
    gamePhaseBanner.style.transform = 'scale(0.95)';
    gamePhaseBanner.style.opacity = '0.7';
    setTimeout(() => {
      gamePhaseBanner.style.transform = 'scale(1)';
      gamePhaseBanner.style.opacity = '1';
    }, 150);
  }
}

// Enhanced How To toggle - now launches tutorial
howToBtn.addEventListener("click", () => {
  // Launch interactive tutorial instead of expanding text
  startTutorial();
});

// Lobby section toggle
lobbyToggle.addEventListener("click", () => {
  const isExpanded = lobbyToggle.getAttribute("aria-expanded") === "true";
  
  if (isExpanded) {
    lobbyPlayers.style.maxHeight = "0";
    lobbyPlayers.style.opacity = "0";
    lobbyToggle.setAttribute("aria-expanded", "false");
  } else {
    lobbyPlayers.style.maxHeight = "400px";
    lobbyPlayers.style.opacity = "1";
    lobbyToggle.setAttribute("aria-expanded", "true");
  }
});

// Enhanced name input validation
nameInput.addEventListener("blur", () => {
  if (nameInput.value.trim() === "") {
    nameInput.style.borderColor = "rgba(231, 76, 60, 0.6)";
    nameInput.style.boxShadow = "0 0 0 3px rgba(231, 76, 60, 0.1)";
  } else {
    nameInput.style.borderColor = "rgba(255, 255, 255, 0.1)";
    nameInput.style.boxShadow = "none";
  }
});

nameInput.addEventListener("focus", () => {
  nameInput.style.borderColor = "var(--accent)";
  nameInput.style.boxShadow = "0 0 0 3px rgba(100, 255, 218, 0.1)";
});

// Add stagger animation to buttons
document.addEventListener("DOMContentLoaded", () => {
  const buttons = document.querySelectorAll(".primary-actions button, .secondary-actions button");
  buttons.forEach((button, index) => {
    button.style.animationDelay = `${800 + (index * 100)}ms`;
  });
});
const exitBtn = document.getElementById("exitButton");
const gameContainer = document.getElementById("gameContainer");
const introScreen = document.getElementById("introScreen");
