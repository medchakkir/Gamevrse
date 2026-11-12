const { ctx, log } = require('./state');
const { rooms } = require('./rooms');
const lobbyHandlers = require('./handlers/lobby');
const gameplayHandlers = require('./handlers/gameplay');
const powerupHandlers = require('./handlers/powerups');
const disconnectHandlers = require('./handlers/disconnect');

function onConnection(socket) {
  log(`========================================`);
  log(`[connection] New client connected`);
  log(`[connection] Socket ID: ${socket.id}`);
  log(`[connection] Client address: ${socket.handshake.address}`);
  log(`[connection] Total connected clients: ${ctx.io.server.engine.clientsCount}`);
  log(`[connection] Active rooms: [${Object.keys(rooms).join(', ')}]`);
  log(`========================================`);

  // --------------------
  lobbyHandlers.register(socket);
  gameplayHandlers.register(socket);
  powerupHandlers.register(socket);
  disconnectHandlers.register(socket);
}

module.exports = { onConnection };
