// Blackjack roulette. See state.js for shared state, connection.js for socket wiring.
const { ctx, playersByToken, RECONNECT_WINDOW_MS } = require('./state');
const { onConnection } = require('./connection');

// Drop stale reconnect tokens.
setInterval(() => {
  const now = Date.now();
  for (const token of Object.keys(playersByToken)) {
    if (now - playersByToken[token].lastSeen > RECONNECT_WINDOW_MS * 10) {
      delete playersByToken[token];
    }
  }
}, 60000);

function attach(namespace) {
  ctx.io = namespace;
  ctx.io.on('connection', onConnection);
}

module.exports = { attach };
