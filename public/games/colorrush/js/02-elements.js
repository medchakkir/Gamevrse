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
