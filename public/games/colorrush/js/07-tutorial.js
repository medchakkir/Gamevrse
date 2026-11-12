// ========== TUTORIAL MODE SYSTEM (SELF-CONTAINED) ==========

// Tutorial state variables (isolated from main game)
let isTutorialMode = false;
let tutorialStep = 0;
let tutorialSequence = [];
let tutorialPlayerSequence = [];
let tutorialWaiting = false;
let tutorialTimerInterval = null;
let tutorialTimeoutId = null;

// Tutorial DOM elements
const tutorialContainer = document.getElementById('tutorialContainer');
const tutorialStepIndicator = document.getElementById('tutorialStepIndicator');
const tutorialSkipBtn = document.getElementById('tutorialSkipBtn');
const tutorialTitle = document.getElementById('tutorialTitle');
const tutorialMessage = document.getElementById('tutorialMessage');
const tutorialGameArea = document.getElementById('tutorialGameArea');
const tutorialTimer = document.getElementById('tutorialTimer');
const tutorialPowerupsArea = document.getElementById('tutorialPowerupsArea');
const tutorialActionBtn = document.getElementById('tutorialActionBtn');

// Tutorial tile elements
const tutorialTiles = {
  red: document.getElementById('tutorialRed'),
  green: document.getElementById('tutorialGreen'),
  blue: document.getElementById('tutorialBlue'),
  yellow: document.getElementById('tutorialYellow')
};

// Tutorial tile colors
const TUTORIAL_COLORS = ['red', 'green', 'blue', 'yellow'];

// Start tutorial
function startTutorial() {
  console.log('Starting tutorial mode');
  isTutorialMode = true;
  tutorialStep = 0;
  
  // Show tutorial container
  tutorialContainer.style.display = 'flex';
  tutorialContainer.setAttribute('aria-hidden', 'false');
  
  // Hide intro screen
  introScreen.style.opacity = '0';
  setTimeout(() => {
    introScreen.style.display = 'none';
  }, 300);
  
  // Start with welcome screen
  showTutorialStep1();
}

// Exit tutorial cleanly
function exitTutorial() {
  console.log('Exiting tutorial mode');
  
  // Clear all tutorial timers and intervals
  if (tutorialTimerInterval) {
    clearInterval(tutorialTimerInterval);
    tutorialTimerInterval = null;
  }
  if (tutorialTimeoutId) {
    clearTimeout(tutorialTimeoutId);
    tutorialTimeoutId = null;
  }
  
  // Reset tutorial state
  isTutorialMode = false;
  tutorialStep = 0;
  tutorialSequence = [];
  tutorialPlayerSequence = [];
  tutorialWaiting = false;
  
  // Hide tutorial container
  tutorialContainer.style.display = 'none';
  tutorialContainer.setAttribute('aria-hidden', 'true');
  
  // Show intro screen
  introScreen.style.display = 'flex';
  introScreen.style.opacity = '1';
  
  // Reset tutorial UI
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'none';
  tutorialTimer.textContent = '';
  
  console.log('Tutorial exited cleanly');
}

// Tutorial Step 1: Welcome Screen
function showTutorialStep1() {
  tutorialStep = 1;
  tutorialStepIndicator.textContent = 'Step 1/6';
  
  tutorialTitle.textContent = 'Welcome to ColorRush';
  tutorialMessage.textContent = 'Watch the tiles carefully. Repeat them in order to survive.';
  
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'none';
  
  // Restore original button structure if it was replaced
  const footer = document.querySelector('.tutorial-footer');
  if (!footer.querySelector('.tutorial-action-btn')) {
    footer.innerHTML = '<button class="tutorial-action-btn">Start Tutorial</button>';
  }
  
  const btn = footer.querySelector('.tutorial-action-btn');
  btn.textContent = 'Start Tutorial';
  btn.className = 'tutorial-action-btn';
  btn.style.display = '';
  btn.onclick = showTutorialStep2;
}

