const lobbyHandlers = require('./handlers/lobby');
const moderationHandlers = require('./handlers/moderation');
const gameplayHandlers = require('./handlers/gameplay');
const disconnectHandlers = require('./handlers/disconnect');

function onConnection(socket) {
  lobbyHandlers.register(socket);
  moderationHandlers.register(socket);
  gameplayHandlers.register(socket);
  disconnectHandlers.register(socket);
}

module.exports = { onConnection };
