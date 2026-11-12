// ui/renderLobby.js
export function renderLobbyPlayers({
  list,
  playerListDiv,
  playersHeader,
  escapeHTML,
  winnerId = null,
  isHost = false,
  mySocketId = null,
  roundActive = false
}) {
  if (!playerListDiv) return;

  const MAX_PLAYERS = 6;
  const rows = [];

  if (playersHeader) {
  const activeCount = list.filter(p => !p.spectator).length;
  playersHeader.textContent = `Players (${activeCount} / ${MAX_PLAYERS})`;
}

  list.forEach(p => {
    // Show kick button only for host, in lobby, and not for themselves
    const showKickButton = isHost && !roundActive && p.id !== mySocketId && !p.spectator;
    
    rows.push(`
          <div class="player-row
           ${p.id === winnerId ? 'winner' : ''}
           ${p.host ? 'host' : ''}
           ${p.spectator ? 'spectator' : ''}"
           data-player-id="${p.id}">
        <span>
           ${escapeHTML(p.name)} ${p.id === winnerId ? '🏆' : ''}
           ${p.spectator ? ' 👁️' : ''}
           ${!p.spectator && p.ready ? ' ✅' : ''}
           ${p.host ? ' ⭐ Host' : ''}
        </span>
        <div class="player-row-actions">
          <span class="player-wins">${p.wins || 0} wins</span>
          ${showKickButton ? `<button class="kick-btn" data-player-id="${p.id}" data-player-name="${escapeHTML(p.name)}" title="Kick ${escapeHTML(p.name)}">✕</button>` : ''}
        </div>
      </div>
    `);
  });

  for (let i = list.length; i < MAX_PLAYERS; i++) {
    rows.push(`
      <div class="player-row" style="opacity:.4">
        <span>Waiting for player...</span>
        <div class="player-row-actions">
          <span class="player-wins">—</span>
        </div>
      </div>
    `);
  }

  playerListDiv.innerHTML = rows.join('');
  
  // Add event listeners for kick buttons
  if (isHost && !roundActive) {
    const kickButtons = playerListDiv.querySelectorAll('.kick-btn');
    kickButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const playerId = btn.getAttribute('data-player-id');
        const playerName = btn.getAttribute('data-player-name');
        
        console.log('[KICK CLIENT] Kick button clicked for:', { playerId, playerName });
        
        // Dispatch custom event for kick confirmation
        window.dispatchEvent(new CustomEvent('requestKickPlayer', {
          detail: { playerId, playerName }
        }));
      });
    });
  }
}
