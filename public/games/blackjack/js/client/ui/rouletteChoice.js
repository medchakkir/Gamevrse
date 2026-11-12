// ui/rouletteChoice.js - Second Chance Card System
import { trapFocus } from './focusTrap.js';
import { play, clickSound } from './audio.js';

const rouletteChoiceOverlay = document.getElementById('rouletteChoiceOverlay');
const roulettePlayerName = document.getElementById('roulettePlayerName');
const rouletteCountdown = document.getElementById('rouletteCountdown');
const rouletteCountdownNumber = document.getElementById('rouletteCountdownNumber');

// Risk-reward buttons (Second Chance Card replaces Double or Nothing)
const normalRiskBtn = document.getElementById('normalRiskBtn');
const secondChanceBtn = document.getElementById('doubleOrNothingBtn'); // Reuse the same button

// Timing buttons
const pullNowBtn = document.getElementById('pullNowBtn');
const spinChamberBtn = document.getElementById('spinChamberBtn');

// Confirm button
const confirmChoicesBtn = document.getElementById('confirmChoicesBtn');

let rouletteTimer = null;
let countdownInterval = null;
let currentChoices = {
  useSecondChance: false, // 'false' or 'true'
  timing: 'pullNow'       // 'pullNow' or 'spinChamber'
};
let choiceCallback = null;
let hasSecondChanceCard = false;

export function showRouletteChoice(playerName, callback, options = {}) {
  if (!rouletteChoiceOverlay || !roulettePlayerName) return;

  console.log('[ROULETTE CHOICE] Showing for:', playerName, 'Options:', options);

  // Reset choices to defaults
  currentChoices = { useSecondChance: false, timing: 'pullNow' };
  choiceCallback = callback;
  
  // Store Second Chance Card availability
  hasSecondChanceCard = options.hasSecondChance === true;
  
  console.log('[ROULETTE CHOICE] Player has Second Chance Card:', hasSecondChanceCard);
  
  updateButtonStates();

  roulettePlayerName.textContent = playerName;
  rouletteChoiceOverlay.classList.remove('hidden');
  rouletteChoiceOverlay.setAttribute('aria-hidden', 'false');
  
  document.body.classList.add('modal-open');
  trapFocus(rouletteChoiceOverlay);

  // Start 30-second countdown
  startCountdown();

  // Focus first available button for accessibility
  setTimeout(() => {
    if (normalRiskBtn) normalRiskBtn.focus();
  }, 100);
}

export function hideRouletteChoice() {
  if (!rouletteChoiceOverlay) return;

  console.log('[ROULETTE CHOICE] Hiding');

  if (rouletteTimer) {
    clearTimeout(rouletteTimer);
    rouletteTimer = null;
  }

  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }

  rouletteChoiceOverlay.classList.add('hidden');
  rouletteChoiceOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
}

function startCountdown() {
  let timeLeft = 30; // Increased to 30 seconds
  
  const updateCountdown = () => {
    if (rouletteCountdownNumber) {
      rouletteCountdownNumber.textContent = timeLeft;
    }
    
    // Add urgent class when under 5 seconds
    if (timeLeft <= 5 && rouletteCountdown) {
      rouletteCountdown.classList.add('urgent');
    } else if (rouletteCountdown) {
      rouletteCountdown.classList.remove('urgent');
    }
    
    timeLeft--;
  };

  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);

  // Auto-submit after 30 seconds
  rouletteTimer = setTimeout(() => {
    console.log('[ROULETTE CHOICE] Auto-submitting default choices');
    submitChoices();
  }, 30000);
}

function submitChoices() {
  hideRouletteChoice();
  
  console.log('[ROULETTE CHOICE] Submitted:', currentChoices);
  
  if (choiceCallback) {
    choiceCallback(currentChoices);
    choiceCallback = null;
  }
}

