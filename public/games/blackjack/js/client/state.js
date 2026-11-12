export const state = {
  uiMode: 'intro', // intro | lobby | game | postgame

  // game state
  lastState: null,
  currentRoomCode: null,

  // winner state (CENTRALIZED)
  winner: {
    id: null,
    name: null
  },
  victoryActive: false,
  postGameCountdown: null,
  
  // player flags
  isEliminated: false,
  
  // 🎯 NEW: Final 2 presentation state
  wasFinalTwo: false,

  // animation / overlay control
  triggerAnimationActive: false,
  gunAnimationActive: false,
  queuedRoundSummary: null,
  queuedDeathData: null
};

// preserve safe mode
window._BLACKJACK_SAFE_MODE = !!window._BLACKJACK_SAFE_MODE;

export function resetSafeMode() {
  window._BLACKJACK_SAFE_MODE = false;
}



