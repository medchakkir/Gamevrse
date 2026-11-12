Object.assign(module.exports, { checkReadyStart, startReadyCountdown, clearReadyCountdown, startNextRoundCountdown, clearNextRoundCountdown }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { NEXT_ROUND_COUNTDOWN_MS, READY_COUNTDOWN_MS, rooms } = require('./state');
const { startRound } = require('./turns');



function checkReadyStart(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.roundActive) return;

  const players = Object.values(room.players)
    .filter(p => p.alive && !p.spectator);

  if (players.length < 2) return;

  // 🤖 Debug logging for practice mode
  if (room.isPracticeMode) {
    const readyPlayers = players.filter(p => p.ready);
    console.log(`[PRACTICE DEBUG] checkReadyStart: ${readyPlayers.length}/${players.length} players ready`);
    console.log(`[PRACTICE DEBUG] All ready?`, players.every(p => p.ready));
  }

  // ✅ THIS IS THE AUTHORITATIVE CONDITION
  if (players.every(p => p.ready)) {
    clearReadyCountdown(roomCode);
    
    // 🤖 In practice mode, start immediately without countdown
    if (room.isPracticeMode) {
      console.log('[PRACTICE] All players ready, starting immediately');
      startRound(roomCode);
    } else {
      startRound(roomCode);
    }
  }
}




function startReadyCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.readyCountdownTimer) return;

  const players = Object.values(room.players)
    .filter(p => p.alive && !p.spectator);

  // 🚀 If everyone already ready → start immediately
  if (players.length >= 2 && players.every(p => p.ready)) {
    startRound(roomCode);
    return;
  }

  room.readyCountdownEndsAt = Date.now() + READY_COUNTDOWN_MS;

  ctx.io.to(roomCode).emit('readyCountdown', {
    endsAt: room.readyCountdownEndsAt
  });

  room.readyCountdownTimer = setTimeout(() => {
    clearReadyCountdown(roomCode);
    startRound(roomCode);
  }, READY_COUNTDOWN_MS);
}



function clearReadyCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.readyCountdownTimer) {
    clearTimeout(room.readyCountdownTimer);
    room.readyCountdownTimer = null;
  }

  room.readyCountdownEndsAt = null;
  ctx.io.to(roomCode).emit('readyCountdown', { endsAt: null });
}


function startNextRoundCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.roundActive || room.gameOver) return;

  if (room.nextRoundTimer) return;

  console.log(`[NEXT ROUND] Starting countdown for room ${roomCode}`);

  room.nextRoundEndsAt = Date.now() + NEXT_ROUND_COUNTDOWN_MS;

  ctx.io.to(roomCode).emit(
  'log',
  '⏳ Next round will start in 10 seconds...'
);

  ctx.io.to(roomCode).emit('nextRoundCountdown', {
    endsAt: room.nextRoundEndsAt
  });

  room.nextRoundTimer = setTimeout(() => {
    room.nextRoundTimer = null;
    room.nextRoundEndsAt = null;

    if (!room.gameOver) {
      console.log(`[NEXT ROUND] Starting new round for room ${roomCode}`);
      startRound(roomCode);
    }
  }, NEXT_ROUND_COUNTDOWN_MS);
}


function clearNextRoundCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.nextRoundTimer) {
    clearTimeout(room.nextRoundTimer);
    room.nextRoundTimer = null;
  }

  room.nextRoundEndsAt = null;

  ctx.io.to(roomCode).emit('nextRoundCountdown', { endsAt: null });
}
