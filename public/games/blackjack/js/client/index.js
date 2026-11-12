// public/client.js - safeMode integrated, end-round UI removed, How-to modal added (patched)
// allow external party UI to provide a socket instance via window._BLACKJACK_SOCKET
import './state.js';

import {
  clickSound,
  hitSound,
  standSound,
  gunSound,
  deathSound,
  finalTwoSound,    // 🎯 Final 2 sounds
  tensionSound,     
  winnerRevealSound,
  immunitySound,    // 🎯 NEW: Additional game sounds
  rouletteSpinSound,
  spectatorJoinSound,
  roundStartSound,  // 🎯 NEW: Round event sounds
  eliminationSound,
  survivalSound,
  play,
  unlockAudioOnce,
  toggleMute,       // 🔊 Mute controls
  setMuted,
  getMuted
} from './ui/audio.js';


import { renderPlayers } from './ui/renderPlayers.js';
import { renderLobbyPlayers } from './ui/renderLobby.js';

import {
  showDeathOverlay,
  hideDeathOverlay,
  showRoundSummaryOverlay,
  hideRoundSummaryOverlay,
  showGameNotification,
  showSuccessNotification,
  showErrorNotification,
  showWarningNotification,
  showInfoNotification
} from './ui/overlays.js';

                                   
import { state as appState } from './state.js';
import { resetSafeMode } from './state.js';

import { showVictoryOverlay, hideVictoryOverlay } from './ui/victoryOverlay.js';
import { setScreen } from './ui/screens.js';
import { trapFocus } from './ui/focusTrap.js';
import { showRouletteChoice, hideRouletteChoice } from './ui/rouletteChoice.js';
import { 
  showSpectatorBanner, 
  hideSpectatorBanner, 
  showSpectatorReactions, 
  hideSpectatorReactions,
  sendReaction,
  applyCurseEffect,
  displayReactionOnScreen
} from './ui/spectatorFeatures.js';

import { 
  showPracticeSetup, 
  hidePracticeSetup, 
  getPracticeSettings,
  showPracticeModeIndicator,
  hidePracticeModeIndicator
} from './ui/practiceMode.js';

import { showTutorial, hideTutorial } from './ui/tutorialMode.js';



document.addEventListener('pointerdown', unlockAudioOnce, {
  once: true,
  passive: true
});



let socket;
try {
  // Validate the injected socket (must have emit/on)
  if (window._BLACKJACK_SOCKET && typeof window._BLACKJACK_SOCKET.emit === 'function' && typeof window._BLACKJACK_SOCKET.on === 'function') {
    socket = window._BLACKJACK_SOCKET;
  } else {
    socket = io('/blackjack');
  }
} catch (e) {
  // fallback to io()
  socket = io('/blackjack');
}
window.onunload = () => {};

// ---------------------------------------------------------
// SAFE MODE FLAG
// ---------------------------------------------------------
window._BLACKJACK_SAFE_MODE = !!window._BLACKJACK_SAFE_MODE;   // default (coerce)

// ----------------- Elements -----------------
const intro = document.getElementById('introScreen');
const lobby = document.getElementById('lobbyScreen');
const game = document.getElementById('gameScreen');




const nameInput = document.getElementById('nameInput');
const roomCodeInput = document.getElementById('roomCodeInput');

const startBtn = document.getElementById('startBtn');       // lobby
const cancelStartBtn = document.getElementById('cancelStartBtn');
const leaveLobbyBtn = document.getElementById('leaveLobbyBtn');
const readyBtn = document.getElementById('readyBtn');

// 🎯 NEW: Elimination mode selector elements
const eliminationModeSelector = document.getElementById('eliminationModeSelector');
const eliminationModeSelect = document.getElementById('eliminationModeSelect');
const modeDescription = document.getElementById('modeDescription');
const readyControls = document.getElementById('readyControls');
const readyCountdownEl = document.getElementById('readyCountdown');

// endBtn intentionally removed
const hitBtn = document.getElementById('hitBtn');
const standBtn = document.getElementById('standBtn');
const exitBtn = document.getElementById('exitBtn');

const waitingBanner = document.getElementById('waitingBanner');
const playerListDiv = document.getElementById('playerList');
const playersWrap = document.getElementById('players');
const playersHeader = document.getElementById('playersHeader');

const gameLog = document.getElementById('gameLog');
const turnTimerEl = document.getElementById('turnTimer');
const roundsCounterEl = document.getElementById('roundsCounter');
const copyRoomCodeBtn = document.getElementById('copyRoomCodeBtn');


const victoryOverlay = document.getElementById('victoryOverlay');
const victoryNameEl = document.getElementById('victoryName');
const victoryClose = document.getElementById('victoryClose');
const confettiContainer = document.getElementById('confettiContainer');
const returnCountdownBanner = document.getElementById('returnCountdownBanner');
const countdownNumber = document.getElementById('countdownNumber');

const deathOverlay = document.getElementById('deathOverlay');
const deathText = document.getElementById('deathText');
const bloodCanvas = document.getElementById('bloodCanvas');

const postDeathPanel = document.getElementById('postDeathPanel');
const postWinnerName = document.getElementById('postWinnerName');
const spectateBtn = document.getElementById('spectateBtn');
const backToLobbyBtn = document.getElementById('backToLobbyBtn');

const gunOverlay = document.getElementById('gunOverlay');
const gunBarrel = document.getElementById('gunBarrel');
const gunSmoke = document.getElementById('gunSmoke');
const gunText = document.getElementById('gunText');

const roundSummaryOverlay = document.getElementById('roundSummaryOverlay');
const roundSummaryModal = document.getElementById('roundSummaryModal');
const roundSummaryBody = document.getElementById('roundSummaryBody');
const roundSummaryClose = document.getElementById('roundSummaryClose');
const startNewGameBtn = document.getElementById('startNewGameBtn');
// How-to elements
const howToPlayBtn = document.getElementById('howToPlayBtn');
const howToPlayBtnHeader = document.getElementById('howToPlayBtnHeader');
const howToPlayBtnIntro = document.getElementById('howToPlayBtnIntro');
const howToOverlay = document.getElementById('howToOverlay');
const howToClose = document.getElementById('howToClose');

let pendingPlayerName = null;
let mySocketId = null;
let readyCountdownActive = false;
let queuedRoundSummary = null;
let queuedDeathData = null;
let readyCountdownInterval = null;
let currentRoomCode = null;
let nextRoundInterval = null;





// ----------------- State -----------------
let actionLock = false;
let lastState = null;
function canShowGameOverlays() {
  // ⛔ Once victory starts, NOTHING else may appear
  return appState.uiMode !== 'postgame';
}
// ======================
// DEBUG STATE OVERLAY
// ======================
const debugOverlay =
  document.getElementById('debugStateOverlay');

const DEBUG_ENABLED =
  location.hostname === 'localhost' ||
  location.hostname === '127.0.0.1';

function updateDebugOverlay(state) {
  if (!DEBUG_ENABLED || !debugOverlay) return;

  debugOverlay.classList.remove('hidden');

  const me = state?.players?.find(p => p.id === socket.id);

  debugOverlay.innerHTML = `
<strong>DEBUG STATE</strong>
socket.id: ${socket.id || '—'}
room: ${currentRoomCode || '—'}

roundActive: ${state?.roundActive}
gameOver: ${state?.gameOver}

currentTurn: ${state?.currentTurn || '—'}

me.alive: ${me?.alive}
me.spectator: ${me?.spectator}
isEliminated: ${appState.isEliminated}

wins: ${me?.wins ?? '—'}
`;
}


let turnDeadline = null;
let countdownInterval = null;
let nextRoundDeadline = null;

// reconnect token
let reconnectToken = localStorage.getItem('rb_reconnect_token') || null;

const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const practiceModeBtn = document.getElementById('practiceModeBtn');
const tutorialBtn = document.getElementById('tutorialBtn');

function setRoomButtonsDisabled(disabled) {
  if (createRoomBtn) createRoomBtn.disabled = disabled;
  if (joinRoomBtn) joinRoomBtn.disabled = disabled;
  if (practiceModeBtn) practiceModeBtn.disabled = disabled;
  if (tutorialBtn) tutorialBtn.disabled = disabled;
}


createRoomBtn && (createRoomBtn.onclick = () => {
  const name = nameInput.value.trim();
  pendingPlayerName = name;

  if (!name) {
    showErrorNotification('Name Required', 'Please enter your name to create a room');
    return;
  }

  setRoomButtonsDisabled(true);
  
  // 🎯 NEW: Add loading state
  const originalText = createRoomBtn.textContent;
  createRoomBtn.textContent = 'Creating...';
  createRoomBtn.classList.add('loading');
  
  console.log('[LOADING] Create room button loading state applied');

  socket.emit('createRoom');

  // Reset button state after timeout (in case of failure)
  setTimeout(() => {
    if (createRoomBtn.disabled) {
      createRoomBtn.textContent = originalText;
      createRoomBtn.classList.remove('loading');
      setRoomButtonsDisabled(false);
      console.log('[LOADING] Create room button timeout reset');
    }
  }, 10000); // 10 second timeout

  unlockAudioOnce();
  play(clickSound);
});


