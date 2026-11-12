// ui/spectatorFeatures.js - Spectator Experience Improvements
import { play, clickSound, spectatorJoinSound } from './audio.js';

const spectatorBanner = document.getElementById('spectatorBanner');
const spectatorReactions = document.getElementById('spectatorReactions');
const reactionBtns = document.querySelectorAll('.reaction-btn');
const joinNextGameBtn = document.getElementById('joinNextGameBtn');
const leaveGameBtn = document.getElementById('leaveGameBtn'); // 🎯 NEW: Leave game button

let reactionCooldown = false;
let lastReactionTime = 0;
const REACTION_COOLDOWN_MS = 2000; // 2 second cooldown between reactions

export function showSpectatorBanner() {
  if (!spectatorBanner) return;
  
  console.log('[SPECTATOR] Showing spectator banner');
  spectatorBanner.classList.remove('hidden');
  
  // 🎯 NEW: Play spectator join sound
  setTimeout(() => play(spectatorJoinSound), 200);
}

export function hideSpectatorBanner() {
  if (!spectatorBanner) return;
  
  console.log('[SPECTATOR] Hiding spectator banner');
  spectatorBanner.classList.add('hidden');
}

export function showSpectatorReactions() {
  if (!spectatorReactions) return;
  
  console.log('[SPECTATOR] Showing reaction buttons');
  spectatorReactions.classList.remove('hidden');
}

export function hideSpectatorReactions() {
  if (!spectatorReactions) return;
  
  console.log('[SPECTATOR] Hiding reaction buttons');
  spectatorReactions.classList.add('hidden');
}

export function sendReaction(emoji, callback) {
  const now = Date.now();
  
  // Rate limiting
  if (reactionCooldown || (now - lastReactionTime) < REACTION_COOLDOWN_MS) {
    console.log('[SPECTATOR] Reaction rate limited');
    return false;
  }
  
  lastReactionTime = now;
  reactionCooldown = true;
  
  // Visual feedback
  createFloatingReaction(emoji);
  play(clickSound);
  
  // Send to server
  if (callback) {
    callback(emoji);
  }
  
  // Reset cooldown
  setTimeout(() => {
    reactionCooldown = false;
  }, REACTION_COOLDOWN_MS);
  
  return true;
}

export function applyCurseEffect(targetElement, curseType) {
  if (!targetElement) return;
  
  console.log('[SPECTATOR] Applying curse effect:', curseType);
  
  // Remove any existing curse effects
  targetElement.classList.remove('curse-red-glow', 'curse-green-luck');
  
  // Apply new curse effect
  if (curseType === 'bad_luck') {
    targetElement.classList.add('curse-red-glow');
  } else if (curseType === 'good_luck') {
    targetElement.classList.add('curse-green-luck');
  }
  
  // Auto-clear after 3 seconds
  setTimeout(() => {
    targetElement.classList.remove('curse-red-glow', 'curse-green-luck');
  }, 3000);
}

export function displayReactionOnScreen(emoji, playerName) {
  // Create floating reaction with player name
  const reaction = document.createElement('div');
  reaction.className = 'floating-reaction';
  reaction.innerHTML = `${emoji}<br><small>${playerName}</small>`;
  
  // Random position on screen
  const x = Math.random() * (window.innerWidth - 100);
  const y = window.innerHeight - 100;
  
  reaction.style.left = x + 'px';
  reaction.style.top = y + 'px';
  
  document.body.appendChild(reaction);
  
  // Remove after animation
  setTimeout(() => {
    if (reaction.parentNode) {
      reaction.remove();
    }
  }, 3000);
}

function createFloatingReaction(emoji) {
  const reaction = document.createElement('div');
  reaction.className = 'floating-reaction';
  reaction.textContent = emoji;
  
  // Position near the reaction buttons
  const rect = spectatorReactions?.getBoundingClientRect();
  if (rect) {
    reaction.style.left = (rect.left + Math.random() * rect.width) + 'px';
    reaction.style.top = (rect.top - 20) + 'px';
  } else {
    reaction.style.right = '20px';
    reaction.style.bottom = '100px';
  }
  
  document.body.appendChild(reaction);
  
  // Remove after animation
  setTimeout(() => {
    if (reaction.parentNode) {
      reaction.remove();
    }
  }, 3000);
}

// Event listeners for reaction buttons
reactionBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.reaction;
    if (emoji) {
      // This will be connected to the socket in the main client file
      window.dispatchEvent(new CustomEvent('spectatorReaction', { 
        detail: { emoji } 
      }));
    }
  });
});

// 🎯 NEW: Event listener for Join Next Game button
if (joinNextGameBtn) {
  joinNextGameBtn.addEventListener('click', () => {
    console.log('[SPECTATOR] Join Next Game clicked');
    
    // Dispatch event to main client
    window.dispatchEvent(new CustomEvent('joinNextGame'));
    
    play(clickSound);
    
    // Provide visual feedback
    joinNextGameBtn.textContent = 'Joining...';
    joinNextGameBtn.disabled = true;
    
    // Reset button after 3 seconds
    setTimeout(() => {
      if (joinNextGameBtn) {
        joinNextGameBtn.textContent = 'Join Next Game';
        joinNextGameBtn.disabled = false;
      }
    }, 3000);
  });
}

// 🎯 NEW: Event listener for Leave Game button
if (leaveGameBtn) {
  leaveGameBtn.addEventListener('click', () => {
    console.log('[SPECTATOR] Leave Game clicked');
    
    // Confirm before leaving
    if (confirm('Are you sure you want to leave the game? You will return to the main screen.')) {
      // Dispatch event to main client to handle leaving
      window.dispatchEvent(new CustomEvent('leaveGame'));
      
      play(clickSound);
      
      // Provide visual feedback
      leaveGameBtn.textContent = 'Leaving...';
      leaveGameBtn.disabled = true;
    }
  });
}

// Keyboard shortcuts for reactions (for spectators)
document.addEventListener('keydown', (e) => {
  // Only if spectator reactions are visible
  if (spectatorReactions && !spectatorReactions.classList.contains('hidden')) {
    const reactionMap = {
      '1': '😱',
      '2': '🙏', 
      '3': '💀',
      '4': '🍀',
      '5': '😬',
      '6': '🔥'
    };
    
    const emoji = reactionMap[e.key];
    if (emoji) {
      window.dispatchEvent(new CustomEvent('spectatorReaction', { 
        detail: { emoji } 
      }));
    }
  }
});