// =============================================================
//  CLIENT.JS (FINAL, CLEAN, LAYOUT A, ROOM FIXED)
// =============================================================
const socket = io('/rankly');

/* -------------------------------------------------------------
   GLOBAL STATE
------------------------------------------------------------- */
let currentRoomId = null;
let mySocketId = null;
let myName = "";
let myAvatarColor = "#4d73ff";
let myAvatarTextColor = "#ffffff";
let amHost = false;
let currentJudgeId = null;
let currentRoomMode = "normal"; // "normal" | "custom"
let playerToken = null; // Unique token for reconnection


let isReady = false;
let currentRoundId = null;
let turnTimeout = null;
let countdownTimerInterval = null;
let countdownReadyCount = 0;
let rankingTimerInterval = null; // Ranking timer
let rankingTimeout = null; // Ranking timeout

let countdownTotal = 0;
let hasAnsweredThisRound = false;
let activeTurnInterval = null;
let endGameBtn = null;
let exitLobbyBtn = null;

/* -------------------------------------------------------------
   SOUND EFFECTS - Global sound enabled flag
------------------------------------------------------------- */
let soundEnabled = true;

// Load sound preference from localStorage
try {
  const savedSoundPref = localStorage.getItem("rankly_sound_enabled");
  if (savedSoundPref !== null) {
    soundEnabled = savedSoundPref === "true";
  }
} catch (e) {
  console.log("localStorage not available");
}

/* -------------------------------------------------------------
   SOUND EFFECTS - Audio Context
------------------------------------------------------------- */
// Create AudioContext for sound effects
let audioContext = null;

// Initialize audio context on first user interaction
function initAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

// Play button click sound
function playClickSound() {
  if (!soundEnabled) return; // Check if sound is enabled
  
  try {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.value = 800;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.05);
  } catch (e) {
    console.log('Audio not supported');
  }
}

// Play countdown tick sound (last 5 seconds)
function playTickSound() {
  try {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.value = 600;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.08, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.1);
  } catch (e) {
    console.log('Audio not supported');
  }
}

// Play time up buzzer sound
function playTimeUpSound() {
  try {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.frequency.value = 200;
    oscillator.type = 'square';
    
    gainNode.gain.setValueAtTime(0.15, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.3);
  } catch (e) {
    console.log('Audio not supported');
  }
}

// Play round start sound (whoosh + impact)
function playRoundStartSound() {
  if (!soundEnabled) return; // Check if sound is enabled
  
  try {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    // Whoosh (white noise sweep)
    const bufferSize = ctx.sampleRate * 0.3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseGain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1000;
    
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    noiseGain.gain.setValueAtTime(0.1, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    
    noise.start(ctx.currentTime);
    
    // Impact
    const impact = ctx.createOscillator();
    const impactGain = ctx.createGain();
    
    impact.connect(impactGain);
    impactGain.connect(ctx.destination);
    
    impact.frequency.setValueAtTime(150, ctx.currentTime + 0.25);
    impact.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.35);
    impact.type = 'sine';
    
    impactGain.gain.setValueAtTime(0.2, ctx.currentTime + 0.25);
    impactGain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    
    impact.start(ctx.currentTime + 0.25);
    impact.stop(ctx.currentTime + 0.35);
  } catch (e) {
    console.log('Audio not supported');
  }
}

// Play ranking reveal sound (rising reveal)
function playRevealSound() {
  if (!soundEnabled) return; // Check if sound is enabled
  
  try {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    // Rising pitch
    oscillator.frequency.setValueAtTime(200, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.5);
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.12, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.12, ctx.currentTime + 0.4);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.5);
  } catch (e) {
    console.log('Audio not supported');
  }
}

// Play victory fanfare (game won)
function playVictorySound() {
  if (!soundEnabled) return; // Check if sound is enabled
  
  try {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    const notes = [
      { freq: 523.25, time: 0, duration: 0.15 },    // C5
      { freq: 659.25, time: 0.15, duration: 0.15 }, // E5
      { freq: 783.99, time: 0.3, duration: 0.3 }    // G5
    ];
    
    notes.forEach(note => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.frequency.value = note.freq;
      osc.type = 'sine';
      
      gain.gain.setValueAtTime(0.15, ctx.currentTime + note.time);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + note.time + note.duration);
      
      osc.start(ctx.currentTime + note.time);
      osc.stop(ctx.currentTime + note.time + note.duration);
    });
  } catch (e) {
    console.log('Audio not supported');
  }
}

// Play game ended sound (descending tone)
function playGameEndedSound() {
  if (!soundEnabled) return; // Check if sound is enabled
  
  try {
    const ctx = initAudioContext();
    if (!ctx) return;
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    // Descending pitch
    oscillator.frequency.setValueAtTime(400, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.6);
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.1, ctx.currentTime + 0.5);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.6);
  } catch (e) {
    console.log('Audio not supported');
  }
}

/* -------------------------------------------------------------
   ONBOARDING STATE
------------------------------------------------------------- */
const ONBOARDING_KEY = "cw_onboarding_complete";
let onboardingState = {
  complete: false,
  shownReadyHint: false,
  shownJudgeHint: false
};

// Load onboarding state from localStorage
try {
  const saved = localStorage.getItem(ONBOARDING_KEY);
  if (saved === "true") {
    onboardingState.complete = true;
    onboardingState.shownReadyHint = true;
    onboardingState.shownJudgeHint = true;
  }
} catch (e) {
  console.log("localStorage not available");
}

/* -------------------------------------------------------------
   UTILS
------------------------------------------------------------- */
function escapeHtml(str){ return String(str).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }
function initials(n){ if(!n)return"U"; const p=n.trim().split(" "); return (p[0][0]+(p[1]?.[0]||"")).toUpperCase(); }

/* -------------------------------------------------------------
   ONBOARDING HELPERS
------------------------------------------------------------- */
function showOnboardingTooltip(message, targetElement) {
  if (onboardingState.complete) return;
  
  const tooltip = document.getElementById("onboardingTooltip");
  if (!tooltip || !targetElement) return;
  
  tooltip.textContent = message;
  tooltip.classList.remove("hidden");
  
  // Position tooltip above target element
  const rect = targetElement.getBoundingClientRect();
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${rect.top - 10}px`;
  tooltip.style.transform = "translate(-50%, -100%)";
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    tooltip.classList.add("hidden");
  }, 5000);
}

function checkOnboardingComplete() {
  if (onboardingState.shownReadyHint && onboardingState.shownJudgeHint) {
    onboardingState.complete = true;
    try {
      localStorage.setItem(ONBOARDING_KEY, "true");
    } catch (e) {
      console.log("Could not save onboarding state");
    }
  }
}

function updateContextualHelpers(state) {
  const readyHelperText = document.getElementById("readyHelperText");
  const startHelperText = document.getElementById("startHelperText");
  const answerHelperText = document.getElementById("answerHelperText");
  const judgeHelperText = document.getElementById("judgeHelperText");
  
  // Hide all helpers first
  if (readyHelperText) hide(readyHelperText);
  if (startHelperText) hide(startHelperText);
  if (answerHelperText) hide(answerHelperText);
  if (judgeHelperText) hide(judgeHelperText);
  
  // Show relevant helper based on state
  if (state === "lobby") {
    if (amHost && startHelperText) {
      show(startHelperText);
    } else if (!amHost && readyHelperText) {
      show(readyHelperText);
    }
  } else if (state === "in_round") {
    if (mySocketId === currentJudgeId && judgeHelperText) {
      show(judgeHelperText);
    } else if (answerHelperText) {
      show(answerHelperText);
    }
  }
}

/* -------------------------------------------------------------
   CUSTOM ALERT SYSTEM
------------------------------------------------------------- */
function showCustomAlert(options) {
  const {
    title = 'Alert',
    message = '',
    icon = '⚠️',
    type = 'warning', // 'warning', 'error', 'success', 'info'
    confirmText = 'OK',
    cancelText = 'Cancel',
    showCancel = false,
    onConfirm = null,
    onCancel = null
  } = options;

  const overlay = document.getElementById('customAlert');
  const modal = overlay.querySelector('.custom-alert-modal');
  const iconEl = document.getElementById('alertIcon');
  const titleEl = document.getElementById('alertTitle');
  const messageEl = document.getElementById('alertMessage');
  const confirmBtn = document.getElementById('alertConfirm');
  const cancelBtn = document.getElementById('alertCancel');

  // Set content
  iconEl.textContent = icon;
  titleEl.textContent = title;
  messageEl.textContent = message;
  confirmBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;

  // Set type class
  modal.className = 'custom-alert-modal';
  if (type) modal.classList.add(`alert-${type}`);

  // Show/hide cancel button
  cancelBtn.classList.toggle('hidden', !showCancel);

  // Show overlay
  overlay.classList.remove('hidden');

  // Handle confirm
  const handleConfirm = () => {
    overlay.classList.add('hidden');
    if (onConfirm) onConfirm();
    cleanup();
  };

  // Handle cancel
  const handleCancel = () => {
    overlay.classList.add('hidden');
    if (onCancel) onCancel();
    cleanup();
  };

  // Cleanup listeners
  const cleanup = () => {
    confirmBtn.removeEventListener('click', handleConfirm);
    cancelBtn.removeEventListener('click', handleCancel);
  };

  // Add listeners
  confirmBtn.addEventListener('click', handleConfirm);
  cancelBtn.addEventListener('click', handleCancel);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      handleCancel();
    }
  });
}

function colorGradient(hex) {
  return `linear-gradient(
    180deg,
    ${hex},
    ${darkenHex(hex, 12)}
  )`;
}

function darkenHex(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) - percent;
  let g = ((num >> 8) & 0xff) - percent;
  let b = (num & 0xff) - percent;

  r = Math.max(0, r);
  g = Math.max(0, g);
  b = Math.max(0, b);

  return `#${(r << 16 | g << 8 | b).toString(16).padStart(6,"0")}`;
}



function show(el){ if(el) el.classList.remove("hidden"); }
function hide(el){ if(el) el.classList.add("hidden"); }

function updateMyAvatarPreview() {
  const myRow = [...document.querySelectorAll(".player-row")]
    .find(row => row.textContent.includes("(You)"));

  if (!myRow) return;

  const avatar = myRow.querySelector(".avatar");
  if (avatar) {
    avatar.style.background = colorGradient(myAvatarColor);
    avatar.style.color = myAvatarTextColor;
  }
}

function updateAvatarPreview(color, textColor) {
  const previewCircle = document.getElementById("avatarPreviewCircle");
  if (previewCircle) {
    previewCircle.style.background = colorGradient(color);
    previewCircle.style.color = textColor || "#ffffff";
    previewCircle.textContent = initials(myName);
  }
}



function setLobbyMode() {
  document.body.classList.remove("in-game");
  document.body.classList.add("in-lobby");

  // 🔓 Unlock avatar editing in lobby
  const avatarBtn = document.getElementById("avatarEditBtn");
  if (avatarBtn) {
    avatarBtn.disabled = false;
    avatarBtn.title = "Edit avatar";
  }

  // Show appropriate button based on host status
  if (amHost) {
    show(startGameBtn);
    hide(readyBtn);
  } else {
    hide(startGameBtn);
    show(readyBtn);
  }
}