// Tutorial Step 2: Watch Sequence
function showTutorialStep2() {
  tutorialStep = 2;
  tutorialStepIndicator.textContent = 'Step 2/6';
  
  tutorialTitle.textContent = 'Watch the Sequence';
  tutorialMessage.textContent = 'Pay attention to the order of the tiles...';
  
  tutorialGameArea.style.display = 'flex';
  tutorialPowerupsArea.style.display = 'none';
  tutorialTimer.textContent = '';
  
  // Hide action button during playback
  tutorialActionBtn.style.display = 'none';
  
  // Generate fixed 3-tile sequence
  tutorialSequence = ['red', 'blue', 'green'];
  tutorialPlayerSequence = [];
  
  // Disable tiles during playback
  disableTutorialTiles();
  
  // Play sequence after short delay
  setTimeout(() => {
    playTutorialSequence();
  }, 1000);
}

// Play tutorial sequence
async function playTutorialSequence() {
  tutorialMessage.textContent = 'Watch carefully...';
  
  for (const color of tutorialSequence) {
    await tutorialLightUp(color, 800);
    await tutorialSleep(900);
  }
  
  // After playback, enable player input
  tutorialMessage.textContent = 'Now repeat the sequence!';
  enableTutorialTiles();
  tutorialWaiting = true;
}

// Tutorial Step 3: Player Input
function handleTutorialTileClick(color) {
  if (!tutorialWaiting || tutorialStep !== 2) return;
  
  tutorialPlayerSequence.push(color);
  tutorialLightUp(color, 400);
  
  const index = tutorialPlayerSequence.length - 1;
  
  // Check if correct
  if (tutorialPlayerSequence[index] !== tutorialSequence[index]) {
    // Wrong tile
    tutorialWaiting = false;
    disableTutorialTiles();
    tutorialMessage.textContent = '❌ Oops! That\'s not correct. Try again.';
    tutorialMessage.style.color = '#ff6b6b';
    
    setTimeout(() => {
      tutorialMessage.style.color = '';
      tutorialPlayerSequence = [];
      tutorialMessage.textContent = 'Watch the sequence again...';
      
      setTimeout(() => {
        playTutorialSequence();
      }, 1000);
    }, 2000);
    return;
  }
  
  // Check if sequence complete
  if (tutorialPlayerSequence.length === tutorialSequence.length) {
    tutorialWaiting = false;
    disableTutorialTiles();
    tutorialMessage.textContent = '✅ Great! You remembered it!';
    tutorialMessage.style.color = '#00e676';
    
    try { if (audioEnabled) fx.success.play(); } catch(e){}
    
    setTimeout(() => {
      tutorialMessage.style.color = '';
      showTutorialStep3();
    }, 2000);
  }
}

// Tutorial Step 3: Timer Demo
function showTutorialStep3() {
  tutorialStep = 3;
  tutorialStepIndicator.textContent = 'Step 3/6';
  
  tutorialTitle.textContent = 'Understanding the Timer';
  tutorialMessage.textContent = 'Each round has a timer. Watch what happens when it runs out...';
  
  tutorialGameArea.style.display = 'flex';
  tutorialPowerupsArea.style.display = 'none';
  
  disableTutorialTiles();
  
  tutorialActionBtn.style.display = 'none';
  
  // Start countdown demo
  setTimeout(() => {
    startTutorialTimerDemo();
  }, 1500);
}

function startTutorialTimerDemo() {
  let timeLeft = 5;
  tutorialTimer.textContent = `⏱️ ${timeLeft}s`;
  
  tutorialTimerInterval = setInterval(() => {
    timeLeft--;
    tutorialTimer.textContent = `⏱️ ${timeLeft}s`;
    
    if (timeLeft <= 2) {
      tutorialTimer.style.color = '#ff6b35';
    }
    
    if (timeLeft <= 0) {
      clearInterval(tutorialTimerInterval);
      tutorialTimerInterval = null;
      tutorialTimer.textContent = '⏱️ Time Up!';
      tutorialMessage.textContent = '⚠️ If time runs out, you lose the round!';
      tutorialMessage.style.color = '#ff6b35';
      
      try { if (audioEnabled) fx.fail.play(); } catch(e){}
      
      setTimeout(() => {
        tutorialTimer.style.color = '';
        tutorialMessage.style.color = '';
        tutorialTimer.textContent = '';
        showTutorialStep4();
      }, 2500);
    }
  }, 1000);
}

