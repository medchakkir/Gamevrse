// Socket events, continued (only attach if socket is present)
if (socket) {

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
}
