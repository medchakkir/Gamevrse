const { ctx } = require('../state');
const { createBot } = require('../bots');
const { checkReadyStart, clearNextRoundCountdown, clearReadyCountdown, startNextRoundCountdown } = require('../countdowns');
const { checkVictoryCondition, createRoom, makeToken, reassignHost, resetRoomToLobby, savePlayerToken, updateState } = require('../roomState');
const { bots, playersByToken, rooms } = require('../state');
const { nextTurn } = require('../turns');

function register(socket) {

  socket.on('createRoom', () => {
  // Step 1: Try to create a unique room code
  let code;
  let attempts = 0;
  
  do {
    code = Math.random().toString(36).slice(2,8).toUpperCase();
    attempts++;
  } while (rooms[code] && attempts < 10); // Keep trying if code already exists
  
  // Step 2: If we couldn't find a unique code, tell the player
  if (rooms[code]) {
    return socket.emit('roomError', 'Failed to create room. Please try again.');
  }
  
  // Step 3: Create the room with the unique code
  rooms[code] = createRoom();
    socket.join(code);
    socket.data.roomCode = code;

    rooms[code].ownerId = socket.id;


    rooms[code].players[socket.id] = {
      id: socket.id,
      name: 'Player',
      hand: [],
      alive: true,
      busted: false,
      stood: false,
      host: true,
      wins: 0,
      spectator: false,
      ready: false,
      // Second Chance Card system
      hasSecondChance: true, // Each player starts with one card
      secondChanceUsed: false
    };
    const token = makeToken();
    socket.data.token = token;
    savePlayerToken(socket, token);
    socket.emit('assignToken', { token });


    socket.emit('roomJoined', { roomCode: code });
    updateState(code);
  });


  socket.on('identify', token => {
  if (typeof token !== 'string') return;

  const saved = playersByToken[token];
  if (!saved) return;

  socket.data.token = token;
  playersByToken[token].lastSeen = Date.now();

  const room = rooms[saved.roomCode];
  if (!room) return;
  // Remove old instance of this player (by token)
for (const id of Object.keys(room.players)) {
  if (room.players[id]?.id === saved.player.id) {
    delete room.players[id];
  }
}


  // Restore player with NEW socket.id
  const restoredPlayer = {
  ...saved.player,
  id: socket.id,
  hand: [],
  busted: false,
  stood: false
};
  restoredPlayer.alive = saved.player.alive === true;
  if (room.roundActive) {
  restoredPlayer.busted = false;
  restoredPlayer.stood = false;
}

  // Ensure Second Chance Card properties exist
  if (restoredPlayer.hasSecondChance === undefined) {
    restoredPlayer.hasSecondChance = true;
    restoredPlayer.secondChanceUsed = false;
  }



  room.players[socket.id] = restoredPlayer;
  // 🔁 IMPORTANT: update ownerId if owner reconnects
if (room.ownerId === saved.player.id) {
  room.ownerId = socket.id;
}

// 🔒 Restore permanent host if owner
if (room.ownerId === socket.id) {
  restoredPlayer.host = true;
}

reassignHost(room);

  socket.join(saved.roomCode);
  socket.data.roomCode = saved.roomCode;

  // 🔥 CRITICAL: If game is over, emit victory event on reconnect
  if (room.gameOver && room.winnerId) {
    const winner = room.players[room.winnerId];
    if (winner) {
      // Send victory event immediately to reconnecting player
      setTimeout(() => {
        ctx.io.to(socket.id).emit('victory', {
          winnerId: winner.id,
          winnerName: winner.name
        });
      }, 100); // Small delay to ensure client is ready
    }
  }

  ctx.io.to(socket.id).emit('phaseChange', {
  phase: room.phase || 'lobby'
});

  // Rebuild turn order safely
  room.currentPlayerOrder = Object.values(room.players)
    .filter(p => p.alive && !p.spectator)
    .map(p => p.id);

  room.turnIndex = Math.min(room.turnIndex, room.currentPlayerOrder.length - 1);

  updateState(saved.roomCode);
});




  socket.on('joinRoom', code => {
  // Step 1: Make sure code is a string
  if (typeof code !== 'string') {
    return socket.emit('roomError', 'Invalid room code');
  }
  
  // Step 2: Clean up the code (remove spaces, uppercase)
  const cleanCode = code.trim().toUpperCase();
  
  // Step 3: Check code is the right length (6 characters)
  if (cleanCode.length !== 6) {
    return socket.emit('roomError', 'Room code must be 6 characters');
  }
  
  // Step 4: Check if room exists
  const room = rooms[cleanCode];
  if (!room) return socket.emit('roomError', 'Room not found');

  // Step 5: Check if player is banned from this room
  if (room.bannedPlayers && room.bannedPlayers.has(socket.id)) {
    console.log(`[JOIN] Blocked banned player ${socket.id} from rejoining room ${cleanCode}`);
    return socket.emit('roomError', 'You cannot join this room because you were previously removed by the host');
  }
  
  // Step 6: Check identity-based ban (more persistent)
  const playerIP = socket.handshake?.address || 'unknown';
  if (room.bannedIdentities) {
    // We'll check the name after they set it, but for now check IP-only bans
    const ipBans = Array.from(room.bannedIdentities.values()).filter(ban => ban.ip === playerIP);
    if (ipBans.length > 0) {
      console.log(`[JOIN] Blocked player with banned IP ${playerIP} from rejoining room ${cleanCode}`);
      return socket.emit('roomError', 'You cannot join this room because you were previously removed by the host');
    }
  }

    socket.join(cleanCode);
    socket.data.roomCode = cleanCode;

    // 🎯 FIXED: Check if game is active - new joiners become spectators during active games
    const isGameActive = room.roundActive || room.phase === 'trigger' || room.phase === 'round';
    const shouldBeSpectator = isGameActive;

    room.players[socket.id] = {
      id: socket.id,
      name: 'Player',
      hand: [],
      alive: !shouldBeSpectator, // Not alive if joining mid-game
      busted: false,
      stood: false,
      host: false,
      wins: 0,
      spectator: shouldBeSpectator, // Spectator if joining mid-game
      ready: false,
      // Second Chance Card system
      hasSecondChance: true, // Each player starts with one card
      secondChanceUsed: false
    };

    // 🎯 NEW: Inform about spectator status if joining mid-game
    if (shouldBeSpectator) {
      ctx.io.to(cleanCode).emit('log', `👁️ ${room.players[socket.id].name} joined as spectator (game in progress)`);
      console.log(`[JOIN] ${socket.id} joined room ${cleanCode} as spectator (game active)`);
    } else {
      ctx.io.to(cleanCode).emit('log', `🎮 ${room.players[socket.id].name} joined the game`);
      console.log(`[JOIN] ${socket.id} joined room ${cleanCode} as player (lobby)`);
    }

    ctx.io.to(socket.id).emit('phaseChange', {
  phase: room.phase || 'lobby'
});

    updateState(cleanCode);

    
    const token = makeToken();
    socket.data.token = token;
    savePlayerToken(socket, token);
    socket.emit('assignToken', { token });


    socket.emit('roomJoined', { roomCode: cleanCode });
    
  });


  socket.on('leave', () => {
  const roomCode = socket.data.roomCode;
  clearNextRoundCountdown(roomCode);

  const room = rooms[roomCode];
  if (!room) return;

  const player = room.players[socket.id];
  if (!player) return; // Player not found, nothing to do

  const name = player.name || 'A player';
  const wasSpectator = player.spectator === true;
  const wasRoulettePlayer = room.rouletteChoiceActive && room.rouletteChoicePlayer === socket.id;

  console.log(`[LEAVE] ${name} leaving - Spectator: ${wasSpectator}, Roulette player: ${wasRoulettePlayer}`);

  // 🎯 CRITICAL FIX: Handle spectators leaving differently - they shouldn't affect game flow
  if (wasSpectator && !wasRoulettePlayer) {
    console.log(`[LEAVE] Spectator ${name} leaving - no game impact`);
    
    // Simple spectator removal - no game flow changes needed
    delete room.players[socket.id];
    
    if (socket.data.token) {
      delete playersByToken[socket.data.token];
    }
    
    // Only send leave message, don't affect game state
    ctx.io.to(roomCode).emit('log', `👁️ ${name} stopped spectating`);
    
    // Check if room is empty
    if (Object.keys(room.players).length === 0) {
      delete rooms[roomCode];
    } else {
      updateState(roomCode); // Just update state, don't change game flow
    }
    
    socket.leave(roomCode);
    return; // Exit early - spectator leaving doesn't affect active game
  }

  // 🎯 IMPROVED: Enhanced leave messaging for active players only
  let leaveMessage = `👋 ${name} left the game`;
  
  if (room.roundActive) {
    if (wasRoulettePlayer) {
      leaveMessage = `👋 ${name} left during roulette choice - continuing game`;
    } else if (room.currentPlayerOrder[room.turnIndex] === socket.id) {
      leaveMessage = `👋 ${name} left during their turn - continuing game`;
    } else {
      leaveMessage = `👋 ${name} left during active round - continuing game`;
    }
  }

  // Handle roulette choice leaving (similar to disconnect)
  if (wasRoulettePlayer) {
    console.log(`[LEAVE] Clearing roulette choice for leaving player ${name}`);
    
    // Clear roulette state
    if (room.rouletteChoiceTimer) {
      clearTimeout(room.rouletteChoiceTimer);
      room.rouletteChoiceTimer = null;
    }
    room.rouletteChoiceActive = false;
    room.rouletteChoicePlayer = null;
    
    // Inform players and auto-eliminate
    ctx.io.to(roomCode).emit('log', leaveMessage);
    ctx.io.to(roomCode).emit('log', `⚡ ${name} was automatically eliminated for leaving`);
    
    // Mark as eliminated before removal
    if (room.players[socket.id]) {
      room.players[socket.id].alive = false;
      room.players[socket.id].spectator = true;
    }
  }

  delete room.players[socket.id];
  reassignHost(room);

  if (socket.data.token) {
  delete playersByToken[socket.data.token];
}

  room.currentPlayerOrder = Object.values(room.players)
    .filter(p => p.alive && !p.spectator)
    .map(p => p.id);

  // 🏆 CRITICAL: Only check victory condition for active players (not spectators)
  if (!wasSpectator) {
    checkVictoryCondition(roomCode);
  }

  // Only call nextTurn if it was an active player and game is still active
  if (room.roundActive && !wasSpectator) {
    nextTurn(roomCode);
  }

  if (Object.keys(room.players).length === 0) {
    delete rooms[roomCode];
  } else {
    clearReadyCountdown(roomCode);
    
    // Send appropriate leave message
    ctx.io.to(roomCode).emit('log', leaveMessage);
    
    // If it was a roulette leave, start next round countdown
    if (wasRoulettePlayer && !room.gameOver) {
      setTimeout(() => {
        if (rooms[roomCode]) {
          const remainingAlive = Object.values(room.players).filter(p => p.alive && !p.spectator);
          if (remainingAlive.length > 1) {
            console.log(`[LEAVE] Starting next round countdown after roulette leave`);
            
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
      }, 2000);
    }
    
    updateState(roomCode);
  }

  socket.leave(roomCode);
});




  socket.on('setName', name => {
  const room = rooms[socket.data.roomCode];
  if (room?.players[socket.id]) {
    // Step 1: Convert to string and remove extra spaces
    const cleaned = String(name).trim();
    
    // Step 2: Remove dangerous characters like < and >
    const safe = cleaned.replace(/[<>]/g, '');
    
    // Step 3: Limit length to 20 characters
    const final = safe.slice(0, 20);
    
    // Step 4: Only save if name is not empty
    if (final) {
      // Step 5: Check if this name+IP combination is banned
      const playerIP = socket.handshake?.address || 'unknown';
      const banKey = `${final.toLowerCase()}|${playerIP}`;
      
      if (room.bannedIdentities && room.bannedIdentities.has(banKey)) {
        console.log(`[SETNAME] Blocked banned identity ${banKey} from setting name in room ${socket.data.roomCode}`);
        
        const roomCode = socket.data.roomCode; // Store before clearing
        
        // Remove the player and disconnect them
        delete room.players[socket.id];
        socket.leave(roomCode);
        socket.data.roomCode = null;
        
        socket.emit('kicked', {
          hostName: 'System'
        });
        
        // Update remaining players
        updateState(roomCode);
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
        
        return;
      }
      
      room.players[socket.id].name = final;
      if (socket.data.token) {
        savePlayerToken(socket, socket.data.token);
      }
      updateState(socket.data.roomCode);
    }
  }
});

socket.on('toggleReady', () => {
  const roomCode = socket.data.roomCode;
  const room = rooms[roomCode];
  const p = room?.players[socket.id];
  if (!p || p.spectator) return;

  // Toggle ready state
  p.ready = !p.ready;

  ctx.io.to(roomCode).emit(
    'log',
    `${p.name} is ${p.ready ? 'READY' : 'NOT READY'}`
  );

  // 🤖 Debug logging for practice mode
  if (room.isPracticeMode) {
    const allPlayers = Object.values(room.players).filter(p => p.alive && !p.spectator);
    const readyPlayers = allPlayers.filter(p => p.ready);
    console.log(`[PRACTICE DEBUG] ${readyPlayers.length}/${allPlayers.length} players ready`);
    console.log(`[PRACTICE DEBUG] Players:`, allPlayers.map(p => `${p.name}(${p.isBot ? 'bot' : 'human'}): ${p.ready}`));
  }

  // 🔴 IMPORTANT LOGIC
  if (!p.ready) {
  // Someone unreadied → cancel countdown
  clearReadyCountdown(roomCode);
} else {
  // Someone readied → ALWAYS re-check
  checkReadyStart(roomCode);
}

  updateState(roomCode);
});


  // 🤖 NEW: Handle practice mode creation
  socket.on('createPracticeRoom', (settings) => {
    const { botCount, difficulty, eliminationMode } = settings;
    
    if (!botCount || botCount < 1 || botCount > 5) return;
    if (!['easy', 'normal', 'hard'].includes(difficulty)) return;
    if (!['standard', 'lowestHand'].includes(eliminationMode || 'standard')) return;

    // Create practice room with special ID
    const code = 'PRACTICE_' + Math.random().toString(36).slice(2, 8).toUpperCase();
    rooms[code] = createRoom();
    rooms[code].isPracticeMode = true;
    rooms[code].botSettings = { botCount, difficulty, eliminationMode: eliminationMode || 'standard' };
    
    // 🎯 NEW: Set elimination mode for practice room
    rooms[code].rules.eliminationMode = eliminationMode || 'standard';
    
    console.log(`[PRACTICE] Creating practice room with elimination mode: ${eliminationMode || 'standard'}`);
    
    socket.join(code);
    socket.data.roomCode = code;
    rooms[code].ownerId = socket.id;

    // Add human player
    rooms[code].players[socket.id] = {
      id: socket.id,
      name: 'Player',
      hand: [],
      alive: true,
      busted: false,
      stood: false,
      host: true,
      wins: 0,
      spectator: false,
      ready: false,
      hasSecondChance: true, // Second Chance Card system
      secondChanceUsed: false,
      isBot: false
    };

    // Add bots
    const botNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve'];
    for (let i = 0; i < botCount; i++) {
      const bot = createBot(botNames[i], difficulty, code);
      bot.ready = true; // 🤖 Bots are always ready in practice mode
      rooms[code].players[bot.id] = bot;
    }

    console.log(`[PRACTICE] Created practice room ${code} with ${botCount} ${difficulty} bots (all ready)`);

    // Assign token for reconnection
    const token = makeToken();
    socket.data.token = token;
    savePlayerToken(socket, token);
    socket.emit('assignToken', { token });

    socket.emit('practiceRoomCreated', { 
      roomCode: code,
      botCount,
      difficulty,
      eliminationMode: eliminationMode || 'standard'
    });

    updateState(code);
  });



  socket.on('spectate', () => {
    const room = rooms[socket.data.roomCode];
    const p = room?.players[socket.id];
    if (!p) return;
    
    // Add game log message for manual spectating
    ctx.io.to(socket.data.roomCode).emit('log', `👁️ ${p.name} chose to spectate the game`);
    
    p.alive = false;
    p.spectator = true;
    p.ready = false;
    if (socket.data.token) {
  savePlayerToken(socket, socket.data.token);
}

    updateState(socket.data.roomCode);
  });


  // 🎯 NEW: Allow spectators to join next game
  socket.on('joinNextGame', () => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    const p = room?.players[socket.id];
    
    if (!p || !p.spectator) return; // Only spectators can use this
    if (room.roundActive || room.phase === 'trigger' || room.phase === 'round') {
      // Game is still active, can't join yet
      socket.emit('log', 'Cannot join during active game. Wait for game to end.');
      return;
    }
    
    // Convert spectator to player
    p.spectator = false;
    p.alive = true;
    p.ready = false;
    
    ctx.io.to(roomCode).emit('log', `🎮 ${p.name} will join the next game`);
    console.log(`[JOIN NEXT] ${p.name} converted from spectator to player`);
    
    if (socket.data.token) {
      savePlayerToken(socket, socket.data.token);
    }
    
    updateState(roomCode);
  });


  socket.on('requestNewGame', () => {
  const roomCode = socket.data.roomCode;
  const room = rooms[roomCode];
  if (!room) return;

  const p = room.players[socket.id];
  if (!p || !p.host) return;

  resetRoomToLobby(roomCode);
});
}

module.exports = { register };
