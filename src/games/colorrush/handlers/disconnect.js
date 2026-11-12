const { ctx } = require('../state');
const { handlePlayerDisconnect } = require('../disconnect');
const { playerRoom } = require('../state');
const { getRoom } = require('../rooms');

function register(socket) {
// ============================================================================
// DISCONNECT SOCKET HANDLER
// ============================================================================

  socket.on("disconnect", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    
    if (!room) {
      // Clean up orphaned playerRoom entry
      delete playerRoom[socket.id];
      return;
    }
    
    // Use centralized disconnect handler
    handlePlayerDisconnect(socket, room, roomId);
  });
}

module.exports = { register };