joinRoomBtn && (joinRoomBtn.onclick = () => {
  const name = nameInput.value.trim();
  pendingPlayerName = name;

  const code = roomCodeInput.value.trim().toUpperCase();

  if (!name) {
    showErrorNotification('Name Required', 'Please enter your name to join a room');
    return;
  }

  if (!code) {
    showErrorNotification('Room Code Required', 'Please enter a room code to join');
    return;
  }

  // 🔧 IMPORTANT: disable buttons while waiting
  setRoomButtonsDisabled(true);
  
  // 🎯 NEW: Add loading state
  const originalText = joinRoomBtn.textContent;
  joinRoomBtn.textContent = 'Joining...';
  joinRoomBtn.classList.add('loading');
  
  console.log('[LOADING] Join room button loading state applied');

  socket.emit('joinRoom', code);
  
  // Reset button state after timeout (in case of failure)
  setTimeout(() => {
    if (joinRoomBtn.disabled) {
      joinRoomBtn.textContent = originalText;
      joinRoomBtn.classList.remove('loading');
      setRoomButtonsDisabled(false);
      console.log('[LOADING] Join room button timeout reset');
    }
  }, 10000); // 10 second timeout
  
  play(clickSound);
});

// 🎓 NEW: Tutorial Mode button
tutorialBtn && (tutorialBtn.onclick = () => {
  console.log('[TUTORIAL] Starting tutorial mode');
  
  // Add loading state
  const originalText = tutorialBtn.textContent;
  tutorialBtn.textContent = 'Loading...';
  tutorialBtn.classList.add('loading');
  tutorialBtn.disabled = true;
  
  // Show tutorial after brief delay
  setTimeout(() => {
    showTutorial();
    
    // Reset button state
    tutorialBtn.textContent = originalText;
    tutorialBtn.classList.remove('loading');
    tutorialBtn.disabled = false;
  }, 500);
  
  play(clickSound);
});

// 🤖 NEW: Practice Mode button
practiceModeBtn && (practiceModeBtn.onclick = () => {
  const name = nameInput.value.trim();
  
  if (!name) {
    showErrorNotification('Name Required', 'Please enter your name for practice mode');
    return;
  }
  
  pendingPlayerName = name;
  
  // 🎯 NEW: Add loading state
  const originalText = practiceModeBtn.textContent;
  practiceModeBtn.textContent = 'Setting up...';
  practiceModeBtn.classList.add('loading');
  practiceModeBtn.disabled = true;
  
  showPracticeSetup();
  
  // Reset loading state after practice setup is shown
  setTimeout(() => {
    practiceModeBtn.textContent = originalText;
    practiceModeBtn.classList.remove('loading');
    practiceModeBtn.disabled = false;
  }, 500);
  
  play(clickSound);
});



readyBtn && (readyBtn.onclick = () => {
  socket.emit('toggleReady');
  play(clickSound);
});

cancelStartBtn && (cancelStartBtn.onclick = () => {
  socket.emit('toggleReady'); // host unreadies → cancels countdown
  play(clickSound);
});

startNewGameBtn && (startNewGameBtn.onclick = () => {
  if (appState.uiMode !== 'postgame') return;


  socket.emit('requestNewGame');
});


// ----------------- Helpers -----------------

function buildRoundSummaryHTML(summary) {
  const hasBusted = summary.busted?.length > 0;

  const bustedHTML = hasBusted
    ? summary.busted
        .map(b => `💥 ${escapeHTML(b.name)} (${b.value})`)
        .join('<br>')
    : 'None';

  const lowestHTML = summary.lowestSurvivor
    ? `⚖️ ${escapeHTML(summary.lowestSurvivor.name)} (${summary.lowestSurvivor.value})`
    : '—';

  const ruleLine = hasBusted
    ? '💥 Busting takes priority over lowest hand'
    : '⚖️ No one busted → lowest hand chosen';

  const outcome = summary.eliminated
    ? `💀 Eliminated (Roll ${summary.roll})`
    : `🟢 Survived (Roll ${summary.roll})`;

  // 🎯 NEW: Add spectator indicator if viewing as spectator
  const me = lastState?.players?.find(p => p.id === socket.id);
  const isSpectator = me?.spectator === true;
  const spectatorNote = isSpectator ? '<div style="color: #68d391; font-size: 14px; margin-bottom: 12px;">👁️ Spectator View</div>' : '';

  return `
    ${spectatorNote}
    <div class="round-summary-rule">${ruleLine}</div>

    <div class="round-summary-section">
      <div class="round-summary-title">Busted Players</div>
      <div>${bustedHTML}</div>
    </div>

    <div class="round-summary-section">
      <div class="round-summary-title">Lowest Hand</div>
      <div>${lowestHTML}</div>
    </div>

    <div class="round-summary-highlight">
      🎯 ${escapeHTML(summary.chosenLoser)} pulled the trigger<br>
      ${outcome}
    </div>
  `;
}


function escapeHTML(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function dangerLevel(player) {
  if (player.busted) return 'danger';

  const value = handValue(player.hand);

  if (value >= 18) return 'safe';
  if (value >= 15) return 'risky';
  return 'danger';
}

function renderWinnerBanner() {
  const el = document.getElementById('winnerBanner');
  if (!el || !appState.winner.name) return;

  el.textContent = `🏆 Winner: ${appState.winner.name}`;
  el.classList.remove('hidden');
}

function hideWinnerBanner() {
  const el = document.getElementById('winnerBanner');
  if (el) el.classList.add('hidden');
}


// Make notifications available globally for tutorial
window.showSuccessNotification = showSuccessNotification;
window.showErrorNotification = showErrorNotification;
window.showWarningNotification = showWarningNotification;
window.showInfoNotification = showInfoNotification;

socket.on('connect', () => {
  mySocketId = socket.id;
  appState.isEliminated = false;

  // ❌ DO NOT auto-reconnect on fresh load
  // Reconnect is ONLY allowed after user joins a room
  console.log('[SOCKET] Connected — waiting for user action');
});




socket.on('roomJoined', data => {

  if (roomCodeInput) roomCodeInput.value = '';
  currentRoomCode = data.roomCode;

  // 🎯 NEW: Show success notification
  showSuccessNotification('Room Joined', `Successfully joined room ${data.roomCode}`);

const roomCodeText = document.getElementById('roomCodeText');
if (roomCodeText) {
  roomCodeText.textContent = data.roomCode;
}

  // 🎯 NEW: Reset loading states on successful join
  if (createRoomBtn) {
    createRoomBtn.textContent = 'Create Room';
    createRoomBtn.classList.remove('loading');
  }
  if (joinRoomBtn) {
    joinRoomBtn.textContent = 'Join Room';
    joinRoomBtn.classList.remove('loading');
  }
  if (practiceModeBtn) {
    practiceModeBtn.textContent = 'Practice Mode';
    practiceModeBtn.classList.remove('loading');
    practiceModeBtn.disabled = false;
  }
  if (tutorialBtn) {
    tutorialBtn.textContent = 'Tutorial';
    tutorialBtn.classList.remove('loading');
    tutorialBtn.disabled = false;
  }

  setRoomButtonsDisabled(false);

  // ✅ Safe reconnect ONLY after user is in a room
if (reconnectToken) {
  try {
    socket.emit('identify', reconnectToken);
    console.log('[RECONNECT] Attempted after room join');
  } catch (e) {}
}

// ✅ Now that we are in a room, safely set the name
if (pendingPlayerName) {
  socket.emit('setName', pendingPlayerName);
  pendingPlayerName = null;
}

// 🎯 NEW: Initialize elimination mode selector with default values
setTimeout(() => {
  const selector = document.getElementById('eliminationModeSelector');
  const select = document.getElementById('eliminationModeSelect');
  const description = document.getElementById('modeDescription');
  
  if (select) {
    select.value = 'standard';
    if (description) {
      updateModeDescription('standard');
    }
    
    // Ensure it's enabled by default for host (will be updated by state)
    if (selector) {
      selector.classList.remove('disabled');
      selector.style.display = 'block';
      selector.style.visibility = 'visible';
    }
    select.disabled = false;
    select.style.pointerEvents = 'auto';
    select.style.opacity = '1';
    
    console.log('[ELIMINATION MODE] Initialized selector on room join - enabled by default');
  } else {
    console.warn('[ELIMINATION MODE] Could not find selector elements on room join');
  }
}, 100); // Small delay to ensure DOM is ready


});

socket.on('roomError', msg => {
  // 🎯 NEW: Reset loading states on error
  if (createRoomBtn) {
    createRoomBtn.textContent = 'Create Room';
    createRoomBtn.classList.remove('loading');
  }
  if (joinRoomBtn) {
    joinRoomBtn.textContent = 'Join Room';
    joinRoomBtn.classList.remove('loading');
  }
  if (practiceModeBtn) {
    practiceModeBtn.textContent = 'Practice Mode';
    practiceModeBtn.classList.remove('loading');
    practiceModeBtn.disabled = false;
  }
  if (tutorialBtn) {
    tutorialBtn.textContent = 'Tutorial';
    tutorialBtn.classList.remove('loading');
    tutorialBtn.disabled = false;
  }
  
  showErrorNotification('Room Error', msg);
  setRoomButtonsDisabled(false);
  
  // If it's a ban message, show additional info
  if (msg.includes('previously removed')) {
    console.log('[BAN] Player is banned from this room');
  }
});


socket.on('assignToken', data => {
  if (data?.token) {
    reconnectToken = data.token;
    try { localStorage.setItem('rb_reconnect_token', reconnectToken); } catch(e) {}
  }
});

function clearAllTimers() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;

  if (nextRoundInterval) clearInterval(nextRoundInterval);
  nextRoundInterval = null;
}