function updateRoomModeDisplay(mode) {
  const roomModeDisplay = document.getElementById("roomModeDisplay");
  if (!roomModeDisplay) return;
  
  const modeText = mode === "custom" 
    ? "✏️ Custom Mode — Custom questions enabled"
    : "🎲 Standard Mode — Built-in questions only";
  
  roomModeDisplay.textContent = modeText;
  roomModeDisplay.className = "room-mode-display " + (mode === "custom" ? "mode-custom" : "mode-normal");
  
  // PART 2: RACE CONDITION PROTECTION - Instant revalidation on mode change
  if (amHost) {
    const questionInput = document.getElementById("questionInput");
    
    if (mode === "custom") {
      // Switching TO custom mode - force validation
      if (questionInput) {
        validateCustomQuestions();
      }
    } else {
      // Switching FROM custom TO standard - clear textarea and reset validation
      if (questionInput) {
        questionInput.value = "";
        questionInput._validatedQuestions = null;
        
        // Reset start button state
        const startGameBtn = document.getElementById("startGameBtn");
        if (startGameBtn) {
          startGameBtn.disabled = false;
          startGameBtn.classList.remove("disabled");
          startGameBtn.style.cursor = "pointer";
          startGameBtn.title = "";
        }
      }
    }
  }
}

function updateQuestionInputVisibility() {
  const questionInput = document.getElementById("questionInput");
  const questionValidation = document.getElementById("questionValidation");
  if (!questionInput || !questionValidation) return;
  
  if (currentRoomMode === "custom" && amHost) {
    show(questionInput);
    show(questionValidation);
    questionInput.placeholder = "Enter one question per line...";
    // Force validation when switching to custom mode
    validateCustomQuestions();
  } else {
    hide(questionInput);
    hide(questionValidation);
    // Clear validation when switching away from custom mode
    questionInput.value = "";
    questionInput._validatedQuestions = null;
    
    // Re-enable start button if it was disabled by validation
    const startGameBtn = document.getElementById("startGameBtn");
    if (startGameBtn && amHost) {
      startGameBtn.disabled = false;
      startGameBtn.classList.remove("disabled");
      startGameBtn.title = "";
    }
  }
}

function validateCustomQuestions() {
  const questionInput = document.getElementById("questionInput");
  const questionCounter = document.getElementById("questionCounter");
  const questionHint = document.getElementById("questionHint");
  const questionWarning = document.getElementById("questionWarning");
  const startGameBtn = document.getElementById("startGameBtn");
  
  if (!questionInput || !questionCounter || !questionHint || !questionWarning || !startGameBtn) return;
  
  // Get current number of rounds from admin controls
  const numRoundsSelect = document.getElementById("ruleNumRounds");
  const numRounds = numRoundsSelect ? parseInt(numRoundsSelect.value) : 5;
  
  // PART 1: CLIENT SIDE HARDENING - Normalize Windows line endings
  const normalizedValue = questionInput.value.replace(/\r/g, "");
  const lines = normalizedValue.split('\n');
  
  const processedQuestions = [];
  const seenQuestions = new Set();
  const validationErrors = [];
  
  // Process each line with comprehensive validation
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    
    // Skip empty lines
    if (line.length === 0) continue;
    
    // Collapse multiple spaces into one
    line = line.replace(/\s+/g, ' ');
    
    // HARDENED VALIDATION RULES:
    
    // 1. Length validation (5-120 characters)
    if (line.length < 5) {
      validationErrors.push("Each question must be at least 5 characters.");
      continue;
    }
    
    if (line.length > 120) {
      validationErrors.push("Max 120 characters per question.");
      continue;
    }
    
    // 2. Content validation - reject if only punctuation
    if (/^[^\w\s]*$/.test(line)) {
      validationErrors.push("Questions cannot be only punctuation.");
      continue;
    }
    
    // 3. Duplicate detection (case-insensitive)
    const normalized = line.toLowerCase().trim();
    if (seenQuestions.has(normalized)) {
      validationErrors.push("Duplicate questions are not allowed.");
      continue;
    }
    
    seenQuestions.add(normalized);
    processedQuestions.push(line);
  }
  
  const validQuestionCount = processedQuestions.length;
  
  // Update live counter - reflects ONLY valid questions
  questionCounter.textContent = `${validQuestionCount} / ${numRounds} valid questions`;
  
  // Update hint
  questionHint.textContent = `Custom Mode: Enter exactly ${numRounds} questions (one per line)`;
  
  // Reset styling
  questionCounter.classList.remove("valid", "invalid");
  
  let isValid = false;
  let warningText = "";
  
  // PART 6: UX POLISH - Specific feedback messages
  if (validationErrors.length > 0) {
    // Show first unique error with specific messaging
    const uniqueErrors = [...new Set(validationErrors)];
    warningText = uniqueErrors[0];
  } else if (validQuestionCount !== numRounds) {
    // PART 1: Exact count requirement
    warningText = `Enter exactly ${numRounds} questions.`;
  } else {
    // All validation passed
    isValid = true;
  }
  
  // Update UI based on validation state
  if (isValid) {
    questionCounter.classList.add("valid");
    hide(questionWarning);
    
    // PART 6: Enable start button with visual feedback
    if (amHost) {
      startGameBtn.disabled = false;
      startGameBtn.classList.remove("disabled");
      startGameBtn.style.cursor = "pointer";
      startGameBtn.title = "";
    }
  } else {
    questionCounter.classList.add("invalid");
    questionWarning.textContent = warningText;
    show(questionWarning);
    
    // PART 6: Disable start button with visual feedback
    if (amHost) {
      startGameBtn.disabled = true;
      startGameBtn.classList.add("disabled");
      startGameBtn.style.cursor = "not-allowed";
      startGameBtn.title = `Enter exactly ${numRounds} valid questions`;
    }
  }
  
  // Store validated questions for start game handler
  questionInput._validatedQuestions = isValid ? processedQuestions : null;
}

function setGameMode() {
  document.body.classList.remove("in-lobby");
  document.body.classList.add("in-game");

  // 🔒 Lock avatar editing during game
  const avatarBtn = document.getElementById("avatarEditBtn");
  if (avatarBtn) {
    avatarBtn.disabled = true;
    avatarBtn.title = "Avatar can only be changed in the lobby";
  }

  // Hide Start Game and Ready buttons during game
  hide(startGameBtn);
  hide(readyBtn);
}



async function safeCopy(text){
  try { await navigator.clipboard.writeText(text); return true; }
  catch{
    const ta=document.createElement("textarea");
    ta.value=text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  }
}

function launchConfetti(container) {
  for (let i = 0; i < 14; i++) {
    const confetti = document.createElement("div");
    confetti.className = "confetti";
    confetti.textContent = ["🎉", "✨", "🎊"][Math.floor(Math.random() * 3)];
    confetti.style.left = Math.random() * 90 + "%";

    container.appendChild(confetti);

    setTimeout(() => confetti.remove(), 1300);
  }
}

function revealResultsSequentially(results) {
  resultsList.innerHTML = "";

  results.forEach((r, index) => {
    const div = document.createElement("div");
    div.className = "result-card";
    div.innerHTML = `
      <b>Rank ${r.rank}</b> — ${escapeHtml(r.answerText)}
      — <em>${escapeHtml(r.playerName)}</em>
      (+${r.points} pts)
    `;

    resultsList.appendChild(div);

    // Reveal one by one
    setTimeout(() => {
      div.classList.add("reveal");
    }, index * 600); // ⏱ delay between reveals
  });
}



/* -------------------------------------------------------------
   DOM READY
------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {

  /* ----------------- grab DOM ------------------ */
  const controlsWrapper = document.querySelector(".controls");
  const roomPanel = document.getElementById("roomPanel");
  const avatarEditBtn = document.getElementById("avatarEditBtn");
  const roomIdDisplay = document.getElementById("roomIdDisplay");

  const createBtn = document.getElementById("createBtn");
  const joinBtn = document.getElementById("joinBtn");
  const nameInput = document.getElementById("nameInput");
  const roomIdInput = document.getElementById("roomIdInput");
  const copyRoomBtn = document.getElementById("copyRoomBtn");

  const avatarModal = document.getElementById("avatarModal");
  const avatarColorPicker = document.getElementById("avatarColorPicker");
  const avatarPreviewCircle = document.getElementById("avatarPreviewCircle");
  const saveAvatarBtn = document.getElementById("saveAvatarBtn");
  const cancelAvatarBtn = document.getElementById("cancelAvatarBtn");

  const avatarTextColorPicker =document.getElementById("avatarTextColorPicker");


  const playersList = document.getElementById("playersList");
  const playerCountInfo = document.getElementById("playerCountInfo");

  const readyBtn = document.getElementById("readyBtn");
  const startGameBtn = document.getElementById("startGameBtn");
  const cancelStartBtn = document.getElementById("cancelStartBtn");
  const questionInput = document.getElementById("questionInput");

  const adminTools = document.getElementById("hostRules");
  const kickSelect = document.getElementById("kickSelect");
  const kickBtn = document.getElementById("kickBtn");

  const ruleNumRounds = document.getElementById("ruleNumRounds");
  const ruleMinPlayers = document.getElementById("ruleMinPlayers");
  const ruleTurnTime = document.getElementById("ruleTurnTime");
  const ruleMultiplier = document.getElementById("ruleMultiplier");

  const gameArea = document.getElementById("gameArea");
  const gameQuestion = document.getElementById("gameQuestion");
  const gameMeta = document.getElementById("gameMeta");
  const gamePlayerMeta = document.getElementById("gamePlayerMeta");

  const turnArea = document.getElementById("turnArea");
  const turnText = document.getElementById("turnText");
  const turnTimer = document.getElementById("turnTimer");
  const turnTimerText = document.getElementById("turnTimerText");


  const answerForm = document.getElementById("answerForm");
  const answerInput = document.getElementById("answerInput");
  const submitAnswerBtn = document.getElementById("submitAnswerBtn");
  const answerFeedback = document.getElementById("answerFeedback");

  const rankingArea = document.getElementById("rankingArea");
  const anonAnswersDiv = document.getElementById("anonAnswers");
  const submitRankBtn = document.getElementById("submitRankBtn");
  const rankFeedback = document.getElementById("rankFeedback");

  const resultsArea = document.getElementById("resultsArea");
  const resultsList = document.getElementById("resultsList");

  /* -------------------------------------------------------------
   GAME UI SAFETY RESET
------------------------------------------------------------- */
function showGameCoreUI() {
  show(gameArea);
  show(gameQuestion);
  show(turnArea);

  hide(resultsArea);
  hide(rankingArea);
}


  const roundIntro = document.getElementById("roundIntro");
  const roundIntroText = document.getElementById("roundIntroText");

  const leaderboardDiv = document.getElementById("leaderboard");

  const chatPanel = document.getElementById("chatPanel");
  const chatMessages = document.getElementById("chatMessages");
  const chatInput = document.getElementById("chatInput");
  const chatSendBtn = document.getElementById("chatSendBtn");

  // Onboarding elements
  const howToPlayBtn = document.getElementById("howToPlayBtn");
  const howToPlayPanel = document.getElementById("howToPlayPanel");

  const systemToast = document.createElement("div");
  systemToast.id = "systemToast";
  systemToast.className = "system-toast hidden";
  systemToast.style.zIndex = 9999;
  document.body.appendChild(systemToast);

  /* -------------------------------------------------------------
     HOW TO PLAY TOGGLE
  ------------------------------------------------------------- */
  if (howToPlayBtn && howToPlayPanel) {
    howToPlayBtn.onclick = () => {
      howToPlayPanel.classList.toggle("hidden");
    };
  }

  function showSystemToast(message, duration = 2500) {
  systemToast.textContent = message;
  systemToast.classList.remove("hidden");

  clearTimeout(systemToast._timer);
  systemToast._timer = setTimeout(() => {
    systemToast.classList.add("hidden");
  }, duration);
}

