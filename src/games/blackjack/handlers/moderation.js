const { ctx } = require('../state');
const { updateState } = require('../roomState');
const { rooms } = require('../state');

function register(socket) {

  socket.on('testKick', () => {
    console.log(`[TEST] Test kick event received from ${socket.id}`);
    socket.emit('testKickResponse', 'Test successful');
  });


  socket.on('unbanPlayer', (targetPlayerId) => {
    console.log(`[UNBAN] Unban request from ${socket.id} for target ${targetPlayerId}`);
    
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    
    if (!room || !room.players[socket.id]) {
      console.log(`[UNBAN] Failed - room or player not found`);
      return;
    }
    
    // Only room owner can unban players
    if (room.ownerId !== socket.id) {
      console.log(`[UNBAN] Failed - not owner`);
      return socket.emit('unbanError', 'Only the host can unban players');
    }
    
    // Check if player is actually banned
    if (!room.bannedPlayers.has(targetPlayerId)) {
      return socket.emit('unbanError', 'Player is not banned');
    }
    
    // Remove from banned list
    room.bannedPlayers.delete(targetPlayerId);
    console.log(`[UNBAN] Removed ${targetPlayerId} from banned list for room ${roomCode}`);
    
    // Log the unban action
    ctx.io.to(roomCode).emit('log', `Host has unbanned a player - they can now rejoin the room`);
    
    // Confirm to the host
    socket.emit('unbanSuccess', {
      playerId: targetPlayerId
    });
  });


  socket.on('kickPlayer', (targetPlayerId) => {
    console.log(`[KICK] Kick request from ${socket.id} for target ${targetPlayerId}`);
    
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    
    if (!room || !room.players[socket.id]) {
      console.log(`[KICK] Failed - room or player not found`);
      return;
    }
    
    console.log(`[KICK] Room: ${roomCode}, Owner: ${room.ownerId}, Requester: ${socket.id}`);
    
    // Only room owner can kick players
    if (room.ownerId !== socket.id) {
      console.log(`[KICK] Failed - not owner`);
      return socket.emit('kickError', 'Only the host can kick players');
    }
    
    // Cannot kick during active rounds
    if (room.roundActive) {
      console.log(`[KICK] Failed - round active`);
      return socket.emit('kickError', 'Cannot kick players during active rounds');
    }
    
    // Cannot kick yourself
    if (targetPlayerId === socket.id) {
      console.log(`[KICK] Failed - cannot kick self`);
      return socket.emit('kickError', 'Cannot kick yourself');
    }
    
    // Check if target player exists
    const targetPlayer = room.players[targetPlayerId];
    if (!targetPlayer) {
      console.log(`[KICK] Failed - target player not found`);
      return socket.emit('kickError', 'Player not found');
    }
    
    console.log(`[KICK] Kicking player: ${targetPlayer.name} (${targetPlayerId})`);
    
    // Find the target socket first to get IP address
    const kickTargetSocket = ctx.io.sockets.get(targetPlayerId);
    const playerIP = kickTargetSocket?.handshake?.address || 'unknown';
    const playerName = targetPlayer.name.toLowerCase().trim();
    
    // Add to both ban lists
    room.bannedPlayers.add(targetPlayerId);
    
    // Create identity-based ban (name + IP combination)
    const banKey = `${playerName}|${playerIP}`;
    room.bannedIdentities.set(banKey, {
      name: targetPlayer.name,
      ip: playerIP,
      kickedAt: Date.now(),
      reason: 'kicked_by_host'
    });
    
    console.log(`[KICK] Added ${targetPlayerId} to banned list for room ${roomCode}`);
    console.log(`[KICK] Added identity ban: ${banKey}`);
    
    // Remove the player
    delete room.players[targetPlayerId];
    
    // Notify the target socket
    if (kickTargetSocket) {
      console.log(`[KICK] Notifying target socket`);
      kickTargetSocket.leave(roomCode);
      kickTargetSocket.data.roomCode = null;
      kickTargetSocket.emit('kicked', {
        hostName: room.players[socket.id]?.name || 'Host'
      });
    } else {
      console.log(`[KICK] Target socket not found`);
    }
    
    // Log the kick action
    ctx.io.to(roomCode).emit('log', `${targetPlayer.name} was removed from the room by the host`);
    
    // Update all remaining players
    updateState(roomCode);
    
    // Emit updated player list
    ctx.io.to(roomCode).emit('playerList',
      Object.values(room.players).map(p => ({
        id: p.id,
        name: p.name,
        host: p.host,
        ready: p.ready,
        wins: p.wins,
        spectator: p.spectator
      }))
    );
    
    // Confirm to the host
    socket.emit('kickSuccess', {
      playerName: targetPlayer.name
    });
    
    console.log(`[KICK] Kick completed successfully`);
  });
}

module.exports = { register };
