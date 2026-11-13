// ColorRush's game-module descriptor (contract v0, see ../game-interface.js).
// Pure adapter: it wraps the existing attach() and exposes metadata; no gameplay
// behaviour, event names or payloads are changed here.
const { attach } = require('./index');
const { rooms } = require('./rooms');
const { clearTimers } = require('../../shared/timers');

module.exports = {
  id: 'colorrush',
  name: 'ColorRush',
  version: '1.0.0',
  config: {
    minPlayers: 2, // startGame / tryStartGame require at least 2 players
    maxPlayers: 6, // default and hard upper bound (hosts may lower it to 2-6 via updateGameSettings)
    supportsSpectators: false, // joining a game in progress is rejected; no spectator role exists
  },
  attach,
  listRooms: () => Object.keys(rooms),
  // Clears every ColorRush timer/interval (labels are prefixed 'colorrush/') so the process can exit.
  shutdown: () => clearTimers('colorrush/'),
};