const winnerCeremony = document.getElementById("winnerCeremony");
const winnerFirst = document.getElementById("winnerFirst");
const winnerSecond = document.getElementById("winnerSecond");
const winnerThird = document.getElementById("winnerThird");



  /* -------------------------------------------------------------
      ENTER ROOM UI — FIXED
  ------------------------------------------------------------- */
  function enterRoomUI(){
    hide(controlsWrapper);
    show(roomPanel);
    show(gameArea);
    show(chatPanel);

    addRoomButtons();

    // First-time tooltip: Ready button hint
    if (!onboardingState.shownReadyHint && !amHost) {
      setTimeout(() => {
        showOnboardingTooltip("You must press Ready before the game can begin.", readyBtn);
        onboardingState.shownReadyHint = true;
        checkOnboardingComplete();
      }, 500);
    }
  }

  /* Exit -> back to lobby */
  function exitRoomUI(){
    show(controlsWrapper);
    hide(roomPanel);
    removeRoomButtons();
  }

  /* -------------------------------------------------------------
   RESET TO LOBBY AFTER GAME ENDS  ✅ ADD HERE
------------------------------------------------------------- */
function resetToLobbyUI() {
  setLobbyMode();
  hide(gameArea);
  hide(resultsArea);
  hide(rankingArea);
  hide(turnArea);
  hide(winnerCeremony);

  show(roomPanel);
  show(chatPanel);

  hasAnsweredThisRound = false;
  submitAnswerBtn.disabled = false;
  currentRoundId = null;

  startGameBtn.disabled = false;
  questionInput.value = "";
  
  // Clear inline styles that were set during game
  readyBtn.style.display = "";
  startGameBtn.style.display = "";
  
  const winner = document.querySelector(".leaderboard-item.winner");
  if (winner) winner.classList.remove("winner");
  const confetti = document.querySelectorAll(".confetti");
  confetti.forEach(c => c.remove());

  if (endGameBtn) endGameBtn.style.display = "none";
  if (exitLobbyBtn) exitLobbyBtn.style.display = "none";
}

  /* -------------------------------------------------------------
     ROOM PANEL BUTTONS (Exit / Close)
  ------------------------------------------------------------- */
  function addRoomButtons(){
    const bar = document.querySelector("#roomPanel .top-bar");
    if(!bar) return;

    removeRoomButtons(); // avoid duplicates

    const exitBtn = document.createElement("button");
    exitBtn.id = "exitRoomBtn";
    exitBtn.className = "btn ghost small";
    exitBtn.textContent = "Exit Room";
    exitBtn.onclick = () => {
      showCustomAlert({
        title: 'Exit Room',
        message: 'Are you sure you want to leave this room? You will lose your current progress.',
        icon: '🚪',
        type: 'warning',
        confirmText: 'Exit',
        cancelText: 'Stay',
        showCancel: true,
        onConfirm: () => {
          socket.emit("leave_room", { roomId: currentRoomId });
        }
      });
    };

    const closeBtn = document.createElement("button");
    closeBtn.id = "closeRoomBtn";
    closeBtn.className = "btn ghost small";
    closeBtn.textContent = "Close Room";
    closeBtn.onclick = () => {
      playClickSound(); // 🔊 Button click sound
      showCustomAlert({
        title: 'Close Room',
        message: 'Are you sure you want to close this room? This will end the game for all players and cannot be undone.',
        icon: '⚠️',
        type: 'error',
        confirmText: 'Close Room',
        cancelText: 'Cancel',
        showCancel: true,
        onConfirm: () => {
          socket.emit("close_room", { roomId: currentRoomId });
        }
      });
    };

    bar.appendChild(exitBtn);
    bar.appendChild(closeBtn);

    toggleRoomButtons();
  }

  function removeRoomButtons(){
    const e = document.getElementById("exitRoomBtn");
    const c = document.getElementById("closeRoomBtn");
    if(e) e.remove();
    if(c) c.remove();
  }

  function toggleRoomButtons(){
    const exitBtn = document.getElementById("exitRoomBtn");
    const closeBtn = document.getElementById("closeRoomBtn");

    if(!exitBtn || !closeBtn) return;

    if(amHost){
      exitBtn.style.display = "none";
      closeBtn.style.display = "";
    } else {
      closeBtn.style.display = "none";
      exitBtn.style.display = "";
    }
  }

  /* -------------------------------------------------------------
     CREATE ROOM
  ------------------------------------------------------------- */
  createBtn.onclick = () => {
    playClickSound(); // 🔊 Button click sound
    
    if(currentRoomId) {
      showCustomAlert({
        title: 'Already in Room',
        message: 'You are already in a room. Please exit first before creating a new one.',
        icon: '🚪',
        type: 'warning',
        confirmText: 'OK'
      });
      return;
    }

    const nameValue = nameInput.value.trim();
    if (!nameValue) {
      showCustomAlert({
        title: 'Name Required',
        message: 'Please enter your name before creating a room.',
        icon: '✏️',
        type: 'warning',
        confirmText: 'OK'
      });
      nameInput.focus();
      return;
    }

    myName = nameValue;
    const selectedMode = modeCustom.checked ? "custom" : "normal";
    currentRoomMode = selectedMode;

    socket.emit("create_room", { 
      name: myName, 
      avatarColor: myAvatarColor,
      avatarTextColor: myAvatarTextColor,
      mode: selectedMode
    }, res => {
      if(!res.ok) {
        showCustomAlert({
          title: 'Error',
          message: res.error || 'Failed to create room. Please try again.',
          icon: '❌',
          type: 'error',
          confirmText: 'OK'
        });
        return;
      }

      currentRoomId = res.roomId;
      currentRoomMode = res.mode || selectedMode;
      playerToken = res.playerToken; // Store token for reconnection
      amHost = true;
      show(startGameBtn);
      hide(readyBtn);

      roomIdDisplay.textContent = currentRoomId;
      updateRoomModeDisplay(currentRoomMode);
      updateQuestionInputVisibility();
      enterRoomUI();

      updatePlayers(res.players, res.room.hostSocketId);
      updateLeaderboard(res.room.leaderboard || []);
      
      // Save connection state for reconnection
      saveConnectionState();
    });
  };

  avatarEditBtn.onclick = () => {
  if (document.body.classList.contains("in-game")) return;

  avatarColorPicker.value = myAvatarColor;
  avatarTextColorPicker.value = myAvatarTextColor;
  updateAvatarPreview(myAvatarColor, myAvatarTextColor);
  avatarModal.classList.remove("hidden");

};

avatarColorPicker.oninput = () => {
  updateAvatarPreview(
    avatarColorPicker.value,
    avatarTextColorPicker.value
  );
};

avatarTextColorPicker.oninput = () => {
  updateAvatarPreview(
    avatarColorPicker.value,
    avatarTextColorPicker.value
  );
};

// Question validation event listeners
if (questionInput) {
  questionInput.oninput = () => {
    if (currentRoomMode === "custom" && amHost) {
      validateCustomQuestions();
    }
  };
}

if (ruleNumRounds) {
  ruleNumRounds.onchange = () => {
    // PART 2: RACE CONDITION PROTECTION - Instant revalidation on numRounds change
    if (currentRoomMode === "custom" && amHost) {
      validateCustomQuestions();
    }
  };
}


saveAvatarBtn.onclick = () => {
  myAvatarColor = avatarColorPicker.value;
  myAvatarTextColor = avatarTextColorPicker.value;

  updateMyAvatarPreview();

  if (currentRoomId) {
    socket.emit("update_avatar", {
      roomId: currentRoomId,
      avatarColor: myAvatarColor,
      avatarTextColor: myAvatarTextColor
    });
  }

  avatarModal.classList.add("hidden");
};


cancelAvatarBtn.onclick = () => {
  avatarModal.classList.add("hidden");
};

// Close modal when clicking backdrop
avatarModal.onclick = (e) => {
  if (e.target === avatarModal) {
    avatarModal.classList.add("hidden");
  }
};

/* -------------------------------------------------------------
   SOUND TOGGLE BUTTON
------------------------------------------------------------- */
const soundToggleBtn = document.getElementById("soundToggleBtn");

// Set initial button icon
if (soundToggleBtn) {
  soundToggleBtn.textContent = soundEnabled ? "🔊" : "🔇";
  console.log("Sound toggle button initialized. Sound enabled:", soundEnabled);
}

