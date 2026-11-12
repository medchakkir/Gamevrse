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