function hidePostDeathPanel() {
  if (postDeathPanel) postDeathPanel.classList.add('hidden');
}


// ---------------- BUTTONS ----------------
copyRoomCodeBtn && (copyRoomCodeBtn.onclick = () => {
  console.log('[COPY] Copy button clicked');
  
  const roomCodeElement = document.getElementById('roomCodeText');
  const code = roomCodeElement?.textContent;
  
  console.log('[COPY] Room code element:', roomCodeElement);
  console.log('[COPY] Room code text:', code);
  
  if (!code || code === '----') {
    console.log('[COPY] No valid room code to copy');
    return;
  }

  // Try modern clipboard API first, fallback to older method
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(() => {
      console.log('[COPY] Room code copied to clipboard:', code);
      play(clickSound);
      
      // Show success notification
      showSuccessNotification('Copied!', `Room code ${code} copied to clipboard`);
      
      const original = copyRoomCodeBtn.textContent;
      copyRoomCodeBtn.textContent = 'Copied!';
      copyRoomCodeBtn.style.background = '#28a745';
      
      setTimeout(() => {
        copyRoomCodeBtn.textContent = original;
        copyRoomCodeBtn.style.background = '';
      }, 1500);
    }).catch(err => {
      console.error('[COPY] Failed to copy room code:', err);
      fallbackCopy(code);
    });
  } else {
    console.log('[COPY] Using fallback copy method');
    fallbackCopy(code);
  }
});

// Fallback copy method for older browsers
function fallbackCopy(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      console.log('[COPY] Room code copied using fallback method:', text);
      play(clickSound);
      
      const original = copyRoomCodeBtn.textContent;
      copyRoomCodeBtn.textContent = 'Copied!';
      copyRoomCodeBtn.style.background = '#28a745';
      
      setTimeout(() => {
        copyRoomCodeBtn.textContent = original;
        copyRoomCodeBtn.style.background = '';
      }, 1500);
    } else {
      console.error('[COPY] Fallback copy failed');
      showWarningNotification('Copy Failed', `Could not copy room code. Please copy manually: ${text}`);
    }
  } catch (err) {
    console.error('[COPY] Fallback copy error:', err);
    showWarningNotification('Copy Failed', `Could not copy room code. Please copy manually: ${text}`);
  } finally {
    document.body.removeChild(textArea);
  }
}


leaveLobbyBtn && (leaveLobbyBtn.onclick = () => {
  cleanupAndReturnToIntro({ clearToken: true });
});



startBtn && (startBtn.onclick = () => {

  if (!readyCountdownActive) {
    // ▶ START
    socket.emit('startRound');
    play(clickSound);
  } else {
    // ❌ CANCEL
    socket.emit('toggleReady'); // host un-readies → cancels countdown
    play(clickSound);
  }
});

// 🎯 NEW: Elimination mode selector handler
eliminationModeSelect && (eliminationModeSelect.onchange = () => {
  const selectedMode = eliminationModeSelect.value;
  socket.emit('setEliminationMode', selectedMode);
  play(clickSound);
  
  // Update description immediately for better UX
  updateModeDescription(selectedMode);
});

// 🎯 NEW: Update elimination mode description
function updateModeDescription(mode) {
  if (!modeDescription) return;
  
  const descriptions = {
    'standard': 'Busted players prioritized, then lowest hand',
    'lowestHand': 'Always lowest hand (bust status ignored for roulette)'
  };
  
  modeDescription.textContent = descriptions[mode] || descriptions['standard'];
  
  // Update visual styling
  if (eliminationModeSelector) {
    eliminationModeSelector.setAttribute('data-mode', mode);
  }
}

// 🎯 NEW: Update elimination mode selector visibility and state
function updateEliminationModeSelector(state) {
  if (!eliminationModeSelector || !eliminationModeSelect) {
    console.log('[ELIMINATION MODE] Selector elements not found - retrying in 100ms');
    // Retry after a short delay in case elements aren't ready yet
    setTimeout(() => {
      const selector = document.getElementById('eliminationModeSelector');
      const select = document.getElementById('eliminationModeSelect');
      if (selector && select) {
        console.log('[ELIMINATION MODE] Elements found on retry, updating selector');
        updateEliminationModeSelectorWithElements(state, selector, select);
      } else {
        console.warn('[ELIMINATION MODE] Elements still not found after retry');
      }
    }, 100);
    return;
  }
  
  updateEliminationModeSelectorWithElements(state, eliminationModeSelector, eliminationModeSelect);
}

function updateEliminationModeSelectorWithElements(state, selectorElement, selectElement) {
  const isHost = state.hostId === socket.id;
  const canChange = isHost && state.phase === 'lobby' && !state.roundActive;
  
  console.log('[ELIMINATION MODE] Update selector:', {
    isHost,
    phase: state.phase,
    roundActive: state.roundActive,
    canChange,
    eliminationMode: state.eliminationMode,
    socketId: socket.id,
    hostId: state.hostId
  });
  
  // Set data attribute for CSS targeting
  selectorElement.setAttribute('data-host', isHost.toString());
  selectorElement.setAttribute('data-can-change', canChange.toString());
  
  // Show/hide selector based on host status
  if (isHost) {
    selectorElement.style.display = 'block';
    selectorElement.style.visibility = 'visible';
    console.log('[ELIMINATION MODE] Showing selector for host');
  } else {
    selectorElement.style.display = 'none';
    console.log('[ELIMINATION MODE] Hiding selector for non-host');
  }
  
  // Enable/disable based on game state
  if (canChange) {
    selectorElement.classList.remove('disabled');
    selectElement.disabled = false;
    selectElement.style.pointerEvents = 'auto';
    selectElement.style.opacity = '1';
    console.log('[ELIMINATION MODE] Enabled selector');
  } else {
    selectorElement.classList.add('disabled');
    selectElement.disabled = true;
    selectElement.style.pointerEvents = 'none';
    selectElement.style.opacity = '0.5';
    console.log('[ELIMINATION MODE] Disabled selector - canChange:', canChange);
  }
  
  // Update selected value if provided
  if (state.eliminationMode && selectElement.value !== state.eliminationMode) {
    selectElement.value = state.eliminationMode;
    updateModeDescription(state.eliminationMode);
    console.log('[ELIMINATION MODE] Updated value to:', state.eliminationMode);
  }
  
  // Ensure default value is set if no mode specified
  if (!state.eliminationMode && selectElement.value !== 'standard') {
    selectElement.value = 'standard';
    updateModeDescription('standard');
    console.log('[ELIMINATION MODE] Set default value to standard');
  }
}

// 🎯 NEW: Force enable selector for host (fallback)
function forceEnableSelectorForHost() {
  // Try to get fresh references to the elements
  const selector = document.getElementById('eliminationModeSelector');
  const select = document.getElementById('eliminationModeSelect');
  
  if (selector && select && lastState) {
    const isHost = lastState.hostId === socket.id;
    const isLobby = lastState.phase === 'lobby';
    const notActive = !lastState.roundActive;
    
    console.log('[ELIMINATION MODE] Force enable check:', {
      isHost,
      isLobby,
      notActive,
      socketId: socket.id,
      hostId: lastState.hostId
    });
    
    if (isHost && isLobby && notActive) {
      // Set data attributes for CSS targeting
      selector.setAttribute('data-host', 'true');
      selector.setAttribute('data-can-change', 'true');
      
      selector.classList.remove('disabled');
      select.disabled = false;
      select.style.pointerEvents = 'auto';
      select.style.opacity = '1';
      selector.style.display = 'block';
      selector.style.visibility = 'visible';
      
      // Ensure the selector has the correct value
      if (lastState.eliminationMode) {
        select.value = lastState.eliminationMode;
        updateModeDescription(lastState.eliminationMode);
      } else {
        select.value = 'standard';
        updateModeDescription('standard');
      }
      
      console.log('[ELIMINATION MODE] Force enabled selector for host');
    }
  } else {
    console.log('[ELIMINATION MODE] Force enable failed - elements or state not available');
  }
}