// Toggle sound on/off when button is clicked
if (soundToggleBtn) {
  soundToggleBtn.onclick = () => {
    soundEnabled = !soundEnabled;
    
    // Update button icon
    soundToggleBtn.textContent = soundEnabled ? "🔊" : "🔇";
    
    // Save to localStorage
    try {
      localStorage.setItem("rankly_sound_enabled", soundEnabled.toString());
    } catch (e) {
      console.log("localStorage not available");
    }
    
    // Play a test sound if enabled
    if (soundEnabled) {
      playClickSound();
    }
    
    console.log("Sound toggled:", soundEnabled);
  };
}

  joinBtn.onclick = () => {
    playClickSound(); // 🔊 Button click sound
    
    if(currentRoomId) {
      showCustomAlert({
        title: 'Already in Room',
        message: 'You are already in a room. Please exit first before joining another one.',
        icon: '🚪',
        type: 'warning',
        confirmText: 'OK'
      });
      return;
    }

    const nameValue = nameInput.value.trim();
    if (!nameValue) {
      showCustomAlert({
        title: 'Name Required',
        message: 'Please enter your name before joining a room.',
        icon: '✏️',
        type: 'warning',
        confirmText: 'OK'
      });
      nameInput.focus();
      return;
    }

    const rid = roomIdInput.value.trim();
    if (!rid) {
      showCustomAlert({
        title: 'Room Code Required',
        message: 'Please enter a room code to join.',
        icon: '🔑',
        type: 'warning',
        confirmText: 'OK'
      });
      roomIdInput.focus();
      return;
    }

    myName = nameValue;

    socket.emit("join_room", { 
      roomId: rid, 
      name: myName, 
      avatarColor: myAvatarColor,
      avatarTextColor: myAvatarTextColor
    }, res => {
      if(!res.ok) {
        if (res.error === 'game_in_progress') {
          const roundInfo = res.round && res.totalRounds 
            ? ` (Round ${res.round} of ${res.totalRounds})`
            : '';
          showCustomAlert({
            title: 'Game In Progress',
            message: `This room is currently playing${roundInfo}. Please wait until the game ends and try again.`,
            icon: '🎮',
            type: 'info',
            confirmText: 'OK'
          });
        } else {
          showCustomAlert({
            title: 'Cannot Join Room',
            message: res.error === 'Room not found' 
              ? 'Room not found. Please check the room code and try again.'
              : res.error || 'Failed to join room. Please try again.',
            icon: '❌',
            type: 'error',
            confirmText: 'OK'
          });
        }
        return;
      }

      currentRoomId = res.roomId;
      currentRoomMode = res.mode || "normal";
      playerToken = res.playerToken; // Store token for reconnection
      amHost = false;
      hide(startGameBtn);
      show(readyBtn);


      roomIdDisplay.textContent = currentRoomId;
      updateRoomModeDisplay(currentRoomMode);
      updateQuestionInputVisibility();
      enterRoomUI();

      updatePlayers(res.players, res.room.hostSocketId);
      updateLeaderboard(res.room.leaderboard || []);
      
      // Save connection state for reconnection
      saveConnectionState();
    });
  };

  /* -------------------------------------------------------------
     COPY ROOM CODE
  ------------------------------------------------------------- */
  copyRoomBtn.onclick = async () => {
    if(!currentRoomId) return;
    await safeCopy(currentRoomId);
    copyRoomBtn.textContent = "✔";
    setTimeout(()=> copyRoomBtn.textContent = "📋", 1000);
  };

  /* -------------------------------------------------------------
     UPDATE PLAYERS LIST
  ------------------------------------------------------------- */
  function updatePlayers(players, hostSocketId){
    playersList.innerHTML = "";
    currentPlayerCount = players.length; // Update global player count

    if(kickSelect) kickSelect.innerHTML = `<option value="">Kick Player...</option>`;

    players.forEach(p=>{
      const li=document.createElement("li");
      li.className="player-row" + (p.ready?" player-ready":"");

      const av=document.createElement("div");
      av.className="avatar";
      av.style.background = colorGradient(p.avatarColor);
      av.style.color = p.avatarTextColor || "#ffffff";
      av.textContent = initials(p.name);

      const isHost = p.socketId === hostSocketId;
      const isYou = p.socketId === mySocketId;

      const info=document.createElement("div");
      info.innerHTML = `
        <div>${escapeHtml(p.name)}${isYou?" (You)":""}${isHost?' <span class="host-badge">👑 HOST</span>':""}</div>
        <div class="meta">${p.ready?"Ready":"Not Ready"}</div>
      `;

      li.append(av,info);
      playersList.appendChild(li);

      if(amHost && kickSelect && p.socketId !== mySocketId){
        const opt=document.createElement("option");
        opt.value=p.socketId;
        opt.textContent=p.name;
        kickSelect.appendChild(opt);
      }
    });

    playerCountInfo.textContent = `${players.length} players`;
    adminTools.classList.toggle("hidden", !amHost);
    readyBtn.style.display = amHost ? "none" : "";
    toggleRoomButtons();
  }

  /* -------------------------------------------------------------
   HOST: KICK PLAYER (with confirmation)
------------------------------------------------------------- */
kickBtn.onclick = () => {
  if (!amHost) return;

  const targetSocketId = kickSelect.value;
  if (!targetSocketId) {
    showCustomAlert({
      title: 'No Player Selected',
      message: 'Please select a player to kick from the dropdown.',
      icon: '👤',
      type: 'warning',
      confirmText: 'OK'
    });
    return;
  }

  const targetName =
    kickSelect.options[kickSelect.selectedIndex]?.text || "this player";

  showCustomAlert({
    title: 'Kick Player',
    message: `Are you sure you want to kick "${targetName}" from the room? This action cannot be undone.`,
    icon: '⚠️',
    type: 'warning',
    confirmText: 'Kick',
    cancelText: 'Cancel',
    showCancel: true,
    onConfirm: () => {
      socket.emit("kick_player", {
        roomId: currentRoomId,
        targetSocketId
      });
    }
  });
};


  /* -------------------------------------------------------------
     READY TOGGLE
  ------------------------------------------------------------- */
  readyBtn.onclick = () => {
  playClickSound(); // 🔊 Button click sound
  
  if (amHost) return;

  isReady = !isReady;

  readyBtn.textContent = isReady ? "Unready" : "Ready";
  readyBtn.classList.toggle("active", isReady);

  socket.emit("toggle_ready", {
    roomId: currentRoomId,
    ready: isReady
  });
};

  /* -------------------------------------------------------------
     HOST: START GAME
  ------------------------------------------------------------- */
  let currentPlayerCount = 0; // Track current player count

  startGameBtn.onclick = (e) => {
    if(!amHost) {
      showCustomAlert({
        title: 'Host Only',
        message: 'Only the host can start the game.',
        icon: '🚫',
        type: 'warning',
        confirmText: 'OK'
      });
      return;
    }

    // If button is in cancel mode, show cancel confirmation
    if (startGameBtn.classList.contains('cancel-mode')) {
      e.stopPropagation();
      showCustomAlert({
        title: 'Cancel Game Start',
        message: 'Are you sure you want to cancel starting the game?',
        icon: '⏸️',
        type: 'warning',
        confirmText: 'Yes, Cancel',
        cancelText: 'No, Continue',
        showCancel: true,
        onConfirm: () => {
          socket.emit("cancel_start", { roomId: currentRoomId });
          startGameBtn.textContent = "START GAME";
          startGameBtn.classList.remove('cancel-mode');
        }
      });
      return;
    }

    // Check minimum player count
    if (currentPlayerCount < 3) {
      showCustomAlert({
        title: 'Not Enough Players',
        message: `You need at least 3 players to start the game. Currently ${currentPlayerCount} player${currentPlayerCount === 1 ? '' : 's'} in the room.`,
        icon: '👥',
        type: 'warning',
        confirmText: 'OK'
      });
      return;
    }

    // Get number of rounds from dropdown
    const numRounds = Number(document.getElementById('ruleNumRounds').value);
    
    let customQuestions = null;
    
    // Handle Custom Mode validation
    if (currentRoomMode === "custom") {
      // PART 4: EDGE CASE PROTECTION - Never trust client state
      // Always re-validate on start attempt with hardened logic
      const normalizedValue = questionInput.value.replace(/\r/g, ""); // CASE 5: Windows line endings
      const lines = normalizedValue.split('\n');
      
      const processedQuestions = [];
      const seenQuestions = new Set();
      
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim(); // CASE 4: Blank lines at top/bottom
        
        if (line.length === 0) continue; // Skip empty lines
        
        line = line.replace(/\s+/g, ' '); // Collapse multiple spaces
        
        // HARDENED VALIDATION: All edge cases
        if (line.length < 5 || line.length > 120) continue; // Length validation
        if (/^[^\w\s]*$/.test(line)) continue; // Punctuation-only rejection
        
        const normalized = line.toLowerCase().trim();
        if (seenQuestions.has(normalized)) continue; // Duplicate detection
        
        seenQuestions.add(normalized);
        processedQuestions.push(line);
      }
      
      // CASE 1 & 6: Strict count enforcement - NEVER trust client validation
      if (processedQuestions.length !== numRounds) {
        showCustomAlert({
          title: 'Invalid Questions',
          message: `You must enter exactly ${numRounds} valid questions. Currently have ${processedQuestions.length} valid questions.`,
          icon: '❌',
          type: 'error',
          confirmText: 'OK'
        });
        return;
      }
      
      customQuestions = processedQuestions;
    }

    socket.emit("start_game", {
      roomId: currentRoomId,
      question: currentRoomMode === "normal" ? questionInput.value.trim() : null,
      customQuestions: customQuestions,
      minPlayers: Number(ruleMinPlayers.value),
      turnTime: Number(ruleTurnTime.value)*1000,
      multiplier: Number(ruleMultiplier.value),
      numRounds
    });

    // Change Start Game button to Cancel button
    startGameBtn.textContent = "CANCEL START";
    startGameBtn.classList.add('cancel-mode');
    startGameBtn.disabled = false;
  };

  cancelStartBtn.onclick = () => {
    socket.emit("cancel_start", { roomId: currentRoomId });
    cancelStartBtn.classList.add("hidden");
    startGameBtn.textContent = "START GAME";
    startGameBtn.classList.remove('cancel-mode');
  };

  /* -------------------------------------------------------------
     SERVER EVENTS
  ------------------------------------------------------------- */
  socket.on("connect", ()=> { 
    mySocketId = socket.id;
    
    console.log("[connect] Socket connected, ID:", mySocketId);
    console.log("[connect] Checking for reconnection data...");
    console.log("[connect] currentRoomId:", currentRoomId);
    console.log("[connect] playerToken:", playerToken ? "exists" : "null");
    
    // Attempt reconnection if we have stored credentials
    attemptReconnection();
  });
  
  /* -------------------------------------------------------------
     RECONNECTION SYSTEM
  ------------------------------------------------------------- */
  function saveConnectionState() {
    try {
      if (currentRoomId && playerToken && myName) {
        localStorage.setItem("cw_reconnect_room", currentRoomId);
        localStorage.setItem("cw_reconnect_token", playerToken);
        localStorage.setItem("cw_reconnect_name", myName);
        localStorage.setItem("cw_reconnect_color", myAvatarColor);
        localStorage.setItem("cw_reconnect_textcolor", myAvatarTextColor);
      }
    } catch (e) {
      console.log("Could not save connection state");
    }
  }
  
  function clearConnectionState() {
    try {
      localStorage.removeItem("cw_reconnect_room");
      localStorage.removeItem("cw_reconnect_token");
      localStorage.removeItem("cw_reconnect_name");
      localStorage.removeItem("cw_reconnect_color");
      localStorage.removeItem("cw_reconnect_textcolor");
    } catch (e) {
      console.log("Could not clear connection state");
    }
  }
  
  function attemptReconnection() {
    try {
      const savedRoomId = localStorage.getItem("cw_reconnect_room");
      const savedToken = localStorage.getItem("cw_reconnect_token");
      const savedName = localStorage.getItem("cw_reconnect_name");
      const savedColor = localStorage.getItem("cw_reconnect_color");
      const savedTextColor = localStorage.getItem("cw_reconnect_textcolor");
      
      console.log("[attemptReconnection] Checking localStorage...");
      console.log("[attemptReconnection] savedRoomId:", savedRoomId);
      console.log("[attemptReconnection] savedToken:", savedToken ? "exists" : "null");
      console.log("[attemptReconnection] savedName:", savedName);
      
      if (!savedRoomId || !savedToken || !savedName) {
        console.log("[attemptReconnection] Missing reconnection data, skipping");
        return; // No reconnection data
      }
      
      console.log("[attemptReconnection] Attempting to reconnect to room:", savedRoomId);
      
      // Show reconnecting banner
      showConnectionBanner("Reconnecting to your game...", "reconnecting");
      
      socket.emit("attempt_reconnect", { 
        roomId: savedRoomId, 
        playerToken: savedToken 
      }, (res) => {
        console.log("[attemptReconnection] Server response:", res);
        
        if (!res.ok) {
          // Reconnection failed
          clearConnectionState();
          hideConnectionBanner();
          
          if (res.error === "room_not_found") {
            showCustomAlert({
              title: 'Room Not Found',
              message: 'The room you were in no longer exists.',
              icon: '❌',
              type: 'error',
              confirmText: 'OK'
            });
          } else if (res.error === "invalid_token") {
            showCustomAlert({
              title: 'Cannot Reconnect',
              message: 'You were removed from the game due to disconnection.',
              icon: '⚠️',
              type: 'warning',
              confirmText: 'OK'
            });
          }
          return;
        }
        
        // Reconnection successful
        console.log("[reconnect] Successfully reconnected to room", savedRoomId);
        
        currentRoomId = res.roomId;
        playerToken = savedToken;
        myName = savedName;
        myAvatarColor = savedColor || "#4d73ff";
        myAvatarTextColor = savedTextColor || "#ffffff";
        currentRoomMode = res.mode || "normal";
        amHost = (res.room.hostSocketId === mySocketId);
        
        // Update room display
        roomIdDisplay.textContent = currentRoomId;
        updateRoomModeDisplay(currentRoomMode);
        updateQuestionInputVisibility();
        
        // Don't call enterRoomUI() here - wait for reconnect_state to restore UI
        // The reconnect_state event will handle showing the correct UI based on game state
        
        updatePlayers(res.players, res.room.hostSocketId);
        updateLeaderboard(res.room.leaderboard || []);
        
        // Show success banner briefly
        showConnectionBanner("Reconnected successfully!", "reconnected");
        setTimeout(() => {
          hideConnectionBanner();
        }, 2000);
      });
    } catch (e) {
      console.log("Reconnection attempt failed", e);
    }
  }
  
  function showConnectionBanner(message, type = "default") {
    const banner = document.getElementById("connectionBanner");
    const text = document.getElementById("connectionBannerText");
    
    if (!banner || !text) return;
    
    text.textContent = message;
    banner.className = "connection-banner";
    
    if (type === "reconnecting") {
      banner.classList.add("reconnecting");
    } else if (type === "reconnected") {
      banner.classList.add("reconnected");
    }
    
    banner.classList.remove("hidden");
  }
  
  function hideConnectionBanner() {
    const banner = document.getElementById("connectionBanner");
    if (banner) {
      banner.classList.add("hidden");
    }
  }
  
  // Handle disconnect event
  socket.on("disconnect", (reason) => {
    console.log("[disconnect]", reason);
    
    if (currentRoomId && playerToken) {
      showConnectionBanner("Connection lost. Attempting to reconnect...", "reconnecting");
    }
  });
  
  // Handle reconnect event
  socket.on("reconnect", () => {
    console.log("[reconnect] Socket reconnected");
    attemptReconnection();
  });

  socket.on("room_update", ({ players, leaderboard, mode, hostSocketId, state }) => {
  updatePlayers(players, hostSocketId);
  updateLeaderboard(leaderboard);
  roomIdDisplay.textContent = currentRoomId || "";
  
  if (mode) {
    currentRoomMode = mode;
    updateRoomModeDisplay(mode);
    updateQuestionInputVisibility();
  }

  if (amHost) {
    show(startGameBtn);
    hide(readyBtn);
  } else {
    hide(startGameBtn);
    show(readyBtn);
  }
  
  // Update question input visibility when host status or mode changes
  updateQuestionInputVisibility();

  // CLIENT-SIDE UX: Disable chat during "starting" and "in_round" states
  if (state === "starting" || state === "in_round") {
    chatInput.disabled = true;
    chatSendBtn.disabled = true;
    chatInput.placeholder = "Chat disabled during round";
  } else {
    chatInput.disabled = false;
    chatSendBtn.disabled = false;
    chatInput.placeholder = "Message…";
  }

  // Update contextual helpers based on state
  updateContextualHelpers(state);
});

  socket.on("left_room", () => {
  currentRoomId = null;
  currentRoundId = null;
  playerToken = null; // Clear token
  amHost = false;
  hide(startGameBtn);
  hide(readyBtn);

  // Clear connection state
  clearConnectionState();

  // FULL UI RESET
  hide(gameArea);
  hide(resultsArea);
  hide(rankingArea);
  hide(turnArea);
  resetToLobbyUI();
  show(controlsWrapper);
  hide(roomPanel);

  hasAnsweredThisRound = false;
  submitAnswerBtn.disabled = false;
  startGameBtn.disabled = false;

  answerFeedback.textContent = "";
  questionInput.value = "";

  removeRoomButtons();
});


  socket.on("room_closed", () => {
    currentRoomId = null;
    playerToken = null; // Clear token
    amHost = false;
    hide(startGameBtn);
    hide(readyBtn);
    
    // Clear connection state
    clearConnectionState();
    
    resetToLobbyUI();
    exitRoomUI();
    showCustomAlert({
      title: "Room Closed",
      message: "The host has closed this room.",
      confirmText: "OK"
    });
  });
  
  /* -------------------------------------------------------------
   YOU WERE KICKED FROM ROOM
------------------------------------------------------------- */
socket.on("kicked_from_room", ({ reason }) => {
  showCustomAlert({
    title: "Kicked from Room",
    message: reason || "You were kicked from the room.",
    confirmText: "OK"
  });

  currentRoomId = null;
  playerToken = null; // Clear token
  amHost = false;
  
  // Clear connection state
  clearConnectionState();

  // Reset UI safely
  hide(gameArea);
  hide(resultsArea);
  hide(rankingArea);
  hide(turnArea);
  hide(roomPanel);
  resetToLobbyUI();
  show(controlsWrapper);
  show(chatPanel);

  removeRoomButtons();

  hasAnsweredThisRound = false;
  submitAnswerBtn.disabled = false;
  startGameBtn.disabled = false;

  answerFeedback.textContent = "";
  questionInput.value = "";

  setLobbyMode();
});


  // -------------------------------------------------------------
