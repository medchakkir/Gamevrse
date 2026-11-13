// Blackjack's game-module descriptor (contract v0, see ../game-interface.js).
// Pure adapter: it wraps the existing attach() and exposes metadata; no gameplay
// behaviour, event names or payloads are changed here.
const { attach } = require('./index');
const { rooms } = require('./state');
const { clearTimers } = require('../../shared/timers');

module.exports = {
  id: 'blackjack',
  name: 'Blackjack Roulette',
  version: '1.0.0',
  config: {
    minPlayers: 2, // checkReadyStart / startRound require at least 2 alive players
    maxPlayers: null, // the current implementation enforces no player cap
    supportsSpectators: true,
  },
  attach,
  listRooms: () => Object.keys(rooms),
  // Clears every Blackjack timer/interval (labels are prefixed 'blackjack/') so the process can exit.
  shutdown: () => clearTimers('blackjack/'),
};
