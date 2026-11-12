// ui/tutorialMode.js - Interactive Tutorial Mode
import { trapFocus } from './focusTrap.js';
import { play, clickSound, hitSound, standSound, gunSound, survivalSound } from './audio.js';

const tutorialOverlay = document.getElementById('tutorialOverlay');
const tutorialModal = document.getElementById('tutorialModal');
const tutorialTitle = document.getElementById('tutorialTitle');
const tutorialContent = document.getElementById('tutorialContent');
const tutorialActions = document.getElementById('tutorialActions');
const skipTutorialBtn = document.getElementById('skipTutorialBtn');

let currentPhase = 0;
let currentStep = 0;
let tutorialState = null;
let tutorialSocket = null;

// Tutorial phases and steps
const tutorialPhases = [
  {
    title: "Phase 1: Blackjack Basics",
    steps: [
      {
        title: "Welcome to Blackjack Roulette!",
        content: "Let's learn by playing! You'll get cards and make decisions.",
        action: "continue"
      },
      {
        title: "Your Hand Value",
        content: "Try to get close to 21 without going over. Face cards = 10, Aces = 1 or 11.",
        action: "deal_safe_hand",
        highlight: "hand"
      },
      {
        title: "Hit for Another Card",
        content: "You have 12. It's safe to hit - you can't bust!",
        action: "force_hit",
        highlight: "hit_button"
      },
      {
        title: "Standing",
        content: "Good! Now you have 19. Click Stand to keep your hand.",
        action: "show_stand_option",
        highlight: "stand_button"
      },
      {
        title: "Busting Example",
        content: "Let's see what happens when you go over 21...",
        action: "deal_bust_hand"
      },
      {
        title: "You Busted!",
        content: "Your hand went over 21. This puts you at higher risk for elimination!",
        action: "continue",
        highlight: "hand"
      }
    ]
  },
  {
    title: "Phase 2: Elimination Logic",
    steps: [
      {
        title: "How Winners and Losers Are Chosen",
        content: "At the end of each round, someone goes to the roulette. Let's see how...",
        action: "setup_elimination_demo"
      },
      {
        title: "Busted Players Go First",
        content: "See the red player? They busted, so they're chosen for roulette first.",
        action: "show_bust_priority",
        highlight: "busted_player"
      },
      {
        title: "No Busts? Lowest Hand Goes",
        content: "When no one busts, the player with the lowest hand faces elimination.",
        action: "show_lowest_hand",
        highlight: "lowest_player"
      },
      {
        title: "The Roulette",
        content: "The chosen player pulls the trigger. Roll 1-2 = eliminated, 3-6 = safe.",
        action: "demo_roulette"
      }
    ]
  },
  {
    title: "Phase 3: Advanced Rules",
    steps: [
      {
        title: "Game Modes",
        content: "Standard Mode: Busted players prioritized. Lowest-Hand Mode: Always lowest hand.",
        action: "explain_modes"
      },
      {
        title: "Second Chance Cards",
        content: "Each player gets one per game. Use it to guarantee survival!",
        action: "demo_second_chance",
        highlight: "second_chance"
      },
      {
        title: "Final 2 Special Rule",
        content: "In Final 2: If one player busts, they go to roulette regardless of mode.",
        action: "explain_final_two"
      },
      {
        title: "You're Ready!",
        content: "Great job! You now know how to play Blackjack Roulette. Good luck!",
        action: "complete"
      }
    ]
  }
];

export function showTutorial() {
  if (!tutorialOverlay) return;

  console.log('[TUTORIAL] Starting tutorial mode');
  
  currentPhase = 0;
  currentStep = 0;
  
  tutorialOverlay.classList.remove('hidden');
  tutorialOverlay.setAttribute('aria-hidden', 'false');
  
  document.body.classList.add('modal-open');
  trapFocus(tutorialOverlay);

  // Initialize tutorial state
  tutorialState = {
    phase: 'tutorial',
    players: [
      {
        id: 'tutorial_player',
        name: 'You',
        hand: [],
        alive: true,
        busted: false,
        stood: false,
        host: true,
        wins: 0,
        spectator: false,
        hasSecondChance: true,
        secondChanceUsed: false
      }
    ],
    currentTurn: 'tutorial_player',
    roundActive: false,
    gameOver: false,
    eliminationMode: 'standard'
  };

  startTutorialPhase();
}