// TIME UP (auto-timeout feedback)
// -------------------------------------------------------------
socket.on("time_up", () => {
  if (turnTimeout) {
  clearTimeout(turnTimeout);
  turnTimeout = null;
}

  if (activeTurnInterval) {
  clearInterval(activeTurnInterval);
  activeTurnInterval = null;
}

  turnTimer.classList.add("hidden");
  turnTimerText.classList.add("hidden");
  answerFeedback.textContent = "⏰ Time’s up! You missed your turn.";
  hide(answerForm);
  answerInput.disabled = true;
  submitAnswerBtn.disabled = true;

});


  // -------------------------------------------------------------
// RETURN TO LOBBY (after game ends)
// -------------------------------------------------------------
socket.on("return_to_lobby", () => {
  // Reset ready state
  isReady = false;
  readyBtn.textContent = "✔ Ready";
  readyBtn.classList.remove("active");
  
  // Reset host/player button states
  if (amHost) {
    startGameBtn.textContent = "START GAME";
    startGameBtn.classList.remove("cancel-mode");
    show(startGameBtn);
    hide(readyBtn);
  } else {
    show(readyBtn);
    hide(startGameBtn);
  }
  
  resetToLobbyUI();
});


socket.on("force_ready_reset", () => {
  isReady = false;
  readyBtn.textContent = "Ready";
  readyBtn.classList.remove("active");
});


  /* -------------------------------------------------------------
     GAME STARTED
  ------------------------------------------------------------- */
  socket.on("game_started", ({
  hostSocketId,
  judgeSocketId,
  roundId,
  question,
  difficulty,
  turnOrder,
  currentRoundIndex,
  totalRounds
}) => {

  const nextBtn = document.getElementById("hostNextRoundBtn");
  if (nextBtn) nextBtn.remove();
hide(avatarModal);

  // 🔒 HARD ROUND RESET
hasAnsweredThisRound = false;
answerInput.value = "";
hide(answerForm);
answerInput.disabled = true;
submitAnswerBtn.disabled = true;
answerFeedback.textContent = "";

hide(rankingArea);
hide(resultsArea);
hide(winnerCeremony);

  // ✅ FIX 2: Hide auto-return timer UI when game starts
  const autoReturnTimer = document.getElementById("autoReturnTimer");
  if (autoReturnTimer) {
    autoReturnTimer.style.display = "none";
  }

  // 🛑 Safety cleanup
if (turnTimeout) {
  clearTimeout(turnTimeout);
  turnTimeout = null;
}
if (activeTurnInterval) {
  clearInterval(activeTurnInterval);
  activeTurnInterval = null;
}


  setGameMode();
  showGameCoreUI();

  // Hide ready button and start game button during game
  hide(readyBtn);
  hide(startGameBtn);
  readyBtn.style.display = "none"; // Force hide with inline style
  startGameBtn.style.display = "none"; // Force hide with inline style


  // ✅ STOP READY COUNTDOWN
  if (countdownTimerInterval) {
    clearInterval(countdownTimerInterval);
    countdownTimerInterval = null;
  }

  const countdownEl =
  document.getElementById("roomCountdownText") ||
  document.getElementById("lobbyCountdownText");

  if (countdownEl) countdownEl.classList.add("hidden");

  // Reset Start Game button if host
  if (amHost) {
    startGameBtn.textContent = "START GAME";
    startGameBtn.classList.remove('cancel-mode');
  }

  // ✅ NORMAL GAME START LOGIC
  currentRoundId = roundId;
  amHost = (hostSocketId === mySocketId);
  currentJudgeId = judgeSocketId;
  
if (mySocketId === currentJudgeId) {
  gamePlayerMeta.textContent = "You are the Judge 👑";
} else {
  gamePlayerMeta.textContent = `${turnOrder.length} players answering`;
}

  submitAnswerBtn.disabled = (mySocketId === judgeSocketId);
  answerInput.disabled = (mySocketId === judgeSocketId);
  answerFeedback.textContent = "";

  const difficultyLabel =
  difficulty === "easy"   ? "🟢 Easy" :
  difficulty === "medium" ? "🟡 Medium" :
                            "🔴 Hard";

gameQuestion.innerHTML = `
  ${escapeHtml(question)}
  <div class="question-difficulty">${difficultyLabel}</div>
`;


  gameMeta.textContent = `Round ${currentRoundIndex}/${totalRounds}`;

  hide(rankingArea);
  hide(resultsArea);
  show(turnArea);

  // 🔊 Play round start sound
  playRoundStartSound();
  
  showRoundIntro(question);
});


  function showRoundIntro(text){
    roundIntroText.textContent = text;
    roundIntro.classList.add("show");
    setTimeout(()=> roundIntro.classList.remove("show"),1500);
  }

  /* -------------------------------------------------------------
     YOUR TURN TIMER
  ------------------------------------------------------------- */
  socket.on("your_turn", ({ time }) => {
  const bar = turnTimer.querySelector("i");

  // Reset visuals
  turnTimer.classList.remove("hidden");
  turnTimerText.classList.remove("hidden");

  bar.style.transition = "none";
  bar.style.transform = "scaleX(1)";

  // Force reflow
  requestAnimationFrame(() => {
    bar.style.transition = `transform ${time}ms linear`;
    bar.style.transform = "scaleX(0)";
  });

  // Numeric countdown
  let seconds = Math.ceil(time / 1000);
  turnTimerText.textContent = seconds;

  if (activeTurnInterval) clearInterval(activeTurnInterval);
activeTurnInterval = setInterval(() => {
  seconds--;
  turnTimerText.textContent = seconds;

  if (seconds <= 0) {
    clearInterval(activeTurnInterval);
    activeTurnInterval = null;
    turnTimerText.textContent = "0";
  }
}, 1000);


  // Safety cleanup
  turnTimeout = setTimeout(() => {
  if (activeTurnInterval) {
    clearInterval(activeTurnInterval);
    activeTurnInterval = null;
  }
  turnTimer.classList.add("hidden");
  turnTimerText.classList.add("hidden");
}, time + 100);
}); 




  socket.on("next_turn", ({ socketId, name, index }) => {
    
    if (turnTimeout) {
  clearTimeout(turnTimeout);
  turnTimeout = null;
}

    if (activeTurnInterval) {
  clearInterval(activeTurnInterval);
  activeTurnInterval = null;
}

    turnTimer.classList.add("hidden");
    turnTimerText.classList.add("hidden");
    const isMyTurn = socketId === mySocketId;
    const isJudge = mySocketId === currentJudgeId;
    answerInput.disabled = !isMyTurn || isJudge;
    submitAnswerBtn.disabled = !isMyTurn || isJudge;



    if(socketId === mySocketId){
      turnText.textContent = `Your turn (#${index})`;
      show(answerForm);
      answerInput.value = "";
    } else {
      turnText.textContent = `${name} is answering…`;
      hide(answerForm);
    }
  });

  /* -------------------------------------------------------------
     SUBMIT ANSWER
  ------------------------------------------------------------- */

  // ✅ FIX 1: Allow Enter key to submit answer
  answerInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      
      // Only allow if it's this player's turn and they haven't answered
      if (answerInput.disabled || submitAnswerBtn.disabled || hasAnsweredThisRound) {
        return;
      }
      
      // Trigger the same submit logic
      submitAnswerBtn.click();
    }
  });

