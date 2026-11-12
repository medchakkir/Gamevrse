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
}