hitBtn && (hitBtn.onclick = () => {

  if (appState.isEliminated) return;
  if (actionLock) return;
  actionLock = true;
  socket.emit('hit');
  play(hitSound);
  setTimeout(() => actionLock = false, 500);
});

standBtn && (standBtn.onclick = () => {

  if (appState.isEliminated) return;
  if (actionLock) return;
  actionLock = true;
  socket.emit('stand');
  play(standSound);
  setTimeout(() => actionLock = false, 500);
});

// 🔊 Mute/Unmute button handler
const muteToggleBtn = document.getElementById('muteToggleBtn');
const muteIcon = document.getElementById('muteIcon');
const muteText = document.getElementById('muteText');

function updateMuteButton() {
  const muted = getMuted();
  if (muteToggleBtn) {
    muteToggleBtn.classList.toggle('muted', muted);
  }
  if (muteIcon) {
    muteIcon.textContent = muted ? '🔇' : '🔊';
  }
  if (muteText) {
    muteText.textContent = muted ? 'Sound Off' : 'Sound On';
  }
}

if (muteToggleBtn) {
  // Initialize button state
  updateMuteButton();
  
  muteToggleBtn.addEventListener('click', () => {
    toggleMute();
    updateMuteButton();
    // Play a click sound to confirm (will only play if unmuting)
    play(clickSound);
  });
}

// How-to handlers
if (howToPlayBtn) howToPlayBtn.addEventListener('click', showHowTo);
if (howToPlayBtnHeader) howToPlayBtnHeader.addEventListener('click', showHowTo);
if (howToPlayBtnIntro) howToPlayBtnIntro.addEventListener('click', showHowTo);
if (howToClose) howToClose.addEventListener('click', hideHowTo);

// close with Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideHowTo();
    
    // Also close tutorial if open
    const tutorialOverlay = document.getElementById('tutorialOverlay');
    if (tutorialOverlay && !tutorialOverlay.classList.contains('hidden')) {
      hideTutorial();
    }
  }
});

function showHowTo() {
  trapFocus(howToOverlay);
  try {
    if (!howToOverlay) return;
    howToOverlay.classList.remove('hidden');
    howToOverlay.setAttribute('aria-hidden', 'false');
    // focus close button for keyboard users
    setTimeout(() => { try { howToClose && howToClose.focus(); } catch(e) {} }, 40);
  } catch (e) { console.error('showHowTo error', e); }
}
function hideHowTo() {
  try {
    if (!howToOverlay) return;
    howToOverlay.classList.add('hidden');
    howToOverlay.setAttribute('aria-hidden', 'true');
  } catch (e) { console.error('hideHowTo error', e); }
}

// ---------- Exit / Leave handler ----------
exitBtn && (exitBtn.onclick = () => {
  if (confirm('Leave the game? You may be eliminated.')) {
    cleanupAndReturnToIntro({ clearToken: true });
  }
});


function cleanupAndReturnToIntro({ clearToken = false } = {}) {
  // Winner is allowed to leave after victory
  clearAllTimers();
  try {
    hideDeathOverlay();
    hideRoundSummaryOverlay();
    hideWinnerBanner();
    hideWinnerSummary();
    hideVictoryOverlay();
    hideRouletteChoice(); // NEW
    hideSpectatorBanner(); // NEW
    hideSpectatorReactions(); // NEW
    hidePracticeSetup(); // NEW
    hidePracticeModeIndicator(); // NEW
    hideTutorial(); // NEW
    hideKickConfirm(); // NEW
    
    // Hide return countdown banner
    if (returnCountdownBanner) {
      returnCountdownBanner.classList.add('hidden');
    }

    appState.winner.id = null;
    appState.winner.name = null;

   if (appState.postGameCountdown) {
     clearInterval(appState.postGameCountdown);
     appState.postGameCountdown = null;
    } 

    try { hideGunAnimation(); } catch(e) {}
    try { hideHowTo(); } catch(e) {}

    if (clearToken) {
      try { localStorage.removeItem('rb_reconnect_token'); } catch(e) {}
      reconnectToken = null;
    }
    
    try { socket.emit('leave'); } catch(e) {}

    try {
      setScreen('intro');  

      debugOverlay?.classList.add('hidden');

      if (nameInput) nameInput.value = '';
      if (gameLog) gameLog.innerHTML = '';
      if (playersWrap) playersWrap.innerHTML = 'Waiting for players...';
      if (playerListDiv) playerListDiv.innerHTML = '';
      

      hitBtn && (hitBtn.disabled = true);
      standBtn && (standBtn.disabled = true);

      currentRoomCode = null;
      lastState = null;

      // clear eliminated flag on exit
      appState.isEliminated = false;

      // Reset safe mode
      window._BLACKJACK_SAFE_MODE = false;
      resetSafeMode();
    } catch (e) {
      console.error('cleanup UI error', e);
    }
  } catch (err) {
    console.error('Error during cleanup:', err);
    try { location.reload(); } catch(e) {}
  }
}

function renderWinnerSummary() {
  const wrap = document.getElementById('winnerSummary');
  const body = document.getElementById('winnerSummaryBody');

  if (!wrap || !body) return;
  if (!appState.lastState || !appState.lastState.players) return;

  body.innerHTML = appState.lastState.players.map(p => `
    <div style="margin:4px 0;">
      ${escapeHTML(p.name)} — ${p.wins || 0} wins
    </div>
  `).join('');

  wrap.classList.remove('hidden');
  wrap.setAttribute('aria-hidden', 'false');
}

function hideWinnerSummary() {
  const wrap = document.getElementById('winnerSummary');
  if (!wrap) return;

  wrap.classList.add('hidden');
  wrap.setAttribute('aria-hidden', 'true');
}

// Post-death buttons
spectateBtn && (spectateBtn.onclick = () => {
  socket.emit('spectate');
  hidePostDeathPanel();
  appState.isEliminated = false;
});

backToLobbyBtn && (backToLobbyBtn.onclick = () => {
  hidePostDeathPanel();
  appState.isEliminated = false;
});

roundSummaryClose && roundSummaryClose.addEventListener('click', () => {
  hideRoundSummaryOverlay();
});

roundSummaryOverlay && roundSummaryOverlay.addEventListener('click', (e) => {
  // Only close when clicking the dark backdrop, not the modal itself
  if (e.target === roundSummaryOverlay) {
    hideRoundSummaryOverlay();
  }
});



// ======================
// TURN TIMER
// ======================
function startLocalCountdown(deadlineMs) {
  clearLocalCountdown();
  if (!deadlineMs) {
    console.log('[TIMER] No deadline provided, showing --');
    turnTimerEl && (turnTimerEl.textContent = '--');
    return;
  }
  console.log('[TIMER] Starting local countdown to:', new Date(deadlineMs));
  turnDeadline = deadlineMs;
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 500);
}
function updateCountdown() {
  if (!turnDeadline) {
    turnTimerEl && (turnTimerEl.textContent = '--');
    return;
  }
  const ms = Math.max(0, turnDeadline - Date.now());
  const seconds = Math.ceil(ms / 1000);
  
  // FIX: Cap display at 15 seconds max to prevent display bugs
  const displaySeconds = Math.min(seconds, 15);
  turnTimerEl && (turnTimerEl.textContent = displaySeconds + 's');
  
  if (ms <= 5000) {
    turnTimerEl && turnTimerEl.classList.add('warning');
    turnTimerEl && turnTimerEl.classList.remove('ok');
  } else {
    turnTimerEl && turnTimerEl.classList.remove('warning');
    turnTimerEl && turnTimerEl.classList.add('ok');
  }
  if (ms <= 0) {
    console.log('[TIMER] Countdown reached zero, clearing');
    clearLocalCountdown();
  }
}
function clearLocalCountdown() {
  turnDeadline = null;
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
  turnTimerEl && (turnTimerEl.textContent = '--');
}

// 🎯 NEW: Final 2 presentation functions
function showFinalTwoBanner() {
  // Create and show Final 2 banner
  const banner = document.createElement('div');
  banner.className = 'final-two-banner';
  banner.innerHTML = '⚔️ FINAL 2 ⚔️<br><small>Last Stand!</small>';
  
  document.body.appendChild(banner);
  
  // Remove banner after 3 seconds
  setTimeout(() => {
    if (banner.parentNode) {
      banner.remove();
    }
  }, 3000);
}

function showWinnerRevealPause(winnerName) {
  const pause = document.createElement('div');
  pause.className = 'winner-reveal-pause';
  pause.innerHTML = `
    <div class="winner-reveal-text">
      The Winner Is...<br>
      <div style="margin-top: 20px; font-size: 48px; color: #ffd966;">
        ${escapeHTML(winnerName)}
      </div>
    </div>
  `;
  
  document.body.appendChild(pause);
  
  // Play tension sound
  play(tensionSound);
  
  // Remove after 2 seconds and play victory sound
  setTimeout(() => {
    if (pause.parentNode) {
      pause.remove();
    }
    play(winnerRevealSound);
  }, 2000);
}