submitAnswerBtn.onclick = () => {
  playClickSound(); // 🔊 Button click sound
  
  if (turnTimeout) {
  clearTimeout(turnTimeout);
  turnTimeout = null;
}

  turnTimerText.classList.add("hidden");

  if (hasAnsweredThisRound) return;

  const ans = answerInput.value.trim();
  if (!ans) {
    answerFeedback.textContent = "Enter an answer!";
    return;
  }

  submitAnswerBtn.disabled = true;

  socket.emit(
    "submit_answer",
    {
      roomId: currentRoomId,
      roundId: currentRoundId,
      answer: ans
    },
    (res) => {
      if (!res?.ok) {
        submitAnswerBtn.disabled = false;

        if (res.error === "duplicate_answer") {
          answerFeedback.textContent =
            "Another player already entered that answer. Please enter a different one.";
        } else {
          answerFeedback.textContent = "Answer rejected. Try again.";
        }
        return;
      }

      turnTimer.classList.add("hidden");

      if (activeTurnInterval) {
  clearInterval(activeTurnInterval);
  activeTurnInterval = null;
}
      hasAnsweredThisRound = true;
      hide(answerForm);
    }
  );
};


  /* -------------------------------------------------------------
     SIMILARITY DETECTION (CLIENT-SIDE UI ENHANCEMENT)
  ------------------------------------------------------------- */
  function detectSimilarAnswers(answers) {
    // Normalize and extract keywords from an answer
    function extractKeywords(text) {
      if (!text || text === "(No Answer)") return [];
      
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove punctuation
        .trim()
        .split(/\s+/)
        .filter(word => word.length >= 3); // Ignore short words
    }

    // Calculate keyword overlap percentage between two answers
    function calculateOverlap(keywords1, keywords2) {
      if (keywords1.length === 0 || keywords2.length === 0) return 0;
      
      const set1 = new Set(keywords1);
      const set2 = new Set(keywords2);
      
      let commonCount = 0;
      for (const word of set1) {
        if (set2.has(word)) commonCount++;
      }
      
      const totalUnique = Math.max(set1.size, set2.size);
      return totalUnique > 0 ? (commonCount / totalUnique) : 0;
    }

    // Extract keywords for all answers
    const answerData = answers.map(a => ({
      answerId: a.answerId,
      text: a.text,
      keywords: extractKeywords(a.text),
      isSimilar: false
    }));

    // Compare all pairs (O(n²) - acceptable for small n)
    for (let i = 0; i < answerData.length; i++) {
      for (let j = i + 1; j < answerData.length; j++) {
        const overlap = calculateOverlap(
          answerData[i].keywords,
          answerData[j].keywords
        );
        
        // 60% threshold for similarity
        if (overlap >= 0.6) {
          answerData[i].isSimilar = true;
          answerData[j].isSimilar = true;
        }
      }
    }

    // Return map of answerId -> isSimilar
    const similarityMap = {};
    answerData.forEach(a => {
      similarityMap[a.answerId] = a.isSimilar;
    });
    
    return similarityMap;
  }

  /* -------------------------------------------------------------
     RANKING TIMER
  ------------------------------------------------------------- */
  function startRankingTimer(rankingTime) {
    // Clear any existing ranking timer
    if (rankingTimerInterval) {
      clearInterval(rankingTimerInterval);
      rankingTimerInterval = null;
    }
    if (rankingTimeout) {
      clearTimeout(rankingTimeout);
      rankingTimeout = null;
    }

    // Create or get timer display element
    let rankingTimerDisplay = document.getElementById("rankingTimerDisplay");
    if (!rankingTimerDisplay) {
      rankingTimerDisplay = document.createElement("div");
      rankingTimerDisplay.id = "rankingTimerDisplay";
      rankingTimerDisplay.className = "ranking-timer-display";
      
      // Insert at the top of game area
      const gameArea = document.getElementById("gameArea");
      if (gameArea) {
        gameArea.insertBefore(rankingTimerDisplay, gameArea.firstChild);
      }
    }

    let remainingSeconds = Math.ceil(rankingTime / 1000);
    
    // Update display immediately
    const isJudge = (mySocketId === currentJudgeId);
    rankingTimerDisplay.textContent = isJudge 
      ? `⏱️ Rank answers: ${remainingSeconds}s` 
      : `⏱️ Judge ranking: ${remainingSeconds}s`;
    rankingTimerDisplay.classList.remove("hidden");
    rankingTimerDisplay.classList.remove("warning");

    // Start countdown
    rankingTimerInterval = setInterval(() => {
      remainingSeconds--;
      
      // 🔊 Play tick sound for last 5 seconds
      if (remainingSeconds <= 0) {
        clearInterval(rankingTimerInterval);
        rankingTimerInterval = null;
        rankingTimerDisplay.textContent = isJudge 
          ? "⏱️ Time's up! Auto-ranking..." 
          : "⏱️ Time's up! Auto-ranking...";
        
        // Hide after 2 seconds
        setTimeout(() => {
          rankingTimerDisplay.classList.add("hidden");
        }, 2000);
        return;
      }
      
      rankingTimerDisplay.textContent = isJudge 
        ? `⏱️ Rank answers: ${remainingSeconds}s` 
        : `⏱️ Judge ranking: ${remainingSeconds}s`;
      
      // Add warning class when time is running out
      if (remainingSeconds <= 10) {
        rankingTimerDisplay.classList.add("warning");
      }
    }, 1000);

    // Set timeout to hide timer
    rankingTimeout = setTimeout(() => {
      if (rankingTimerInterval) {
        clearInterval(rankingTimerInterval);
        rankingTimerInterval = null;
      }
    }, rankingTime + 2000);
  }

  function clearRankingTimer() {
    if (rankingTimerInterval) {
      clearInterval(rankingTimerInterval);
      rankingTimerInterval = null;
    }
    if (rankingTimeout) {
      clearTimeout(rankingTimeout);
      rankingTimeout = null;
    }
    
    const rankingTimerDisplay = document.getElementById("rankingTimerDisplay");
    if (rankingTimerDisplay) {
      rankingTimerDisplay.classList.add("hidden");
    }
  }

  /* -------------------------------------------------------------
     ENTER RANKING
  ------------------------------------------------------------- */
  socket.on("enter_ranking", ({ answersAnon, rankingTime }) => {
    // ✅ FIX 3: Reset ranking phase ended flag when entering ranking
    rankingPhaseEnded = false;
    
    // ✅ Reset submit button to normal state
    if (submitRankBtn) {
      submitRankBtn.disabled = false;
      submitRankBtn.textContent = "Submit"; // Reset button text to original
    }
    
    // ✅ Clear any previous feedback messages
    if (rankFeedback) {
      rankFeedback.textContent = "";
      rankFeedback.style.color = ""; // Reset color
    }
    
    // Start ranking timer for all players
    if (rankingTime) {
      startRankingTimer(rankingTime);
    }
    
    if (mySocketId !== currentJudgeId) {
      turnText.textContent = "Judge is ranking answers…";
      return;
    }
    show(rankingArea);

    anonAnswersDiv.innerHTML = "";

    // CLIENT-SIDE: Filter out timed-out answers
    const validAnswers = answersAnon.filter(a => a.text !== "(No Answer)" && !a.timedOut);
    const timedOutCount = answersAnon.length - validAnswers.length;

    // Show warning message if players timed out
    if (timedOutCount > 0) {
      const warning = document.createElement("div");
      warning.className = "timeout-warning";
      warning.innerHTML = `⚠️ ${timedOutCount} player${timedOutCount > 1 ? 's' : ''} did not answer and will receive 0 points.`;
      anonAnswersDiv.appendChild(warning);
    }

    // First-time tooltip: Judge ranking hint
    if (!onboardingState.shownJudgeHint) {
      setTimeout(() => {
        showOnboardingTooltip("You are the Judge. Rank answers from best to worst.", rankingArea);
        onboardingState.shownJudgeHint = true;
        checkOnboardingComplete();
      }, 500);
    }

    // CLIENT-SIDE: Detect similar answers for UI enhancement (valid answers only)
    const similarityMap = detectSimilarAnswers(validAnswers);

    validAnswers.forEach(a=>{
      const card = document.createElement("div");
      card.className = "anon-card";

      const text=document.createElement("div");
      text.textContent=a.text;

      // Add similarity badge if detected
      if (similarityMap[a.answerId]) {
        const badge = document.createElement("span");
        badge.className = "similarity-badge";
        badge.textContent = "🔁 Similar";
        badge.title = "This answer shares concepts with another answer";
        text.appendChild(badge);
      }

      const sel=document.createElement("select");
      sel.dataset.id=a.answerId;

      sel.innerHTML = `<option value="">Rank</option>`;
      for(let i=1;i<=validAnswers.length;i++)
        sel.innerHTML+=`<option>${i}</option>`;

      card.append(text,sel);
      anonAnswersDiv.appendChild(card);
    });
  });

  submitRankBtn.onclick = () => {
    playClickSound(); // 🔊 Button click sound
    
    // ✅ FIX 3: Prevent submission if ranking phase already ended
    if (rankingPhaseEnded) {
      console.log("[submitRankBtn] Ranking phase already ended, ignoring click");
      return;
    }
    
    const selects = [...anonAnswersDiv.querySelectorAll("select")];
    const ranks = [];

    // EDGE CASE: If no selects (all players timed out), submit empty ranks
    if (selects.length === 0) {
      clearRankingTimer(); // Clear timer
      socket.emit("submit_rank", { roomId: currentRoomId, roundId: currentRoundId, ranks: [] });
      hide(rankingArea);
      rankingPhaseEnded = true; // Mark as ended
      return;
    }

    for(const s of selects){
      if(!s.value) return rankFeedback.textContent = "Rank all answers!";
      ranks.push({ answerId:s.dataset.id, rank:Number(s.value) });
    }

    // check unique ranks
    const sorted = ranks.map(r=>r.rank).sort((a,b)=>a-b);
    for(let i=0;i<sorted.length;i++)
      if(sorted[i] !== i+1)
        return rankFeedback.textContent="Ranks must be unique!";

    clearRankingTimer(); // Clear timer
    socket.emit("submit_rank", { roomId: currentRoomId, roundId: currentRoundId, ranks });
    hide(rankingArea);
  };

  /* -------------------------------------------------------------
     ROUND RESULTS
  ------------------------------------------------------------- */
  socket.on("ranking_result", ({ results, leaderboard, roundsRemaining }) => {

  // 🔊 Play reveal sound when results appear
  playRevealSound();
  
  // ✅ Ensure ranking area is hidden when results are shown
  hide(rankingArea);
  
  show(resultsArea);

  // Hide turn messages when results are displayed
  hide(turnArea);
  turnText.textContent = "";
  gamePlayerMeta.textContent = ""; // Clear judge/player status text

  revealResultsSequentially(
    [...results].sort((a, b) => b.rank - a.rank)
  );

  updateLeaderboard(leaderboard);

  let nextBtn = document.getElementById("hostNextRoundBtn");

  if (amHost && roundsRemaining) {
    if (!nextBtn) {
      nextBtn = document.createElement("button");
      nextBtn.id = "hostNextRoundBtn";
      nextBtn.className = "btn small";
      nextBtn.textContent = "Next Round ▶";
      nextBtn.onclick = () => {
        playClickSound(); // 🔊 Button click sound
        socket.emit("host_next_round", { roomId: currentRoomId });
      };

      resultsArea.appendChild(nextBtn);
    }

    nextBtn.style.display = "inline-block";
  } else if (nextBtn) {
    nextBtn.style.display = "none";
  }
});


  socket.on("judge_bonus", ({ points }) => {
    if (typeof points !== "number") return;
    
    // Only the judge receives this event
    const msg = `🏅 You received +${points} judge bonus points!`;
    showSystemToast(msg);
  });

  socket.on("player_points_earned", ({ points, rank, totalAnswers }) => {
    if (typeof points !== "number") return;
    
    const msg = `🎯 You earned +${points} points! (Rank ${rank}/${totalAnswers})`;
    showSystemToast(msg);
  });

  socket.on("next_round_countdown", ({ seconds }) => {
    let countdownEl = document.getElementById("nextRoundCountdown");
    
    if (!countdownEl) {
      countdownEl = document.createElement("div");
      countdownEl.id = "nextRoundCountdown";
      countdownEl.className = "next-round-countdown";
      resultsArea.appendChild(countdownEl);
    }
    
    if (seconds > 0) {
      countdownEl.textContent = `Next round starts in ${seconds}s...`;
      countdownEl.style.display = "block";
    } else {
      countdownEl.style.display = "none";
    }
  });

  socket.on("game_ended", ({ leaderboard }) => {

  // 🔊 Play victory sound
  playVictorySound();
  
  // Clear next round countdown if it exists
  const countdownEl = document.getElementById("nextRoundCountdown");
  if (countdownEl) {
    countdownEl.style.display = "none";
  }

  // 🏆 WINNER CEREMONY
  show(winnerCeremony);

  const [first, second, third] = leaderboard;

  winnerFirst.textContent = first?.name || "";
  winnerSecond.textContent = second?.name || "";
  winnerThird.textContent = third?.name || "";

  winnerFirst.classList.remove("winner-pulse");

  // Show other players (4th place and below)
  const otherPlayersDiv = document.getElementById("otherPlayers");
  if (leaderboard.length > 3) {
    const otherPlayers = leaderboard.slice(3);
    otherPlayersDiv.innerHTML = '<div class="other-players-title">Other Players</div>';
    
    otherPlayers.forEach((player, index) => {
      const position = index + 4;
      const playerEl = document.createElement("div");
      playerEl.className = "other-player-item";
      playerEl.innerHTML = `
        <span class="position">${position}th</span>
        <span class="player-name">${escapeHtml(player.name)}</span>
        <span class="player-score">${player.score} pts</span>
      `;
      otherPlayersDiv.appendChild(playerEl);
    });
    
    otherPlayersDiv.style.display = "block";
  } else {
    otherPlayersDiv.style.display = "none";
  }

  setTimeout(() => {
    winnerFirst.classList.add("winner-pulse");
  }, 500);

  launchConfetti(winnerCeremony);

  // ⏳ After ceremony → show results
  setTimeout(() => {
    hide(winnerCeremony);

    updateLeaderboard(leaderboard);
    show(resultsArea);

    // Highlight winner in leaderboard
    const firstItem = leaderboardDiv.querySelector(".leaderboard-item");
    if (firstItem) firstItem.classList.add("winner");

  }, 4000);

  // 🎮 Show "Exit to Room" button for everyone (including host)
  if (!exitLobbyBtn) {
    exitLobbyBtn = document.createElement("button");
    exitLobbyBtn.className = "btn ghost small";
    exitLobbyBtn.textContent = "⬅ Exit to Room";
    exitLobbyBtn.onclick = () => {
      // Notify server to reset ready state - server will send return_to_lobby
      socket.emit("manual_exit_to_lobby", { roomId: currentRoomId });
    };
    resultsArea.appendChild(exitLobbyBtn);
  }
  exitLobbyBtn.style.display = "";

  // Hide host's end game button if it exists
  if (endGameBtn) {
    endGameBtn.style.display = "none";
  }

  // Display 30-second countdown timer
  let autoReturnTimer = document.getElementById("autoReturnTimer");
  if (!autoReturnTimer) {
    autoReturnTimer = document.createElement("div");
    autoReturnTimer.id = "autoReturnTimer";
    autoReturnTimer.style.cssText = `
      margin-top: 16px;
      padding: 12px 20px;
      background: rgba(244, 196, 48, 0.15);
      border: 2px solid rgba(244, 196, 48, 0.3);
      border-radius: 12px;
      color: var(--accent-gold);
      font-weight: 700;
      text-align: center;
      font-size: 15px;
    `;
    resultsArea.appendChild(autoReturnTimer);
  }
  autoReturnTimer.style.display = "";
  autoReturnTimer.textContent = "Returning to lobby in 30 seconds...";
});

  // Handle auto-return countdown updates
  socket.on("auto_return_countdown", ({ seconds }) => {
    const autoReturnTimer = document.getElementById("autoReturnTimer");
    if (autoReturnTimer) {
      autoReturnTimer.textContent = `Returning to lobby in ${seconds} second${seconds === 1 ? '' : 's'}...`;
    }
  });


  /* -------------------------------------------------------------
     LEADERBOARD
  ------------------------------------------------------------- */
  function updateLeaderboard(lb){
    leaderboardDiv.innerHTML="";
    const ul=document.createElement("ul");
    ul.className="leaderboard-list";

    lb.forEach(e=>{
      const li=document.createElement("li");
      li.className="leaderboard-item";
      li.innerHTML=`<div>${escapeHtml(e.name)}</div><div>${e.score}</div>`;
      ul.appendChild(li);
    });

    leaderboardDiv.appendChild(ul);
  }

  /* -------------------------------------------------------------
     CHAT
  ------------------------------------------------------------- */
  chatSendBtn.onclick = sendChat;
  chatInput.onkeydown = e => { if(e.key==="Enter") sendChat(); };

  function sendChat(){
    const msg = chatInput.value.trim();
    if(!msg) return;
    socket.emit("chat_message",{ roomId:currentRoomId, name:myName, text:msg });
    chatInput.value="";
  }

  socket.on("chat_message_broadcast",({name,text})=>{
    const msg=document.createElement("div");
    msg.className="chat-message";
    msg.innerHTML=`<b>${escapeHtml(name)}:</b> ${escapeHtml(text)}`;
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  });

  socket.on("start_countdown", ({ expiresAt, ready, total }) => {
  const countdownEl =
  document.getElementById("roomCountdownText") ||
  document.getElementById("lobbyCountdownText");

  if (!countdownEl) return;

  countdownReadyCount = ready;
  countdownTotal = total;

  countdownEl.classList.remove("hidden");

  function updateCountdown() {
    const secondsLeft = Math.max(
      0,
      Math.ceil((expiresAt - Date.now()) / 1000)
    );

    countdownEl.textContent =
      `Game starting in ${secondsLeft}s (${countdownReadyCount}/${countdownTotal} ready)`;

    if (secondsLeft <= 0) {
      clearInterval(countdownTimerInterval);
      countdownTimerInterval = null;
    }
  }

  updateCountdown();

  if (countdownTimerInterval) clearInterval(countdownTimerInterval);
  countdownTimerInterval = setInterval(updateCountdown, 1000);
});

  socket.on("ready_count_update", ({ ready, total }) => {
  countdownReadyCount = ready;
  countdownTotal = total;
}); 