export function hideTutorial() {
  if (!tutorialOverlay) return;

  console.log('[TUTORIAL] Hiding tutorial');
  
  tutorialOverlay.classList.add('hidden');
  tutorialOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  
  // Clean up tutorial state
  currentPhase = 0;
  currentStep = 0;
  tutorialState = null;
  
  // Remove any tutorial highlights
  clearTutorialHighlights();
}

function startTutorialPhase() {
  const phase = tutorialPhases[currentPhase];
  if (!phase) {
    completeTutorial();
    return;
  }

  console.log(`[TUTORIAL] Starting phase ${currentPhase + 1}: ${phase.title}`);
  
  tutorialTitle.textContent = phase.title;
  currentStep = 0;
  
  showTutorialStep();
}

function showTutorialStep() {
  const phase = tutorialPhases[currentPhase];
  const step = phase.steps[currentStep];
  
  if (!step) {
    // Move to next phase
    currentPhase++;
    startTutorialPhase();
    return;
  }

  console.log(`[TUTORIAL] Step ${currentStep + 1}: ${step.title}`);
  
  // Clear previous highlights
  clearTutorialHighlights();
  
  // Update content
  tutorialContent.innerHTML = `
    <h3>${step.title}</h3>
    <p>${step.content}</p>
  `;
  
  // Handle step action FIRST (sets up game state)
  handleTutorialAction(step);
  
  // Update actions AFTER (creates buttons and enables them)
  updateTutorialActions(step);
  
  // Add highlight if specified
  if (step.highlight) {
    addTutorialHighlight(step.highlight);
  }
}

function handleTutorialAction(step) {
  switch (step.action) {
    case 'continue':
      // Just show continue button
      break;
      
    case 'deal_safe_hand':
      // Give player a safe hand (12)
      tutorialState.players[0].hand = [
        { rank: '7', suit: '♠' },
        { rank: '5', suit: '♥' }
      ];
      tutorialState.players[0].busted = false;
      tutorialState.players[0].stood = false;
      tutorialState.roundActive = true;
      updateTutorialDisplay();
      break;
      
    case 'force_hit':
      // Player has 12, should hit
      // Buttons will be enabled in updateTutorialActions
      break;
      
    case 'show_stand_option':
      // This step is shown AFTER the player clicked Hit
      // The hand should already have 19 from handleTutorialHit
      // Just enable the Stand button
      break;
      
    case 'deal_bust_hand':
      // Give player a hand that will bust
      tutorialState.players[0].hand = [
        { rank: 'K', suit: '♠' },
        { rank: '8', suit: '♥' },
        { rank: '6', suit: '♦' }
      ];
      tutorialState.players[0].busted = true;
      tutorialState.players[0].stood = false;
      tutorialState.roundActive = false;
      updateTutorialDisplay();
      break;
      
    case 'setup_elimination_demo':
      setupEliminationDemo();
      break;
      
    case 'show_bust_priority':
      highlightBustedPlayer();
      break;
      
    case 'show_lowest_hand':
      showLowestHandDemo();
      break;
      
    case 'demo_roulette':
      demoRoulette();
      break;
      
    case 'explain_modes':
      explainGameModes();
      break;
      
    case 'demo_second_chance':
      demoSecondChance();
      break;
      
    case 'explain_final_two':
      explainFinalTwo();
      break;
      
    case 'complete':
      // Tutorial complete
      break;
  }
}

function setupEliminationDemo() {
  // Create multiple players for demonstration
  tutorialState.players = [
    {
      id: 'player1',
      name: 'You',
      hand: [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }], // 19
      alive: true,
      busted: false,
      stood: true
    },
    {
      id: 'player2',
      name: 'Alice',
      hand: [{ rank: 'K', suit: '♠' }, { rank: '8', suit: '♥' }, { rank: '5', suit: '♦' }], // 23 - busted
      alive: true,
      busted: true,
      stood: false
    },
    {
      id: 'player3',
      name: 'Bob',
      hand: [{ rank: '10', suit: '♣' }, { rank: '7', suit: '♠' }], // 17
      alive: true,
      busted: false,
      stood: true
    }
  ];
  updateTutorialDisplay();
}

