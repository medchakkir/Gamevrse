import { state } from '../state.js';

const intro = document.getElementById('introScreen');
const lobby = document.getElementById('lobbyScreen');
const game  = document.getElementById('gameScreen');

export function setScreen(mode) {
  // 🏆 Victory screen owns the UI
  // BUT allow explicitly entering postgame
  if (state.victoryActive && mode !== 'postgame') {
  return;
}

  state.uiMode = mode;

  intro.classList.add('hidden');
  lobby.classList.add('hidden');
  game.classList.add('hidden');

  if (mode === 'intro') intro.classList.remove('hidden');
  if (mode === 'lobby') lobby.classList.remove('hidden');
  if (mode === 'game') game.classList.remove('hidden');

  // spectator always sees game screen
  if (mode === 'spectator') {
    game.classList.remove('hidden');
    lobby.classList.add('hidden');
  }

  // postgame shows lobby behind victory overlay
  if (mode === 'postgame') {
    lobby.classList.remove('hidden');
  }
}