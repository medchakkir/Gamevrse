const { ctx } = require('../state');
const { clearNextRoundCountdown, clearReadyCountdown, startNextRoundCountdown } = require('../countdowns');
const { checkVictoryCondition, reassignHost, resetRoomToLobby, setPhase, updateState } = require('../roomState');
const { RETURN_TO_LOBBY_SECONDS, rooms } = require('../state');
const { clearTurnTimer, nextTurn } = require('../turns');

function register(socket) {

  socket.on('disconnect', () => {
  const roomCode = socket.data.roomCode;
  const room = rooms[roomCode];
  if (!room) return;

  const player = room.players[socket.id];
  if (!player) return; // Player not found, nothing to do

  const name = player.name || 'A player';
  const wasHost = room.ownerId === socket.id;
  const wasSpectator = player.spectator === true;
  const wasRoulettePlayer = room.rouletteChoiceActive && room.rouletteChoicePlayer === socket.id;

  console.log(`[DISCONNECT] ${name} disconnecting - Spectator: ${wasSpectator}, Host: ${wasHost}, Roulette player: ${wasRoulettePlayer}`);

  clearReadyCountdown(roomCode);
  clearTurnTimer(roomCode);

  // 🎯 CRITICAL FIX: Handle spectators disconnecting differently - they shouldn't affect game flow
  if (wasSpectator && !wasRoulettePlayer && !wasHost) {
    console.log(`[DISCONNECT] Spectator ${name} disconnecting - no game impact`);
    
    // Simple spectator removal - no game flow changes needed
    delete room.players[socket.id];
    
    // Only send disconnect message, don't affect game state
    ctx.io.to(roomCode).emit('log', `👁️ ${name} disconnected while spectating`);
    
    // Check if room is empty
    const remaining = Object.values(room.players);
    if (remaining.length === 0) {
      delete rooms[roomCode];
    } else {
      updateState(roomCode); // Just update state, don't change game flow
    }
    
    return; // Exit early - spectator disconnecting doesn't affect active game
  }

  // 🎯 IMPROVED: Enhanced disconnect messaging for active players only
  let disconnectMessage = `💔 ${name} disconnected`;
  
  if (room.roundActive) {
    if (wasRoulettePlayer) {
      disconnectMessage = `💔 ${name} disconnected during roulette choice - continuing game`;
    } else if (room.currentPlayerOrder[room.turnIndex] === socket.id) {
      disconnectMessage = `💔 ${name} disconnected during their turn - continuing game`;
    } else {
      disconnectMessage = `💔 ${name} disconnected during active round - continuing game`;
    }
  } else {
    disconnectMessage = `💔 ${name} disconnected from lobby`;
  }

  // 🎯 CRITICAL FIX: Handle roulette choice disconnection with proper flow
  if (wasRoulettePlayer) {
    console.log(`[DISCONNECT] Clearing roulette choice for disconnected player ${name}`);
    
    // Clear roulette state
    if (room.rouletteChoiceTimer) {
      clearTimeout(room.rouletteChoiceTimer);
      room.rouletteChoiceTimer = null;
    }
    room.rouletteChoiceActive = false;
    room.rouletteChoicePlayer = null;
    
    // Inform players about the disconnection and auto-elimination
    ctx.io.to(roomCode).emit('log', disconnectMessage);
    ctx.io.to(roomCode).emit('log', `⚡ ${name} was automatically eliminated due to disconnection`);
    
    // Mark player as eliminated before removal
    if (room.players[socket.id]) {
      room.players[socket.id].alive = false;
      room.players[socket.id].spectator = true;
    }
    
    // Remove player and continue game flow
    delete room.players[socket.id];
    
    // Update player order
    room.currentPlayerOrder = Object.values(room.players)
      .filter(p => p.alive && !p.spectator)
      .map(p => p.id);
    
    // Check for victory condition
    checkVictoryCondition(roomCode);
    
    // If game is still active, start next round countdown
    setTimeout(() => {
      if (rooms[roomCode] && !room.gameOver) {
        const remainingAlive = Object.values(room.players).filter(p => p.alive && !p.spectator);
        if (remainingAlive.length > 1) {
          console.log(`[DISCONNECT] Starting next round countdown after roulette disconnection`);
          
          // Clean up round state
          Object.values(room.players).forEach(p => {
            p.hand = [];
            p.busted = false;
            p.stood = false;
          });
          
          room.endingRound = false;
          room.roundActive = false;
          room.triggerLocked = false;
          updateState(roomCode);
          
          startNextRoundCountdown(roomCode);
        }
      }
    }, 2000); // 2 second delay for message visibility
    
    return; // Exit early since we handled everything
  }

  // Handle regular disconnection
  delete room.players[socket.id];

  room.currentPlayerOrder = Object.values(room.players)
    .filter(p => p.alive && !p.spectator)
    .map(p => p.id);

  // 🏆 CRITICAL: Check for immediate victory in Final 2 scenarios
  const remainingAlive = Object.values(room.players).filter(p => p.alive && !p.spectator);
  
  // 🎯 ENHANCED FIX: Check for Final 2 victory even if round is not active but game isn't over
  if (remainingAlive.length === 1 && !room.gameOver) {
    // 🎯 CRITICAL FIX: Immediate victory when opponent disconnects during Final 2
    console.log(`[DISCONNECT] Final 2 disconnect - immediate victory for ${remainingAlive[0].name}`);
    
    const winner = remainingAlive[0];
    winner.wins = (winner.wins || 0) + 1;
    
    // Clear any active timers and states
    clearTurnTimer(roomCode);
    clearNextRoundCountdown(roomCode);
    if (room.rouletteChoiceTimer) {
      clearTimeout(room.rouletteChoiceTimer);
      room.rouletteChoiceTimer = null;
    }
    
    // Set victory state immediately
    room.gameOver = true;
    room.winnerId = winner.id;
    room.roundActive = false;
    room.endingRound = false;
    room.triggerLocked = false;
    room.rouletteChoiceActive = false;
    
    setPhase(roomCode, 'postgame');
    
    // 🎯 NEW: Cancel any ongoing trigger animations
    ctx.io.to(roomCode).emit('cancelTriggerAnimation');
    
    // Immediate victory announcement
    ctx.io.to(roomCode).emit('log', `🏆 ${winner.name} wins by default - opponent disconnected!`);
    
    setTimeout(() => {
      ctx.io.to(roomCode).emit('victory', {
        winnerId: winner.id,
        winnerName: winner.name
      });
      updateState(roomCode);
      
      // Auto-return to lobby after victory animation
      setTimeout(() => {
        resetRoomToLobby(roomCode);
      }, RETURN_TO_LOBBY_SECONDS * 1000);
    }, 1000); // 1 second delay for message visibility
    
    return; // Exit early - victory handled
  }
  
  // Only check victory condition for non-Final 2 scenarios
  if (!wasSpectator && remainingAlive.length > 1) {
    checkVictoryCondition(roomCode);
  }

  // 🚨 CRITICAL FIX: Handle host disconnection during active game
  if (wasHost && room.roundActive) {
    console.log(`[DISCONNECT] Host disconnected during active game in room ${roomCode}`);
    const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.spectator);
    
    if (alivePlayers.length <= 1) {
      // Force victory condition if only 1 or 0 players left
      console.log(`[DISCONNECT] Forcing victory due to host disconnect with ${alivePlayers.length} players`);
      checkVictoryCondition(roomCode);
    } else {
      // Emergency host transfer and continue game
      reassignHost(room);
      ctx.io.to(roomCode).emit('log', `⚠️ Host disconnected - game continues with new host`);
    }
  }

  // Only call nextTurn if it was an active player and game is still active
  if (room.roundActive && !wasSpectator) {
    nextTurn(roomCode);
  }

  const remaining = Object.values(room.players);
  reassignHost(room);

  if (remaining.length === 0) {
    delete rooms[roomCode];
  } else {
    // Send the appropriate disconnect message
    ctx.io.to(roomCode).emit('log', disconnectMessage);
    updateState(roomCode);
  }
});
}

module.exports = { register };
