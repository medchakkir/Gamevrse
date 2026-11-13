Object.assign(module.exports, { makeToken, savePlayerToken, setPhase, createRoom, reassignHost, updateState, detectAndResolveSoftLocks, checkVictoryCondition, startReturnToLobbyCountdown, clearReturnCountdown, resetRoomToLobby, checkForVictoryAfterElimination, sendRoundSummary }); // function declarations are hoisted, so cyclic requires resolve
const crypto = require('crypto');
const { ctx } = require('./state');
const { handValue } = require('./cards');
const { clearNextRoundCountdown, clearReadyCountdown, startNextRoundCountdown } = require('./countdowns');
const { processRouletteChoice } = require('./roulette');
const { RETURN_TO_LOBBY_SECONDS, playersByToken, rooms } = require('./state');
const { clearTurnTimer, nextTurn } = require('./turns');
const logger = require('../../shared/logger');
const { safeInterval, safeTimeout } = require('../../shared/timers');


function makeToken() {
  return crypto.randomBytes(10).toString('hex');
}


function savePlayerToken(socket, token) {
  const roomCode = socket.data.roomCode;
  if (!roomCode || !token) return;

  const room = rooms[roomCode];
  if (!room) return;

  playersByToken[token] = {
    roomCode,
    player: { ...room.players[socket.id] },
    lastSeen: Date.now()
  };
}


function setPhase(roomCode, phase) {
  const room = rooms[roomCode];
  if (!room) return;

  room.phase = phase;

  ctx.io.to(roomCode).emit('phaseChange', {
    phase
  });
}


function createRoom() {
  return {
    players: {},
    ownerId: null,
    deck: [],
    roundActive: false,
    currentPlayerOrder: [],
    turnIndex: 0,
    roundsPlayed: 0,
    phase: 'lobby',
    turnTimer: null,
    turnDeadline: null,
    endingRound: false,
    readyCountdownTimer: null,
    readyCountdownEndsAt: null,
    pendingElimination: null,
    winnerId: null,
    gameOver: false,
    triggerLocked: false,
    returningToLobby: false,
    returnCountdownInterval: null,
    nextRoundTimer: null,
    nextRoundEndsAt: null,
    // New roulette choice system
    rouletteChoiceActive: false,
    rouletteChoiceTimer: null,
    rouletteChoicePlayer: null,
    rouletteChoices: null,
    // Spectator reactions
    spectatorReactions: new Map(), // playerId -> { lastReactionTime, reactionCount }
    // Practice mode
    isPracticeMode: false,
    botSettings: null,
    // Enhanced banned players system
    bannedPlayers: new Set(), // Socket IDs (for current session)
    bannedIdentities: new Map(), // name+ip -> { name, ip, kickedAt, reason }
    // 🎯 NEW: Game rules configuration
    rules: {
      eliminationMode: 'standard' // 'standard' or 'lowestHand'
    }
  };
}



function reassignHost(room) {
  if (!room) return;

  // 1️⃣ Owner always wins if present
  const owner = room.players[room.ownerId];
  if (owner) {
    Object.values(room.players).forEach(p => (p.host = false));
    owner.host = true;
    return;
  }

  // 2️⃣ Fallback only if owner is gone
  const first = Object.values(room.players).find(p => !p.spectator);
  if (first) {
    Object.values(room.players).forEach(p => (p.host = false));
    first.host = true;
  }
}




function updateState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  reassignHost(room);

const host = Object.values(room.players).find(p => p.host);


  ctx.io.to(roomCode).emit('state', {
    players: Object.values(room.players).map(p => ({
      id: p.id,
      name: p.name,
      hand: p.hand,
      alive: p.alive,
      busted: p.busted,
      stood: p.stood,
      host: p.host,
      wins: p.wins,
      spectator: p.spectator,
      hasSecondChance: p.hasSecondChance && !p.secondChanceUsed // Show if player has unused Second Chance Card
    })),
    currentTurn: room.currentPlayerOrder[room.turnIndex] || null,
    roundActive: room.roundActive,
    gameOver: !!room.gameOver,
    winnerId: room.winnerId || null,
    hostId: host?.id || null,
    roundsPlayed: room.roundsPlayed,
    // 🎯 NEW: Include elimination mode and phase in state
    eliminationMode: room.rules.eliminationMode,
    phase: room.phase
  });

  ctx.io.to(roomCode).emit('playerList',
  Object.values(room.players).map(p => ({
    id: p.id,
    name: p.name,
    host: p.host,
    wins: p.wins,
    ready: p.ready,
    spectator: p.spectator
  }))
);

}


