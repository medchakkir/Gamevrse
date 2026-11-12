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

// Room system elements
const joinRoomModal = document.getElementById("joinRoomModal");
const joinModalClose = document.getElementById("joinModalClose");
const roomCodeInput = document.getElementById("roomCodeInput");
const joinRoomError = document.getElementById("joinRoomError");
const joinRoomCancel = document.getElementById("joinRoomCancel");
const joinRoomConfirm = document.getElementById("joinRoomConfirm");

const roomLobbyScreen = document.getElementById("roomLobbyScreen");
const displayRoomCode = document.getElementById("displayRoomCode");
const copyRoomCode = document.getElementById("copyRoomCode");
const leaveRoomBtn = document.getElementById("leaveRoomBtn");
const startGameBtn = document.getElementById("startGameBtn");
const cancelStartBtn = document.getElementById("cancelStartBtn");
const waitingForHost = document.getElementById("waitingForHost");
const roomPlayersList = document.getElementById("roomPlayersList");
const playerCount = document.getElementById("playerCount");
const gameCountdownBanner = document.getElementById("gameCountdownBanner");
const countdownTime = document.getElementById("countdownTime");

// Kick player modal elements (legacy - now using global modal)
const kickPlayerModal = document.getElementById("kickPlayerModal");

// Kicked player modal elements
const kickedModal = document.getElementById("kickedModal");
const kickedCountdown = document.getElementById("kickedCountdown");

let countdownInterval = null;

const scoreboardEl = document.getElementById("scoreboard");
const winnerNameEl = document.getElementById("winnerName");
const finalScoresEl = document.getElementById("finalScores");
const tieBanner = document.getElementById("tieBreakerBanner");
const readyArea = document.getElementById("readyArea");
const readyBtn = document.getElementById("readyBtn");
const autoReadyTimerEl = document.getElementById("autoReadyTimer");
const playAgainBtn = document.getElementById("playAgainBtn");
const practiceBtn = document.getElementById("practiceBtn");
const practiceRetryBtn = document.getElementById("practiceRetryBtn");

// Victory screen elements
const victoryScreen = document.getElementById("victoryScreen");
const victoryWinnerName = document.getElementById("victoryWinnerName");
const matchStatsGrid = document.getElementById("matchStatsGrid");
const playerRankings = document.getElementById("playerRankings");
const victoryCountdown = document.getElementById("victoryCountdown");
const victoryProgressBar = document.getElementById("victoryProgressBar");
const returnNowBtn = document.getElementById("returnNowBtn");

// Power-up elements
const powerUpsPanel = document.getElementById("powerUpsPanel");
const shieldBtn = document.getElementById("shieldBtn");
const timeFreezeBtn = document.getElementById("timeFreezeBtn");
const patternPeekBtn = document.getElementById("patternPeekBtn");

// Power-up state (NEW SECOND CHANCE SYSTEM)
let powerUpState = {
  secondChance: { available: true, active: false, used: false },
  freeze: { available: true, used: false, active: false },
  peek: { available: true, used: false }
};

// Power-up effects state
let timeFreezeActive = false;

// Game statistics tracking
let gameStats = {
  totalRounds: 0,
  fastestTime: Infinity,
  totalPlayers: 0,
  eliminations: 0,
  playerStats: {},
  startTime: null,
  endTime: null
};

const tiles = {
  red: document.getElementById("red"),
  green: document.getElementById("green"),
  blue: document.getElementById("blue"),
  yellow: document.getElementById("yellow")
};

let myName = "Player";
let currentRoomId = null;
let isHost = false;
let roomPowerUpsEnabled = true; // Track if power-ups are enabled in room settings
let sequence = [];
let playerSequence = [];
let waitingForInput = false;
let round = 0;
// Server-authoritative timer variables
let serverRemainingTime = 0;
let serverFreezeActive = false;
let timerDisplay = null;

// Practice mode timer variables
let practiceRoundEndTimestamp = null;
let practiceFreezeActive = false;
let practiceFreezeRemaining = 0;
let practiceTimerInterval = null;
let practiceRoundTimeout = null;
let startTime = 0;
let audioEnabled = true;
let audioUnlocked = false;
let isLocal = false;         // local practice mode flag
let localRound = 0;
let localTimer = null;
let readyTimeout = null;
let readyCountdown = 8;

// STEP 1: Global Playback Lock System
let isSequencePlaying = false;
let currentPlaybackId = 0;
const allAudio = [];

// preloaded simon sounds
const sounds = {
  red: new Audio("https://s3.amazonaws.com/freecodecamp/simonSound1.mp3"),
  green: new Audio("https://s3.amazonaws.com/freecodecamp/simonSound2.mp3"),
  blue: new Audio("https://s3.amazonaws.com/freecodecamp/simonSound3.mp3"),
  yellow: new Audio("https://s3.amazonaws.com/freecodecamp/simonSound4.mp3")
};
Object.values(sounds).forEach(s => { s.preload = 'auto'; allAudio.push(s); });

// fx helper
function createAudio(src, vol=1) {
  const a = new Audio(src);
  a.preload = 'auto';
  a.volume = Math.max(0, Math.min(1, vol));
  allAudio.push(a);
  return a;
}
const fx = {
  enter: createAudio('https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg', 0.7),
  roundStart: createAudio('https://actions.google.com/sounds/v1/alarms/beep_short.ogg', 0.6),
  success: createAudio('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg', 0.8),
  fail: createAudio('https://actions.google.com/sounds/v1/cartoon/boing.ogg', 0.8),
  win: createAudio('https://actions.google.com/sounds/v1/cartoon/party_horn.ogg', 0.9),
  streak: createAudio('https://actions.google.com/sounds/v1/cartoon/slide_whistle_to_drum_hit.ogg', 0.7),
  tie: createAudio('https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg', 0.6),
  victory: createAudio('https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg', 0.9)
};

function setAudioEnabled(flag, persist = true) {
  audioEnabled = !!flag;
  allAudio.forEach(a => { try { a.muted = !audioEnabled; } catch(e){} });
  audioToggle.textContent = audioEnabled ? '🔊' : '🔈';
  audioToggle.setAttribute('aria-pressed', audioEnabled ? 'true' : 'false');
  audioToggle.title = audioEnabled ? 'Audio enabled' : 'Audio muted';
  if (persist) {
    try { localStorage.setItem('colorRush_audio', audioEnabled ? '1' : '0'); } catch(e){}
  }
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  const probe = allAudio[0];
  if (!probe) return;
  try {
    const p = probe.play();
    if (p && p.then) {
      p.then(()=>{ probe.pause(); probe.currentTime = 0; }).catch(()=>{});
    }
  } catch(e){}
}

// load saved audio preference
try {
  const val = localStorage.getItem('colorRush_audio');
  if (val !== null) setAudioEnabled(val === '1', false);
  else setAudioEnabled(true, false);
} catch(e) {
  setAudioEnabled(true, false);
}

// Small utility for sleep
function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

// UI helpers
function showTemporaryMessage(el, text, className, duration=3000) {
  if(!el) return;
  el.className = className;
  el.textContent = text;
  if (duration > 0) setTimeout(()=>{ el.textContent=''; el.className=''; }, duration);
}
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"'`]/g, (m) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#96;'
  })[m]);
}

// Light tile programmatically
function lightUp(color, duration = 400) {
  const btn = tiles[color];
  if(!btn) return;
  
  // STEP 4: Prevent Animation Stacking
  // Remove active class first to prevent stacking
  btn.classList.remove("active");
  
  // Force reflow to ensure class removal takes effect
  btn.offsetHeight;
  
  // Add active class for new animation
  btn.classList.add("active");
  
  try { if (audioEnabled && sounds[color]) { sounds[color].currentTime = 0; sounds[color].play(); } } catch(e){}
  setTimeout(()=> btn.classList.remove("active"), duration);
}

// Sequence playback (client/local)
async function playSequence(seq) {
  // STEP 2: Modify playSequence Logic - Exit if already playing
  if (isSequencePlaying) {
    console.log('playSequence blocked - already playing');
    return;
  }
  
  // Set playback lock and increment ID
  isSequencePlaying = true;
  currentPlaybackId++;
  const localPlaybackId = currentPlaybackId;
  
  console.log(`Starting playSequence with ID: ${localPlaybackId}`);
  
  try {
    waitingForInput = false;
    disableTiles();
    
    updateGamePhase(`Round ${round}: Get Ready`, '⏱️');
    await showCountdown(5);
    
    // Check if this playback was cancelled
    if (localPlaybackId !== currentPlaybackId) {
      console.log(`Playback ${localPlaybackId} cancelled during countdown`);
      return;
    }

    updateGamePhase(`Round ${round}: Watch Closely`, '👀');
    inputTimerEl.textContent = "";

    try { if (audioEnabled) fx.roundStart.play(); } catch(e){}

    // Normal speed only
    let delay = 600;
    
    console.log('Playback speed:', { delay, round, playbackId: localPlaybackId });
    
    for (const color of seq) {
      // Check before every tile animation if this playback was cancelled
      if (localPlaybackId !== currentPlaybackId) {
        console.log(`Playback ${localPlaybackId} cancelled during sequence`);
        return;
      }
      
      lightUp(color, delay * 0.7);
      await sleep(delay);
    }
    
    // Final check before enabling input
    if (localPlaybackId !== currentPlaybackId) {
      console.log(`Playback ${localPlaybackId} cancelled before input enable`);
      return;
    }

    // PART 3: Auto-reset powerups at end of round (practice mode)
    if (isLocal && practiceRoom) {
      const practicePlayer = practiceRoom.players['practice-player'];
      if (practicePlayer) {
        cleanupRoundPowerups(practicePlayer, round);
        
        // Update UI for any reset powerups
        if (timeFreezeBtn) {
          timeFreezeBtn.classList.remove('active');
          timeFreezeBtn.style.boxShadow = '';
        }
        updatePowerUpButtons();
      }
    }

    updateGamePhase(`Round ${round}: Your Turn!`, '🎯');
    setInputState("playing"); // Use new state machine
    playerSequence = [];
    startTime = Date.now();
    
    // Start practice timer for local mode
    if (isLocal && practiceRoom) {
      startPracticeTimer();
    }
    // For multiplayer, timer is server-controlled via timerUpdate events
    
    // Update power-up buttons for input phase
    updatePowerUpButtons();
    
    console.log(`Playback ${localPlaybackId} completed successfully`);
    
  } catch (error) {
    console.error(`Playback ${localPlaybackId} error:`, error);
  } finally {
    // Always reset the lock, but only if this is still the current playback
    if (localPlaybackId === currentPlaybackId) {
      isSequencePlaying = false;
      console.log(`Playback lock released by ${localPlaybackId}`);
    }
  }
}

async function showCountdown(seconds) {
  countdownEl.textContent = `Get ready: ${seconds}`;
  for (let i = seconds - 1; i >= 0; i--) {
    await sleep(1000);
    countdownEl.textContent = i > 0 ? `Get ready: ${i}` : '';
  }
}

// Timer for player's input with time freeze support
// Server-authoritative timer display (replaces old startRoundTimer)
function updateTimerDisplay(remainingMs, freezeActive = false) {
  if (!inputTimerEl) return;
  
  const seconds = Math.ceil(remainingMs / 1000);
  const freezeIcon = freezeActive ? '❄️ ' : '';
  
  if (remainingMs > 0) {
    inputTimerEl.textContent = `${freezeIcon}🕒 Time left: ${seconds}s`;
    inputTimerEl.style.color = seconds <= 5 ? 'var(--danger-red)' : '';
  } else {
    inputTimerEl.textContent = freezeActive ? `${freezeIcon}🕒 Time frozen` : '🕒 Time up!';
  }
}

function clearTimerDisplay() {
  if (inputTimerEl) {
    inputTimerEl.textContent = "";
    inputTimerEl.style.color = '';
  }
}

// Practice mode timer functions (mirror server logic)
function startPracticeTimer() {
  clearPracticeTimer();
  
  practiceRoundEndTimestamp = Date.now() + 30000; // 30 seconds
  practiceFreezeActive = false;
  practiceFreezeRemaining = 0;
  
  // Start timer update interval
  practiceTimerInterval = setInterval(() => {
    updatePracticeTimer();
  }, 100);
  
  // Set timeout for round end
  practiceRoundTimeout = setTimeout(() => {
    handlePracticeTimeout();
  }, 30000);
  
  console.log('Practice timer started for 30000ms');
}

function updatePracticeTimer() {
  if (!practiceRoundEndTimestamp) return;
  
  let remainingTime;
  if (practiceFreezeActive) {
    remainingTime = practiceFreezeRemaining;
  } else {
    remainingTime = Math.max(0, practiceRoundEndTimestamp - Date.now());
  }
  
  updateTimerDisplay(remainingTime, practiceFreezeActive);
  
  if (!practiceFreezeActive && remainingTime <= 0) {
    clearPracticeTimer();
    handlePracticeTimeout();
  }
}

function clearPracticeTimer() {
  if (practiceTimerInterval) {
    clearInterval(practiceTimerInterval);
    practiceTimerInterval = null;
  }
  if (practiceRoundTimeout) {
    clearTimeout(practiceRoundTimeout);
    practiceRoundTimeout = null;
  }
}

function handlePracticeTimeout() {
  if (practiceFreezeActive) return;
  
  console.log('Practice round timed out');
  
  // End practice game due to timeout
  if (practiceRoom) {
    endPracticeGame(practiceRoom, 'practice-player');
  }
}