// ======================
// GUN ANIMATION & BLOOD etc (Enhanced for Final 2)
function showGunAnimation(text = 'Pulling the trigger...') {
  if (!gunOverlay || !gunText) return;

  // 🛑 CRITICAL: Never show gun animation if victory is active or about to be active
  if (appState.victoryActive || appState.uiMode === 'postgame') {
    console.log('[GUN ANIMATION] Blocked - victory is active');
    return;
  }

  // Check if we're in the final moments (last man standing scenario)
  if (lastState && lastState.players) {
    const alivePlayers = lastState.players.filter(p => p.alive && !p.spectator);
    if (alivePlayers.length <= 1) {
      console.log('[GUN ANIMATION] Blocked - last man standing detected');
      return;
    }
    
    // 🎯 NEW: Enhanced animation for Final 2
    const isFinalTwo = alivePlayers.length === 2;
    if (isFinalTwo) {
      gunOverlay.classList.add('final-two-roulette');
      console.log('[GUN ANIMATION] Final 2 mode - slower animation');
    }
  }

  // HARD BLOCK everything else
  appState.triggerAnimationActive = true;

  // Hide anything that might already be visible
  hideRoundSummaryOverlay();

  gunOverlay.classList.remove('hidden');
  gunOverlay.setAttribute('aria-hidden', 'false');

  if (gunBarrel) gunBarrel.style.display = 'none';
  if (gunSmoke) gunSmoke.style.display = 'none';

  gunText.innerHTML = `
    <div class="trigger-animation-container">
      <div class="gun-icon">🔫</div>
      <div class="trigger-text-enhanced">${text}</div>
    </div>
  `;
  
  gunText.classList.add('trigger-text');

  // 🎯 ENHANCED: Longer animation for Final 2
  const animationDuration = gunOverlay.classList.contains('final-two-roulette') ? 5000 : 3500;

  // AUTHORITATIVE END OF TRIGGER PHASE - store timeout for cancellation
  window.gunAnimationTimeout = setTimeout(() => {
    // 🛑 Check again before showing overlays (victory might have arrived)
    if (appState.victoryActive || appState.uiMode === 'postgame') {
      hideGunAnimation();
      appState.triggerAnimationActive = false;
      return; // Victory takes priority
    }

    hideGunAnimation();
    appState.triggerAnimationActive = false;

    // 💀 Death overlay is now handled directly in the eliminated event
    // 📊 Round summary is now handled directly by the server
    // No need to show queued overlays here anymore
    
    console.log('[GUN ANIMATION] Completed - overlays handled by server events');
  }, animationDuration);
}


function hideGunAnimation() {
  if (!gunOverlay || !gunText) return;

  gunOverlay.classList.add('hidden');
  gunOverlay.setAttribute('aria-hidden', 'true');

  // Clean animation state
  gunText.classList.remove('trigger-text');
  gunText.innerHTML = ''; // Clear enhanced HTML content
  
  // 🎯 NEW: Clean Final 2 classes
  gunOverlay.classList.remove('final-two-roulette');

  if (gunBarrel) gunBarrel.style.animation = 'none';
  if (gunSmoke) gunSmoke.style.animation = 'none';
}
// ======================
// RENDERING
// ======================
function renderGame(state) {

  const status = document.getElementById('lobbyStatus');
if (status && !state.roundActive) {
  status.innerHTML =
    '⚠️ <strong>Busting</strong> is always worse than having the lowest hand.';
}


  const me = state.players?.find(p => p.id === socket.id);

// 🔒 If no player data, do nothing
if (!me) return;


  lastState = state;

  // 🎯 NEW: Final 2 detection and presentation
  const alivePlayers = (state.players || []).filter(p => p.alive && !p.spectator);
  const isFinalTwo = alivePlayers.length === 2;
  const wasNotFinalTwo = !appState.wasFinalTwo;
  
  if (isFinalTwo && wasNotFinalTwo && state.roundActive) {
    // First time entering Final 2
    appState.wasFinalTwo = true;
    showFinalTwoBanner();
    play(finalTwoSound);
    console.log('[FINAL 2] Entered Final 2 mode');
    
    // 🎯 NEW: Show Final 2 message to spectators too
    const me = state.players?.find(p => p.id === socket.id);
    if (me?.spectator) {
      setTimeout(() => {
        if (gameLog) {
          const el = document.createElement('div');
          el.textContent = '⚔️ FINAL 2 - The last stand begins!';
          el.style.color = '#ffd966';
          el.style.fontWeight = 'bold';
          el.style.textAlign = 'center';
          el.style.fontSize = '18px';
          gameLog.prepend(el);
        }
      }, 1000);
    }
  } else if (!isFinalTwo) {
    appState.wasFinalTwo = false;
  }

  const roundStateEl = document.getElementById('roundState');
if (roundStateEl) {
  roundStateEl.textContent = state.roundActive
    ? (isFinalTwo ? 'FINAL 2 - Last Stand!' : 'Round in progress')
    : 'Waiting for next round';
}


  if (roundsCounterEl) roundsCounterEl.textContent = `Rounds: ${state.roundsPlayed}`;

  updateLobbyButtons(state.hostId);
updateLobbyBanner(state);
const startBtn = document.getElementById('startBtn');

const hint = document.getElementById('minPlayersHint');
if (hint) {
  hint.style.display = alivePlayers.length < 2 ? 'block' : 'none';
}

if (startBtn) {
  startBtn.disabled = alivePlayers.length < 2;
}


const amTurn = state.currentTurn === socket.id;
const isSpectator = me?.spectator === true;

// 👁️ Enhanced spectator UI handling
if (isSpectator) {
  showSpectatorBanner();
  if (state.roundActive) {
    showSpectatorReactions();
  } else {
    hideSpectatorReactions();
  }
  
  // Add disabled overlay to controls for spectators
  const controlsSection = document.getElementById('controls');
  if (controlsSection && !controlsSection.querySelector('.controls-disabled-overlay')) {
    const overlay = document.createElement('div');
    overlay.className = 'controls-disabled-overlay';
    overlay.innerHTML = `
      <div class="controls-disabled-text">
        👁️ Spectating<br>
        <small>Controls disabled while spectating</small>
      </div>
    `;
    controlsSection.style.position = 'relative';
    controlsSection.appendChild(overlay);
  }
} else {
  hideSpectatorBanner();
  hideSpectatorReactions();
  
  // Remove disabled overlay if not spectating
  const controlsSection = document.getElementById('controls');
  const overlay = controlsSection?.querySelector('.controls-disabled-overlay');
  if (overlay) {
    overlay.remove();
  }
}

const isGameVisible = !game.classList.contains('hidden');

const controlsSection = document.getElementById('controls');
if (controlsSection) {
  controlsSection.style.display =
    isSpectator && isGameVisible ? 'none' : 'block';
}

  const yourTurnLabel = document.getElementById('yourTurnLabel');
if (yourTurnLabel) {
  yourTurnLabel.style.display = amTurn && state.roundActive
    ? 'block'
    : 'none';
}

  if (hitBtn) hitBtn.disabled = !(amTurn && state.roundActive);
  if (standBtn) standBtn.disabled = !(amTurn && state.roundActive);
renderPlayers({
  state,
  playersWrap,
  escapeHTML,
  handValue,
  dangerLevel
});

}

function handValue(hand) {
  let t = 0, a = 0;
  for (const c of (hand||[])) {
    if (!c) continue;
    if (c.rank === "A") { a++; t += 11; }
    else if (["K","Q","J"].includes(c.rank)) t += 10;
    else {
      const v = parseInt(c.rank, 10);
      t += Number.isFinite(v) ? v : 0;
    }
  }
  while (t > 21 && a > 0){ t -= 10; a--; }
  return t;
}

// ----------------- Logs -----------------
socket.on('log', msg => {

  try {
    const el = document.createElement('div');
    el.textContent = '• ' + msg;
    if (gameLog) gameLog.prepend(el);

    if (msg.includes('is now the host')) {
      gameLog?.firstChild?.classList.add('host-change');
    }

    // 🎯 NEW: Contextual sound effects based on log messages
    const msgLower = String(msg).toLowerCase();
    
    // Round events
    if (msgLower.includes('round') && msgLower.includes('started')) {
      play(roundStartSound);
    }
    
    // Immunity events
    if (msgLower.includes('immunity') && (msgLower.includes('gained') || msgLower.includes('protected'))) {
      play(immunitySound);
    }
    
    // Survival events
    if (msgLower.includes('survived') || (msgLower.includes('rolled') && msgLower.includes('survived'))) {
      setTimeout(() => play(survivalSound), 100); // Slight delay for better timing
    }
    
    // Spectator events
    if (msgLower.includes('joined as spectator') || msgLower.includes('spectating')) {
      play(spectatorJoinSound);
    }
    
    // Chamber spinning
    if (msgLower.includes('spins the chamber') || msgLower.includes('click click click')) {
      play(rouletteSpinSound);
    }

    // Elimination events (enhanced)
    if (String(msg).toUpperCase().includes("ELIMINATED")) {
      if (!window._BLACKJACK_SAFE_MODE) {
        const prefersReducedMotion =
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (!prefersReducedMotion) {
          document.body.classList.add('flash');
          setTimeout(() => document.body.classList.remove('flash'), 300);
        }

        // Play both gun sound and elimination sound for dramatic effect
        try { 
          play(gunSound); 
          setTimeout(() => play(eliminationSound), 500); // Delayed elimination sound
        } catch (e) {}
      }
    }
  } catch (e) { console.error('log handler error', e); }
});

