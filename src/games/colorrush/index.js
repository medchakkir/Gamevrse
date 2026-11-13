// ColorRush: memory-sequence game. See state.js for shared state, connection.js for socket wiring.
const { ctx, log } = require('./state');
const { rooms } = require('./rooms');
const { onConnection } = require('./connection');
const logger = require('../../shared/logger');
const { safeInterval } = require('../../shared/timers');

function attach(namespace) {
  ctx.io = namespace;
  ctx.io.on("connection", onConnection);

  // Periodic room health check (every 5 minutes)
    safeInterval('colorrush/index#1', () => {
      const roomCount = Object.keys(rooms).length;
      const roomList = Object.keys(rooms);
      log(`[health-check] Active rooms: ${roomCount}`);
      if (roomCount > 0) {
        log(`[health-check] Room IDs: [${roomList.join(', ')}]`);
        roomList.forEach(roomId => {
          const room = rooms[roomId];
          if (room) {
            log(`[health-check]   ${roomId}: ${Object.keys(room.players).length} players, phase: ${room.phase}`);
          }
        });
      }
    }, 300000); // 5 minutes
  logger.info("[colorrush] ready");
}

module.exports = { attach };
