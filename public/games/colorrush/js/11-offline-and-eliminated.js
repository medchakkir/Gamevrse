if (!socket) {
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
      setTimeout(() => { try { document.getElementById("enterBtn")?.click(); } catch(e) { /* fallback */ } }, 150);
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