// ----------------- Socket events -----------------
// Kick confirmation modal elements
const kickConfirmOverlay = document.getElementById('kickConfirmOverlay');
const kickConfirmMessage = document.getElementById('kickConfirmMessage');
const kickConfirmBtn = document.getElementById('kickConfirmBtn');
const kickCancelBtn = document.getElementById('kickCancelBtn');

let pendingKickData = null;

// Test kick connection
socket.on('testKickResponse', (message) => {
  console.log('[TEST] Received test response:', message);
});

// Handle kick player events
window.addEventListener('requestKickPlayer', (e) => {
  const { playerId, playerName } = e.detail;
  console.log('[KICK CLIENT] Request kick event received:', { playerId, playerName });
  
  pendingKickData = { playerId, playerName };
  
  kickConfirmMessage.textContent = `Are you sure you want to kick "${playerName}" from the room? This action cannot be undone.`;
  kickConfirmOverlay.classList.remove('hidden');
  kickConfirmOverlay.setAttribute('aria-hidden', 'false');
  
  // Focus the cancel button for safety
  kickCancelBtn.focus();
});

// Kick confirmation handlers
kickConfirmBtn && (kickConfirmBtn.onclick = () => {
  if (pendingKickData) {
    console.log('[KICK CLIENT] Sending kick request for:', pendingKickData);
    socket.emit('kickPlayer', pendingKickData.playerId);
    hideKickConfirm();
  }
});

kickCancelBtn && (kickCancelBtn.onclick = () => {
  hideKickConfirm();
});

// Close kick modal with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !kickConfirmOverlay.classList.contains('hidden')) {
    hideKickConfirm();
  }
});

function hideKickConfirm() {
  kickConfirmOverlay.classList.add('hidden');
  kickConfirmOverlay.setAttribute('aria-hidden', 'true');
  pendingKickData = null;
}

// Handle kick responses from server
socket.on('kickSuccess', (data) => {
  // Show success notification
  showSuccessNotification('Player Removed', `${data.playerName} has been removed from the room`);
  
  // Show success message in game log instead of alert
  if (gameLog) {
    const el = document.createElement('div');
    el.textContent = `✅ ${data.playerName} has been removed from the room.`;
    el.style.color = '#28a745';
    el.style.fontWeight = 'bold';
    gameLog.prepend(el);
  }
});

socket.on('kickError', (message) => {
  // Show error notification
  showErrorNotification('Cannot Remove Player', message);
  
  // Show error message in game log instead of alert
  if (gameLog) {
    const el = document.createElement('div');
    el.textContent = `❌ Cannot kick player: ${message}`;
    el.style.color = '#dc3545';
    el.style.fontWeight = 'bold';
    gameLog.prepend(el);
  }
});

socket.on('kicked', (data) => {
  console.log('[KICK CLIENT] Received kicked notification:', data);
  
  // Show a prominent modal instead of just an alert
  const kickedModal = document.createElement('div');
  kickedModal.className = 'overlay';
  kickedModal.style.zIndex = '99999';
  kickedModal.innerHTML = `
    <div class="kick-confirm-modal" style="border-color: #dc3545;">
      <h3 style="color: #dc3545;">⚠️ Removed from Room</h3>
      <p style="font-size: 18px; margin: 20px 0;">You have been removed from the room by <strong>${data.hostName}</strong>.</p>
      <p style="font-size: 14px; opacity: 0.8; margin-bottom: 24px;">You will be returned to the main screen.</p>
      <button class="btn red" onclick="this.parentElement.parentElement.remove(); window.location.reload();">OK</button>
    </div>
  `;
  
  document.body.appendChild(kickedModal);
  
  // Auto-cleanup and return to intro after 5 seconds
  setTimeout(() => {
    kickedModal.remove();
    cleanupAndReturnToIntro({ clearToken: true });
  }, 5000);
});

socket.on('playerList', list => {
  const me = lastState?.players?.find(p => p.id === socket.id);
  const isHost = me?.host === true;
  const roundActive = lastState?.roundActive === true;
  
  renderLobbyPlayers({
    list,
    playerListDiv,
    playersHeader,
    escapeHTML,
    winnerId: appState.winner.id,
    isHost,
    mySocketId: socket.id,
    roundActive
  });
});

socket.on('phaseChange', ({ phase }) => {
  console.log('[PHASE]', phase);

  // 🛑 CRITICAL: Never override victory/postgame mode unless explicitly resetting
  if (appState.victoryActive && phase !== 'lobby') {
    console.log('[PHASE] Blocked phase change during victory:', phase);
    return;
  }

  switch (phase) {
    case 'lobby':
      // Only allow lobby transition if victory is complete or not active
      appState.uiMode = 'lobby';
      appState.isEliminated = false;
      setScreen('lobby');
      break;

    case 'round':
      nextRoundDeadline = null;
      if (nextRoundInterval) {
        clearInterval(nextRoundInterval);
        nextRoundInterval = null;
      }
      console.log('[PHASE] Round started - cleared next round countdown');
      setScreen('game');
      break;

    case 'trigger':
      setScreen('game');
      break;

    case 'postgame':
  appState.uiMode = 'postgame';
  setScreen('postgame');
  break;

  }
});

socket.on('state', state => {
  lastState = state;
  appState.lastState = state;

  updateDebugOverlay(state);

  const me = state.players.find(p => p.id === socket.id);
  if (!me) return;

  // 🎯 NEW: Update elimination mode selector
  updateEliminationModeSelector(state);
  
  // 🎯 NEW: Force enable after a short delay (fallback)
  setTimeout(() => {
    forceEnableSelectorForHost();
  }, 100);

  renderGame(state);
});


socket.on('turnDeadline', data => {
  // Only block if we're actually in a countdown between rounds
  if (nextRoundDeadline && nextRoundInterval) {
    console.log('[TIMER] Blocked turnDeadline - next round countdown active');
    return;
  }

  if (!data || !data.deadline) {
    console.log('[TIMER] Clearing turn countdown');
    clearLocalCountdown();
  } else {
    console.log('[TIMER] Starting turn countdown:', new Date(data.deadline));
    startLocalCountdown(data.deadline);
  }
});

socket.on('returnToLobbyCountdown', data => {
  console.log('[RETURN COUNTDOWN] Received:', data);
  
  if (!data || !data.timeLeft) {
    // Hide countdown banner
    if (returnCountdownBanner) {
      returnCountdownBanner.classList.add('hidden');
    }
    return;
  }
  
  // Show and update countdown banner
  if (returnCountdownBanner && countdownNumber) {
    countdownNumber.textContent = data.timeLeft;
    returnCountdownBanner.classList.remove('hidden');
    
    // Add urgency styling for last 3 seconds
    if (data.timeLeft <= 3) {
      returnCountdownBanner.classList.add('urgent');
    } else {
      returnCountdownBanner.classList.remove('urgent');
    }
  }
});

// ======================
// TRIGGER / VICTORY / ELIMINATED events
// ======================
socket.on('triggerPull', data => {
  // 🛑 Never show trigger animation if victory is active or imminent
  if (appState.victoryActive || appState.uiMode === 'postgame') {
    console.log('[TRIGGER PULL] Blocked - victory is active');
    return;
  }
  
  // Additional check: if this is the last elimination that would trigger victory
  if (lastState && lastState.players) {
    const alivePlayers = lastState.players.filter(p => p.alive && !p.spectator);
    if (alivePlayers.length <= 1) {
      console.log('[TRIGGER PULL] Blocked - last man standing scenario');
      return;
    }
  }
  
  if (!canShowGameOverlays()) return;
  
  // 🎯 NEW: Enhanced trigger message based on roulette choices
  let message = `${data.loserName || 'Player'} is pulling the trigger...`;
  
  if (data.useSecondChance) {
    message = `${data.loserName} used their Second Chance Card! 🃏`;
  }
  
  if (data.timing === 'spinChamber') {
    message = `${data.loserName} spins the chamber... *click*`;
  }
  
  showGunAnimation(message);
});