function highlightBustedPlayer() {
  // Highlight the busted player
  addTutorialHighlight('player2');
}

function showLowestHandDemo() {
  // Remove busted player, show lowest hand selection
  tutorialState.players = [
    {
      id: 'player1',
      name: 'You',
      hand: [{ rank: '10', suit: '♠' }, { rank: '9', suit: '♥' }], // 19
      alive: true,
      busted: false,
      stood: true
    },
    {
      id: 'player3',
      name: 'Bob',
      hand: [{ rank: '10', suit: '♣' }, { rank: '5', suit: '♠' }], // 15 - lowest
      alive: true,
      busted: false,
      stood: true
    },
    {
      id: 'player4',
      name: 'Carol',
      hand: [{ rank: '9', suit: '♦' }, { rank: '8', suit: '♣' }], // 17
      alive: true,
      busted: false,
      stood: true
    }
  ];
  updateTutorialDisplay();
  addTutorialHighlight('player3');
}

function demoRoulette() {
  // Show roulette animation
  tutorialContent.innerHTML += `
    <div class="tutorial-roulette-demo">
      <div class="roulette-visual">🎯</div>
      <p>Bob pulls the trigger... <span class="roulette-result">Roll: 4 - Safe!</span></p>
    </div>
  `;
}

function explainGameModes() {
  tutorialContent.innerHTML += `
    <div class="tutorial-modes">
      <div class="mode-box standard">
        <h4>🎯 Standard Mode</h4>
        <p>Busted players → Roulette first<br>No busts → Lowest hand</p>
      </div>
      <div class="mode-box lowest">
        <h4>⚖️ Lowest-Hand Mode</h4>
        <p>Always lowest hand<br>(Ignores bust status)</p>
      </div>
    </div>
  `;
}

function demoSecondChance() {
  tutorialContent.innerHTML += `
    <div class="tutorial-second-chance">
      <div class="second-chance-card">🃏</div>
      <p>Use your Second Chance Card to guarantee survival!</p>
      <div class="second-chance-effect">✨ Elimination cancelled! ✨</div>
    </div>
  `;
}

function explainFinalTwo() {
  tutorialContent.innerHTML += `
    <div class="tutorial-final-two">
      <h4>⚔️ Final 2 Special Rule</h4>
      <div class="final-two-scenario">
        <div class="player-demo busted">Player A: 23 (Busted)</div>
        <div class="player-demo safe">Player B: 21 (Safe)</div>
      </div>
      <p>→ Player A goes to roulette (bust overrides mode)</p>
    </div>
  `;
}

function updateTutorialActions(step) {
  let actionsHTML = '';
  
  if (step.action === 'force_hit' || step.action === 'show_stand_option') {
    // Show game controls
    actionsHTML = `
      <div class="tutorial-controls">
        <button id="tutorialHitBtn" class="btn green">Hit</button>
        <button id="tutorialStandBtn" class="btn red">Stand</button>
      </div>
    `;
  }
  
  // Always show navigation
  actionsHTML += `
    <div class="tutorial-navigation">
      <button id="tutorialNextBtn" class="btn gold">Continue</button>
      <button id="skipTutorialBtn" class="btn secondary">Skip Tutorial</button>
    </div>
  `;
  
  tutorialActions.innerHTML = actionsHTML;
  
  // Add event listeners
  const nextBtn = document.getElementById('tutorialNextBtn');
  const skipBtn = document.getElementById('skipTutorialBtn');
  const hitBtn = document.getElementById('tutorialHitBtn');
  const standBtn = document.getElementById('tutorialStandBtn');
  
  if (nextBtn) {
    nextBtn.onclick = () => {
      play(clickSound);
      nextTutorialStep();
    };
  }
  
  if (skipBtn) {
    skipBtn.onclick = () => {
      play(clickSound);
      completeTutorial();
    };
  }
  
  if (hitBtn) {
    hitBtn.onclick = () => {
      play(hitSound);
      handleTutorialHit();
    };
  }
  
  if (standBtn) {
    standBtn.onclick = () => {
      play(standSound);
      handleTutorialStand();
    };
  }
  
  // Enable/disable buttons based on step action
  if (step.action === 'force_hit') {
    enableTutorialButton('hit', true);
    enableTutorialButton('stand', false);
  } else if (step.action === 'show_stand_option') {
    enableTutorialButton('hit', false);
    enableTutorialButton('stand', true);
  }
}