socket.on("countdown_cancelled", () => {
  const countdownEl =
  document.getElementById("roomCountdownText") ||
  document.getElementById("lobbyCountdownText");

  if (countdownEl) countdownEl.classList.add("hidden");

  if (countdownTimerInterval) {
    clearInterval(countdownTimerInterval);
    countdownTimerInterval = null;
  }

  isReady = false;
  readyBtn.textContent = "Ready";
  readyBtn.classList.remove("active");

  if (amHost) {
    startGameBtn.disabled = false;
    startGameBtn.textContent = "START GAME";
    startGameBtn.classList.remove('cancel-mode');
  }
});

socket.on("start_error", ({ error }) => {
  // Reset start button state
  const startGameBtn = document.getElementById("startGameBtn");
  if (startGameBtn) {
    startGameBtn.textContent = "START GAME";
    startGameBtn.classList.remove('cancel-mode');
  }
  
  // Show specific error message based on server validation
  let errorMessage = "Failed to start game. Please check your settings.";
  let errorTitle = "Cannot Start Game";
  
  if (error === "invalid_custom_questions") {
    errorTitle = "Invalid Custom Questions";
    errorMessage = "Your custom questions failed server validation. Please ensure:\n• Exactly the right number of questions\n• Each question is 5-120 characters\n• No duplicate questions\n• No questions with only punctuation\n• No HTML or special characters";
  } else if (error === "invalid_num_rounds") {
    errorTitle = "Invalid Settings";
    errorMessage = "Invalid number of rounds selected. Please choose between 1-20 rounds.";
  } else if (error === "invalid_room_state") {
    errorTitle = "Room Not Ready";
    errorMessage = "The room is not in the correct state to start a game.";
  }
  
  showCustomAlert({
    title: errorTitle,
    message: errorMessage,
    icon: '❌',
    type: 'error',
    confirmText: 'OK'
  });
});

  /* -------------------------------------------------------------
     DISCONNECT/RECONNECT EVENTS
  ------------------------------------------------------------- */
  socket.on("player_disconnected", ({ socketId, name, temporary }) => {
    if (temporary) {
      showSystemToast(`${name} disconnected (reconnecting...)`, 3000);
    }
  });
  
  socket.on("player_permanently_disconnected", ({ socketId, name }) => {
    showSystemToast(`${name} left the game`, 2500);
  });
  
  socket.on("player_reconnected", ({ socketId, name }) => {
    showSystemToast(`${name} reconnected!`, 2500);
  });
  
  /* -------------------------------------------------------------
     STATE REHYDRATION ON RECONNECT
  ------------------------------------------------------------- */
  socket.on("reconnect_state", (data) => {
    console.log("[reconnect_state]", data.roomState);
    restoreGameState(data);
  });
  
  /* -------------------------------------------------------------
     RESTORE GAME STATE (Shared Logic)
  ------------------------------------------------------------- */
  function restoreGameState(data) {
    console.log("[restoreGameState] Called with data:", data);
    console.log("[restoreGameState] roomState:", data.roomState);
    
    // Update global state
    currentJudgeId = data.judgeSocketId;
    amHost = (data.hostSocketId === mySocketId);
    
    console.log("[restoreGameState] Showing room UI...");
    
    // Ensure room UI is shown (hide intro, show room panel)
    hide(controlsWrapper);
    show(roomPanel);
    show(chatPanel);
    addRoomButtons();
    
    console.log("[restoreGameState] Switching on roomState:", data.roomState);
    
    switch (data.roomState) {
      case "lobby":
        setLobbyMode();
        hide(gameArea);
        show(roomPanel);
        updateContextualHelpers("lobby");
        break;
        
      case "starting":
        setLobbyMode();
        show(roomPanel);
        
        // Restore countdown timer
        if (data.startingData && data.startingData.expiresAt) {
          const expiresAt = data.startingData.expiresAt;
          const secondsLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
          
          if (secondsLeft > 0) {
            const countdownEl = document.getElementById("roomCountdownText") || 
                               document.getElementById("lobbyCountdownText");
            
            if (countdownEl) {
              countdownEl.classList.remove("hidden");
              
              function updateCountdown() {
                const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
                countdownEl.textContent = `Game starting in ${remaining}s`;
                
                if (remaining <= 0) {
                  clearInterval(countdownTimerInterval);
                  countdownTimerInterval = null;
                }
              }
              
              updateCountdown();
              
              if (countdownTimerInterval) clearInterval(countdownTimerInterval);
              countdownTimerInterval = setInterval(updateCountdown, 1000);
            }
          }
        }
        break;
        
      case "in_round":
        if (!data.inRoundData) break;
        
        setGameMode();
        showGameCoreUI();
        
        const roundData = data.inRoundData;
        currentRoundId = roundData.roundId;
        
        // Render question
        const difficultyLabel =
          roundData.difficulty === "easy"   ? "🟢 Easy" :
          roundData.difficulty === "medium" ? "🟡 Medium" :
                                              "🔴 Hard";
        
        gameQuestion.innerHTML = `
          ${escapeHtml(roundData.question)}
          <div class="question-difficulty">${difficultyLabel}</div>
        `;
        
        gameMeta.textContent = `Round ${data.currentRoundIndex + 1}/${data.totalRounds}`;
        
        // Restore role-based UI
        if (roundData.isJudge) {
          gamePlayerMeta.textContent = "You are the Judge 👑";
          
          console.log("[restoreGameState] ===== JUDGE RECONNECTION DEBUG =====");
          console.log("[restoreGameState] Judge detected: TRUE");
          console.log("[restoreGameState] phase:", roundData.phase);
          console.log("[restoreGameState] answersForRanking:", roundData.answersForRanking);
          console.log("[restoreGameState] answersForRanking exists:", !!roundData.answersForRanking);
          console.log("[restoreGameState] answersForRanking length:", roundData.answersForRanking?.length);
          console.log("[restoreGameState] Full roundData:", JSON.stringify(roundData, null, 2));
          console.log("[restoreGameState] =====================================");
          
          // Check if in ranking phase
          if (roundData.phase === "ranking" && roundData.answersForRanking) {
            console.log("[restoreGameState] ✅ Showing ranking UI for judge");
            // Restore ranking UI
            hide(turnArea);
            show(rankingArea);
            
            // Restore ranking timer if remaining time provided
            if (roundData.remainingRankingTime && roundData.remainingRankingTime > 0) {
              startRankingTimer(roundData.remainingRankingTime);
            }
            
            anonAnswersDiv.innerHTML = "";
            
            // Filter out timed-out answers
            const validAnswers = roundData.answersForRanking.filter(a => !a.timedOut);
            const timedOutCount = roundData.answersForRanking.length - validAnswers.length;
            
            // Show warning if players timed out
            if (timedOutCount > 0) {
              const warning = document.createElement("div");
              warning.className = "timeout-warning";
              warning.innerHTML = `⚠️ ${timedOutCount} player${timedOutCount > 1 ? 's' : ''} did not answer and will receive 0 points.`;
              anonAnswersDiv.appendChild(warning);
            }
            
            // Detect similar answers
            const similarityMap = detectSimilarAnswers(validAnswers);
            
            // Render answer cards with rank dropdowns
            validAnswers.forEach(a => {
              const card = document.createElement("div");
              card.className = "anon-card";
              
              const text = document.createElement("div");
              text.textContent = a.text;
              
              // Add similarity badge if detected
              if (similarityMap[a.answerId]) {
                const badge = document.createElement("span");
                badge.className = "similarity-badge";
                badge.textContent = "🔁 Similar";
                badge.title = "This answer shares concepts with another answer";
                text.appendChild(badge);
              }
              
              const sel = document.createElement("select");
              sel.dataset.id = a.answerId;
              sel.innerHTML = `<option value="">Rank</option>`;
              for (let i = 1; i <= validAnswers.length; i++) {
                sel.innerHTML += `<option>${i}</option>`;
              }
              
              card.append(text, sel);
              anonAnswersDiv.appendChild(card);
            });
            
            turnText.textContent = "";
          } else {
            // Still in answer phase
            console.log("[restoreGameState] Judge NOT in ranking phase - showing waiting message");
            console.log("[restoreGameState] phase:", roundData.phase);
            console.log("[restoreGameState] answersForRanking exists:", !!roundData.answersForRanking);
            hide(answerForm);
            answerInput.disabled = true;
            submitAnswerBtn.disabled = true;
            turnText.textContent = "Waiting for players to answer...";
            show(turnArea);
            hide(rankingArea);
          }
        } else {
          gamePlayerMeta.textContent = `${roundData.totalAnswerers} players answering`;
          
          // Check if in ranking phase (non-judge players)
          if (roundData.phase === "ranking") {
            console.log("[restoreGameState] Non-judge player in ranking phase - showing waiting message");
            hide(answerForm);
            hide(rankingArea);
            show(turnArea);
            turnText.textContent = "Judge is ranking answers…";
            
            // Restore ranking timer if remaining time provided
            if (roundData.remainingRankingTime && roundData.remainingRankingTime > 0) {
              startRankingTimer(roundData.remainingRankingTime);
            }
          } else if (roundData.playerAnswered) {
            // Already answered - hide form
            hide(answerForm);
            hasAnsweredThisRound = true;
            turnText.textContent = "Waiting for other players...";
            show(turnArea);
          } else if (roundData.isCurrentTurn) {
            // It's their turn - show form and restore timer
            show(answerForm);
            show(turnArea);
            answerInput.disabled = false;
            submitAnswerBtn.disabled = false;
            hasAnsweredThisRound = false;
            
            turnText.textContent = `Your turn (#${roundData.currentTurnIndex + 1})`;
            
            // Restore turn timer if remaining time provided
            if (roundData.remainingTurnTime && roundData.remainingTurnTime > 0) {
              const remainingMs = roundData.remainingTurnTime;
              const remainingSec = Math.ceil(remainingMs / 1000);
              
              // Show timer elements
              turnTimer.classList.remove("hidden");
              turnTimerText.classList.remove("hidden");
              turnTimerText.textContent = remainingSec;
              
              // Animate progress bar
              const bar = turnTimer.querySelector("i");
              if (bar) {
                // Calculate what percentage of time remains
                const totalTurnTime = data.rules.turnTime;
                const percentRemaining = remainingMs / totalTurnTime;
                
                bar.style.transition = "none";
                bar.style.transform = `scaleX(${percentRemaining})`;
                
                requestAnimationFrame(() => {
                  bar.style.transition = `transform ${remainingMs}ms linear`;
                  bar.style.transform = "scaleX(0)";
                });
              }
              
              // Start numeric countdown
              let seconds = remainingSec;
              if (activeTurnInterval) clearInterval(activeTurnInterval);
              activeTurnInterval = setInterval(() => {
                seconds--;
                turnTimerText.textContent = seconds;
                
                if (seconds <= 0) {
                  clearInterval(activeTurnInterval);
                  activeTurnInterval = null;
                  turnTimerText.textContent = "0";
                }
              }, 1000);
              
              // Set timeout to hide timer when done
              if (turnTimeout) clearTimeout(turnTimeout);
              turnTimeout = setTimeout(() => {
                if (activeTurnInterval) {
                  clearInterval(activeTurnInterval);
                  activeTurnInterval = null;
                }
                turnTimer.classList.add("hidden");
                turnTimerText.classList.add("hidden");
              }, remainingMs + 100);
            }
          } else {
            // Not their turn yet
            hide(answerForm);
            answerInput.disabled = true;
            submitAnswerBtn.disabled = true;
            
            const currentPlayer = roundData.turnOrder[roundData.currentTurnIndex];
            if (currentPlayer) {
              turnText.textContent = `${currentPlayer.name} is answering...`;
            } else {
              turnText.textContent = "Waiting for next turn...";
            }
            show(turnArea);
          }
        }
        
        updateContextualHelpers("in_round");
        break;
        
      case "between_rounds":
        setGameMode();
        show(gameArea);
        show(resultsArea);
        hide(turnArea);
        hide(rankingArea);
        
        if (data.betweenRoundsData) {
          updateLeaderboard(data.betweenRoundsData.leaderboard);
        }
        
        // Show Next Round button if host
        if (amHost) {
          let nextBtn = document.getElementById("hostNextRoundBtn");
          if (!nextBtn) {
            nextBtn = document.createElement("button");
            nextBtn.id = "hostNextRoundBtn";
            nextBtn.className = "btn small";
            nextBtn.textContent = "Next Round ▶";
            nextBtn.onclick = () => {
              playClickSound(); // 🔊 Button click sound
              socket.emit("host_next_round", { roomId: currentRoomId });
            };
            resultsArea.appendChild(nextBtn);
          }
          nextBtn.style.display = "inline-block";
        }
        break;
        
      case "game_ended":
        // Game ended - show final results
        setGameMode();
        show(gameArea);
        show(resultsArea);
        hide(turnArea);
        hide(rankingArea);
        
        updateLeaderboard(data.leaderboard);
        break;
    }
  }
  
  socket.on("host_changed", ({ newHostSocketId, newHostName }) => {
    amHost = (newHostSocketId === mySocketId);
    
    if (amHost) {
      show(startGameBtn);
      hide(readyBtn);
      show(adminTools); // Show host controls
      updateQuestionInputVisibility(); // Show/hide question input based on mode
      showSystemToast("You are now the host!", 3000);
    } else {
      hide(startGameBtn);
      show(readyBtn);
      showSystemToast(`${newHostName} is now the host`, 2500);
    }
    
    toggleRoomButtons();
  });
  
  socket.on("judge_reassigned", ({ newJudgeSocketId, newJudgeName }) => {
    currentJudgeId = newJudgeSocketId;
    
    if (newJudgeSocketId === mySocketId) {
      showSystemToast("You are now the judge!", 3000);
      gamePlayerMeta.textContent = "You are the Judge 👑";
    } else {
      showSystemToast(`${newJudgeName} is now the judge`, 2500);
    }
  });
  
  socket.on("game_ended_due_to_low_players", ({ reason, leaderboard }) => {
    // 🔊 Play game ended sound
    playGameEndedSound();
    
    showCustomAlert({
      title: 'Game Ended',
      message: reason || 'Not enough players to continue the game.',
      icon: '⚠️',
      type: 'warning',
      confirmText: 'OK',
      onConfirm: () => {
        resetToLobbyUI();
      }
    });
    
    if (leaderboard) {
      updateLeaderboard(leaderboard);
    }
  });

  // Handle round skipped (judge disconnected during ranking)
  socket.on("round_skipped", ({ reason, leaderboard, roundsRemaining }) => {
    showCustomAlert({
      title: 'Round Skipped',
      message: reason || 'The round was skipped due to judge disconnection.',
      icon: '⏭️',
      type: 'warning',
      confirmText: 'Continue',
      onConfirm: () => {
        // UI will update automatically via room_update
      }
    });
    
    if (leaderboard) {
      updateLeaderboard(leaderboard);
    }
    
    // Clear any ranking UI
    hide(rankingArea);
    hide(turnArea);
    
    if (!roundsRemaining) {
      // Game ended
      setTimeout(() => {
        resetToLobbyUI();
      }, 2000);
    }
  });

  // Handle judge reassigned during ranking phase
  socket.on("judge_reassigned_ranking", ({ newJudgeSocketId, newJudgeName, answersAnon, rankingTime }) => {
    currentJudgeId = newJudgeSocketId;
    
    // Start ranking timer for all players
    if (rankingTime) {
      startRankingTimer(rankingTime);
    }
    
    showSystemToast(`${newJudgeName} is now the judge`, 3000);
    
    if (mySocketId === newJudgeSocketId) {
      // I'm the new judge - show ranking interface
      turnText.textContent = "You are now the judge! Rank the answers:";
      
      hide(answerForm);
      hide(turnTimer);
      hide(turnTimerText);
      show(rankingArea);
      
      // Build ranking UI
      const anonAnswersDiv = document.getElementById("anonAnswers");
      anonAnswersDiv.innerHTML = "";
      
      answersAnon.forEach((ans, i) => {
        const card = document.createElement("div");
        card.className = "anon-card";
        if (ans.timedOut) {
          card.classList.add("timed-out");
        }
        
        card.innerHTML = `
          <div style="font-weight:700; margin-bottom:8px;">Answer ${i + 1}</div>
          <div style="margin-bottom:12px;">${ans.text}</div>
          <select data-answer-id="${ans.answerId}">
            <option value="">Rank...</option>
            ${answersAnon.map((_, idx) => 
              `<option value="${idx + 1}">${idx + 1}</option>`
            ).join("")}
          </select>
        `;
        
        anonAnswersDiv.appendChild(card);
      });
    } else {
      // I'm not the judge
      turnText.textContent = `${newJudgeName} is ranking answers…`;
      hide(rankingArea);
    }
  });

  // ✅ FIX 3: Handle ranking phase ended (timeout)
  let rankingPhaseEnded = false;
  
  socket.on("ranking_phase_ended", () => {
    console.log("[ranking_phase_ended] Ranking time expired");
    rankingPhaseEnded = true;
    
    // ✅ DON'T hide ranking area - wait for ranking_result event
    // Just disable controls and show processing message
    
    // Disable submit button
    if (submitRankBtn) {
      submitRankBtn.disabled = true;
      submitRankBtn.textContent = "Processing...";
    }
    
    // Lock all ranking dropdowns
    const selects = anonAnswersDiv.querySelectorAll("select");
    selects.forEach(select => {
      select.disabled = true;
    });
    
    // Clear ranking timer display
    clearRankingTimer();
    
    // Show feedback message
    if (rankFeedback) {
      rankFeedback.textContent = "⏰ Time's up! Auto-ranking answers...";
      rankFeedback.style.color = "var(--accent-gold)";
    }
  });

});






