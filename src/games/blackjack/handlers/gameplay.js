const { ctx } = require('../state');
const { createDeck, handValue, shuffle } = require('../cards');
const { checkReadyStart, startReadyCountdown } = require('../countdowns');
const { savePlayerToken, updateState } = require('../roomState');
const { processRouletteChoice } = require('../roulette');
const { ACTION_COOLDOWN_MS, rooms } = require('../state');
const { nextTurn, startRound } = require('../turns');

function register(socket) {



  socket.on('startRound', () => {
  const roomCode = socket.data.roomCode;
  const room = rooms[roomCode];
  if (!room) return;

  if (room.nextRoundTimer) return;

  const host = room.players[socket.id];
  if (!host || !host.host) return;
  if (room.roundActive) return;

  const alivePlayers = Object.values(room.players)
    .filter(p => p.alive && !p.spectator);

  if (alivePlayers.length < 2) {
    socket.emit('log', 'Need at least 2 players to start.');
    return;
  }

  // ✅ HOST PRESSING START = HOST IS READY
  host.ready = true;

  ctx.io.to(roomCode).emit(
    'log',
    `${host.name} started the round`
  );

  // 🔥 IMMEDIATE CHECK
  checkReadyStart(roomCode);

  // ⏱️ If not everyone is ready yet, start countdown
  if (!room.roundActive) {
    startReadyCountdown(roomCode);
  }

  updateState(roomCode);
});




  socket.on('hit', () => {
  const room = rooms[socket.data.roomCode];
  const p = room?.players[socket.id];
  if (!p || !room.roundActive || room.triggerLocked) return;


  const now = Date.now();
  if (now - (p.lastActionAt || 0) < ACTION_COOLDOWN_MS) return;
  p.lastActionAt = now;

  // Step 1: Check if deck is running low (less than 5 cards)
  if (room.deck.length < 5) {
    // Step 2: Create and shuffle a new deck
    room.deck = createDeck();
    shuffle(room.deck);
    ctx.io.to(socket.data.roomCode).emit('log', '🔄 Deck reshuffled!');
  }

  // Step 3: Now it's safe to pop a card
  p.hand.push(room.deck.pop());
  if (handValue(p.hand) > 21) p.busted = true;
  if (socket.data.token) {
  savePlayerToken(socket, socket.data.token);
}


  nextTurn(socket.data.roomCode);
});



  socket.on('stand', () => {
  const room = rooms[socket.data.roomCode];
  const p = room?.players[socket.id];
  if (!p || !room.roundActive || room.triggerLocked) return;


  const now = Date.now();
  if (now - (p.lastActionAt || 0) < ACTION_COOLDOWN_MS) return;
  p.lastActionAt = now;

  p.stood = true;
  if (socket.data.token) {
  savePlayerToken(socket, socket.data.token);
}


  nextTurn(socket.data.roomCode);
});


  // 🎯 NEW: Handle elimination mode change (host only)
  socket.on('setEliminationMode', (mode) => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || !player.host) {
      console.log(`[ELIMINATION MODE] Non-host ${socket.id} tried to change elimination mode`);
      return;
    }

    // Only allow changes in lobby phase
    if (room.phase !== 'lobby' || room.roundActive) {
      console.log(`[ELIMINATION MODE] Cannot change mode during active game`);
      socket.emit('eliminationModeError', 'Cannot change elimination mode during active game');
      return;
    }

    // Validate mode
    if (!['standard', 'lowestHand'].includes(mode)) {
      console.log(`[ELIMINATION MODE] Invalid mode: ${mode}`);
      socket.emit('eliminationModeError', 'Invalid elimination mode');
      return;
    }

    // Update room rules
    room.rules.eliminationMode = mode;
    console.log(`[ELIMINATION MODE] Host ${player.name} set elimination mode to: ${mode}`);

    // Notify all players
    ctx.io.to(roomCode).emit('eliminationModeChanged', {
      mode: mode,
      hostName: player.name
    });

    // Log the change
    const modeNames = {
      'standard': 'Standard Mode',
      'lowestHand': 'Lowest-Hand Mode'
    };
    ctx.io.to(roomCode).emit('log', `🎯 ${player.name} set elimination mode to: ${modeNames[mode]}`);
  });


  // 🃏 NEW: Handle roulette choice submission (Second Chance Card)
  socket.on('submitRouletteChoice', (choices) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    if (!choices || typeof choices !== 'object') return;

    processRouletteChoice(roomCode, socket.id, choices);
  });


  // 👁️ NEW: Handle spectator reactions
  socket.on('spectatorReaction', (data) => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || !player.spectator) return; // Only spectators can react

    const { emoji } = data ?? {};
    if (!emoji || typeof emoji !== 'string') return;

    // Rate limiting
    const now = Date.now();
    const reactionData = room.spectatorReactions.get(socket.id) || { lastReactionTime: 0, reactionCount: 0 };
    
    if (now - reactionData.lastReactionTime < 2000) { // 2 second cooldown
      return;
    }

    // Update reaction data
    reactionData.lastReactionTime = now;
    reactionData.reactionCount++;
    room.spectatorReactions.set(socket.id, reactionData);

    // Broadcast reaction to all players
    ctx.io.to(roomCode).emit('spectatorReactionReceived', {
      emoji,
      playerName: player.name,
      playerId: socket.id
    });

    console.log(`[SPECTATOR] ${player.name} reacted with ${emoji}`);
  });
}

module.exports = { register };
