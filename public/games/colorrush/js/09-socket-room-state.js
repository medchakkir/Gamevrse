// Socket events, continued (only attach if socket is present)
if (socket) {

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
}