function activatePracticeFreeze(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.alive) return false;
  
  // Validation
  if (!player.powerups.freeze.available) return false;
  if (player.powerups.freeze.roundUsed === room.round) return false;
  if (practiceFreezeActive) return false;
  
  // Calculate current remaining time
  const currentRemaining = Math.max(0, practiceRoundEndTimestamp - Date.now());
  if (currentRemaining <= 0) return false;
  
  // Store remaining time and activate freeze
  practiceFreezeRemaining = currentRemaining;
  practiceFreezeActive = true;
  
  // Clear existing timeout
  if (practiceRoundTimeout) {
    clearTimeout(practiceRoundTimeout);
    practiceRoundTimeout = null;
  }
  
  // Mark powerup as used
  player.powerups.freeze.used = true;
  player.powerups.freeze.active = true;
  player.powerups.freeze.roundUsed = room.round;
  
  const freezeDuration = 3000;
  
  // Show freeze notification
  const message = document.createElement('div');
  message.className = 'power-up-notification';
  message.textContent = `❄️ Timer Frozen! ${Math.ceil(freezeDuration/1000)} seconds remaining.`;
  document.body.appendChild(message);
  
  setTimeout(() => {
    if (message.parentNode) {
      message.parentNode.removeChild(message);
    }
  }, 3000);
  
  // Set timeout to resume timer
  setTimeout(() => {
    resumePracticeTimer();
  }, freezeDuration);
  
  console.log(`Practice freeze activated for ${freezeDuration}ms, ${practiceFreezeRemaining}ms remaining`);
  return true;
}

function resumePracticeTimer() {
  if (!practiceFreezeActive) return;
  
  // Calculate new round end timestamp
  practiceRoundEndTimestamp = Date.now() + practiceFreezeRemaining;
  practiceFreezeActive = false;
  
  // Restart timeout with remaining time
  practiceRoundTimeout = setTimeout(() => {
    handlePracticeTimeout();
  }, practiceFreezeRemaining);
  
  // Show resume notification
  const message = document.createElement('div');
  message.className = 'power-up-notification';
  message.textContent = '⏰ Timer Resumed!';
  document.body.appendChild(message);
  
  setTimeout(() => {
    if (message.parentNode) {
      message.parentNode.removeChild(message);
    }
  }, 2000);
  
  console.log(`Practice timer resumed with ${practiceFreezeRemaining}ms remaining`);
}

// Pause and resume timer functions for freeze
// These functions are no longer needed - timer is server-controlled
// Keeping stubs for compatibility
function pauseInputTimer() {
  // Timer control is now server-authoritative
  console.log('Input timer paused (server-controlled)');
}

function resumeInputTimer() {
  // Timer control is now server-authoritative
  console.log('Input timer resumed (server-controlled)');
}

function markFreezeButtonUsed() {
  powerUpState.freeze.used = true;
  updatePowerUpButtons();
}

// Safe emit wrapper (no-op if socket missing)
function emitSafe(ev, payload) {
  if (isLocal) {
    // local mode: no socket emits
    console.log("local-mode emit skipped:", ev, payload);
    return;
  }
  if (socket && socket.connected) {
    console.log(`📤 Emitting: ${ev}`, payload || '(no payload)');
    try { socket.emit(ev, payload); } catch(e) { console.warn("emit failed", e); }
  } else {
    console.warn("⚠️ socket not available, would have emitted:", ev, payload);
  }
}

// Input state management (clean state machine)
let inputState = "idle"; // "idle", "playing", "waitingServer", "failed", "complete"

// Set input state with proper transitions
function setInputState(newState) {
  console.log(`Input state: ${inputState} → ${newState}`);
  inputState = newState;
  
  switch (newState) {
    case "playing":
      waitingForInput = true;
      enableTiles();
      break;
    case "waitingServer":
      waitingForInput = false;
      // Don't disable tiles yet - wait for server response
      break;
    case "failed":
    case "complete":
      waitingForInput = false;
      disableTiles();
      break;
    case "idle":
      waitingForInput = false;
      disableTiles();
      break;
  }
}

// Tile activation with STRICT INPUT LOCKING
function activateTile(color) {
  console.log(`🎯 activateTile(${color}) called`);
  console.log(`   inputLocked: ${inputLocked}`);
  console.log(`   currentPhase: ${currentPhase}`);
  console.log(`   inputState: ${inputState}`);
  console.log(`   isLocal: ${isLocal}`);
  
  // ⛔ HARD BLOCK #1: Check input lock FIRST
  if (inputLocked) {
    console.log(`🔒 Tile click REJECTED - input locked`);
    return;
  }
  
  // ⛔ HARD BLOCK #2: Check phase - ONLY allow in PLAY phase (skip for practice mode)
  if (!isLocal && currentPhase !== PHASE_PLAY) {
    console.log(`🔒 Tile click REJECTED - wrong phase: ${currentPhase}`);
    return;
  }
  
  // ⛔ HARD BLOCK #3: Check input state for multiplayer
  if (!isLocal && inputState !== "playing") {
    console.log(`🔒 Tile click REJECTED - wrong input state: ${inputState}`);
    return;
  }
  
  console.log(`✅ Tile click ACCEPTED - processing ${color}`);
  
  unlockAudio();
  
  playerSequence.push(color);
  lightUp(color);
  const i = playerSequence.length - 1;
  
  // Check if this tile is wrong
  if (playerSequence[i] !== sequence[i]) {
    // Set state to waiting for server response (don't show failure yet)
    setInputState("waitingServer");
    disableTiles(); // Lock immediately after wrong tile
    
    // Submit to server and let SERVER decide what happens
    if (isLocal) {
      // Practice mode - process locally using shared logic
      const result = processWrongTile(practiceRoom, 'practice-player', playerSequence, Number.MAX_SAFE_INTEGER);
      handleWrongTileResult(result);
    } else {
      // Multiplayer mode - let server decide
      emitSafe("submitSequence", { inputSequence: playerSequence, timeTaken: Number.MAX_SAFE_INTEGER });
    }
    return;
  }
  
  // Correct tile - check if sequence is complete
  if (playerSequence.length === sequence.length) {
    setInputState("complete");
    disableTiles(); // Lock immediately after completion
    clearTimerDisplay();
    const timeTaken = Date.now() - startTime;
    updateGamePhase("Correct! Well Done", '✅');
    
    // Track player performance
    if (!isLocal && socket && socket.id) {
      const playerName = myName || 'Unknown';
      trackPlayerTime(socket.id, playerName, timeTaken);
    }
    
    try { if (audioEnabled) fx.success.play(); } catch(e){}
    if (isLocal) {
      processSubmission(practiceRoom, 'practice-player', playerSequence, timeTaken);
    } else {
      emitSafe("submitSequence", { inputSequence: playerSequence, timeTaken });
    }
  }
}

// Handle wrong tile result (for practice mode)
function handleWrongTileResult(result) {
  switch (result) {
    case 'secondChanceTriggered':
      // Second Chance triggered - replay the same sequence
      setInputState("idle");
      updateGamePhase(`🔁 SECOND CHANCE! Replaying sequence...`, '🔁');
      
      const secondChanceEffect = document.createElement('div');
      secondChanceEffect.className = 'power-up-notification';
      secondChanceEffect.textContent = '🔁 SECOND CHANCE ACTIVATED! Watch the sequence again!';
      document.body.appendChild(secondChanceEffect);
      
      setTimeout(() => {
        if (secondChanceEffect.parentNode) {
          secondChanceEffect.parentNode.removeChild(secondChanceEffect);
        }
      }, 3000);
      
      updatePowerUpButtons();
      
      // Reset player sequence and replay
      playerSequence = [];
      setTimeout(() => {
        playSequence(sequence);
      }, 1000);
      break;
      
    case 'lifeLost':
      // Life lost - show failure state
      setInputState("failed");
      clearTimerDisplay();
      updateGamePhase("Wrong Answer!", '❌');
      try { if (audioEnabled) fx.fail.play(); } catch(e){}
      
      // For practice mode, end the game
      if (practiceRoom) {
        endPracticeGame(practiceRoom, 'practice-player');
      }
      break;
      
    case 'eliminated':
      // Eliminated - show elimination state
      setInputState("failed");
      clearTimerDisplay();
      updateGamePhase("You Were Eliminated", '💀');
      try { if (audioEnabled) fx.fail.play(); } catch(e){}
      
      if (practiceRoom) {
        endPracticeGame(practiceRoom, 'practice-player');
      }
      break;
  }
}

// Tile click handlers
Object.keys(tiles).forEach(color => {
  const el = tiles[color];
  if (!el) return;
  el.addEventListener("click", () => {
    console.log(`🖱️ Tile ${color} clicked`);
    activateTile(color);
  });
  // keyboard activation on focused element
  el.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      console.log(`⌨️ Tile ${color} keyboard activated`);
      activateTile(color);
    }
  });
});

// Global keyboard shortcuts: 1-4 map to colors; arrow keys move focus
const colorOrder = ["red","green","blue","yellow"];
document.addEventListener("keydown", (e) => {
  // ignore typing in inputs
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;

  if (e.key >= '1' && e.key <= '4') {
    const idx = Number(e.key) - 1;
    const color = colorOrder[idx];
    if (color) {
      const btn = tiles[color];
      if (btn) { btn.focus(); activateTile(color); }
    }
  } else if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "ArrowDown") {
    // move focus among tile buttons in reading order
    const focusable = colorOrder.map(c => tiles[c]).filter(Boolean);
    const idx = focusable.indexOf(document.activeElement);
    let next = 0;
    if (idx === -1) next = 0;
    else {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % focusable.length;
      else next = (idx - 1 + focusable.length) % focusable.length;
    }
    focusable[next].focus();
  } else if (e.key.toLowerCase() === 'm') { // quick mute toggle (m)
    setAudioEnabled(!audioEnabled);
  }
});

// UI wiring (intro + lobby)
// Removed duplicate howToBtn listener - tutorial launcher is at line 313

// Room system handlers
createRoomBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) { 
    showError("Name Required", "Please enter your name before continuing.");
    return; 
  }
  myName = name;
  unlockAudio();
  try { if (audioEnabled) fx.enter.play(); } catch(e){}
  
  // Show create room settings modal instead of creating immediately
  showCreateRoomModal();
});

// Create Room Modal handlers
function showCreateRoomModal() {
  const createRoomModal = document.getElementById("createRoomModal");
  createRoomModal.style.display = "flex";
  createRoomModal.setAttribute("aria-hidden", "false");
  
  // Reset to defaults
  document.getElementById("maxPlayersSelect").value = "6";
  document.getElementById("maxRoundsSelect").value = "15";
  document.getElementById("powerUpsToggle").checked = true;
}

function hideCreateRoomModal() {
  const createRoomModal = document.getElementById("createRoomModal");
  createRoomModal.style.display = "none";
  createRoomModal.setAttribute("aria-hidden", "true");
}

// Create Room Modal event listeners
document.getElementById("createModalClose").addEventListener("click", hideCreateRoomModal);
document.getElementById("createRoomCancel").addEventListener("click", hideCreateRoomModal);

document.getElementById("createRoomConfirm").addEventListener("click", () => {
  const maxPlayers = parseInt(document.getElementById("maxPlayersSelect").value);
  const maxRounds = parseInt(document.getElementById("maxRoundsSelect").value);
  const powerUpsEnabled = document.getElementById("powerUpsToggle").checked;
  
  // Create room with selected settings
  emitSafe("createRoom", { 
    name: myName,
    options: {
      maxPlayers,
      maxRounds,
      powerUpsEnabled
    }
  });
  
  hideCreateRoomModal();
});

// Close modal when clicking backdrop
document.getElementById("createRoomModal").addEventListener("click", (e) => {
  if (e.target.id === "createRoomModal" || e.target.classList.contains('modal-backdrop')) {
    hideCreateRoomModal();
  }
});

joinRoomBtn.addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) { 
    showError("Name Required", "Please enter your name before continuing.");
    return; 
  }
  myName = name;
  showJoinRoomModal();
});

// Join Room Modal handlers
function showJoinRoomModal() {
  joinRoomModal.style.display = "flex";
  joinRoomModal.setAttribute("aria-hidden", "false");
  roomCodeInput.value = "";
  roomCodeInput.focus();
  hideJoinRoomError();
}

function hideJoinRoomModal() {
  joinRoomModal.style.display = "none";
  joinRoomModal.setAttribute("aria-hidden", "true");
  // Reset button state
  joinRoomConfirm.disabled = false;
  joinRoomConfirm.textContent = "Join Room";
}

function showJoinRoomError(message) {
  joinRoomError.textContent = message;
  joinRoomError.style.display = "block";
}

function hideJoinRoomError() {
  joinRoomError.style.display = "none";
}

joinModalClose.addEventListener("click", hideJoinRoomModal);
joinRoomCancel.addEventListener("click", hideJoinRoomModal);

// Close modal when clicking backdrop
joinRoomModal.addEventListener("click", (e) => {
  if (e.target === joinRoomModal || e.target.classList.contains('modal-backdrop')) {
    hideJoinRoomModal();
  }
});

// Escape key to close modal
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (joinRoomModal.style.display === "flex") {
      hideJoinRoomModal();
    }
    const createRoomModal = document.getElementById("createRoomModal");
    if (createRoomModal && createRoomModal.style.display === "flex") {
      hideCreateRoomModal();
    }
    // Kick modal is now handled by global modal system
  }
});

joinRoomConfirm.addEventListener("click", () => {
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (roomCode.length !== 6) {
    showError("Invalid Room Code", "Please enter a valid 6-character room code.");
    return;
  }
  
  // Show loading state
  joinRoomConfirm.disabled = true;
  joinRoomConfirm.textContent = "Joining...";
  
  unlockAudio();
  try { if (audioEnabled) fx.enter.play(); } catch(e){}
  
  emitSafe("joinRoom", { roomId: roomCode, name: myName });
  
  // Reset button state after timeout
  setTimeout(() => {
    joinRoomConfirm.disabled = false;
    joinRoomConfirm.textContent = "Join Room";
  }, 3000);
});

// Room code input formatting
roomCodeInput.addEventListener("input", (e) => {
  let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (value.length > 6) value = value.substring(0, 6);
  e.target.value = value;
  hideJoinRoomError();
});

// Enter key in room code input
roomCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    joinRoomConfirm.click();
  }
});

