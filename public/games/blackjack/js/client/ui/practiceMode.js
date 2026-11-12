// ui/practiceMode.js - Practice Mode with Bots
import { trapFocus } from './focusTrap.js';
import { play, clickSound, roundStartSound } from './audio.js';

const practiceModeOverlay = document.getElementById('practiceModeOverlay');
const startPracticeBtn = document.getElementById('startPracticeBtn');
const cancelPracticeBtn = document.getElementById('cancelPracticeBtn');

let practiceSettings = {
  botCount: 1,
  difficulty: 'normal',
  eliminationMode: 'standard'
};

export function showPracticeSetup() {
  if (!practiceModeOverlay) return;

  console.log('[PRACTICE] Showing setup modal');
  
  practiceModeOverlay.classList.remove('hidden');
  practiceModeOverlay.setAttribute('aria-hidden', 'false');
  
  document.body.classList.add('modal-open');
  trapFocus(practiceModeOverlay);

  // Focus start button
  setTimeout(() => {
    if (startPracticeBtn) startPracticeBtn.focus();
  }, 100);
}

export function hidePracticeSetup() {
  if (!practiceModeOverlay) return;

  console.log('[PRACTICE] Hiding setup modal');
  
  practiceModeOverlay.classList.add('hidden');
  practiceModeOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

export function getPracticeSettings() {
  return { ...practiceSettings };
}

export function showPracticeModeIndicator() {
  // Create practice mode indicator
  const indicator = document.createElement('div');
  indicator.id = 'practiceModeIndicator';
  indicator.className = 'practice-mode-indicator';
  indicator.innerHTML = '🤖 Practice Mode';
  document.body.appendChild(indicator);
}

export function hidePracticeModeIndicator() {
  const indicator = document.getElementById('practiceModeIndicator');
  if (indicator) {
    indicator.remove();
  }
}

// Event listeners for bot count selection
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('bot-count-btn')) {
    // Remove selected from all bot count buttons
    document.querySelectorAll('.bot-count-btn').forEach(btn => {
      btn.classList.remove('selected');
    });
    
    // Add selected to clicked button
    e.target.classList.add('selected');
    practiceSettings.botCount = parseInt(e.target.dataset.count);
    
    play(clickSound);
    console.log('[PRACTICE] Bot count set to:', practiceSettings.botCount);
  }
});

// Event listeners for difficulty selection
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('difficulty-btn') || e.target.parentElement.classList.contains('difficulty-btn')) {
    const btn = e.target.classList.contains('difficulty-btn') ? e.target : e.target.parentElement;
    
    // Remove selected from all difficulty buttons
    document.querySelectorAll('.difficulty-btn').forEach(button => {
      button.classList.remove('selected');
    });
    
    // Add selected to clicked button
    btn.classList.add('selected');
    practiceSettings.difficulty = btn.dataset.difficulty;
    
    play(clickSound);
    console.log('[PRACTICE] Difficulty set to:', practiceSettings.difficulty);
  }
});

// Event listeners for elimination mode selection
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('elimination-mode-btn') || e.target.parentElement.classList.contains('elimination-mode-btn')) {
    const btn = e.target.classList.contains('elimination-mode-btn') ? e.target : e.target.parentElement;
    
    // Remove selected from all elimination mode buttons
    document.querySelectorAll('.elimination-mode-btn').forEach(button => {
      button.classList.remove('selected');
    });
    
    // Add selected to clicked button
    btn.classList.add('selected');
    practiceSettings.eliminationMode = btn.dataset.mode;
    
    play(clickSound);
    console.log('[PRACTICE] Elimination mode set to:', practiceSettings.eliminationMode);
  }
});

// Start practice button
if (startPracticeBtn) {
  startPracticeBtn.addEventListener('click', () => {
    console.log('[PRACTICE] Starting practice mode with settings:', practiceSettings);
    
    // 🎯 NEW: Play round start sound for practice mode
    play(roundStartSound);
    
    // Dispatch event to main client
    window.dispatchEvent(new CustomEvent('startPracticeMode', {
      detail: practiceSettings
    }));
    
    hidePracticeSetup();
    play(clickSound);
  });
}

// Cancel button
if (cancelPracticeBtn) {
  cancelPracticeBtn.addEventListener('click', () => {
    hidePracticeSetup();
    play(clickSound);
  });
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (practiceModeOverlay && !practiceModeOverlay.classList.contains('hidden')) {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        startPracticeBtn?.click();
        break;
      case 'Escape':
        hidePracticeSetup();
        break;
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
        const count = parseInt(e.key);
        const countBtn = document.querySelector(`[data-count="${count}"]`);
        if (countBtn) countBtn.click();
        break;
    }
  }
});