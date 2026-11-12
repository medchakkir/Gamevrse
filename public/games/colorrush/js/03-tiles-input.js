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
