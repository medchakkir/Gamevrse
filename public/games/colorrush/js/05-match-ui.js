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