function updateButtonStates() {
  console.log('[ROULETTE CHOICE] Updating button states - Has Second Chance:', hasSecondChanceCard);
  
  // Update risk buttons
  if (normalRiskBtn && secondChanceBtn) {
    normalRiskBtn.classList.toggle('selected', !currentChoices.useSecondChance);
    secondChanceBtn.classList.toggle('selected', currentChoices.useSecondChance);
    
    // Enable/disable Second Chance Card button based on availability
    if (!hasSecondChanceCard) {
      secondChanceBtn.disabled = true;
      secondChanceBtn.classList.add('disabled');
      secondChanceBtn.title = 'No Second Chance Card available';
      
      console.log('[ROULETTE CHOICE] Second Chance Card DISABLED - not available');
      
      // Force selection to normal if Second Chance was selected
      if (currentChoices.useSecondChance) {
        console.log('[ROULETTE CHOICE] Forcing selection back to Normal');
        currentChoices.useSecondChance = false;
        normalRiskBtn.classList.add('selected');
        secondChanceBtn.classList.remove('selected');
      }
    } else {
      secondChanceBtn.disabled = false;
      secondChanceBtn.classList.remove('disabled');
      secondChanceBtn.title = 'Use your Second Chance Card to avoid elimination';
      console.log('[ROULETTE CHOICE] Second Chance Card ENABLED');
    }
  }

  // Update timing buttons (removed waitBtn)
  if (pullNowBtn && spinChamberBtn) {
    pullNowBtn.classList.toggle('selected', currentChoices.timing === 'pullNow');
    spinChamberBtn.classList.toggle('selected', currentChoices.timing === 'spinChamber');
  }
}

// Event listeners for risk-reward choices
if (normalRiskBtn) {
  normalRiskBtn.addEventListener('click', () => {
    currentChoices.useSecondChance = false;
    updateButtonStates();
    play(clickSound);
  });
}

if (secondChanceBtn) {
  secondChanceBtn.addEventListener('click', () => {
    // Check if Second Chance Card is available
    if (secondChanceBtn.disabled || secondChanceBtn.classList.contains('disabled')) {
      console.log('[ROULETTE CHOICE] Second Chance Card is disabled (UI level)');
      return;
    }
    
    // Check if player has Second Chance Card
    if (!hasSecondChanceCard) {
      console.log('[ROULETTE CHOICE] Second Chance Card blocked - not available');
      return;
    }
    
    currentChoices.useSecondChance = true;
    updateButtonStates();
    play(clickSound);
  });
}

// Event listeners for timing choices (removed waitBtn)
if (pullNowBtn) {
  pullNowBtn.addEventListener('click', () => {
    currentChoices.timing = 'pullNow';
    updateButtonStates();
    play(clickSound);
  });
}

if (spinChamberBtn) {
  spinChamberBtn.addEventListener('click', () => {
    currentChoices.timing = 'spinChamber';
    updateButtonStates();
    play(clickSound);
  });
}

// Event listener for confirm button
if (confirmChoicesBtn) {
  confirmChoicesBtn.addEventListener('click', () => {
    console.log('[ROULETTE CHOICE] User confirmed choices');
    submitChoices();
    play(clickSound);
  });
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (rouletteChoiceOverlay && !rouletteChoiceOverlay.classList.contains('hidden')) {
    switch (e.key) {
      case '1':
        currentChoices.useSecondChance = false;
        updateButtonStates();
        break;
      case '2':
        // Check if Second Chance Card is available
        if (secondChanceBtn && !secondChanceBtn.disabled && !secondChanceBtn.classList.contains('disabled') && hasSecondChanceCard) {
          currentChoices.useSecondChance = true;
          updateButtonStates();
        } else {
          console.log('[ROULETTE CHOICE] Second Chance Card keyboard shortcut blocked');
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        // Submit current choices immediately
        submitChoices();
        break;
      case 'Escape':
        // Allow escape to auto-submit defaults
        submitChoices();
        break;
    }
  }
});