// Room Lobby handlers
function showRoomLobby(roomId, roomData = null) {
  currentRoomId = roomId;
  displayRoomCode.textContent = roomId;
  
  // Hide intro and show room lobby
  introScreen.style.display = "none";
  roomLobbyScreen.style.display = "flex";
  roomLobbyScreen.setAttribute("aria-hidden", "false");
  
  hideJoinRoomModal();
  
  // Start tips rotation
  startTipsRotation();
  
  // If we have room data, immediately update the UI
  if (roomData) {
    updateRoomPlayersList(roomData.players, roomData.hostId, roomData.maxPlayers);
    
    // Update host status first
    isHost = roomData.isHost;
    
    // Ensure clean countdown state - only show if valid and active
    const cleanCountdownEndsAt = roomData.startCountdownEndsAt && roomData.startCountdownEndsAt > Date.now() 
      ? roomData.startCountdownEndsAt 
      : null;
    
    console.log('showRoomLobby:', { isHost, phase: roomData.phase, countdownEndsAt: cleanCountdownEndsAt });
    
    updateLobbyControls(isHost, roomData.phase, cleanCountdownEndsAt);
  } else {
    // No room data provided - ensure clean idle state
    resetClientLobbyState();
    
    // Force idle state UI
    const cancelStartBtn = document.getElementById('cancelStartBtn');
    const startGameBtn = document.getElementById('startGameBtn');
    const gameCountdownBanner = document.getElementById('gameCountdownBanner');
    
    if (gameCountdownBanner) gameCountdownBanner.style.display = 'none';
    
    if (isHost) {
      if (cancelStartBtn) cancelStartBtn.style.display = 'none';
      if (startGameBtn) startGameBtn.style.display = 'flex';
    }
  }
}

function hideRoomLobby() {
  roomLobbyScreen.style.display = "none";
  roomLobbyScreen.setAttribute("aria-hidden", "true");
  introScreen.style.display = "flex";
  currentRoomId = null;
  isHost = false;
  
  // Stop tips rotation
  stopTipsRotation();
  
  // Clean up countdown display
  stopCountdownDisplay();
  
  // Hide any open modals
  hideKickPlayerModal();
}

copyRoomCode.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentRoomId);
    
    // Success animation
    const originalContent = copyRoomCode.innerHTML;
    copyRoomCode.innerHTML = '<span class="copy-icon">✓</span><span class="copy-text">Copied!</span>';
    copyRoomCode.style.background = 'rgba(0, 230, 118, 0.2)';
    copyRoomCode.style.borderColor = 'rgba(0, 230, 118, 0.4)';
    copyRoomCode.style.color = 'var(--primary-green)';
    
    setTimeout(() => {
      copyRoomCode.innerHTML = originalContent;
      copyRoomCode.style.background = '';
      copyRoomCode.style.borderColor = '';
      copyRoomCode.style.color = '';
    }, 2000);
  } catch (err) {
    // Fallback for older browsers
    const textArea = document.createElement("textarea");
    textArea.value = currentRoomId;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    
    // Success animation
    const originalContent = copyRoomCode.innerHTML;
    copyRoomCode.innerHTML = '<span class="copy-icon">✓</span><span class="copy-text">Copied!</span>';
    copyRoomCode.style.background = 'rgba(0, 230, 118, 0.2)';
    copyRoomCode.style.borderColor = 'rgba(0, 230, 118, 0.4)';
    copyRoomCode.style.color = 'var(--primary-green)';
    
    setTimeout(() => {
      copyRoomCode.innerHTML = originalContent;
      copyRoomCode.style.background = '';
      copyRoomCode.style.borderColor = '';
      copyRoomCode.style.color = '';
    }, 2000);
  }
});

leaveRoomBtn.addEventListener("click", () => {
  emitSafe("leaveRoom");
  hideRoomLobby();
});

startGameBtn.addEventListener("click", () => {
  emitSafe("startGame");
});

cancelStartBtn.addEventListener("click", () => {
  emitSafe("cancelGameStart");
});

// Practice button wiring
if (practiceBtn) {
  practiceBtn.addEventListener("click", () => {
    // Set practice flag and show the game UI, but DO NOT start the round
    const name = (nameInput && nameInput.value && nameInput.value.trim()) ? nameInput.value.trim() : 'Solo';
    isLocal = true;
    myName = name;
    // unlock audio on first interaction
    unlockAudio();
    try { if (audioEnabled) fx.enter.play(); } catch(e){}

    // Hide intro and show game UI
    introScreen.classList.add("fade-out");
    introScreen.addEventListener("transitionend", () => {
      introScreen.classList.remove("intro-visible");
      introScreen.classList.add("intro-hidden");
      gameContainer.style.display = "block";
      gameContainer.setAttribute("aria-hidden", "false");
      // Show Start button so player must press Start Game to begin practice
      startBtn.style.display = "inline-block";
      updateGamePhase(`Practice Mode: ${myName} — Press Start to Begin`, '🎮');
      // Ensure Try Again hidden (fresh start)
      showPracticeControls(false);
      // HIDE players UI in local practice mode
      try { if (playersEl) playersEl.style.display = 'none'; } catch(e){}
      try { if (lobbyPlayersEl) lobbyPlayersEl.style.display = 'none'; } catch(e){}
    }, { once: true });
  });
}

// startBtn behavior: behave differently for local vs multiplayer
startBtn.addEventListener("click", () => {
  // local practice
  if (isLocal) {
    startBtn.style.display = "none"; // hide button once started
    localRound = 0;
    // Ensure players UI hidden while practice running
    try { if (playersEl) playersEl.style.display = 'none'; } catch(e){}
    try { if (lobbyPlayersEl) lobbyPlayersEl.style.display = 'none'; } catch(e){}
    localStartRound();
    return;
  }

  // This is now handled by startGameBtn in room lobby
  // Legacy support for old system
  emitSafe("startGame");
  startBtn.style.display = "none";
  updateGamePhase("Starting Game...", '🚀');
});

audioToggle.addEventListener("click", () => {
  setAudioEnabled(!audioEnabled);
});
setAudioEnabled(audioEnabled, false);

// Ready button logic (DEPRECATED - kept for backward compatibility but does nothing)
// The new 4-phase system handles readiness automatically
readyBtn.addEventListener("click", () => {
  // Hide ready area
  readyArea.style.display = 'none';
  stopReadyCountdown();
  
  // Add confirmation animation
  readyBtn.classList.add('confirmed');
  readyBtn.innerHTML = '<span class="ready-icon">✓</span><span class="ready-text">Ready!</span>';
  
  // NO-OP: playerReady is deprecated, new system uses GET_READY phase
  // emitSafe("playerReady", {});
});

// Enhanced ready countdown with visual ring
function startReadyCountdown(seconds = 8) {
  readyArea.style.display = 'flex';
  readyCountdown = seconds;
  autoReadyTimerEl.textContent = readyCountdown;
  
  // Add countdown ring animation
  const countdownRing = document.getElementById('readyCountdownRing');
  if (countdownRing) {
    countdownRing.classList.add('active');
    countdownRing.style.animationDuration = `${seconds}s`;
  }
  
  stopReadyCountdown();
  readyTimeout = setInterval(() => {
    readyCountdown--;
    autoReadyTimerEl.textContent = readyCountdown;
    if (readyCountdown <= 0) {
      // auto-ready
      stopReadyCountdown();
      readyArea.style.display = 'none';
      
      // Add ready confirmation animation
      const readyBtn = document.getElementById('readyBtn');
      if (readyBtn) {
        readyBtn.classList.add('confirmed');
        readyBtn.innerHTML = '<span class="ready-icon">✓</span><span class="ready-text">Ready!</span>';
      }
      
      // NO-OP: playerReady is deprecated, new system uses GET_READY phase
      // emitSafe("playerReady", {});
    }
  }, 1000);
}

function stopReadyCountdown() {
  if (readyTimeout) { clearInterval(readyTimeout); readyTimeout = null; }
  autoReadyTimerEl.textContent = '0';
  
  // Remove countdown ring animation
  const countdownRing = document.getElementById('readyCountdownRing');
  if (countdownRing) {
    countdownRing.classList.remove('active');
  }
}

// Exit back to lobby (used for both practice & multiplayer)
exitBtn.addEventListener("click", goToMenu);
// Unified Practice Mode Exit Function - Complete Lifecycle Cleanup
function exitPracticeToIntro() {
  console.log('Executing complete practice mode exit cleanup');
  
  // 1. Stop all timers and intervals
  clearPracticeTimer();
  clearTimerDisplay();
  clearTimeout(readyTimeout);
  if (localTimer) {
    clearTimeout(localTimer);
    localTimer = null;
  }
  
  // Cancel any ongoing playback
  currentPlaybackId++;
  isSequencePlaying = false;
  
  // 2. Reset all game variables
  isLocal = false;
  localRound = 0;
  round = 0;
  sequence = [];
  playerSequence = [];
  waitingForInput = false;
  startTime = 0;
  practiceRoom = null;
  
  // 3. Reset powerups completely
  resetPowerUps();
  
  // 4. Reset input and UI state
  setInputState("idle");
  disableTiles();
  
  // 5. Hide all game UI elements
  gameContainer.style.display = "none";
  if (victoryScreen) victoryScreen.style.display = "none";
  try { tieBanner.style.display = 'none'; } catch (e) {}
  try { readyArea.style.display = 'none'; } catch (e) {}
  exitBtn.style.display = "none";
  practiceRetryBtn.style.display = "none";
  
  // 6. Clear all banners and messages
  document.getElementById("gameOverMessages").innerHTML = "";
  if (scoreboardEl) scoreboardEl.style.display = "none";
  inputTimerEl.textContent = "";
  countdownEl.textContent = "";
  
  // 7. Remove active classes and animation states
  document.body.classList.remove("game-active", "game-ended");
  
  // 8. Show intro screen with proper transition
  introScreen.style.display = "flex";
  introScreen.classList.remove("intro-hidden", "fade-out");
  introScreen.classList.add("intro-visible");
  
  // 9. Reset intro UI state
  if (nameInput) nameInput.value = "";
  
  // 10. Reset internal flags
  serverRemainingTime = 0;
  serverFreezeActive = false;
  practiceFreezeActive = false;
  practiceFreezeRemaining = 0;
  
  // 11. Restore players UI visibility
  try { if (playersEl) playersEl.style.display = ''; } catch(e){}
  try { if (lobbyPlayersEl) lobbyPlayersEl.style.display = ''; } catch(e){}
  
  // 12. Update phase
  updateGamePhase("Welcome to Color Rush", '🎮');
  
  console.log('Practice mode exit cleanup completed - returned to intro');
}

function goToMenu() {
  // For practice mode, use the single exit authority
  if (isLocal) {
    finishPracticeAndReturn();
    return;
  }
  
  // Reset sudden death flag
  isSuddenDeath = false;
  
  // Multiplayer mode - return to room lobby or main menu
  // hide tie banner and ready area too
  try { tieBanner.style.display = 'none'; } catch (e) {}
  try { readyArea.style.display = 'none'; } catch (e) {}
  
  // Hide victory screen if showing
  if (victoryScreen) victoryScreen.style.display = 'none';
  
  if (currentRoomId) {
    // Return to room lobby
    gameContainer.style.display = "none";
    showRoomLobby(currentRoomId);
  } else {
    // Return to main menu
    gameContainer.style.display = "none";
    introScreen.style.display = "flex";
  }
  
  exitBtn.style.display = "none";
  practiceRetryBtn.style.display = "none";
  document.getElementById("gameOverMessages").innerHTML = "";
  if (scoreboardEl) scoreboardEl.style.display = "none";
  
  // reset local state
  sequence = [];
  playerSequence = [];
  waitingForInput = false;
  // restore players UI when leaving practice
  try { if (playersEl) playersEl.style.display = ''; } catch(e){}
  try { if (lobbyPlayersEl) lobbyPlayersEl.style.display = ''; } catch(e){}
  clearTimerDisplay();
  countdownEl.textContent = "";
  
  if (currentRoomId) {
    updateGamePhase("Back in Room Lobby", '🏠');
  } else {
    updateGamePhase("Back in Main Menu", '🏠');
  }
}

// Victory screen functions
function showVictoryScreen(gameOverData) {
  const { winner, winnerName, scoreboard, gameStats: serverStats, isDraw } = gameOverData;
  
  // Hide game container and show victory screen
  gameContainer.style.display = "none";
  victoryScreen.style.display = "flex";
  victoryScreen.setAttribute("aria-hidden", "false");
  
  // Get UI elements
  const victoryTitle = document.getElementById('victoryTitle');
  const victorySubtitle = document.getElementById('victorySubtitle');
  
  // Update winner information
  if (victoryWinnerName) {
    if (isDraw) {
      // Show DRAW screen
      if (victoryTitle) victoryTitle.textContent = "DRAW";
      victoryWinnerName.textContent = "";
      if (victorySubtitle) victorySubtitle.textContent = "ALL PLAYERS ELIMINATED";
    } else {
      // Show VICTORY screen
      if (victoryTitle) victoryTitle.textContent = "VICTORY!";
      victoryWinnerName.textContent = winnerName || "Champion";
      if (victorySubtitle) victorySubtitle.textContent = "Congratulations!";
    }
  }
  
  // Update match statistics
  updateMatchStats(serverStats || gameStats);
  
  // Update player rankings
  updatePlayerRankings(scoreboard || []);
  
  // Start return countdown
  startVictoryCountdown();
  
  // Play victory sound and effects
  if (isDraw) {
    // Different sound/effect for draw (optional)
    try { 
      if (audioEnabled) fx.fail.play(); // Use fail sound for draw
    } catch(e){}
  } else {
    try { 
      if (audioEnabled) fx.victory.play(); 
    } catch(e){}
    
    // Confetti for winner only (not for draw)
    if (socket && socket.id === winner) {
      triggerVictoryEffects();
    }
  }
}

function updateMatchStats(stats) {
  // Update individual stat values
  const statElements = {
    statTotalRounds: stats.totalRounds || gameStats.totalRounds || 0,
    statFastestTime: formatTime(stats.fastestTime || gameStats.fastestTime),
    statTotalPlayers: stats.totalPlayers || gameStats.totalPlayers || 0,
    statEliminations: stats.eliminations || gameStats.eliminations || 0
  };
  
  Object.entries(statElements).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) {
      element.textContent = value;
    }
  });
}