// 🎯 NEW: Soft-lock detection and recovery system
function detectAndResolveSoftLocks() {
  const now = Date.now();
  
  Object.entries(rooms).forEach(([roomCode, room]) => {
    // Skip practice rooms and non-active games
    if (room.isPracticeMode || !room.roundActive) return;
    
    const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.spectator);
    
    // Detect stuck roulette choice (timeout after 2 minutes)
    if (room.rouletteChoiceActive && room.rouletteChoicePlayer) {
      const rouletteStartTime = room.rouletteChoiceStartTime || now;
      if (now - rouletteStartTime > 120000) { // 2 minutes
        logger.warn(`[SOFT-LOCK] Roulette choice stuck in room ${roomCode} - auto-resolving`);
        
        // Auto-process with default choices
        processRouletteChoice(roomCode, room.rouletteChoicePlayer, {
          riskLevel: 'normal',
          timing: 'pullNow'
        });
      }
    }
    
    // Detect stuck turns (timeout after 3 minutes)
    if (room.turnDeadline && now - room.turnDeadline > 180000) { // 3 minutes past deadline
      logger.warn(`[SOFT-LOCK] Turn stuck in room ${roomCode} - auto-resolving`);
      
      const currentPlayerId = room.currentPlayerOrder[room.turnIndex];
      const currentPlayer = room.players[currentPlayerId];
      
      if (currentPlayer && currentPlayer.alive && !currentPlayer.busted && !currentPlayer.stood) {
        currentPlayer.stood = true;
        ctx.io.to(roomCode).emit('log', `⏰ ${currentPlayer.name} auto-stood due to timeout`);
        nextTurn(roomCode);
      }
    }
    
    // Detect games with no valid players (shouldn't happen but safety check)
    if (alivePlayers.length === 0 && room.roundActive) {
      logger.warn(`[SOFT-LOCK] No alive players in active room ${roomCode} - resetting`);
      
      room.roundActive = false;
      room.gameOver = false;
      setPhase(roomCode, 'lobby');
      updateState(roomCode);
    }
  });
}

// Run soft-lock detection every 30 seconds
safeInterval('blackjack/roomState#1', detectAndResolveSoftLocks, 30000);


function checkVictoryCondition(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  // 🎯 ENHANCED FIX: Check victory condition even if round is not active but game isn't over
  // This handles cases where players disconnect after roulette results but before next round
  if (room.gameOver) return; // Don't check if game is already over

  const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.spectator);
  
  logger.debug(`[VICTORY CHECK] Room ${roomCode}: ${alivePlayers.length} alive players (roundActive: ${room.roundActive}, gameOver: ${room.gameOver})`);

  // 🏆 CRITICAL: Check for victory condition (1 or 0 players left)
  if (alivePlayers.length <= 1) {
    logger.debug(`[VICTORY] Victory condition met in room ${roomCode}`);
    
    // Clear any active timers
    clearTurnTimer(roomCode);
    clearNextRoundCountdown(roomCode);
    
    if (alivePlayers.length === 1) {
      // We have a winner
      const winner = alivePlayers[0];
      winner.wins = (winner.wins || 0) + 1;
      
      room.gameOver = true;
      room.winnerId = winner.id;
      room.roundActive = false;
      
      logger.debug(`[VICTORY] ${winner.name} wins the game!`);
      
      // Emit victory to all players
      ctx.io.to(roomCode).emit('victory', {
        winnerId: winner.id,
        winnerName: winner.name
      });
      
      // Start the return-to-lobby countdown
      startReturnToLobbyCountdown(roomCode);
      
    } else {
      // No players left - shouldn't happen but handle gracefully
      logger.info(`[VICTORY] No players left in room ${roomCode} - cleaning up`);
      delete rooms[roomCode];
    }
  }
}


// New function to handle the return-to-lobby countdown
function startReturnToLobbyCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.returningToLobby) return; // Prevent duplicate countdowns
  
  room.returningToLobby = true;
  let timeLeft = RETURN_TO_LOBBY_SECONDS;
  
  logger.debug(`[RETURN COUNTDOWN] Starting ${RETURN_TO_LOBBY_SECONDS}s countdown for room ${roomCode}`);
  
  // Send initial countdown
  ctx.io.to(roomCode).emit('returnToLobbyCountdown', { timeLeft });
  
  const countdownInterval = safeInterval('blackjack/roomState#2', () => {
    timeLeft--;
    
    if (timeLeft > 0) {
      // Send countdown update
      ctx.io.to(roomCode).emit('returnToLobbyCountdown', { timeLeft });
      logger.debug(`[RETURN COUNTDOWN] Room ${roomCode}: ${timeLeft}s remaining`);
    } else {
      // Countdown finished - return to lobby
      clearInterval(countdownInterval);
      logger.debug(`[RETURN COUNTDOWN] Room ${roomCode}: Returning to lobby now`);
      
      // Reset all players for new game
      Object.values(room.players).forEach(p => {
        p.hand = [];
        p.alive = true;
        p.busted = false;
        p.stood = false;
        p.ready = false;
        p.spectator = false;
        p.host = false;
        // Clear immunity
        p.hasImmunity = false;
        p.immunityRoundsLeft = 0;
      });
      
      // Reset room state
      room.gameOver = false;
      room.winnerId = null;
      room.roundActive = false;
      room.currentPlayerOrder = [];
      room.turnIndex = 0;
      room.triggerLocked = false;
      room.returningToLobby = false;
      
      // Reassign host
      reassignHost(room);
      
      setPhase(roomCode, 'lobby');
      updateState(roomCode);
      
      ctx.io.to(roomCode).emit('gameReset');
    }
  }, 1000);
  
  // Store interval reference for cleanup if needed
  room.returnCountdownInterval = countdownInterval;
}


