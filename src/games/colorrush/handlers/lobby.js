const { ctx } = require('../state');
const { broadcastRoomState, cancelGameCountdown, createNewPlayer, resetPlayersState, resetRoundState, tryStartGame, updatePlayerList } = require('../lobby');
const { startNextRound, waitForReadies } = require('../rounds');
const { log, playerRoom } = require('../state');
const { clearAllRoomTimers } = require('../timers');
const { rooms, createRoom, getRoom, removeRoom } = require('../rooms');

function register(socket) {

  // --------------------
  // CREATE ROOM
  // --------------------
  socket.on("createRoom", ({ name, options } = {}) => {
    const room = createRoom(socket.id, options || {});

    log(`[createRoom] Player ${socket.id} (${name}) creating room ${room.id}`);
    log(`[createRoom] Room settings: maxPlayers=${room.settings.maxPlayers}, isPrivate=${room.settings.isPrivate}`);

    socket.join(room.id);
    playerRoom[socket.id] = room.id;

    room.players[socket.id] = createNewPlayer(socket.id, name);
    room.hostId = socket.id;

    // Send complete room state immediately
    socket.emit("roomCreated", {
      roomId: room.id,
      isHost: true,
      hostId: room.hostId,
      players: Object.values(room.players),
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
      settings: {
        maxPlayers: room.settings.maxPlayers,
        maxRounds: room.settings.maxRounds,
        powerUpsEnabled: room.settings.powerUpsEnabled
      }
    });

    socket.emit("youAreHost");

    log(`[createRoom] SUCCESS: Room ${room.id} created by ${socket.id} (${name})`);
    log(`[createRoom] Total rooms in memory: ${Object.keys(rooms).length}`);
    log(`[createRoom] Available rooms: [${Object.keys(rooms).join(', ')}]`);
  });

  // --------------------
  // JOIN ROOM
  // --------------------
  socket.on("joinRoom", ({ roomId, name }) => {
    // STEP 1: NORMALIZE ROOM CODE INPUT
    // Validate and normalize room code before processing
    if (!roomId || typeof roomId !== 'string') {
      log(`[joinRoom] Invalid room code format from ${socket.id}: ${roomId}`);
      socket.emit("joinError", "Invalid room code format");
      return;
    }
    
    // Normalize: trim whitespace and convert to uppercase
    const normalizedRoomId = roomId.trim().toUpperCase();
    
    // Validate length (must be exactly 6 characters)
    if (normalizedRoomId.length !== 6) {
      log(`[joinRoom] Invalid room code length from ${socket.id}: "${roomId}" (normalized: "${normalizedRoomId}", length: ${normalizedRoomId.length})`);
      socket.emit("joinError", "Room code must be 6 characters");
      return;
    }
    
    // STEP 2: ADD DEBUG LOGGING
    log(`[joinRoom] Player ${socket.id} (${name}) attempting to join room "${normalizedRoomId}"`);
    log(`[joinRoom] Original input: "${roomId}"`);
    log(`[joinRoom] Available rooms: [${Object.keys(rooms).join(', ')}]`);
    log(`[joinRoom] Total rooms in memory: ${Object.keys(rooms).length}`);
    
    // STEP 6: GET ROOM WITH FAILSAFE LOGGING
    const room = getRoom(normalizedRoomId);

    if (!room) {
      // STEP 7: HANDLE SERVER RESTART CASE WITH DETAILED ERROR
      log(`[joinRoom] Room "${normalizedRoomId}" not found`);
      log(`[joinRoom] Available rooms at time of failure: ${JSON.stringify(Object.keys(rooms))}`);
      socket.emit("joinError", "Room not found. It may have expired or the server restarted.");
      return;
    }
    
    // Log room found successfully
    log(`[joinRoom] Room "${normalizedRoomId}" found! Current players: ${Object.keys(room.players).length}/${room.settings.maxPlayers}`);

    // Check if player is already in this room
    if (room.players[socket.id]) {
      log(`[joinRoom] Player ${socket.id} is already in room ${normalizedRoomId}`);
      socket.emit("joinError", "You are already in this room");
      return;
    }

    if (Object.keys(room.players).length >= room.settings.maxPlayers) {
      log(`[joinRoom] Room ${normalizedRoomId} is full (${Object.keys(room.players).length}/${room.settings.maxPlayers})`);
      socket.emit("joinError", "Room is full");
      return;
    }

    if (room.phase === 'game') {
      log(`[joinRoom] Room ${normalizedRoomId} game is already in progress`);
      socket.emit("joinError", "Game is already in progress");
      return;
    }

    socket.join(normalizedRoomId);
    playerRoom[socket.id] = normalizedRoomId;

    room.players[socket.id] = createNewPlayer(socket.id, name);

    // Send complete room state to the joining player immediately
    socket.emit("roomJoined", {
      roomId: room.id,
      isHost: socket.id === room.hostId,
      hostId: room.hostId,
      players: Object.values(room.players),
      maxPlayers: room.settings.maxPlayers,
      phase: room.phase,
      startCountdownEndsAt: room.startCountdownEndsAt,
      settings: {
        maxPlayers: room.settings.maxPlayers,
        maxRounds: room.settings.maxRounds,
        powerUpsEnabled: room.settings.powerUpsEnabled
      }
    });

    // Broadcast updated state to all players in room
    broadcastRoomState(room);

    log(`[joinRoom] SUCCESS: ${socket.id} (${name}) joined room ${normalizedRoomId}. Total players: ${Object.keys(room.players).length}`);
  });

  // --------------------
  // LEAVE ROOM
  // --------------------
  socket.on("leaveRoom", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    const wasHost = socket.id === room.hostId;
    const playerName = room.players[socket.id]?.name || 'Unknown';
    
    log(`[leaveRoom] Player ${socket.id} (${playerName}) leaving room ${roomId}`);
    
    delete room.players[socket.id];
    delete playerRoom[socket.id];
    socket.leave(roomId);

    if (wasHost) {
      const remainingPlayers = Object.keys(room.players);
      if (remainingPlayers.length > 0) {
        room.hostId = remainingPlayers[0];
        ctx.io.to(room.hostId).emit("youAreHost");
        log(`[leaveRoom] Host transferred to ${room.hostId} in room ${roomId}`);
      }
    }

    // STEP 3: SAFE ROOM DELETION WITH TIMER CLEANUP
    if (Object.keys(room.players).length === 0) {
      log(`[leaveRoom] Room ${roomId} is now empty - cleaning up and removing`);
      
      // Use centralized timer cleanup
      clearAllRoomTimers(room);
      
      removeRoom(roomId);
      log(`[leaveRoom] Room ${roomId} deleted (empty)`);
      log(`[leaveRoom] Remaining rooms: [${Object.keys(rooms).join(', ')}]`);
    } else {
      // Broadcast updated state to remaining players
      broadcastRoomState(room);
      
      log(`[leaveRoom] ${socket.id} (${playerName}) left room ${roomId}. Remaining players: ${Object.keys(room.players).length}`);
    }
  });

  // Sync on request
  socket.on("requestSync", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    const me = room.players[socket.id];
    ctx.io.to(socket.id).emit("sync", {
      players: Object.entries(room.players).map(([id,p]) => ({
        id, name: p.name, colorIndex: p.colorIndex, alive: p.alive, lives: p.lives, score: Math.round(p.score||0)
      })),
      hostId: room.hostId,
      gameStarted: room.gameStarted,
      round: room.round,
      sequenceLength: room.sequence?.length || 0,
      you: me ? { name: me.name, lives: me.lives, score: Math.round(me.score||0), alive: me.alive } : null
    });
  });

  socket.on("registerName", name => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    if (typeof name === "string" && name.trim().length > 0 && room.players[socket.id]) {
      room.players[socket.id].name = name.trim();
      updatePlayerList(room);
      log(`Player ${socket.id} registered as ${name}`);
    }
  });

  // host starts initial game
  socket.on("startGame", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.hostId) return;
    if (room.gameStarted || room.phase !== 'lobby') return;

    // Check minimum players
    if (Object.keys(room.players).length < 2) {
      socket.emit("gameStartError", "Need at least 2 players to start");
      return;
    }

    // Set the start requested flag
    room.startRequested = true;
    log(`[${room.id}] Host requested game start`);

    // Try to start the game (will start immediately if all ready, or start countdown)
    tryStartGame(room);
  });

  // --------------------
  // UPDATE GAME SETTINGS (HOST ONLY)
  // --------------------
  socket.on("updateGameSettings", (settings) => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    
    // Validation: Room must exist
    if (!room) {
      socket.emit("settingsUpdateError", "Room not found");
      return;
    }
    
    // Validation: Only host can update settings
    if (socket.id !== room.hostId) {
      socket.emit("settingsUpdateError", "Only host can update settings");
      return;
    }
    
    // Validation: Can only update in LOBBY phase
    if (room.phase !== 'lobby') {
      socket.emit("settingsUpdateError", "Settings can only be changed in lobby");
      return;
    }
    
    // Validate and update maxPlayers
    if (settings.maxPlayers !== undefined) {
      const maxPlayers = parseInt(settings.maxPlayers);
      
      if (isNaN(maxPlayers) || maxPlayers < 2 || maxPlayers > 6) {
        socket.emit("settingsUpdateError", "Max players must be between 2 and 6");
        return;
      }
      
      // Cannot lower below current player count
      const currentPlayerCount = Object.keys(room.players).length;
      if (maxPlayers < currentPlayerCount) {
        socket.emit("settingsUpdateError", `Cannot set max players below current count (${currentPlayerCount})`);
        return;
      }
      
      room.settings.maxPlayers = maxPlayers;
      log(`[updateGameSettings] Room ${roomId} maxPlayers set to ${maxPlayers}`);
    }
    
    // Validate and update maxRounds
    if (settings.maxRounds !== undefined) {
      const maxRounds = parseInt(settings.maxRounds);
      
      if (isNaN(maxRounds) || maxRounds < 15 || maxRounds > 30) {
        socket.emit("settingsUpdateError", "Max rounds must be between 15 and 30");
        return;
      }
      
      room.settings.maxRounds = maxRounds;
      log(`[updateGameSettings] Room ${roomId} maxRounds set to ${maxRounds}`);
    }
    
    // Validate and update powerUpsEnabled
    if (settings.powerUpsEnabled !== undefined) {
      if (typeof settings.powerUpsEnabled !== 'boolean') {
        socket.emit("settingsUpdateError", "Power-ups enabled must be true or false");
        return;
      }
      
      room.settings.powerUpsEnabled = settings.powerUpsEnabled;
      log(`[updateGameSettings] Room ${roomId} powerUpsEnabled set to ${settings.powerUpsEnabled}`);
    }
    
    // Broadcast updated settings to all players
    broadcastRoomState(room);
    
    log(`[updateGameSettings] Settings updated successfully for room ${roomId}`);
  });

  // host cancels game start
  socket.on("cancelGameStart", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id !== room.hostId) return;
    if (!room.startCountdownTimer && !room.startRequested) return;

    // Reset the start requested flag
    room.startRequested = false;
    
    cancelGameCountdown(room);
  });

  // player toggles ready state
  socket.on("toggleReady", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.phase !== 'lobby') return;

    const player = room.players[socket.id];
    if (!player) return;

    player.isReady = !player.isReady;
    
    log(`[${room.id}] ${player.name} is now ${player.isReady ? 'ready' : 'not ready'}`);
    
    // Broadcast updated room state
    broadcastRoomState(room);

    // Try to start the game (will start immediately if host started + all ready)
    tryStartGame(room);
  });

  // host kicks player
  socket.on("kickPlayer", ({ playerId }) => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.phase !== 'lobby') return;

    // Verify sender is host
    if (socket.id !== room.hostId) return;
    
    // Verify player exists and is not the host
    if (!room.players[playerId] || playerId === room.hostId) return;

    const kickedPlayerName = room.players[playerId].name;
    
    // Remove player from room
    delete room.players[playerId];
    delete playerRoom[playerId];
    
    // Notify kicked player
    ctx.io.to(playerId).emit("kicked", {
      message: "You were removed from the room by the host."
    });
    
    // Force disconnect from room
    const kickedSocket = ctx.io.sockets.get(playerId);
    if (kickedSocket) {
      kickedSocket.leave(roomId);
    }

    // Check if we need to cancel countdown due to insufficient players
    if (room.startCountdownTimer && Object.keys(room.players).length < 2) {
      cancelGameCountdown(room);
    }

    // Broadcast updated room state
    broadcastRoomState(room);

    log(`[${room.id}] ${kickedPlayerName} was kicked by host`);
  });


  // host requests rematch (keeps players)
  socket.on("restartGame", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;

    if (socket.id === room.hostId && Object.keys(room.players).length >= 2) {
      log("Restart requested by host:", socket.id);
      room.gameStarted = true;
      room.phase = 'game';
      // reset scores/lives but keep player list & host
      resetPlayersState(room);
      resetRoundState(room);
      
      // Notify phase change
      ctx.io.to(room.id).emit("phaseChange", { phase: 'game', roomId: room.id });
      
      // FIX: Start first round directly instead of using old waitForReadies system
      startNextRound(room);
    }
  });
}

module.exports = { register };