function updatePlayerRankings(scoreboard) {
  if (!playerRankings) return;
  
  playerRankings.innerHTML = '';
  
  scoreboard.forEach((player, index) => {
    const rankingItem = document.createElement('div');
    rankingItem.className = `ranking-item ${index === 0 ? 'winner' : ''}`;
    
    // Use server-provided stats from scoreboard, not local gameStats
    const avgTime = player.avgTime || 0;
    const roundsPlayed = player.roundsPlayed || 0;
    
    rankingItem.innerHTML = `
      <div class="ranking-position">${index + 1}</div>
      <div class="ranking-info">
        <div class="ranking-name">${escapeHtml(player.name)}</div>
        <div class="ranking-stats">
          <div class="ranking-stat">
            <span class="ranking-stat-value">${player.score || 0}</span>
            <span class="ranking-stat-label">Score</span>
          </div>
          <div class="ranking-stat">
            <span class="ranking-stat-value">${formatTime(avgTime)}</span>
            <span class="ranking-stat-label">Avg Time</span>
          </div>
          <div class="ranking-stat">
            <span class="ranking-stat-value">${roundsPlayed}</span>
            <span class="ranking-stat-label">Rounds</span>
          </div>
        </div>
      </div>
    `;
    
    playerRankings.appendChild(rankingItem);
  });
}

function startVictoryCountdown() {
  let countdown = 10;
  let countdownInterval;
  
  if (victoryCountdown) victoryCountdown.textContent = countdown;
  if (victoryProgressBar) victoryProgressBar.style.width = '100%';
  
  countdownInterval = setInterval(() => {
    countdown--;
    if (victoryCountdown) victoryCountdown.textContent = countdown;
    if (victoryProgressBar) {
      victoryProgressBar.style.width = `${(countdown / 10) * 100}%`;
    }
    
    if (countdown <= 0) {
      clearInterval(countdownInterval);
      hideVictoryScreen();
    }
  }, 1000);
  
  // Store interval for cleanup
  victoryScreen.countdownInterval = countdownInterval;
}

// Practice mode exit guard
let practiceHasExited = false;

function hideVictoryScreen() {
  if (victoryScreen.countdownInterval) {
    clearInterval(victoryScreen.countdownInterval);
    victoryScreen.countdownInterval = null;
  }
  
  victoryScreen.style.display = "none";
  victoryScreen.setAttribute("aria-hidden", "true");
  
  // Handle practice mode vs multiplayer differently
  if (isLocal) {
    // Practice mode - use complete cleanup
    finishPracticeAndReturn();
  } else {
    // Multiplayer mode - return to appropriate screen
    if (currentRoomId) {
      // Force clean lobby state when returning
      resetClientLobbyState();
      showRoomLobby(currentRoomId);
    } else {
      introScreen.style.display = "flex";
      introScreen.setAttribute("aria-hidden", "false");
    }
  }
  
  // Reset game stats
  resetGameStats();
}

// Single authoritative practice exit function
function finishPracticeAndReturn() {
  // Guard against duplicate calls
  if (practiceHasExited) {
    console.log('Practice already exited, skipping duplicate call');
    return;
  }
  
  practiceHasExited = true;
  console.log('Finishing practice and returning to intro');
  
  // Clear countdown interval if still running
  if (victoryScreen.countdownInterval) {
    clearInterval(victoryScreen.countdownInterval);
    victoryScreen.countdownInterval = null;
  }
  
  // Complete practice cleanup
  exitPracticeToIntro();
  
  // Reset exit guard after cleanup
  setTimeout(() => {
    practiceHasExited = false;
  }, 500);
}

// Reset client-side lobby state
function resetClientLobbyState() {
  // Stop any running countdown displays
  stopCountdownDisplay();
  
  // Hide countdown elements
  const gameCountdownBanner = document.getElementById('gameCountdownBanner');
  if (gameCountdownBanner) {
    gameCountdownBanner.style.display = 'none';
  }
  
  // Reset countdown time display
  if (countdownTime) {
    countdownTime.textContent = '30';
  }
  
  // Clear any intervals
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  
  // Force correct button state for host (INDEPENDENT OF READY STATES)
  const cancelStartBtn = document.getElementById('cancelStartBtn');
  const startGameBtn = document.getElementById('startGameBtn');
  const hostControls = document.getElementById('hostControls');
  const waitingForHost = document.getElementById('waitingForHost');
  
  if (isHost) {
    if (hostControls) hostControls.style.display = 'flex';
    if (cancelStartBtn) cancelStartBtn.style.display = 'none';
    if (startGameBtn) startGameBtn.style.display = 'flex';
    if (waitingForHost) waitingForHost.style.display = 'none';
  } else {
    if (hostControls) hostControls.style.display = 'none';
    if (waitingForHost) waitingForHost.style.display = 'flex';
  }
  
  // Force UI refresh to idle state
  if (currentRoomId) {
    updateLobbyControls(isHost, 'lobby', null);
  }
  
  console.log('Client lobby state reset - countdown cleared, UI refreshed to idle state, host button forced visible');
}