// Tutorial Step 4: Powerups Demo
function showTutorialStep4() {
  tutorialStep = 4;
  tutorialStepIndicator.textContent = 'Step 4/6';
  
  tutorialTitle.textContent = 'Power-ups';
  tutorialMessage.textContent = 'Use power-ups strategically to help you survive!';
  
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'block';
  
  tutorialActionBtn.style.display = 'inline-block';
  tutorialActionBtn.textContent = 'Continue';
  tutorialActionBtn.className = 'tutorial-action-btn';
  tutorialActionBtn.onclick = showTutorialStep5;
}

// Tutorial Step 5: Lives and Elimination
function showTutorialStep5() {
  tutorialStep = 5;
  tutorialStepIndicator.textContent = 'Step 5/6';
  
  tutorialTitle.textContent = 'Lives & Elimination';
  tutorialMessage.textContent = 'You start with 2 lives. Make a mistake and lose a life. Lose all lives and you\'re eliminated!';
  
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'none';
  
  tutorialActionBtn.style.display = 'inline-block';
  tutorialActionBtn.textContent = 'Continue';
  tutorialActionBtn.className = 'tutorial-action-btn';
  tutorialActionBtn.onclick = showTutorialStep6;
}

// Tutorial Step 6: Finish
function showTutorialStep6() {
  tutorialStep = 6;
  tutorialStepIndicator.textContent = 'Step 6/6';
  
  tutorialTitle.textContent = 'Ready to Play!';
  tutorialMessage.textContent = 'That\'s it! You\'re ready to compete. Good luck!';
  
  tutorialGameArea.style.display = 'none';
  tutorialPowerupsArea.style.display = 'none';
  
  // Show two buttons
  tutorialActionBtn.style.display = 'none';
  
  const footer = document.querySelector('.tutorial-footer');
  footer.innerHTML = `
    <button class="tutorial-action-btn secondary" onclick="exitTutorial()">Back to Menu</button>
    <button class="tutorial-action-btn" onclick="startPracticeFromTutorial()">Start Practice</button>
  `;
}

// Start practice mode from tutorial
function startPracticeFromTutorial() {
  exitTutorial();
  
  // Small delay then start practice
  setTimeout(() => {
    if (practiceBtn) {
      practiceBtn.click();
    }
  }, 300);
}

// Tutorial tile helpers
function disableTutorialTiles() {
  Object.values(tutorialTiles).forEach(tile => {
    if (tile) tile.disabled = true;
  });
}

function enableTutorialTiles() {
  Object.values(tutorialTiles).forEach(tile => {
    if (tile) tile.disabled = false;
  });
}

async function tutorialLightUp(color, duration = 400) {
  const tile = tutorialTiles[color];
  if (!tile) return;
  
  tile.classList.add('active');
  
  try { 
    if (audioEnabled && sounds[color]) { 
      sounds[color].currentTime = 0; 
      sounds[color].play(); 
    } 
  } catch(e){}
  
  await tutorialSleep(duration);
  tile.classList.remove('active');
}

function tutorialSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Attach tutorial tile click handlers
Object.keys(tutorialTiles).forEach(color => {
  const tile = tutorialTiles[color];
  if (tile) {
    tile.addEventListener('click', () => handleTutorialTileClick(color));
  }
});

// Tutorial skip button handler
if (tutorialSkipBtn) {
  tutorialSkipBtn.addEventListener('click', exitTutorial);
}

// ========== END TUTORIAL MODE SYSTEM ==========
