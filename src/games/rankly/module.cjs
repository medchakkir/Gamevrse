// Rankly's game-module descriptor (contract v0, see ../game-interface.js).
// This is a .cjs file because src/games/rankly is an ES-module package (nanoid is
// ESM-only); the game itself is loaded lazily with a dynamic import() in attach().
// Pure adapter: no gameplay behaviour, event names or payloads are changed here.
const { clearTimers } = require('../../shared/timers');

let game = null; // the loaded ES module, set by attach()

module.exports = {
  id: 'rankly',
  name: 'Rankly',
  version: '1.0.0',
  config: {
    minPlayers: 3, // DEFAULT_RULES.minPlayers; the host may override rules.minPlayers when starting
    maxPlayers: null, // the current implementation enforces no player cap
    supportsSpectators: false, // joining after the lobby is rejected ("game_in_progress"); no spectator role
  },
  async attach(namespace, app) {
    game = await import('./index.js');
    game.attach(namespace, app); // also mounts the /admin/* Express routes
  },
  listRooms: () => (game ? game.listRooms() : []),
  // Clears every Rankly timer/interval (labels are prefixed 'rankly/') so the process can exit.
  shutdown: () => clearTimers('rankly/'),
};