function triggerVictoryEffects() {
  // Confetti animation
  const duration = 3000;
  const end = Date.now() + duration;
  
  (function frame() {
    confetti({
      particleCount: 8,
      spread: 360,
      origin: { x: Math.random(), y: Math.random() - 0.2 },
      colors: ["#FFD700", "#FFA500", "#FFFFFF", "#64FFDA"]
    });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

function formatTime(ms) {
  if (ms === Infinity || ms === 0 || !ms) return "N/A";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function resetGameStats() {
  gameStats = {
    totalRounds: 0,
    fastestTime: Infinity,
    totalPlayers: 0,
    eliminations: 0,
    playerStats: {},
    startTime: null,
    endTime: null
  };
}

// Track game statistics
function trackRoundStart(roundNumber) {
  gameStats.totalRounds = Math.max(gameStats.totalRounds, roundNumber);
  if (!gameStats.startTime) {
    gameStats.startTime = Date.now();
  }
}

function trackPlayerTime(playerId, playerName, timeTaken) {
  if (!gameStats.playerStats[playerName]) {
    gameStats.playerStats[playerName] = {
      totalTime: 0,
      roundsPlayed: 0,
      avgTime: 0,
      fastestTime: Infinity
    };
  }
  
  const playerStat = gameStats.playerStats[playerName];
  playerStat.totalTime += timeTaken;
  playerStat.roundsPlayed++;
  playerStat.avgTime = playerStat.totalTime / playerStat.roundsPlayed;
  playerStat.fastestTime = Math.min(playerStat.fastestTime, timeTaken);
  
  // Update global fastest time
  gameStats.fastestTime = Math.min(gameStats.fastestTime, timeTaken);
}

function trackElimination() {
  gameStats.eliminations++;
}

// Return now button handler
if (returnNowBtn) {
  returnNowBtn.addEventListener("click", () => {
    if (isLocal) {
      // Practice mode - use single exit authority
      finishPracticeAndReturn();
    } else {
      // Multiplayer mode - use original logic
      hideVictoryScreen();
    }
  });
}

// Power-up button handlers (unified for multiplayer and practice)
if (shieldBtn) {
  shieldBtn.addEventListener("click", () => {
    console.log('Second Chance button clicked');
    
    if (isLocal && practiceRoom) {
      // Practice mode - NO phase check, just validate powerup state
      const player = practiceRoom.players['practice-player'];
      if (player && player.powerups.secondChance.available && 
          !player.powerups.secondChance.used && !player.powerups.secondChance.active) {
        activateSecondChance(practiceRoom, 'practice-player');
      }
    } else if (!isLocal) {
      // Multiplayer mode - PHASE CHECK required
      if (currentPhase !== PHASE_PLAY) {
        console.log('Second Chance rejected - wrong phase:', currentPhase);
        return;
      }
      
      if (inputState === "playing" && powerUpState.secondChance.available && 
          !powerUpState.secondChance.used && !powerUpState.secondChance.active) {
        console.log('Emitting activateSecondChance');
        emitSafe("activateSecondChance");
      }
    }
  });
}

if (timeFreezeBtn) {
  timeFreezeBtn.addEventListener("click", () => {
    console.log('Freeze button clicked');
    
    if (isLocal && practiceRoom) {
      // Practice mode - NO phase check
      activateFreeze(practiceRoom, 'practice-player');
    } else if (!isLocal) {
      // Multiplayer mode - PHASE CHECK required
      if (currentPhase !== PHASE_PLAY) {
        console.log('Freeze rejected - wrong phase:', currentPhase);
        return;
      }
      
      if (inputState === "playing" && powerUpState.freeze.available && !powerUpState.freeze.used) {
        console.log('Emitting activateFreeze');
        emitSafe("activateFreeze");
      }
    }
  });
}

if (patternPeekBtn) {
  patternPeekBtn.addEventListener("click", () => {
    console.log('Pattern Peek button clicked');
    console.log('isLocal:', isLocal);
    console.log('practiceRoom:', practiceRoom);
    console.log('currentPhase:', currentPhase);
    console.log('PHASE_PLAY:', PHASE_PLAY);
    console.log('playerSequence:', playerSequence);
    
    if (isLocal && practiceRoom) {
      // Practice mode - activate Pattern Peek
      console.log('Activating Pattern Peek in practice mode');
      activatePatternPeek(practiceRoom, 'practice-player');
    } else if (!isLocal) {
      // Multiplayer mode - PHASE CHECK required (only in PLAY)
      if (currentPhase !== PHASE_PLAY) {
        console.log('Pattern Peek rejected - wrong phase:', currentPhase);
        return;
      }
      
      console.log('Emitting activatePatternPeek with current input length:', playerSequence.length);
      // Send current input sequence length so server knows which tile to reveal
      emitSafe("activatePatternPeek", { currentInputLength: playerSequence.length });
    }
  });
}

// Update power-up button states (UPDATED FOR SECOND CHANCE SYSTEM)
function updatePowerUpButtons() {
  if (!powerUpsPanel) return;
  
  // Hide power-ups panel if disabled in room settings (multiplayer only)
  if (!isLocal && !roomPowerUpsEnabled) {
    powerUpsPanel.style.display = 'none';
    return;
  }
  
  // Always show power-ups panel for both multiplayer and practice (when enabled)
  powerUpsPanel.style.display = 'block';
  
  // Get power-up state from appropriate source
  let powerUps;
  if (isLocal && practiceRoom) {
    // Practice mode - get from practice room player
    powerUps = practiceRoom.players['practice-player']?.powerups || {
      secondChance: { available: true, active: false, used: false },
      freeze: { available: true, used: false, active: false },
      patternPeek: { available: true, used: false }
    };
  } else {
    // Multiplayer mode - use global powerUpState with new structure
    powerUps = {
      secondChance: powerUpState.secondChance,
      freeze: powerUpState.freeze,
      patternPeek: powerUpState.peek
    };
  }
  
  // PHASE-BASED POWERUP AVAILABILITY (only for multiplayer)
  const inPlayPhase = currentPhase === PHASE_PLAY;
  const inGetReadyPhase = currentPhase === PHASE_GET_READY;
  
  // Update Second Chance button
  if (shieldBtn) {
    let canUseSecondChance;
    if (isLocal) {
      // Practice mode - no phase restriction
      canUseSecondChance = powerUps.secondChance.available && 
                          !powerUps.secondChance.used &&
                          !powerUps.secondChance.active &&
                          inputState === "playing";
    } else {
      // Multiplayer mode - phase restriction
      canUseSecondChance = powerUps.secondChance.available && 
                          !powerUps.secondChance.used &&
                          !powerUps.secondChance.active &&
                          inPlayPhase &&
                          inputState === "playing";
    }
    
    shieldBtn.disabled = !canUseSecondChance;
    shieldBtn.className = `power-up-btn second-chance-btn ${powerUps.secondChance.used ? 'used' : ''}`;
    if (powerUps.secondChance.active) {
      shieldBtn.classList.add('active', 'armed');
    }
    
    // Update button text/icon for Second Chance
    const buttonText = shieldBtn.querySelector('.power-up-text');
    if (buttonText) {
      buttonText.textContent = powerUps.secondChance.active ? 'ARMED' : 'SECOND CHANCE';
    }
  }
  
  // Update time freeze button
  if (timeFreezeBtn) {
    let canUseFreeze;
    if (isLocal) {
      // Practice mode - no phase restriction
      canUseFreeze = powerUps.freeze.available && 
                    !powerUps.freeze.used &&
                    inputState === "playing";
    } else {
      // Multiplayer mode - phase restriction
      canUseFreeze = powerUps.freeze.available && 
                    !powerUps.freeze.used &&
                    inPlayPhase &&
                    inputState === "playing";
    }
    
    timeFreezeBtn.disabled = !canUseFreeze;
    timeFreezeBtn.className = `power-up-btn freeze-btn ${powerUps.freeze.used ? 'used' : ''}`;
    if (powerUps.freeze.active) {
      timeFreezeBtn.classList.add('active');
    }
  }
  
  // Update Pattern Peek button
  if (patternPeekBtn) {
    console.log('Updating Pattern Peek button state:', {
      powerUps: powerUps.patternPeek,
      isLocal,
      inPlayPhase,
      inputState,
      currentPhase
    });
    
    let canUsePeek;
    if (isLocal) {
      // Practice mode - only during play phase
      canUsePeek = powerUps.patternPeek.available && 
                  !powerUps.patternPeek.used &&
                  inputState === "playing";
    } else {
      // Multiplayer mode - only in PLAY phase
      canUsePeek = powerUps.patternPeek.available && 
                  !powerUps.patternPeek.used &&
                  inPlayPhase &&
                  inputState === "playing";
    }
    
    console.log('Pattern Peek canUsePeek:', canUsePeek);
    
    patternPeekBtn.disabled = !canUsePeek;
    patternPeekBtn.className = `power-up-btn peek-btn ${powerUps.patternPeek.used ? 'used' : ''}`;
  }
}

// Reset power-ups for new match
function resetPowerUps() {
  powerUpState = {
    secondChance: { available: true, active: false, used: false },
    freeze: { available: true, used: false, active: false },
    peek: { available: true, used: false }
  };
  
  timeFreezeActive = false;
  
  updatePowerUpButtons();
}

// Practice controls visibility helper
function showPracticeControls(show) {
  if (!practiceRetryBtn) return;
  practiceRetryBtn.style.display = show ? 'inline-flex' : 'none';
  // keep main exit visible so users can still go out
  exitBtn.style.display = show ? 'inline-flex' : exitBtn.style.display;
}

// Practice Retry handler (restart local practice from round 1)
if (practiceRetryBtn) {
  practiceRetryBtn.addEventListener("click", () => {
    console.log('Practice retry clicked');
    
    // Use single exit authority first
    finishPracticeAndReturn();
    
    // Then immediately start new practice game
    setTimeout(() => {
      // Re-enter practice mode
      isLocal = true;
      gameContainer.style.display = 'block';
      introScreen.style.display = 'none';
      
      updateGamePhase(`Practice Mode: ${myName || 'Player'} — Starting...`, '🔄');
      
      // Start new practice round
      try { 
        localStartRound(); 
      } catch (e) { 
        console.error("localStartRound failed on retry", e); 
        // Fallback to intro if retry fails
        finishPracticeAndReturn();
      }
    }, 100);
  });
}

// Helper mapping colorIndex -> chip background
function chipColorForIndex(i) {
  const map = ['var(--red)', 'var(--green)', 'var(--blue)', 'var(--yellow)'];
  return map[i % map.length] || 'var(--muted)';
}

// Render a single player card
function renderPlayerCard(p, isMe=false) {
  const outer = document.createElement('div');
  outer.className = 'player-card';
  outer.setAttribute('role','listitem');

  // chip (first letter)
  const chip = document.createElement('div');
  chip.className = 'player-chip';
  chip.style.background = chipColorForIndex(p.colorIndex);
  chip.textContent = (p.name || '?').slice(0,1).toUpperCase();

  // meta
  const meta = document.createElement('div');
  meta.className = 'player-meta';

  const nameRow = document.createElement('div');
  nameRow.className = 'player-name';
  nameRow.innerHTML = escapeHtml(p.name || 'Unknown');
  // host indicator
  if (p.isHost) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = 'HOST';
    nameRow.appendChild(b);
  }
  if (isMe) {
    const meTag = document.createElement('span');
    meTag.className = 'player-sub';
    meTag.style.marginLeft = '8px';
    meTag.textContent = ' (you)';
    nameRow.appendChild(meTag);
  }

  const sub = document.createElement('div');
  sub.className = 'player-sub';
  sub.textContent = `Lives: ${typeof p.lives === 'number' ? p.lives : '—'}`;

  meta.appendChild(nameRow);
  meta.appendChild(sub);

  // right-side status dot
  const statusDot = document.createElement('div');
  statusDot.className = 'status-dot ' + (p.alive ? 'status-alive' : 'status-dead');

  outer.appendChild(chip);
  outer.appendChild(meta);
  outer.appendChild(statusDot);

  return outer;
}

// Update room players list with individual ready buttons
function updateRoomPlayersList(players, hostId, maxPlayers) {
  if (!roomPlayersList) return;
  
  roomPlayersList.innerHTML = '';
  
  const playerArray = Array.isArray(players) ? players : Object.values(players || {});
  
  // Update player count with server-provided maxPlayers
  if (playerCount && typeof maxPlayers === 'number') {
    playerCount.textContent = `(${playerArray.length}/${maxPlayers})`;
  }
  
  console.log('updateRoomPlayersList:', { playerCount: playerArray.length, hostId, players: playerArray.map(p => ({ name: p.name, isReady: p.isReady })) });
  
  playerArray.forEach(player => {
    const card = document.createElement('div');
    card.className = 'room-player-card';
    if (player.id === hostId) {
      card.classList.add('host-card');
    }
    card.setAttribute('role', 'listitem');
    
    const avatar = document.createElement('div');
    avatar.className = 'room-player-avatar';
    avatar.style.background = chipColorForIndex(player.colorIndex || 0);
    avatar.textContent = (player.name || '?').charAt(0).toUpperCase();
    
    const info = document.createElement('div');
    info.className = 'room-player-info';
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'room-player-name';
    nameDiv.textContent = player.name || 'Unknown';
    
    // Add host badge using server-provided hostId
    if (player.id === hostId) {
      const hostBadge = document.createElement('span');
      hostBadge.className = 'host-badge';
      hostBadge.textContent = '⭐ HOST';
      nameDiv.appendChild(hostBadge);
    }
    
    // Add "you" indicator
    if (socket && socket.id === player.id) {
      const youSpan = document.createElement('span');
      youSpan.style.color = 'rgba(255, 255, 255, 0.5)';
      youSpan.style.fontSize = '14px';
      youSpan.style.fontWeight = '400';
      youSpan.textContent = ' (you)';
      nameDiv.appendChild(youSpan);
    }
    
    const statusDiv = document.createElement('div');
    statusDiv.className = 'room-player-status';
    // Use server-provided ready state, default to false if not provided
    const playerIsReady = player.isReady === true;
    statusDiv.textContent = playerIsReady ? 'Ready to play' : 'Not ready';
    
    info.appendChild(nameDiv);
    info.appendChild(statusDiv);
    
    // Player actions section
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'room-player-actions';
    
    // Add ready button for non-host players (only show for current player who is not host)
    if (socket && socket.id === player.id && player.id !== hostId) {
      const readyBtn = document.createElement('button');
      readyBtn.className = `ready-toggle-btn ${playerIsReady ? 'ready' : 'not-ready'}`;
      readyBtn.textContent = playerIsReady ? 'Ready' : 'Not Ready';
      readyBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        emitSafe("toggleReady");
      };
      actionsDiv.appendChild(readyBtn);
    }
    
    // Add kick button for host (only for other players, not themselves)
    if (isHost && socket && socket.id !== player.id && player.id !== hostId) {
      const kickBtn = document.createElement('button');
      kickBtn.className = 'kick-btn';
      kickBtn.textContent = '❌ Kick';
      kickBtn.title = 'Kick player';
      kickBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showKickPlayerModal(player.id, player.name);
      };
      actionsDiv.appendChild(kickBtn);
    }
    
    card.appendChild(avatar);
    card.appendChild(info);
    if (actionsDiv.children.length > 0) {
      card.appendChild(actionsDiv);
    }
    
    roomPlayersList.appendChild(card);
  });
}

// Update lobby controls with strict state-based rendering (NO READY STATE DEPENDENCY FOR HOST BUTTON)
function updateLobbyControls(isHostPlayer, phase, countdownEndsAt) {
  const hostControls = document.getElementById('hostControls');
  const startGameBtn = document.getElementById('startGameBtn');
  const cancelStartBtn = document.getElementById('cancelStartBtn');
  const waitingForHost = document.getElementById('waitingForHost');
  const gameCountdownBanner = document.getElementById('gameCountdownBanner');
  
  if (!hostControls || !startGameBtn || !cancelStartBtn || !waitingForHost || !gameCountdownBanner) return;
  
  // Determine if countdown is actually active and valid
  const isStarting = countdownEndsAt && countdownEndsAt > Date.now() && phase === 'lobby';
  
  console.log('updateLobbyControls:', { isHostPlayer, phase, countdownEndsAt, isStarting });
  
  if (phase === 'lobby') {
    if (isHostPlayer) {
      // HOST LOGIC - INDEPENDENT OF READY STATES
      hostControls.style.display = 'flex';
      waitingForHost.style.display = 'none';
      
      if (isStarting) {
        // STARTING STATE: Show countdown and cancel button
        startGameBtn.style.display = 'none';
        cancelStartBtn.style.display = 'flex';
        gameCountdownBanner.style.display = 'flex';
        startCountdownDisplay(countdownEndsAt);
      } else {
        // IDLE STATE: ALWAYS show start button for host (regardless of ready states)
        startGameBtn.style.display = 'flex';
        cancelStartBtn.style.display = 'none';
        gameCountdownBanner.style.display = 'none';
        stopCountdownDisplay();
      }
    } else {
      // NON-HOST LOGIC
      hostControls.style.display = 'none';
      
      if (isStarting) {
        // STARTING STATE: Show countdown, hide waiting message
        waitingForHost.style.display = 'none';
        gameCountdownBanner.style.display = 'flex';
        startCountdownDisplay(countdownEndsAt);
      } else {
        // IDLE STATE: Show waiting message, hide countdown
        waitingForHost.style.display = 'flex';
        gameCountdownBanner.style.display = 'none';
        stopCountdownDisplay();
      }
    }
  } else {
    // NOT IN LOBBY PHASE: Hide everything
    hostControls.style.display = 'none';
    waitingForHost.style.display = 'none';
    gameCountdownBanner.style.display = 'none';
    stopCountdownDisplay();
  }
}

// Countdown display functions
function startCountdownDisplay(endsAt) {
  // Only start if we have a valid future timestamp
  if (!endsAt || endsAt <= Date.now()) {
    stopCountdownDisplay();
    return;
  }
  
  stopCountdownDisplay();
  
  function updateCountdown() {
    const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    if (countdownTime) {
      countdownTime.textContent = remaining;
    }
    
    if (remaining <= 0) {
      stopCountdownDisplay();
    }
  }
  
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

function stopCountdownDisplay() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  
  // Reset countdown display
  if (countdownTime) {
    countdownTime.textContent = '30';
  }
}

// Kick player modal functions
async function showKickPlayerModal(playerId, playerName) {
  try {
    const confirmed = await showConfirm(
      "Kick Player",
      `Are you sure you want to remove ${playerName} from the room?`,
      "Kick Player",
      "Cancel",
      "⚠️"
    );
    
    if (confirmed) {
      emitSafe("kickPlayer", { playerId });
    }
  } catch (error) {
    console.warn("Kick confirmation cancelled");
  }
}

function hideKickPlayerModal() {
  // This function is now handled by the global modal system
  // Keeping for compatibility
}

// LOCAL MODE: simple local sequence generation & evaluation
const LOCAL_COLORS = ["red","green","blue","yellow"];
function localGenerateSequence(length) {
  const seq = [];
  for (let i=0;i<length;i++) seq.push(LOCAL_COLORS[Math.floor(Math.random()*LOCAL_COLORS.length)]);
  return seq;
}
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

// ========== TUTORIAL MODE SYSTEM (SELF-CONTAINED) ==========

// Tutorial state variables (isolated from main game)
let isTutorialMode = false;
let tutorialStep = 0;
let tutorialSequence = [];
let tutorialPlayerSequence = [];
let tutorialWaiting = false;
let tutorialTimerInterval = null;
let tutorialTimeoutId = null;

// Tutorial DOM elements
const tutorialContainer = document.getElementById('tutorialContainer');
const tutorialStepIndicator = document.getElementById('tutorialStepIndicator');
const tutorialSkipBtn = document.getElementById('tutorialSkipBtn');
const tutorialTitle = document.getElementById('tutorialTitle');
const tutorialMessage = document.getElementById('tutorialMessage');
const tutorialGameArea = document.getElementById('tutorialGameArea');
const tutorialTimer = document.getElementById('tutorialTimer');
const tutorialPowerupsArea = document.getElementById('tutorialPowerupsArea');
const tutorialActionBtn = document.getElementById('tutorialActionBtn');

// Tutorial tile elements
const tutorialTiles = {
  red: document.getElementById('tutorialRed'),
  green: document.getElementById('tutorialGreen'),
  blue: document.getElementById('tutorialBlue'),
  yellow: document.getElementById('tutorialYellow')
};

// Tutorial tile colors
const TUTORIAL_COLORS = ['red', 'green', 'blue', 'yellow'];

// Start tutorial
function startTutorial() {
  console.log('Starting tutorial mode');
  isTutorialMode = true;
  tutorialStep = 0;
  
  // Show tutorial container
  tutorialContainer.style.display = 'flex';
  tutorialContainer.setAttribute('aria-hidden', 'false');
  
  // Hide intro screen
  introScreen.style.opacity = '0';
  setTimeout(() => {
    introScreen.style.display = 'none';
  }, 300);
  
  // Start with welcome screen
  showTutorialStep1();
}

// Exit tutorial cleanly
function exitTutorial() {
  console.log('Exiting tutorial mode');
  
  // Clear all tutorial timers and intervals
  if (tutorialTimerInterval) {
    clearInterval(tutorialTimerInterval);
    tutorialTimerInterval = null;
  }
  if (tutorialTimeoutId) {
    clearTimeout(tutorialTimeoutId);
    tutorialTimeoutId = null;
  }
  
  // Reset tutorial state
  isTutorialMode = false;
  tutorialStep = 0;
  tutorialSequence = [];
  tutorialPlayerSequence = [];
  tutorialWaiting = false;
  
  // Hide tutorial container
  tutorialContainer.style.display = 'none';
  tutorialContainer.setAttribute('aria-hidden', 'true');
  
  // Show intro screen
  introScreen.style.display = 'flex';
  introScreen.style.opacity = '1';
  
  // Reset tutorial UI
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'none';
  tutorialTimer.textContent = '';
  
  console.log('Tutorial exited cleanly');
}

// Tutorial Step 1: Welcome Screen
function showTutorialStep1() {
  tutorialStep = 1;
  tutorialStepIndicator.textContent = 'Step 1/6';
  
  tutorialTitle.textContent = 'Welcome to ColorRush';
  tutorialMessage.textContent = 'Watch the tiles carefully. Repeat them in order to survive.';
  
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'none';
  
  // Restore original button structure if it was replaced
  const footer = document.querySelector('.tutorial-footer');
  if (!footer.querySelector('.tutorial-action-btn')) {
    footer.innerHTML = '<button class="tutorial-action-btn">Start Tutorial</button>';
  }
  
  const btn = footer.querySelector('.tutorial-action-btn');
  btn.textContent = 'Start Tutorial';
  btn.className = 'tutorial-action-btn';
  btn.style.display = '';
  btn.onclick = showTutorialStep2;
}

// Tutorial Step 2: Watch Sequence
function showTutorialStep2() {
  tutorialStep = 2;
  tutorialStepIndicator.textContent = 'Step 2/6';
  
  tutorialTitle.textContent = 'Watch the Sequence';
  tutorialMessage.textContent = 'Pay attention to the order of the tiles...';
  
  tutorialGameArea.style.display = 'flex';
  tutorialPowerupsArea.style.display = 'none';
  tutorialTimer.textContent = '';
  
  // Hide action button during playback
  tutorialActionBtn.style.display = 'none';
  
  // Generate fixed 3-tile sequence
  tutorialSequence = ['red', 'blue', 'green'];
  tutorialPlayerSequence = [];
  
  // Disable tiles during playback
  disableTutorialTiles();
  
  // Play sequence after short delay
  setTimeout(() => {
    playTutorialSequence();
  }, 1000);
}

// Play tutorial sequence
async function playTutorialSequence() {
  tutorialMessage.textContent = 'Watch carefully...';
  
  for (const color of tutorialSequence) {
    await tutorialLightUp(color, 800);
    await tutorialSleep(900);
  }
  
  // After playback, enable player input
  tutorialMessage.textContent = 'Now repeat the sequence!';
  enableTutorialTiles();
  tutorialWaiting = true;
}

// Tutorial Step 3: Player Input
function handleTutorialTileClick(color) {
  if (!tutorialWaiting || tutorialStep !== 2) return;
  
  tutorialPlayerSequence.push(color);
  tutorialLightUp(color, 400);
  
  const index = tutorialPlayerSequence.length - 1;
  
  // Check if correct
  if (tutorialPlayerSequence[index] !== tutorialSequence[index]) {
    // Wrong tile
    tutorialWaiting = false;
    disableTutorialTiles();
    tutorialMessage.textContent = '❌ Oops! That\'s not correct. Try again.';
    tutorialMessage.style.color = '#ff6b6b';
    
    setTimeout(() => {
      tutorialMessage.style.color = '';
      tutorialPlayerSequence = [];
      tutorialMessage.textContent = 'Watch the sequence again...';
      
      setTimeout(() => {
        playTutorialSequence();
      }, 1000);
    }, 2000);
    return;
  }
  
  // Check if sequence complete
  if (tutorialPlayerSequence.length === tutorialSequence.length) {
    tutorialWaiting = false;
    disableTutorialTiles();
    tutorialMessage.textContent = '✅ Great! You remembered it!';
    tutorialMessage.style.color = '#00e676';
    
    try { if (audioEnabled) fx.success.play(); } catch(e){}
    
    setTimeout(() => {
      tutorialMessage.style.color = '';
      showTutorialStep3();
    }, 2000);
  }
}

// Tutorial Step 3: Timer Demo
function showTutorialStep3() {
  tutorialStep = 3;
  tutorialStepIndicator.textContent = 'Step 3/6';
  
  tutorialTitle.textContent = 'Understanding the Timer';
  tutorialMessage.textContent = 'Each round has a timer. Watch what happens when it runs out...';
  
  tutorialGameArea.style.display = 'flex';
  tutorialPowerupsArea.style.display = 'none';
  
  disableTutorialTiles();
  
  tutorialActionBtn.style.display = 'none';
  
  // Start countdown demo
  setTimeout(() => {
    startTutorialTimerDemo();
  }, 1500);
}

function startTutorialTimerDemo() {
  let timeLeft = 5;
  tutorialTimer.textContent = `⏱️ ${timeLeft}s`;
  
  tutorialTimerInterval = setInterval(() => {
    timeLeft--;
    tutorialTimer.textContent = `⏱️ ${timeLeft}s`;
    
    if (timeLeft <= 2) {
      tutorialTimer.style.color = '#ff6b35';
    }
    
    if (timeLeft <= 0) {
      clearInterval(tutorialTimerInterval);
      tutorialTimerInterval = null;
      tutorialTimer.textContent = '⏱️ Time Up!';
      tutorialMessage.textContent = '⚠️ If time runs out, you lose the round!';
      tutorialMessage.style.color = '#ff6b35';
      
      try { if (audioEnabled) fx.fail.play(); } catch(e){}
      
      setTimeout(() => {
        tutorialTimer.style.color = '';
        tutorialMessage.style.color = '';
        tutorialTimer.textContent = '';
        showTutorialStep4();
      }, 2500);
    }
  }, 1000);
}

// Tutorial Step 4: Powerups Demo
function showTutorialStep4() {
  tutorialStep = 4;
  tutorialStepIndicator.textContent = 'Step 4/6';
  
  tutorialTitle.textContent = 'Power-ups';
  tutorialMessage.textContent = 'Use power-ups strategically to help you survive!';
  
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'block';
  
  tutorialActionBtn.style.display = 'inline-block';
  tutorialActionBtn.textContent = 'Continue';
  tutorialActionBtn.className = 'tutorial-action-btn';
  tutorialActionBtn.onclick = showTutorialStep5;
}

// Tutorial Step 5: Lives and Elimination
function showTutorialStep5() {
  tutorialStep = 5;
  tutorialStepIndicator.textContent = 'Step 5/6';
  
  tutorialTitle.textContent = 'Lives & Elimination';
  tutorialMessage.textContent = 'You start with 2 lives. Make a mistake and lose a life. Lose all lives and you\'re eliminated!';
  
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'none';
  
  tutorialActionBtn.style.display = 'inline-block';
  tutorialActionBtn.textContent = 'Continue';
  tutorialActionBtn.className = 'tutorial-action-btn';
  tutorialActionBtn.onclick = showTutorialStep6;
}

// Tutorial Step 6: Finish
function showTutorialStep6() {
  tutorialStep = 6;
  tutorialStepIndicator.textContent = 'Step 6/6';
  
  tutorialTitle.textContent = 'Ready to Play!';
  tutorialMessage.textContent = 'That\'s it! You\'re ready to compete. Good luck!';
  
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'none';
  
  // Show two buttons
  tutorialActionBtn.style.display = 'none';
  
  const footer = document.querySelector('.tutorial-footer');
  footer.innerHTML = `
    <button class="tutorial-action-btn secondary" onclick="exitTutorial()">Back to Menu</button>
    <button class="tutorial-action-btn" onclick="startPracticeFromTutorial()">Start Practice</button>
  `;
}

// Start practice mode from tutorial
function startPracticeFromTutorial() {
  exitTutorial();
  
  // Small delay then start practice
  setTimeout(() => {
    if (practiceBtn) {
      practiceBtn.click();
    }
  }, 300);
}

// Tutorial tile helpers
function disableTutorialTiles() {
  Object.values(tutorialTiles).forEach(tile => {
    if (tile) tile.disabled = true;
  });
}

function enableTutorialTiles() {
  Object.values(tutorialTiles).forEach(tile => {
    if (tile) tile.disabled = false;
  });
}

async function tutorialLightUp(color, duration = 400) {
  const tile = tutorialTiles[color];
  if (!tile) return;
  
  tile.classList.add('active');
  
  try { 
    if (audioEnabled && sounds[color]) { 
      sounds[color].currentTime = 0; 
      sounds[color].play(); 
    } 
  } catch(e){}
  
  await tutorialSleep(duration);
  tile.classList.remove('active');
}

function tutorialSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Attach tutorial tile click handlers
Object.keys(tutorialTiles).forEach(color => {
  const tile = tutorialTiles[color];
  if (tile) {
    tile.addEventListener('click', () => handleTutorialTileClick(color));
  }
});

// Tutorial skip button handler
if (tutorialSkipBtn) {
  tutorialSkipBtn.addEventListener('click', exitTutorial);
}

// ========== END TUTORIAL MODE SYSTEM ==========

// Socket events (only attach if socket is present)
if (socket) {
  socket.on("connect", () => {
    updateGamePhase("Connected! Create or join a room to play", '🌐');
    setAudioEnabled(audioEnabled);
  });

  // Room creation success
  socket.on("roomCreated", (data) => {
    isHost = data.isHost;
    // Capture power-ups enabled setting
    if (data.settings && data.settings.powerUpsEnabled !== undefined) {
      roomPowerUpsEnabled = data.settings.powerUpsEnabled;
    }
    showRoomLobby(data.roomId, data);
  });

  // Room join success
  socket.on("roomJoined", (data) => {
    isHost = data.isHost;
    // Capture power-ups enabled setting
    if (data.settings && data.settings.powerUpsEnabled !== undefined) {
      roomPowerUpsEnabled = data.settings.powerUpsEnabled;
    }
    showRoomLobby(data.roomId, data);
  });

  // Room join error
  socket.on("joinError", (message) => {
    showJoinRoomError(message);
  });

  // Player list updates (legacy support)
  socket.on("playerList", (players) => {
    // This event is now primarily handled by roomState
    // Keep for backward compatibility but don't use for room lobby
    if (!currentRoomId && !isLocal) {
      // Legacy lobby system (if still needed)
      playersEl.innerHTML = players.map(p => 
        `<li class="playerName${p.colorIndex}">${escapeHtml(p.name)} ${p.alive ? '' : '❌'}</li>`
      ).join("");
    }
    
    // Update power-up states from server
    const myPlayer = players.find(p => p.id === socket.id);
    if (myPlayer && myPlayer.powerUps) {
      powerUpState = { ...myPlayer.powerUps };
      updatePowerUpButtons();
    }
  });

  // Power-up event handlers
  // NEW SECOND CHANCE EVENT HANDLERS
  socket.on("secondChanceActivated", () => {
    console.log('Second Chance activated');
    powerUpState.secondChance.active = true;
    
    // Add glow effect and armed state
    if (shieldBtn) {
      shieldBtn.classList.add('active', 'armed');
      shieldBtn.style.boxShadow = '0 0 20px rgba(255, 193, 7, 0.8)';
    }
    
    updatePowerUpButtons();
    
    // Show notification
    const message = document.createElement('div');
    message.className = 'power-up-notification';
    message.textContent = '🔁 Second Chance Armed! You will get one retry if you fail (one-time use).';
    document.body.appendChild(message);
    
    setTimeout(() => {
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    }, 3000);
  });

  socket.on("secondChanceTriggered", (data) => {
    console.log('Second Chance triggered - timer PAUSED, replaying sequence');
    
    // Update Second Chance state - used permanently
    powerUpState.secondChance.active = false;
    powerUpState.secondChance.used = true;
    secondChanceReplayActive = true;
    
    if (shieldBtn) {
      shieldBtn.classList.remove('active', 'armed');
      shieldBtn.style.boxShadow = '';
    }
    
    updatePowerUpButtons();
    
    // Show Second Chance effect with timer pause info
    const secondChanceEffect = document.createElement('div');
    secondChanceEffect.className = 'power-up-notification';
    secondChanceEffect.textContent = `🔁 SECOND CHANCE! Timer paused at ${Math.ceil(data.remainingTime/1000)}s. Watch again!`;
    document.body.appendChild(secondChanceEffect);
    
    setTimeout(() => {
      if (secondChanceEffect.parentNode) {
        secondChanceEffect.parentNode.removeChild(secondChanceEffect);
      }
    }, 3000);
    
    // Reset player sequence
    playerSequence = [];
    
    // Stay in PLAY phase but LOCK tiles during replay
    disableTiles();
    setInputState("idle");
    
    // Clear timer display to show paused state
    if (inputTimerEl) {
      inputTimerEl.textContent = `⏸️ Timer Paused (${Math.ceil(data.remainingTime/1000)}s remaining)`;
      inputTimerEl.style.color = 'var(--accent)';
    }
    
    setTimeout(async () => {
      updateGamePhase(`🔁 Watch Again!`, '👀');
      
      // Play sequence with simple animation (no countdown)
      const seq = data.sequence;
      sequence = seq;
      
      try {
        if (audioEnabled) fx.roundStart.play();
      } catch(e){}
      
      const delay = 600;
      for (const color of seq) {
        lightUp(color, delay * 0.7);
        await sleep(delay);
      }
      
      // Notify server that replay is complete
      console.log('Second Chance replay complete - notifying server to resume timer');
      emitSafe("secondChanceReplayComplete");
      
      // In sudden death, enable tiles immediately (no server response needed)
      if (isSuddenDeath) {
        console.log('Sudden death mode - enabling tiles immediately after replay');
        secondChanceReplayActive = false;
        
        // UNLOCK tiles and return to PLAY state
        enableTiles();
        updateGamePhase(`Sudden Death: Your Turn!`, '⚡');
        setInputState("playing");
        playerSequence = [];
        startTime = Date.now();
        
        // Timer continues automatically via timerUpdate events
        if (inputTimerEl) {
          inputTimerEl.style.color = ''; // Reset color
        }
      }
    }, 1000);
  });
  
  // NEW: Server resumes timer after Second Chance replay
  socket.on("secondChanceTimerResume", (data) => {
    console.log(`Timer resuming from ${data.remainingTime}ms after Second Chance replay`);
    
    secondChanceReplayActive = false;
    
    // UNLOCK tiles and return to PLAY state
    enableTiles();
    updateGamePhase(`Round ${round}: Your Turn!`, '🎯');
    setInputState("playing");
    playerSequence = [];
    startTime = Date.now();
    
    // Show resume notification
    const message = document.createElement('div');
    message.className = 'power-up-notification';
    message.textContent = `⏰ Timer Resumed! ${Math.ceil(data.remainingTime/1000)}s remaining`;
    document.body.appendChild(message);
    
    setTimeout(() => {
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    }, 2000);
    
    console.log('Second Chance complete - tiles UNLOCKED, timer resumed');
  });

  socket.on("freezeActivated", () => {
    console.log('Freeze activated');
    powerUpState.freeze.used = true;
    
    // Add glow effect
    if (timeFreezeBtn) {
      timeFreezeBtn.classList.add('active');
      timeFreezeBtn.style.boxShadow = '0 0 20px rgba(33, 150, 243, 0.8)';
    }
    
    pauseInputTimer();
    setTimeout(() => {
      resumeInputTimer();
      if (timeFreezeBtn) {
        timeFreezeBtn.classList.remove('active');
        timeFreezeBtn.style.boxShadow = '';
      }
    }, 3000);
    
    markFreezeButtonUsed();
    
    // Show notification
    const message = document.createElement('div');
    message.className = 'power-up-notification';
    message.textContent = '❄️ Time Freeze Activated! Timer paused for 3 seconds.';
    document.body.appendChild(message);
    
    setTimeout(() => {
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    }, 3000);
  });

  socket.on("peekReveal", (data) => {
    console.log('Pattern Peek reveal received:', data);
    const { index, color } = data;
    
    // Mark as used
    powerUpState.peek.used = true;
    
    // Reveal the tile
    revealPeekTile(color);
    
    updatePowerUpButtons();
  });

  // Server-authoritative timer events
  socket.on("timerUpdate", (data) => {
    // Ignore timer updates if we're in ROUND_END phase (already finished)
    if (currentPhase === PHASE_ROUND_END) {
      return;
    }
    
    serverRemainingTime = data.remainingTime;
    serverFreezeActive = data.freezeActive;
    updateTimerDisplay(serverRemainingTime, serverFreezeActive);
  });

  socket.on("timerFrozen", (data) => {
    console.log(`Timer frozen for ${data.duration}ms, ${data.remainingTime}ms remaining`);
    serverRemainingTime = data.remainingTime;
    serverFreezeActive = true;
    updateTimerDisplay(serverRemainingTime, true);
    
    // Show freeze notification
    const message = document.createElement('div');
    message.className = 'power-up-notification';
    message.textContent = `❄️ Timer Frozen! ${Math.ceil(data.duration/1000)} seconds remaining.`;
    document.body.appendChild(message);
    
    setTimeout(() => {
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    }, 3000);
  });

  socket.on("timerResumed", (data) => {
    console.log(`Timer resumed with ${data.remainingTime}ms remaining`);
    serverRemainingTime = data.remainingTime;
    serverFreezeActive = false;
    updateTimerDisplay(serverRemainingTime, false);
    
    // Show resume notification
    const message = document.createElement('div');
    message.className = 'power-up-notification';
    message.textContent = '⏰ Timer Resumed!';
    document.body.appendChild(message);
    
    setTimeout(() => {
      if (message.parentNode) {
        message.parentNode.removeChild(message);
      }
    }, 2000);
  });

  // Removed old shieldAbsorbed handler - replaced with secondChanceTriggered

  socket.on("powerUpUsed", (data) => {
    console.log('Power-up used:', data);
    // Additional visual feedback for power-up usage
  });

  // Room state update with host info
  socket.on("roomState", (data) => {
    if (currentRoomId && data.roomId === currentRoomId) {
      // Update host status first
      isHost = socket.id === data.hostId;
      
      // Update power-ups enabled setting
      if (data.settings && data.settings.powerUpsEnabled !== undefined) {
        roomPowerUpsEnabled = data.settings.powerUpsEnabled;
      }
      
      // Ensure clean countdown state if explicitly null
      const cleanCountdownEndsAt = data.startCountdownEndsAt === null ? null : data.startCountdownEndsAt;
      
      console.log('roomState received:', { 
        phase: data.phase, 
        isHost, 
        countdownEndsAt: cleanCountdownEndsAt,
        isNull: cleanCountdownEndsAt === null,
        playersReady: data.players ? data.players.map(p => ({ name: p.name, isReady: p.isReady })) : []
      });
      
      // Update players list first (this will show correct ready states)
      updateRoomPlayersList(data.players || [], data.hostId, data.maxPlayers);
      
      // Then update lobby controls (host button should ALWAYS show if not starting)
      updateLobbyControls(isHost, data.phase, cleanCountdownEndsAt);
      
      // If countdown is null, ensure UI is clean
      if (cleanCountdownEndsAt === null) {
        stopCountdownDisplay();
        const gameCountdownBanner = document.getElementById('gameCountdownBanner');
        const cancelStartBtn = document.getElementById('cancelStartBtn');
        const startGameBtn = document.getElementById('startGameBtn');
        
        if (gameCountdownBanner) {
          gameCountdownBanner.style.display = 'none';
        }
        
        // Force correct button state for host (INDEPENDENT OF READY STATES)
        if (isHost && data.phase === 'lobby') {
          if (cancelStartBtn) cancelStartBtn.style.display = 'none';
          if (startGameBtn) startGameBtn.style.display = 'flex';
        }
      }
    }
  });

  // Game starting countdown
  socket.on("gameStarting", (data) => {
    if (currentRoomId) {
      updateLobbyControls(isHost, 'lobby', data.endsAt);
    }
  });

  // Game start cancelled
  socket.on("gameStartCancelled", () => {
    if (currentRoomId) {
      console.log('Game start cancelled - forcing UI reset');
      // Force clean state when countdown is cancelled
      stopCountdownDisplay();
      
      // Force correct button state immediately
      const cancelStartBtn = document.getElementById('cancelStartBtn');
      const startGameBtn = document.getElementById('startGameBtn');
      const gameCountdownBanner = document.getElementById('gameCountdownBanner');
      
      if (gameCountdownBanner) gameCountdownBanner.style.display = 'none';
      
      if (isHost) {
        if (cancelStartBtn) cancelStartBtn.style.display = 'none';
        if (startGameBtn) startGameBtn.style.display = 'flex';
      }
      
      updateLobbyControls(isHost, 'lobby', null);
    }
  });

  // Player was kicked
  socket.on("kicked", (data) => {
    kickedModal.style.display = "flex";
    kickedModal.setAttribute("aria-hidden", "false");
    
    let countdown = 3;
    kickedCountdown.textContent = countdown;
    
    const kickedInterval = setInterval(() => {
      countdown--;
      kickedCountdown.textContent = countdown;
      
      if (countdown <= 0) {
        clearInterval(kickedInterval);
        kickedModal.style.display = "none";
        hideRoomLobby();
      }
    }, 1000);
  });

  // Game start error
  socket.on("gameStartError", (message) => {
    showError("Cannot Start Game", message);
  });

  // Host status update
  socket.on("youAreHost", () => {
    isHost = true;
    if (currentRoomId) {
      updateLobbyControls(true, 'lobby');
    }
  });

  // Phase change events
  socket.on("phaseChange", (data) => {
    const { phase, roomId } = data;
    if (roomId !== currentRoomId) return;
    
    switch (phase) {
      case 'lobby':
        // Back to lobby - ensure clean state
        document.body.classList.remove("game-ended"); // Remove guard class
        
        // Hide eliminated overlay
        hideEliminatedOverlay();
        
        resetClientLobbyState();
        resetPowerUps(); // Reset power-ups when returning to lobby
        hideRoomLobby();
        showRoomLobby(roomId);
        break;
      case 'game':
        // Game starting - hide lobby, show game
        document.body.classList.remove("game-ended"); // Remove guard class
        
        // Hide eliminated overlay
        hideEliminatedOverlay();
        
        roomLobbyScreen.style.display = "none";
        gameContainer.style.display = "block";
        gameContainer.setAttribute("aria-hidden", "false");
        resetPowerUps(); // Reset power-ups when starting new game
        updatePowerUpButtons(); // Update visibility based on room settings
        break;
      case 'postgame':
        // Game ended - could show results or return to lobby
        break;
    }
  });

  socket.on("playerCount", count => {
    // if local, don't show player count in practice
    if (isLocal) return;
    if (!currentRoomId) {
      status.textContent = `Players connected: ${count}`;
    }
  });

  // prepareNextRound: show ready UI then server will wait for playerReady from everyone
  // DEPRECATED: prepareNextRound (old ready system, replaced by GET_READY phase)
  socket.on("prepareNextRound", () => {
    // NO-OP: This event is deprecated
    // The new 4-phase system (GET_READY → SEQUENCE → PLAY → ROUND_END) handles this automatically
    console.log('Received deprecated prepareNextRound event - ignoring');
  });

  // tie breaker notification
  socket.on("tieBreakerStart", (data) => {
    const names = data.names && data.names.length ? data.names : [];
    const nameText = names.length ? `${names.join(' & ')}` : 'top players';
    const bannerText = `⚡ SUDDEN DEATH ⚡ — ${nameText}! Fixed ${data.tieLength}-tile sequences until winner!`;
    if (tieBanner) { 
      tieBanner.textContent = bannerText; 
      tieBanner.style.display = 'block';
      tieBanner.style.background = 'linear-gradient(90deg, #ff6b35, #f7931e)';
      tieBanner.style.color = '#fff';
    }
    if (status && !isLocal) status.innerHTML = `<strong style="color:#ff6b35">⚡ SUDDEN DEATH — ${escapeHtml(nameText)} tied!</strong>`;
    try { if (audioEnabled) fx.tie.play(); } catch(e){}
  });

  socket.on("tieBreakerRoundStart", (data) => {
    // Guard: Don't process if game is already over
    if (document.body.classList.contains("game-ended")) {
      console.log('Ignoring tieBreakerRoundStart - game already ended');
      return;
    }
    
    // STEP 3: Cancel Old Playback When New Round Starts
    currentPlaybackId++;
    isSequencePlaying = false;
    console.log(`tieBreakerRoundStart: Cancelled old playback, new ID: ${currentPlaybackId}`);
    
    // Handle tie-breaker round like normal round but with special UI
    try { tieBanner.style.display = 'block'; } catch(e){}
    try { readyArea.style.display = 'none'; } catch(e){}
    stopReadyCountdown();
    document.body.classList.add("game-active");
    round = data.tieRound; // Use tie round number for display
    sequence = data.sequence;
    
    // CRITICAL: Set phase to PLAY so tiles can be clicked
    currentPhase = PHASE_PLAY;
    
    // Update phase to show sudden death
    updateGamePhase(`⚡ Sudden Death Round ${data.tieRound} ⚡`, '💀');
    
    enableTiles();
    try { if (audioEnabled) fx.roundStart.play(); } catch(e){}
    playSequence(sequence);
  });

  // ========== NEW SUDDEN DEATH EVENT HANDLERS ==========

  // Sudden death notification
  socket.on("suddenDeathStart", (data) => {
    const names = data.names && data.names.length ? data.names : [];
    const nameText = names.length ? `${names.join(' & ')}` : 'remaining players';
    const reason = data.reason || 'score_tie';
    
    // Show appropriate message based on reason
    let message;
    if (reason === 'all_eliminated') {
      message = `⚡ SUDDEN DEATH — All players eliminated! ${escapeHtml(nameText)} battle for victory!`;
    } else {
      message = `⚡ SUDDEN DEATH — ${escapeHtml(nameText)} tied!`;
    }
    
    // Update status text
    if (status && !isLocal) status.innerHTML = `<strong style="color:#ff6b35">${message}</strong>`;
    try { if (audioEnabled) fx.tie.play(); } catch(e){}
  });

  socket.on("suddenDeathRoundStart", (data) => {
    // Guard: Don't process if game is already over
    if (document.body.classList.contains("game-ended")) {
      console.log('Ignoring suddenDeathRoundStart - game already ended');
      return;
    }
    
    // Set sudden death flag
    isSuddenDeath = true;
    
    // Cancel old playback when new sudden death round starts
    currentPlaybackId++;
    isSequencePlaying = false;
    console.log(`suddenDeathRoundStart: Cancelled old playback, new ID: ${currentPlaybackId}`);
    
    // Hide banner and ready area for clean sudden death UI
    try { tieBanner.style.display = 'none'; } catch(e){}
    try { readyArea.style.display = 'none'; } catch(e){}
    stopReadyCountdown();
    document.body.classList.add("game-active");
    
    // Store sequence length for display
    const suddenDeathLength = data.length || 5;
    
    // PHASE 1: GET_READY - show get ready countdown
    currentPhase = PHASE_GET_READY;
    updateGamePhase(`⚡ SUDDEN DEATH — Fixed ${suddenDeathLength} tiles until winner! ⚡`, '💀');
    
    // Lock tiles during GET_READY
    disableTiles();
    
    // Show "Get ready" countdown (3 seconds to match server)
    getReadyCountdown = 3;
    countdownEl.textContent = `Get ready: ${getReadyCountdown}`;
    inputTimerEl.textContent = ''; // Clear main timer display
    
    getReadyInterval = setInterval(() => {
      getReadyCountdown--;
      if (getReadyCountdown > 0) {
        countdownEl.textContent = `Get ready: ${getReadyCountdown}`;
      } else {
        countdownEl.textContent = '';
        clearInterval(getReadyInterval);
      }
    }, 1000);
    
    try { if (audioEnabled) fx.roundStart.play(); } catch(e){}
    
    console.log('[Sudden Death] GET_READY phase - waiting for server to send sequence');
  });

  // ========== END NEW SUDDEN DEATH HANDLERS ==========

  // PHASE 1: GET_READY phase start
  socket.on("roundStart", data => {
    // Track current round
    currentRound = data.round || 0;
    
    // Cancel old playback
    currentPlaybackId++;
    isSequencePlaying = false;
    console.log(`roundStart: Round ${currentRound} PHASE 1 GET_READY, cancelled old playback, new ID: ${currentPlaybackId}`);
    
    // Reset input state for new round
    setInputState("idle");
    
    // Reset Second Chance round state (but NOT the used flag)
    powerUpState.secondChance.active = false;
    
    // Hide any tie banner/ready area
    try { tieBanner.style.display = 'none'; } catch(e){}
    try { readyArea.style.display = 'none'; } catch(e){}
    stopReadyCountdown();
    document.body.classList.add("game-active");
    round = data.round;
    
    // Track round start
    trackRoundStart(round);
    
    // Update power-up buttons for new round
    updatePowerUpButtons();
    
    // Enter GET_READY phase (PHASE 1)
    enterGetReadyPhase(data);
  });
  
  // PHASE 2: SEQUENCE phase start
  socket.on("enterSequencePhase", (data) => {
    console.log('Server signaled SEQUENCE phase');
    enterSequencePhase(data);
  });
  
  // PHASE 3: PLAY phase start
  socket.on("enterPlayPhase", (data) => {
    console.log('🎮 Server signaled PLAY phase - calling enterPlayPhase()');
    console.log('Play phase data:', data);
    enterPlayPhase(data);
  });
  
  // PHASE 4: ROUND_END phase start
  socket.on("enterRoundEndPhase", (data) => {
    console.log('Server signaled ROUND_END phase');
    enterRoundEndPhase();
  });

  socket.on("eliminated", (data) => {
    console.log('[Client] Player eliminated', data);
    
    // Check if this is 1v1 endgame (server will handle game end)
    if (data && data.is1v1Endgame) {
      console.log('[Client] 1v1 endgame - waiting for game over');
      updateGamePhase("You Were Eliminated", '💀');
      clearTimerDisplay();
      try { if (audioEnabled) fx.fail.play(); } catch(e){}
      return;
    }
    
    // Use round from server data, fallback to currentRound
    const eliminationRound = data.round || currentRound || 1;
    
    // Show eliminated overlay with elimination round
    showEliminatedOverlay("Game in progress...", eliminationRound);
    
    console.log('[Client] Eliminated - isPlayerEliminated now:', isPlayerEliminated);
    console.log('[Client] Waiting for matchStatusUpdate events...');
    updateGamePhase("You Were Eliminated", '💀');
    clearTimerDisplay();
    try { if (audioEnabled) fx.fail.play(); } catch(e){}
  });

  socket.on("correct", (data) => {
    // Enter ROUND_END phase
    enterRoundEndPhase();
    updateGamePhase("Waiting for Others...", '⏳');
    clearTimerDisplay();
    if (data.streak >= 3) {
      document.getElementById("streakMessages").innerHTML = `🔥 You're on a <b>${data.streak}</b> streak! (+${data.streakBonus})`;
      document.getElementById("streakMessages").className = "streak-message streak-glow";
      try { if (audioEnabled) fx.streak.play(); } catch(e){}
    } else {
      document.getElementById("streakMessages").innerHTML = "";
      document.getElementById("streakMessages").className = "";
    }
  });

  socket.on("lifeLost", (data) => {
    // Enter ROUND_END phase
    enterRoundEndPhase();
    clearTimerDisplay();
    updateGamePhase("Wrong Answer!", '❌');
    
    const box = document.getElementById("lifeMessages");
    if (!box) return;
    box.className = "life-warning";
    box.innerHTML = `⚠️ Wrong tile! You have <b>${data.livesLeft}</b> life left. ${data.livesLeft === 1 ? "One more mistake and it's GAME OVER!" : ""}`;
    try { if (audioEnabled) fx.fail.play(); } catch(e){}
    setTimeout(()=>{ box.innerHTML = ""; box.className = ""; }, 5000);
  });

  socket.on("streakUpdate", (data) => {
    const box = document.getElementById("streakMessages");
    if (!box) return;
    if (data.active && data.streak >= 3) {
      box.className = "streak-message streak-glow";
      box.innerHTML = `🔥 You’re on a streak! (x${data.streak})`;
    } else {
      box.innerHTML = "";
      box.className = "";
    }
  });

  socket.on("pointsEarned", (data) => {
    const box = document.getElementById("pointsMessages");
    if (!box) return;
    box.className = "points-popup";
    box.innerHTML = `+${data.points} points! (Total: ${data.total})`;
    setTimeout(()=>{ box.innerHTML = ""; box.className = ""; }, 3000);
  });

  socket.on("playerEliminated", data => {
    if (isLocal) return;
    updateGamePhase(`${data.name} was eliminated`, '💥');
    trackElimination();
    try { if (audioEnabled) fx.fail.play(); } catch(e){}
  });

  socket.on("playerDisconnected", (data) => {
    console.log(`Player disconnected: ${data.playerName}`);
    
    // Show small corner notification
    const notification = document.createElement('div');
    notification.className = 'disconnect-notification';
    notification.textContent = `${data.playerName} disconnected`;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      if (notification.parentNode) {
        notification.classList.add('fade-out');
        setTimeout(() => {
          if (notification.parentNode) {
            notification.parentNode.removeChild(notification);
          }
        }, 300);
      }
    }, 3000);
  });

  // Updated gameOver handler: show victory screen instead of old scoreboard
  socket.on("gameOver", data => {
    try { tieBanner.style.display = 'none'; } catch(e){}
    document.body.classList.remove("game-active");
    document.body.classList.add("game-ended"); // Add guard class

    // Hide eliminated overlay
    hideEliminatedOverlay();

    // Track game end
    gameStats.endTime = Date.now();
    gameStats.totalPlayers = Object.keys(data.scoreboard || {}).length;

    // Show victory screen with enhanced data
    const enhancedData = {
      ...data,
      gameStats: gameStats
    };
    
    showVictoryScreen(enhancedData);

    clearTimerDisplay();
    disableTiles();

    // Victory effects for winner
    if (socket.id === data.winner) {
      try { if (audioEnabled) fx.win.play(); } catch(e){}
    }
  });

  socket.on("sync", data => {
    // in local practice mode we don't update lobby/player UI from server
    if (!isLocal && currentRoomId && data.roomId === currentRoomId) {
      // Handle room-specific sync
      updateRoomPlayersList(data.players || [], data.hostId, data.maxPlayers);
      updateLobbyControls(socket.id === data.hostId, data.phase || 'lobby');
      
      // show playAgain for host when in scoreboard
      if (data.hostId && data.hostId === socket.id) {
        if (scoreboardEl && scoreboardEl.style.display === 'block') {
          playAgainBtn.style.display = 'inline-flex';
        }
      } else {
        playAgainBtn.style.display = 'none';
      }
      
      if (data.gameStarted) {
        status.textContent = `Game in progress — Round ${data.round || 0}`;
      }
    }
  });

  socket.on("chatMessage", m => {
    console.log("chat:", m);
  });

  socket.on("disconnect", () => {
    if (isLocal) return;
    updateGamePhase("Disconnected. Reconnecting...", '🔄');
  });

  // Match status updates for eliminated players
  socket.on("matchStatusUpdate", (data) => {
    console.log('[Client] Match status update received:', data);
    console.log('[Client] isPlayerEliminated:', isPlayerEliminated);
    console.log('[Client] My socket.id:', socket.id);
    
    // Only process if player is eliminated
    if (!isPlayerEliminated) {
      console.log('[Client] Ignoring match status - player not eliminated');
      return;
    }
    
    // Update live progress panel
    updateMatchProgress(data);
    
    // Update mini scoreboard
    if (data.leaderboard) {
      console.log('[Client] Updating scoreboard with', data.leaderboard.length, 'players');
      updateEliminatedScoreboard(data.leaderboard);
    } else {
      console.log('[Client] No leaderboard data in match status');
    }
  });

} else {
  // No socket.io loaded: show friendly offline message
  updateGamePhase("Offline: Use practice mode", '📴');
  startBtn.style.display = "none";
}

