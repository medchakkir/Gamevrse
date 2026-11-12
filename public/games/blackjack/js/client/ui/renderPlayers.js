// ui/renderPlayers.js - Enhanced with visual indicators
export function renderPlayers({
  state,
  playersWrap,
  escapeHTML,
  handValue,
  dangerLevel
}) {
  if (!playersWrap || !state || !Array.isArray(state.players)) return;

  const activePlayers = state.players.filter(p => p.alive && !p.spectator);
  const isFinalTwo = activePlayers.length === 2;

  if (!state.roundActive && activePlayers.length === 0) {
    playersWrap.textContent = 'Waiting for players...';
    return;
  }

  // Add Final 2 atmosphere
  if (isFinalTwo && state.roundActive) {
    document.body.classList.add('final-two-mode');
  } else {
    document.body.classList.remove('final-two-mode');
  }

  playersWrap.innerHTML = state.players.map(p => {
    const danger = dangerLevel(p);
    const isCurrentTurn = state.currentTurn === p.id;
    const isAlive = p.alive && !p.spectator;
    
    // Determine roulette eligibility (cosmetic only)
    let rouletteStatus = '';
    let rouletteStatusBadge = '';
    
    if (isAlive && state.roundActive) {
      if (p.busted || (danger === 'danger' && !p.busted)) {
        rouletteStatus = 'roulette-eligible';
        rouletteStatusBadge = '<div class="roulette-status-badge eligible">At Risk</div>';
      } else {
        rouletteStatus = 'roulette-safe';
        rouletteStatusBadge = '<div class="roulette-status-badge safe">Safe</div>';
      }
    }

    const playerClasses = [
      'player',
      danger,
      !p.alive ? 'eliminated' : '',
      isCurrentTurn ? 'current-turn' : '',
      rouletteStatus,
      // Only apply Final 2 spotlight to the current turn player to avoid confusion
      isFinalTwo && isAlive && isCurrentTurn ? 'final-two-spotlight' : ''
    ].filter(Boolean).join(' ');

    return `
  <div class="${playerClasses}" data-player-id="${p.id}" data-has-second-chance="${p.hasSecondChance || false}" style="position: relative;">
    ${isCurrentTurn ? '<div class="turn-indicator-arrow">▼</div>' : ''}
    ${rouletteStatusBadge}
    
    <strong>
      ${escapeHTML(p.name)}
      <span class="danger-tag">${danger.toUpperCase()}</span>
      ${p.host ? ' ⭐' : ''}
      ${isCurrentTurn ? ' ←' : ''}
    </strong>

    <div style="font-size:13px;margin:4px;color:#ffd966;">
      Wins: ${p.wins || 0}
    </div>

    <div class="cards">
      ${
        p.hand?.length
          ? p.hand.map(c =>
              `<div class="playing-card">${escapeHTML(c.rank)}${escapeHTML(c.suit)}</div>`
            ).join('')
          : `<div class="playing-card">-</div>`
      }
    </div>

    <div>Value: ${handValue(p.hand)}</div>
    <div>Status: ${
      p.spectator ? 'Spectating'
      : !p.alive ? 'Eliminated'
      : p.busted ? 'Busted'
      : p.stood ? 'Stood'
      : 'Playing'
    }</div>
    
    ${p.hasSecondChance ? 
      `<div class="second-chance-indicator">
        <span class="second-chance-icon">🃏</span>
        <span>Second Chance</span>
      </div>` : 
      ''
    }
  </div>
`;

  }).join('');
}