// 🎯 NEW: Handle trigger animation cancellation for Final 2 disconnects
socket.on('cancelTriggerAnimation', () => {
  console.log('[CLIENT] Cancelling trigger animation due to disconnect');
  
  // Hide any active gun animation overlays
  const gunOverlay = document.getElementById('gunOverlay');
  if (gunOverlay) {
    gunOverlay.style.display = 'none';
  }
  
  // Clear any gun animation timeouts
  if (window.gunAnimationTimeout) {
    clearTimeout(window.gunAnimationTimeout);
    window.gunAnimationTimeout = null;
  }
  
  // Reset UI state
  appState.gunAnimationActive = false;
});


socket.on('victory', ({ winnerId, winnerName }) => {
  console.log('[CLIENT] Victory received:', winnerName);

  // 🔒 CRITICAL: Force victory mode FIRST to block all other UI
  appState.uiMode = 'postgame';
  appState.victoryActive = true;
  appState.winner = { id: winnerId, name: winnerName };

  // 🎯 IMPORTANT: Only show victory overlay if this player is NOT the one who just got eliminated
  const isWinner = winnerId === socket.id;
  const justGotEliminated = appState.isEliminated;

  if (justGotEliminated && !isWinner) {
    // 💀 This player just got eliminated - let them see the death animation only
    console.log('[VICTORY] Player just eliminated - showing death overlay only');
    
    // Clear competing overlays but keep death overlay
    hideRoundSummaryOverlay();
    hideGunAnimation();
    
    // Clear trigger animation state
    appState.triggerAnimationActive = false;
    
    // Clear queued overlays except death
    queuedRoundSummary = null;
    
    // Don't show victory overlay to eliminated player
    return;
  }

  // 🔥 FORCE HIDE all competing overlays for winner and spectators
  hideDeathOverlay();
  hideRoundSummaryOverlay();
  hideGunAnimation();
  hideRouletteChoice(); // Add this line
  
  // Clear trigger animation state
  appState.triggerAnimationActive = false;
  
  // Clear any queued overlays that might interfere
  queuedDeathData = null;
  queuedRoundSummary = null;

  // Clear all timers that might interfere
  clearAllTimers();

  // Force screen ownership - victory takes priority
  setScreen('postgame');

  // 🎯 ENHANCED: Show winner reveal pause for tension, then victory overlay
  const wasFinalTwo = appState.wasFinalTwo;
  if (wasFinalTwo) {
    // Final 2 victory - show dramatic pause
    showWinnerRevealPause(winnerName);
    setTimeout(() => {
      showVictoryOverlay(winnerName);
    }, 2500); // After winner reveal pause
  } else {
    // Regular victory
    setTimeout(() => {
      showVictoryOverlay(winnerName);
    }, 50);
  }
});

socket.on('gameReset', () => {
  console.log('[CLIENT] Game reset received - transitioning to lobby');

  // 🔒 Force clear ALL states immediately
  appState.winner = { id: null, name: null };
  appState.victoryActive = false;
  appState.isEliminated = false; // Clear elimination state
  appState.uiMode = 'lobby';

  // Clear all queued overlays and timers
  queuedDeathData = null;
  queuedRoundSummary = null;
  clearAllTimers();

  // Hide ALL overlays forcefully
  hideDeathOverlay();
  hideRoundSummaryOverlay();
  hideWinnerBanner();
  hideWinnerSummary();
  hideVictoryOverlay();
  hideGunAnimation();
  
  // Hide return countdown banner
  if (returnCountdownBanner) {
    returnCountdownBanner.classList.add('hidden');
  }

  // Clear animation states
  appState.triggerAnimationActive = false;

  // Clear body classes
  document.body.classList.remove('modal-open', 'victory-active');

  // 🔥 Force transition to lobby screen
  setScreen('lobby');

  // Re-enable lobby logic
  readyCountdownActive = false;

  console.log('[CLIENT] UI fully reset to lobby');
});



socket.on('eliminated', data => {
  console.log('[CLIENT] Player eliminated');
  
  // 🔥 CRITICAL: Set elimination flag immediately
  appState.isEliminated = true;

  // 🛑 Never process elimination overlay if victory is already active
  if (appState.victoryActive || appState.uiMode === 'postgame') {
    console.log('[ELIMINATED] Blocked - victory is active');
    return;
  }
  
  if (!canShowGameOverlays()) return;

  // 💀 Show death animation immediately
  showDeathOverlay('You have been eliminated', deathSound);
  
  // 👁️ After 5 seconds, transition to spectator mode
  setTimeout(() => {
    hideDeathOverlay();
    showSpectatorBanner();
    
    // Show spectator reactions if there's still a game going on
    if (lastState && lastState.roundActive) {
      showSpectatorReactions();
    }
    
    console.log('[ELIMINATED] Transitioned to spectator mode');
  }, 5000);
});


socket.on('readyCountdown', data => {
  if (!readyCountdownEl) return;

  // ⛔ Countdown stopped
  if (!data.endsAt) {
    readyCountdownEl.textContent = '';
    readyCountdownActive = false;

    if (startBtn) {
      startBtn.textContent = 'Start Round';
      startBtn.classList.remove('cancel');
    }

    if (readyCountdownInterval) {
      clearInterval(readyCountdownInterval);
      readyCountdownInterval = null;
    }
    return;
  }

  // ▶ Countdown active
  readyCountdownActive = true;

  if (startBtn) {
    startBtn.textContent = 'Cancel Start';
    startBtn.classList.add('cancel');
  }

  const update = () => {
    const ms = Math.max(0, data.endsAt - Date.now());
    const seconds = Math.ceil(ms / 1000);
    // FIX: Cap display at 60 seconds max to prevent display bugs
    const displaySeconds = Math.min(seconds, 60);
    readyCountdownEl.textContent =
      `Game starts in ${displaySeconds}s`;
  };

  update();
  readyCountdownInterval = setInterval(update, 500);
});

socket.on('nextRoundCountdown', data => {
  if (!turnTimerEl) return;

  // Countdown cancelled
  if (!data || !data.endsAt) {
    nextRoundDeadline = null;
    turnTimerEl.textContent = '--';
    turnTimerEl.classList.remove('warning');
    return;
  }

  nextRoundDeadline = data.endsAt;

  const update = () => {
    const ms = Math.max(0, nextRoundDeadline - Date.now());
    const s = Math.ceil(ms / 1000);
    // FIX: Cap display at 15 seconds max to prevent display bugs
    const displaySeconds = Math.min(s, 15);

    turnTimerEl.textContent = `Next round in: ${displaySeconds}s`;
    turnTimerEl.classList.add('warning');

    if (ms <= 0) {
      nextRoundDeadline = null;
      turnTimerEl.textContent = '--';
      turnTimerEl.classList.remove('warning');
      clearInterval(nextRoundInterval);
      nextRoundInterval = null;
    }
  };

  update();

  if (nextRoundInterval) clearInterval(nextRoundInterval);
  nextRoundInterval = setInterval(update, 500);
});

// ----------------- Round Summary listener -----------------
socket.on('roundSummary', summary => {
  // 🛑 CRITICAL: Never show round summary if victory is active
  if (appState.victoryActive || appState.uiMode === 'postgame') {
    console.log('[ROUND SUMMARY] Blocked - victory is active');
    return;
  }
  if (appState.winner.id) return;

  if (!canShowGameOverlays()) return;

  // 🛑 NEW: Don't show round summary during trigger animation
  if (appState.triggerAnimationActive) {
    console.log('[ROUND SUMMARY] Blocked - trigger animation active');
    return;
  }

  // 🏆 IF GAME IS OVER / WINNER EXISTS → DO NOT SHOW SUMMARY
  if (appState.uiMode === 'postgame' || appState.winner.id) {
    console.log('[ROUND SUMMARY] Skipped because game is over');
    return;
  }

  // 🎯 NEW: Show round summary to ALL players including spectators
  const me = lastState?.players?.find(p => p.id === socket.id);
  const isSpectator = me?.spectator === true;
  
  if (isSpectator) {
    console.log('[ROUND SUMMARY] Showing for spectator');
  } else {
    console.log('[ROUND SUMMARY] Showing for survivor');
  }
  
  showRoundSummaryOverlay(buildRoundSummaryHTML(summary));
});

// 🃏 NEW: Roulette choice event with Second Chance Card option
socket.on('rouletteChoice', (data) => {
  console.log('[ROULETTE CHOICE] Received for:', data.playerName, 'Data:', data);
  
  showRouletteChoice(data.playerName, (choices) => {
    console.log('[ROULETTE CHOICE] Submitting choices:', choices);
    socket.emit('submitRouletteChoice', choices);
  }, {
    hasSecondChance: data.hasSecondChance,
    playersRemaining: data.playersRemaining
  });
});

// 👁️ NEW: Spectator reaction received
socket.on('spectatorReactionReceived', (data) => {
  console.log('[SPECTATOR] Reaction received:', data);
  displayReactionOnScreen(data.emoji, data.playerName);
  
  // Apply curse effects randomly (cosmetic only)
  if (Math.random() < 0.3) { // 30% chance
    const curseType = Math.random() < 0.5 ? 'bad_luck' : 'good_luck';
    const gunOverlay = document.getElementById('gunOverlay');
    if (gunOverlay) {
      applyCurseEffect(gunOverlay, curseType);
    }
  }
});