// ============================================
// ELIMINATED PLAYER OVERLAY
// ============================================

let isPlayerEliminated = false;
let eliminatedInRound = 0;

function showEliminatedOverlay(message = "Waiting for game to end...", round = 0) {
  isPlayerEliminated = true;
  eliminatedInRound = round;
  document.body.classList.add('player-eliminated');
  
  const overlay = document.getElementById('eliminatedOverlay');
  const messageEl = document.getElementById('eliminatedMessage');
  const roundEl = document.getElementById('eliminatedRound');
  
  if (overlay) {
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
  }
  
  if (roundEl) {
    roundEl.textContent = round;
  }
  
  // Lock all input
  inputLocked = true;
  disableTiles();
  
  console.log('[Eliminated] Overlay shown - eliminated in round', round);
}

function hideEliminatedOverlay() {
  isPlayerEliminated = false;
  eliminatedInRound = 0;
  document.body.classList.remove('player-eliminated');
  
  const overlay = document.getElementById('eliminatedOverlay');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }
  
  console.log('[Eliminated] Overlay hidden');
}

function updateMatchProgress(data) {
  if (!isPlayerEliminated) return;
  
  const { roundNumber, alivePlayerCount, statusMessage, isFinalDuel } = data;
  
  console.log('[Eliminated] Updating progress:', { roundNumber, alivePlayerCount, statusMessage });
  
  // Update round number
  const roundEl = document.getElementById('progressRound');
  if (roundEl) {
    roundEl.textContent = roundNumber || '-';
    console.log('[Eliminated] Set progressRound to:', roundNumber);
  } else {
    console.warn('[Eliminated] progressRound element not found');
  }
  
  // Update alive player count
  const playersEl = document.getElementById('progressPlayers');
  if (playersEl) {
    playersEl.textContent = alivePlayerCount || '-';
    console.log('[Eliminated] Set progressPlayers to:', alivePlayerCount);
  } else {
    console.warn('[Eliminated] progressPlayers element not found');
  }
  
  // Update status message
  const statusEl = document.getElementById('progressStatus');
  if (statusEl) {
    statusEl.textContent = statusMessage || 'Game in progress...';
    
    // Add special styling for final duel
    if (isFinalDuel) {
      statusEl.classList.add('final-duel');
    } else {
      statusEl.classList.remove('final-duel');
    }
  } else {
    console.warn('[Eliminated] progressStatus element not found');
  }
  
  console.log('[Eliminated] Progress updated successfully');
}

