// ui/victoryOverlay.js - COMPLETE READY-TO-USE FILE
import { trapFocus } from './focusTrap.js';
import { play, clickSound } from './audio.js';
import { state } from '../state.js';

const victoryOverlay = document.getElementById('victoryOverlay');
const victoryNameEl = document.getElementById('victoryName');
const victoryClose = document.getElementById('victoryClose');
const confettiContainer = document.getElementById('confettiContainer');

let confettiInterval = null;
let autoCloseTimer = null;

export function showVictoryOverlay(winnerName) {
  console.log('[VICTORY OVERLAY] Showing for:', winnerName);
  
  if (!victoryOverlay || !victoryNameEl) {
    console.error('[VICTORY OVERLAY] Elements not found!');
    return;
  }

  // 🔒 CRITICAL: Force victory state FIRST to block all competing overlays
  state.victoryActive = true;
  state.uiMode = 'postgame';

  // 🔥 FORCE HIDE all competing overlays immediately
  const competingOverlays = [
    document.getElementById('deathOverlay'),
    document.getElementById('roundSummaryOverlay'),
    document.getElementById('gunOverlay'),
    document.getElementById('howToOverlay')
  ];
  
  competingOverlays.forEach(overlay => {
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
    }
  });

  // Clear any modal-open states from other overlays
  document.body.classList.remove('modal-open');
  
  // Set victory content and show
  victoryNameEl.textContent = winnerName;
  victoryOverlay.classList.remove('hidden');
  victoryOverlay.setAttribute('aria-hidden', 'false');
  
  // Apply victory-specific body classes
  document.body.classList.add('modal-open', 'victory-active');
  
  trapFocus(victoryOverlay);
  startConfetti();

  setTimeout(() => {
    if (victoryClose) victoryClose.focus();
  }, 100);

  // 🔄 Auto-close after 8 seconds (matching server timeout)
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  autoCloseTimer = setTimeout(() => {
    console.log('[VICTORY OVERLAY] Auto-closing after 8 seconds');
    hideVictoryOverlay();
  }, 8000);
}

export function hideVictoryOverlay() {
  console.log('[VICTORY OVERLAY] Hiding');

  if (!victoryOverlay) return;

  // Fix aria-hidden focus bug
  if (victoryOverlay.contains(document.activeElement)) {
    document.activeElement.blur();
  }

  victoryOverlay.classList.add('hidden');
  victoryOverlay.setAttribute('aria-hidden', 'true');

  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  stopConfetti();
  
  document.body.classList.remove('modal-open', 'victory-active');

  // 🔓 RELEASE UI OWNERSHIP - but keep postgame mode until server resets
  state.victoryActive = false;

  // Dispatch event for any cleanup needed
  window.dispatchEvent(new Event('victoryOverlayClosed'));
}

function startConfetti() {
  if (!confettiContainer) return;

  confettiContainer.innerHTML = '';

  const colors = ['#ffd966', '#ff6b6b', '#4ecdc4', '#45b7d1', '#f7b731', '#ff9ff3'];

  confettiInterval = setInterval(() => {
    for (let i = 0; i < 3; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti';
      confetti.style.left = Math.random() * 100 + '%';
      confetti.style.background = colors[Math.floor(Math.random() * colors.length)];
      confetti.style.animationDelay = Math.random() * 0.5 + 's';
      confetti.style.animationDuration = (Math.random() * 2 + 2) + 's';
      
      const size = Math.random() * 6 + 4;
      confetti.style.width = size + 'px';
      confetti.style.height = size + 'px';
      
      confettiContainer.appendChild(confetti);

      setTimeout(() => {
        if (confetti.parentNode) confetti.remove();
      }, 4000);
    }
  }, 150);
}

function stopConfetti() {
  if (confettiInterval) {
    clearInterval(confettiInterval);
    confettiInterval = null;
  }
  if (confettiContainer) confettiContainer.innerHTML = '';
}

if (victoryClose) {
  victoryClose.addEventListener('click', () => {
    hideVictoryOverlay();

    play(clickSound);
  });
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && victoryOverlay && !victoryOverlay.classList.contains('hidden')) {
    hideVictoryOverlay();
  }
});

if (victoryOverlay) {
  victoryOverlay.addEventListener('click', (e) => {
    if (e.target === victoryOverlay) {
      hideVictoryOverlay();
    }
  });
}