// Handle spectator reaction events from UI
window.addEventListener('spectatorReaction', (e) => {
  const { emoji } = e.detail;
  console.log('[SPECTATOR] Sending reaction:', emoji);
  socket.emit('spectatorReaction', { emoji });
});

// 🎯 NEW: Handle join next game from spectator UI
window.addEventListener('joinNextGame', () => {
  console.log('[SPECTATOR] Requesting to join next game');
  socket.emit('joinNextGame');
});

// 🎯 NEW: Handle leave game from spectator UI
window.addEventListener('leaveGame', () => {
  console.log('[SPECTATOR] Requesting to leave game');
  
  // Use the existing cleanup function to return to intro
  cleanupAndReturnToIntro({ clearToken: true });
});

// 🤖 NEW: Handle practice mode start
window.addEventListener('startPracticeMode', (e) => {
  const settings = e.detail;
  console.log('[PRACTICE] Starting with settings:', settings);
  
  // Enable safe mode for practice
  window._BLACKJACK_SAFE_MODE = true;
  
  setRoomButtonsDisabled(true);
  socket.emit('createPracticeRoom', settings);
});

// 🤖 NEW: Practice room created
socket.on('practiceRoomCreated', (data) => {
  console.log('[PRACTICE] Room created:', data);
  
  currentRoomCode = data.roomCode;
  
  // Show success notification
  showSuccessNotification('Practice Room Created', `Created practice room with ${data.botCount} ${data.difficulty} bots`);
  
  // 🎯 NEW: Reset loading state for practice button
  if (practiceModeBtn) {
    practiceModeBtn.textContent = 'Practice Mode';
    practiceModeBtn.classList.remove('loading');
    practiceModeBtn.disabled = false;
  }
  
  // Show practice mode indicator
  showPracticeModeIndicator();
  
  // Set player name
  if (pendingPlayerName) {
    socket.emit('setName', pendingPlayerName);
    pendingPlayerName = null;
  }
  
  setRoomButtonsDisabled(false);
  setScreen('lobby');
});

// 🎯 NEW: Elimination mode change events
socket.on('eliminationModeChanged', (data) => {
  console.log('[ELIMINATION MODE] Mode changed to:', data.mode);
  
  // Update the selector if it exists
  if (eliminationModeSelect && eliminationModeSelect.value !== data.mode) {
    eliminationModeSelect.value = data.mode;
    updateModeDescription(data.mode);
  }
  
  // Show notification
  const modeNames = {
    'standard': 'Standard Mode',
    'lowestHand': 'Lowest-Hand Mode'
  };
  
  showInfoNotification(
    'Elimination Mode Changed', 
    `${data.hostName} set mode to: ${modeNames[data.mode]}`
  );
});

socket.on('eliminationModeError', (message) => {
  console.error('[ELIMINATION MODE] Error:', message);
  showErrorNotification('Cannot Change Mode', message);
});

// 🎯 NEW: Chamber spin event for enhanced realism
socket.on('chamberSpin', (data) => {
  console.log('[CHAMBER SPIN] Received for:', data.playerName);
  
  // 🎯 NEW: Play roulette spin sound immediately
  play(rouletteSpinSound);
  
  // Show spinning animation/effect
  const gunOverlay = document.getElementById('gunOverlay');
  if (gunOverlay) {
    // Add spinning effect class
    gunOverlay.classList.add('chamber-spinning');
    
    // Remove after 3 seconds
    setTimeout(() => {
      gunOverlay.classList.remove('chamber-spinning');
    }, 3000);
  }
});

// 🃏 NEW: Second Chance Card used event
socket.on('secondChanceUsed', (data) => {
  console.log('[SECOND CHANCE] Card used by:', data.playerName, 'Roll:', data.roll, 'Threshold:', data.threshold);
  
  // Play special sound effect
  play(survivalSound);
  
  // Show dramatic visual effect
  showSecondChanceEffect(data.playerName);
});

// ----------------- Small UI helpers -----------------
function updateLobbyButtons(hostId) {
  if (readyCountdownActive) return;
  const hostPanel = document.getElementById('hostControls');
  const readyPanel = document.getElementById('readyControls');

  // Always hide everything first
  hostPanel?.classList.add('hidden');
  readyPanel?.classList.add('hidden');


  if (!lastState || !Array.isArray(lastState.players)) return;

  const me = lastState.players.find(p => p.id === socket.id);
  if (!me) return;

  // ❌ SPECTATOR OR DEAD → NO CONTROLS, EVER
  if (me.spectator || !me.alive) {
    return;
  }

  // 🟡 HOST (alive only)
  if (me.host && hostId === socket.id) {
    hostPanel?.classList.remove('hidden');
    return;
  }

  // 🟢 NORMAL PLAYER
  readyPanel?.classList.remove('hidden');
}


function updateLobbyBanner(state) {

  const status = document.getElementById('lobbyStatus');
  if (!status || !state) return;

  if (state.hostId === socket.id) {
    status.textContent = 'You are the host. Start the round when ready.';
  } else {
    status.textContent = 'Waiting for host to start the game...';
  }
}

/* ---------------------------------------------------
   START / STOP functions for integration (added)
   - startBlackjackMinigame(playersList, hostId, options)
   - stopBlackjackMinigame()
   These let the main party UI turn your minigame on/off.
   options: { safeMode: true/false }
--------------------------------------------------- */
window.startBlackjackMinigame = function(playersList, hostId, options = {}) {
  try {
    window._BLACKJACK_SAFE_MODE = !!(options && options.safeMode);

    if (intro) intro.classList.add('hidden');
    if (lobby) lobby.classList.remove('hidden');

    if (playerListDiv) {
      playerListDiv.innerHTML = (playersList || []).map(p =>
        `<div>${escapeHTML(p.name)}${p.id === hostId ? " ⭐" : ""}</div>`
      ).join('');
    }

    lastState = lastState || {};
    lastState.hostId = hostId;

    console.log("Blackjack minigame started with players:", playersList, "safeMode:", window._BLACKJACK_SAFE_MODE);
  } catch (e) {
    console.error('startBlackjackMinigame error', e);
  }
};

window.stopBlackjackMinigame = function() {
  try {
    cleanupAndReturnToIntro({ clearToken: false });
    console.log('Blackjack minigame stopped.');
  } catch (e) {
    console.error('stopBlackjackMinigame error', e);
  }
};
/* --------------------------------------------------- */

(function initUI() {
  try {
    // HARD RESET: only intro screen is allowed on load
    setScreen('intro');


    // Disable gameplay controls
    hitBtn && (hitBtn.disabled = true);
    standBtn && (standBtn.disabled = true);

    // Reset state
    currentRoomCode = null;
    lastState = null;
    appState.isEliminated = false;


    console.log('[INIT] UI hard reset complete');
  } catch (e) {
    console.error('initUI error', e);
  }
})();

// =======================================
// BFCache HARD RESET 
// =======================================
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    console.warn('[BFCache] Page restored from cache — forcing hard UI reset');

    try {
      // kill all state
      currentRoomCode = null;
      lastState = null;
      appState.isEliminated = false;

      // FORCE screen visibility
      intro && intro.classList.remove('hidden');
      lobby && lobby.classList.add('hidden');
      game && game.classList.add('hidden');


      // buttons
      hitBtn && (hitBtn.disabled = true);
      standBtn && (standBtn.disabled = true);

      console.warn('[BFCache] UI forcibly reset');
    } catch (e) {
      console.error('[BFCache] reset failed', e);
    }
  }
});
// Only expose debug helpers in development mode
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
  window._rb = {
    cleanup: cleanupAndReturnToIntro,
    showGunAnimation,
    hideGunAnimation,
    showHowTo,
    hideHowTo
  };
}

window.addEventListener('victoryOverlayClosed', () => {
  console.log('[VICTORY] Overlay closed - preparing for lobby transition');
  
  if (appState.uiMode !== 'postgame') return;
  
  // Show winner summary briefly while waiting for server reset
  renderWinnerBanner();
  renderWinnerSummary();
  
  // The server should send gameReset within 8 seconds of victory
  // If it hasn't arrived yet, we wait for it
  // This ensures the transition is always server-controlled for consistency
});


// 🃏 Second Chance Card visual effect
function showSecondChanceEffect(playerName) {
  console.log('[SECOND CHANCE] Showing effect for:', playerName);
  
  // Create dramatic overlay effect
  const overlay = document.createElement('div');
  overlay.className = 'second-chance-overlay';
  overlay.innerHTML = `
    <div class="second-chance-content">
      <div class="second-chance-card">🃏</div>
      <div class="second-chance-text">${playerName} cheated death!</div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  // Animate in
  setTimeout(() => {
    overlay.classList.add('active');
  }, 100);
  
  // Remove after 3 seconds
  setTimeout(() => {
    overlay.classList.remove('active');
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 500);
  }, 3000);
}