function updateEliminatedScoreboard(leaderboard) {
  if (!isPlayerEliminated) return;
  
  const scoreboard = document.getElementById('eliminatedScoreboard');
  if (!scoreboard) {
    console.warn('[Eliminated] eliminatedScoreboard element not found');
    return;
  }
  
  if (!leaderboard || leaderboard.length === 0) {
    console.warn('[Eliminated] No leaderboard data to display');
    scoreboard.innerHTML = '<p style="text-align: center; color: rgba(255,255,255,0.5);">No data available</p>';
    return;
  }
  
  console.log('[Eliminated] Building scoreboard for', leaderboard.length, 'players');
  console.log('[Eliminated] My socket.id:', socket.id);
  
  // Show top 5 players
  const top5 = leaderboard.slice(0, 5);
  
  let html = '';
  top5.forEach((player, index) => {
    const isCurrentPlayer = player.id === socket.id;
    const rankClass = index < 3 ? `rank-${index + 1}` : '';
    const currentClass = isCurrentPlayer ? 'current-player' : '';
    const eliminatedClass = !player.alive ? 'eliminated' : '';
    
    console.log('[Eliminated] Player:', player.name, 'isMe:', isCurrentPlayer, 'alive:', player.alive, 'roundEliminated:', player.roundEliminated);
    
    let statusText = '';
    if (!player.alive && player.roundEliminated) {
      statusText = `Eliminated Round ${player.roundEliminated}`;
    } else if (player.alive) {
      statusText = 'Still in game';
    }
    
    html += `
      <div class="eliminated-player-row ${rankClass} ${currentClass}">
        <div class="eliminated-player-info">
          <span class="eliminated-player-name ${eliminatedClass}">${escapeHtml(player.name)}</span>
          ${statusText ? `<span class="eliminated-player-status">${statusText}</span>` : ''}
        </div>
        <div class="eliminated-player-score">
          <span>${player.score || 0}</span>
          <span class="score-label">points</span>
        </div>
      </div>
    `;
  });
  
  scoreboard.innerHTML = html;
  console.log('[Eliminated] Scoreboard updated with', top5.length, 'players');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


// --- GLOBAL INTEGRATION HOOKS ---
// startColorRush supports { name, skipIntro, local }
window.startColorRush = function(options) {
  options = options || {};
  // detect local flag
  isLocal = !!options.local;

  // If a name is passed, store it
  if (options.name && typeof options.name === 'string') {
    myName = options.name;
    // apply to input for consistency
    try { nameInput.value = myName; } catch(e){}
  }

  // Show the intro overlay (unless skipIntro)
  if (options.skipIntro) {
    introScreen.classList.add('fade-out');
    introScreen.addEventListener("transitionend", () => {
      introScreen.classList.remove("intro-visible");
      introScreen.classList.add("intro-hidden");
      gameContainer.style.display = "block";
      gameContainer.setAttribute("aria-hidden", "false");
    }, { once: true });
  } else {
    // Ensure intro is visible (user can still press Enter/Ready)
    introScreen.classList.remove('intro-hidden');
    introScreen.classList.add('intro-visible');
    introScreen.classList.remove('fade-out');
    try { nameInput.focus(); } catch(e){}
  }

  // For multiplayer (server present) we keep previous behavior: use enterBtn to register and hide intro
  if (!isLocal) {
    if (options.name && typeof options.name === 'string') {
      nameInput.value = options.name;
      setTimeout(() => { try { enterBtn.click(); } catch(e) { /* fallback */ } }, 150);
    }
    setTimeout(()=> {
      emitSafe('requestSync');
    }, 250);
    return;
  }

  // ---- Local practice flow ----
  // When called programmatically with local:true, we follow the same behavior
  // as the Practice button: show the UI and show Start button but DO NOT auto-start.
  try {
    introScreen.classList.add('fade-out');
    introScreen.addEventListener("transitionend", () => {
      introScreen.classList.remove("intro-visible");
      introScreen.classList.add("intro-hidden");
      gameContainer.style.display = "block";
      gameContainer.setAttribute("aria-hidden", "false");
      status.textContent = `Practice mode: ${myName} — press Start Game to begin`;
      // ensure Start is visible for practice start
      startBtn.style.display = "inline-block";
      // hide practice controls until session ends
      showPracticeControls(false);
      // hide player UI in practice
      try { if (playersEl) playersEl.style.display = 'none'; } catch(e){}
      try { if (lobbyPlayersEl) lobbyPlayersEl.style.display = 'none'; } catch(e){}
    }, { once: true });
  } catch(e) {
    // fallback UI updates
    try { introScreen.style.display = 'none'; } catch(e){}
    try { gameContainer.style.display = 'block'; } catch(e){}
    status.textContent = `Practice mode: ${myName} — press Start Game to begin`;
    startBtn.style.display = "inline-block";
    showPracticeControls(false);
    try { if (playersEl) playersEl.style.display = 'none'; } catch(e){}
    try { if (lobbyPlayersEl) lobbyPlayersEl.style.display = 'none'; } catch(e){}
  }
};

// finishColorRush unchanged but hides ready area and tie banner
window.finishColorRush = function() {
  try {
    goToMenu();
  } catch (e) {
    if (gameContainer) gameContainer.style.display = "none";
    if (scoreboardEl) scoreboardEl.style.display = "none";
    if (introScreen) {
      introScreen.classList.remove('intro-hidden');
      introScreen.classList.add('intro-visible');
    }
  }
  try {
    if (typeof window.onMinigameFinished === 'function') {
      window.onMinigameFinished();
    }
  } catch(e) {
    console.warn("onMinigameFinished threw:", e);
  }
};

// expose finish helper (internal)
function finishColorRush() { window.finishColorRush(); }