function enableTutorialButton(buttonType, enabled) {
  const btn = document.getElementById(`tutorial${buttonType.charAt(0).toUpperCase() + buttonType.slice(1)}Btn`);
  if (btn) {
    btn.disabled = !enabled;
    if (enabled) {
      btn.classList.add('tutorial-highlight');
    } else {
      btn.classList.remove('tutorial-highlight');
    }
  }
}

function handleTutorialHit() {
  // Add card to player's hand
  const player = tutorialState.players[0];
  player.hand.push({ rank: '7', suit: '♦' });
  
  updateTutorialDisplay();
  
  // Auto-advance to next step
  setTimeout(() => {
    nextTutorialStep();
  }, 1000);
}

function handleTutorialStand() {
  const player = tutorialState.players[0];
  player.stood = true;
  
  updateTutorialDisplay();
  
  // Auto-advance to next step
  setTimeout(() => {
    nextTutorialStep();
  }, 1000);
}

function updateTutorialDisplay() {
  // Update the tutorial display to show current game state
  let displayArea = tutorialContent.querySelector('.tutorial-game-display');
  
  if (!displayArea) {
    displayArea = document.createElement('div');
    displayArea.className = 'tutorial-game-display';
    tutorialContent.appendChild(displayArea);
  }
  
  let html = '<div class="tutorial-players">';
  
  tutorialState.players.forEach(player => {
    const handValue = calculateHandValue(player.hand);
    const statusClass = player.busted ? 'busted' : player.stood ? 'stood' : 'active';
    
    html += `
      <div class="tutorial-player ${statusClass}" data-player-id="${player.id}">
        <div class="player-name">${player.name}</div>
        <div class="player-hand">
          ${player.hand.map(card => `<span class="card">${card.rank}${card.suit}</span>`).join('')}
        </div>
        <div class="player-value">Value: ${handValue}${player.busted ? ' (BUST)' : ''}</div>
        ${player.hasSecondChance && !player.secondChanceUsed ? '<div class="second-chance">🃏</div>' : ''}
      </div>
    `;
  });
  
  html += '</div>';
  displayArea.innerHTML = html;
}

function calculateHandValue(hand) {
  let total = 0;
  let aces = 0;
  
  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      total += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      total += 10;
    } else {
      total += parseInt(card.rank, 10);
    }
  }
  
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  
  return total;
}

function addTutorialHighlight(target) {
  // Add visual highlight to specific elements
  const element = document.querySelector(`[data-player-id="${target}"]`) || 
                 document.getElementById(target) ||
                 document.querySelector(`.${target}`);
  
  if (element) {
    element.classList.add('tutorial-highlight');
  }
}

function clearTutorialHighlights() {
  document.querySelectorAll('.tutorial-highlight').forEach(el => {
    el.classList.remove('tutorial-highlight');
  });
}

function nextTutorialStep() {
  currentStep++;
  showTutorialStep();
}

function completeTutorial() {
  console.log('[TUTORIAL] Tutorial completed');
  
  hideTutorial();
  
  // Show completion message
  setTimeout(() => {
    if (window.showSuccessNotification) {
      window.showSuccessNotification('Tutorial Complete!', 'You\'re ready to play Blackjack Roulette!');
    }
  }, 500);
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (tutorialOverlay && !tutorialOverlay.classList.contains('hidden')) {
    switch (e.key) {
      case 'Enter':
      case ' ':
        e.preventDefault();
        const nextBtn = document.getElementById('tutorialNextBtn');
        if (nextBtn && !nextBtn.disabled) {
          nextBtn.click();
        }
        break;
      case 'Escape':
        completeTutorial();
        break;
    }
  }
});