function clearReturnCountdown(roomCode) {
  const room = rooms[roomCode];
  if (room?.returnCountdownInterval) {
    clearInterval(room.returnCountdownInterval);
    logger.debug(`[RETURN COUNTDOWN] Cleared countdown interval for room ${roomCode}`);
    room.returnCountdownInterval = null;
    room.returningToLobby = false;
  }
}


function resetRoomToLobby(roomCode) {
  clearNextRoundCountdown(roomCode);
  const room = rooms[roomCode];
  if (!room) return;

  // Stop timers
  clearTurnTimer(roomCode);
  clearReadyCountdown(roomCode);

  room.roundActive = false;
  room.endingRound = false;
  room.gameOver = false;
  room.winnerId = null;
  room.triggerLocked = false;

  room.turnIndex = 0;
  room.currentPlayerOrder = [];

  // ✅ FULL HARD RESET — EVERYONE RETURNS TO LOBBY
  const players = Object.values(room.players);

  players.forEach(p => {
    p.hand = [];
    p.busted = false;
    p.stood = false;
    p.ready = false;
    p.spectator = false;   // 🔥 IMPORTANT
    p.alive = true;        // 🔥 IMPORTANT
    p.host = false;
    // Reset Second Chance Cards for new game
    p.hasSecondChance = true;
    p.secondChanceUsed = false;
  });

reassignHost(room);
setPhase(roomCode, 'lobby');

// 🔔 FORCE CLIENTS BACK TO LOBBY
ctx.io.to(roomCode).emit('gameReset');

updateState(roomCode);
 
}


function checkForVictoryAfterElimination(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const remainingAlive = Object.values(room.players).filter(p => p.alive && !p.spectator);
  
  if (remainingAlive.length === 1 && !room.gameOver) {
    // Handle victory
    const winner = remainingAlive[0];
    room.winnerId = winner.id;
    room.gameOver = true;
    winner.wins++;
    setPhase(roomCode, 'postgame');

    safeTimeout('blackjack/roomState#3', () => {
      ctx.io.to(roomCode).emit('victory', {
        winnerId: winner.id,
        winnerName: winner.name
      });
      updateState(roomCode);
      
      // Auto-return to lobby after victory animation
      safeTimeout('blackjack/roomState#4', () => {
        resetRoomToLobby(roomCode);
      }, RETURN_TO_LOBBY_SECONDS * 1000);
    }, 1000); // 1 second delay to ensure elimination is processed
  } else if (remainingAlive.length > 1 && !room.gameOver) {
    // Continue game - start next round countdown
    safeTimeout('blackjack/roomState#5', () => {
      logger.debug(`[NEXT ROUND] Starting countdown after elimination processed`);
      startNextRoundCountdown(roomCode);
    }, 2000);
  }
}


function sendRoundSummary(roomCode, player, roll, eliminated, secondChanceUsed = false) {
  const room = rooms[roomCode];
  if (!room) return;

  const alive = Object.values(room.players).filter(p => p.alive && !p.spectator);
  const busted = alive.filter(p => p.busted);
  const nonBusted = alive.filter(p => !p.busted);
  
  let candidates;
  if (busted.length > 0) {
    candidates = busted;
  } else {
    const lowestValue = Math.min(...nonBusted.map(p => handValue(p.hand)));
    candidates = nonBusted.filter(p => handValue(p.hand) === lowestValue);
  }

  // 🎯 NEW: Send round summary to ALL players including spectators
  const summaryData = {
    roundNumber: room.roundsPlayed,
    busted: busted.map(b => ({ name: b.name, value: handValue(b.hand) })),
    loserCandidates: candidates.map(c => c.name),
    chosenLoser: player.name,
    roll,
    eliminated,
    secondChanceUsed, // NEW: Include Second Chance information
    winnerName: null
  };

  // Send to ALL players (survivors, eliminated, and spectators)
  Object.values(room.players).forEach(p => {
    ctx.io.to(p.id).emit('roundSummary', summaryData);
  });
}
