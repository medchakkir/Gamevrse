const crypto = require('crypto');

// Socket.IO namespace, assigned by attach() from src/server.js
let io;

const READY_COUNTDOWN_MS = 60000;
const ACTION_COOLDOWN_MS = 400;
const TURN_MS = 15000;
const TURN_EMIT_BUFFER_MS = 50;
const ELIM_THRESHOLD = 2;
const RECONNECT_WINDOW_MS = 60 * 1000;
const RETURN_TO_LOBBY_SECONDS = 10;
const NEXT_ROUND_COUNTDOWN_MS = 10000;
const ROULETTE_CHOICE_TIMEOUT_MS = 30000; // 30 seconds to make roulette choices


const rooms = {};
const playersByToken = {};

// Bot management
const bots = new Map(); // botId -> bot data
let botIdCounter = 0;

function createBot(name, difficulty, roomCode) {
  const botId = `bot_${++botIdCounter}`;
  const bot = {
    id: botId,
    name: name,
    difficulty: difficulty,
    roomCode: roomCode,
    hand: [],
    alive: true,
    busted: false,
    stood: false,
    host: false,
    wins: 0,
    spectator: false,
    ready: false,
    hasSecondChance: true, // Bots also get Second Chance Cards
    secondChanceUsed: false,
    isBot: true,
    // Bot AI state
    riskTolerance: difficulty === 'easy' ? 0.3 : difficulty === 'normal' ? 0.5 : 0.7,
    aggressiveness: difficulty === 'easy' ? 0.2 : difficulty === 'normal' ? 0.5 : 0.8
  };
  
  bots.set(botId, bot);
  return bot;
}

function removeBot(botId) {
  bots.delete(botId);
}

function getBotDecision(bot, gameState) {
  const handVal = handValue(bot.hand);
  const { difficulty, riskTolerance, aggressiveness } = bot;
  const eliminationMode = gameState.rules?.eliminationMode || 'standard';
  
  // 🎯 NEW: Mode-aware bot strategy
  if (eliminationMode === 'lowestHand') {
    // LOWEST-HAND MODE: Bots need to avoid having the lowest hand
    return getBotDecisionLowestHandMode(bot, gameState, handVal, difficulty);
  } else {
    // STANDARD MODE: Original strategy (avoid busting, but busts are prioritized for roulette)
    return getBotDecisionStandardMode(bot, gameState, handVal, difficulty, riskTolerance, aggressiveness);
  }
}

function getBotDecisionStandardMode(bot, gameState, handVal, difficulty, riskTolerance, aggressiveness) {
  // Original logic for Standard Mode
  if (difficulty === 'easy') {
    // Easy bots: Conservative, hit until 17
    return handVal < 17 ? 'hit' : 'stand';
  } else if (difficulty === 'normal') {
    // Normal bots: Balanced strategy
    if (handVal < 12) return 'hit';
    if (handVal >= 17) return 'stand';
    // 12-16: depends on risk tolerance
    return Math.random() < riskTolerance ? 'hit' : 'stand';
  } else { // hard
    // Hard bots: Aggressive, consider game state
    const alivePlayers = Object.values(gameState.players).filter(p => p.alive && !p.spectator);
    const isLateGame = alivePlayers.length <= 3;
    
    if (handVal < 10) return 'hit';
    if (handVal >= 19) return 'stand';
    if (handVal >= 17 && !isLateGame) return 'stand';
    
    // Aggressive play in late game
    const hitChance = isLateGame ? aggressiveness : riskTolerance;
    return Math.random() < hitChance ? 'hit' : 'stand';
  }
}

function getBotDecisionLowestHandMode(bot, gameState, handVal, difficulty) {
  // 🎯 NEW: Lowest-Hand Mode strategy - avoid being the lowest hand
  const alivePlayers = Object.values(gameState.players).filter(p => p.alive && !p.spectator);
  const otherPlayers = alivePlayers.filter(p => p.id !== bot.id);
  
  // Calculate what we know about other players' hands (visible cards)
  const otherHandValues = otherPlayers.map(p => handValue(p.hand)).filter(val => val > 0);
  const lowestOtherHand = otherHandValues.length > 0 ? Math.min(...otherHandValues) : 21;
  const averageOtherHand = otherHandValues.length > 0 ? otherHandValues.reduce((a, b) => a + b, 0) / otherHandValues.length : 18;
  
  console.log(`[BOT AI] ${bot.name} (${handVal}) analyzing Lowest-Hand Mode - Others: [${otherHandValues.join(', ')}], Lowest: ${lowestOtherHand}`);
  
  if (difficulty === 'easy') {
    // Easy bots: Simple strategy - try to beat the lowest visible hand
    if (handVal < lowestOtherHand && handVal < 17) return 'hit';
    if (handVal >= 17) return 'stand';
    return handVal < 15 ? 'hit' : 'stand';
    
  } else if (difficulty === 'normal') {
    // Normal bots: More strategic - consider average and try to stay above lowest
    if (handVal < lowestOtherHand - 1 && handVal < 19) return 'hit'; // Try to beat lowest by margin
    if (handVal >= 19) return 'stand'; // Don't risk busting with good hand
    if (handVal < averageOtherHand - 2 && handVal < 17) return 'hit'; // Stay competitive
    return 'stand';
    
  } else { // hard
    // Hard bots: Advanced strategy - calculate risk vs reward
    const isLateGame = alivePlayers.length <= 3;
    const riskOfBeingLowest = calculateRiskOfBeingLowest(handVal, otherHandValues, isLateGame);
    
    // If we're likely to be lowest, take more risks to improve
    if (riskOfBeingLowest > 0.6 && handVal < 19) return 'hit';
    
    // Conservative if we're safely above others
    if (handVal > lowestOtherHand + 2) return 'stand';
    
    // Aggressive in late game to avoid being lowest
    if (isLateGame && handVal <= lowestOtherHand && handVal < 20) return 'hit';
    
    // Default: try to stay above average
    return handVal < averageOtherHand && handVal < 18 ? 'hit' : 'stand';
  }
}

function calculateRiskOfBeingLowest(myHand, otherHands, isLateGame) {
  if (otherHands.length === 0) return 0;
  
  const lowerHands = otherHands.filter(hand => hand < myHand).length;
  const equalHands = otherHands.filter(hand => hand === myHand).length;
  const totalHands = otherHands.length;
  
  // Risk increases if fewer hands are below us
  const baseRisk = (totalHands - lowerHands) / totalHands;
  
  // Equal hands create 50% chance of being selected
  const equalRisk = equalHands > 0 ? 0.5 : 0;
  
  // Late game increases risk
  const lateGameMultiplier = isLateGame ? 1.3 : 1.0;
  
  return Math.min(1.0, (baseRisk + equalRisk) * lateGameMultiplier);
}

function getBotRouletteChoice(bot, gameState) {
  const { difficulty } = bot;
  const eliminationMode = gameState.rules?.eliminationMode || 'standard';
  
  let useSecondChance = false;
  let timing = 'pullNow';
  
  // 🎯 NEW: Mode-aware Second Chance Card usage
  if (bot.hasSecondChance && !bot.secondChanceUsed) {
    if (eliminationMode === 'lowestHand') {
      // In Lowest-Hand Mode, Second Chance is more valuable since selection is predictable
      // Bots should be more strategic about when to use it
      const myHandValue = handValue(bot.hand);
      const alivePlayers = Object.values(gameState.players).filter(p => p.alive && !p.spectator);
      const otherPlayers = alivePlayers.filter(p => p.id !== bot.id);
      const otherHandValues = otherPlayers.map(p => handValue(p.hand));
      const lowestOtherHand = otherHandValues.length > 0 ? Math.min(...otherHandValues) : 21;
      
      // Use Second Chance if we have the lowest or tied for lowest hand
      const hasLowestHand = myHandValue <= lowestOtherHand;
      
      if (difficulty === 'easy') {
        // Easy bots: Use if they have lowest hand (60% chance)
        useSecondChance = hasLowestHand && Math.random() < 0.6;
      } else if (difficulty === 'normal') {
        // Normal bots: More strategic - use if lowest or very close (80% chance)
        const isVeryLow = myHandValue <= lowestOtherHand + 1;
        useSecondChance = isVeryLow && Math.random() < 0.8;
      } else { // hard
        // Hard bots: Highly strategic - almost always use if they have lowest hand
        useSecondChance = hasLowestHand && Math.random() < 0.9;
      }
      
      console.log(`[BOT AI] ${bot.name} Lowest-Hand Mode roulette: myHand=${myHandValue}, lowestOther=${lowestOtherHand}, hasLowest=${hasLowestHand}, useSecondChance=${useSecondChance}`);
      
    } else {
      // Standard Mode: Original logic
      // Easy bots: rarely use it (20% chance)
      // Normal bots: sometimes use it (50% chance)  
      // Hard bots: strategically use it (70% chance)
      const useChance = difficulty === 'easy' ? 0.2 : difficulty === 'normal' ? 0.5 : 0.7;
      useSecondChance = Math.random() < useChance;
      
      console.log(`[BOT AI] ${bot.name} Standard Mode roulette: useChance=${useChance}, useSecondChance=${useSecondChance}`);
    }
  }
  
  // Timing decision (mostly cosmetic)
  if (difficulty !== 'easy' && Math.random() < 0.3) {
    timing = 'spinChamber';
  }
  
  return { useSecondChance, timing };
}

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

  io.to(roomCode).emit('phaseChange', {
    phase
  });
}




function createDeck() {
  const suits = ['♠','♥','♦','♣'];
  const ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  return suits.flatMap(s => ranks.map(r => ({ rank: r, suit: s })));
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

function handValue(hand = []) {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (c.rank === 'A') { aces++; total += 11; }
    else if (['K','Q','J'].includes(c.rank)) total += 10;
    else total += parseInt(c.rank, 10);
  }
  while (total > 21 && aces) { total -= 10; aces--; }
  return total;
}

function checkVictoryCondition(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  // 🎯 ENHANCED FIX: Check victory condition even if round is not active but game isn't over
  // This handles cases where players disconnect after roulette results but before next round
  if (room.gameOver) return; // Don't check if game is already over

  const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.spectator);
  
  console.log(`[VICTORY CHECK] Room ${roomCode}: ${alivePlayers.length} alive players (roundActive: ${room.roundActive}, gameOver: ${room.gameOver})`);

  // 🏆 CRITICAL: Check for victory condition (1 or 0 players left)
  if (alivePlayers.length <= 1) {
    console.log(`[VICTORY] Victory condition met in room ${roomCode}`);
    
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
      
      console.log(`[VICTORY] ${winner.name} wins the game!`);
      
      // Emit victory to all players
      io.to(roomCode).emit('victory', {
        winnerId: winner.id,
        winnerName: winner.name
      });
      
      // Start the return-to-lobby countdown
      startReturnToLobbyCountdown(roomCode);
      
    } else {
      // No players left - shouldn't happen but handle gracefully
      console.log(`[VICTORY] No players left in room ${roomCode} - cleaning up`);
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
  
  console.log(`[RETURN COUNTDOWN] Starting ${RETURN_TO_LOBBY_SECONDS}s countdown for room ${roomCode}`);
  
  // Send initial countdown
  io.to(roomCode).emit('returnToLobbyCountdown', { timeLeft });
  
  const countdownInterval = setInterval(() => {
    timeLeft--;
    
    if (timeLeft > 0) {
      // Send countdown update
      io.to(roomCode).emit('returnToLobbyCountdown', { timeLeft });
      console.log(`[RETURN COUNTDOWN] Room ${roomCode}: ${timeLeft}s remaining`);
    } else {
      // Countdown finished - return to lobby
      clearInterval(countdownInterval);
      console.log(`[RETURN COUNTDOWN] Room ${roomCode}: Returning to lobby now`);
      
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
      
      io.to(roomCode).emit('gameReset');
    }
  }, 1000);
  
  // Store interval reference for cleanup if needed
  room.returnCountdownInterval = countdownInterval;
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
        console.warn(`[SOFT-LOCK] Roulette choice stuck in room ${roomCode} - auto-resolving`);
        
        // Auto-process with default choices
        processRouletteChoice(roomCode, room.rouletteChoicePlayer, {
          riskLevel: 'normal',
          timing: 'pullNow'
        });
      }
    }
    
    // Detect stuck turns (timeout after 3 minutes)
    if (room.turnDeadline && now - room.turnDeadline > 180000) { // 3 minutes past deadline
      console.warn(`[SOFT-LOCK] Turn stuck in room ${roomCode} - auto-resolving`);
      
      const currentPlayerId = room.currentPlayerOrder[room.turnIndex];
      const currentPlayer = room.players[currentPlayerId];
      
      if (currentPlayer && currentPlayer.alive && !currentPlayer.busted && !currentPlayer.stood) {
        currentPlayer.stood = true;
        io.to(roomCode).emit('log', `⏰ ${currentPlayer.name} auto-stood due to timeout`);
        nextTurn(roomCode);
      }
    }
    
    // Detect games with no valid players (shouldn't happen but safety check)
    if (alivePlayers.length === 0 && room.roundActive) {
      console.warn(`[SOFT-LOCK] No alive players in active room ${roomCode} - resetting`);
      
      room.roundActive = false;
      room.gameOver = false;
      setPhase(roomCode, 'lobby');
      updateState(roomCode);
    }
  });
}

// Run soft-lock detection every 30 seconds
setInterval(detectAndResolveSoftLocks, 30000);

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


  io.to(roomCode).emit('state', {
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

  io.to(roomCode).emit('playerList',
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

function clearTurnTimer(roomCode) {
  const room = rooms[roomCode];
  if (room?.turnTimer) {
    clearTimeout(room.turnTimer);
    console.log(`[TIMER] Cleared turn timer for room ${roomCode}`);
  }
  if (room) {
    room.turnTimer = null;
    room.turnDeadline = null;
    // Only emit null deadline when we're actually clearing (not during transitions)
    io.to(roomCode).emit('turnDeadline', { deadline: null });
    console.log(`[TIMER] Sent null turnDeadline to clear client timers for room ${roomCode}`);
  }
}

function clearReturnCountdown(roomCode) {
  const room = rooms[roomCode];
  if (room?.returnCountdownInterval) {
    clearInterval(room.returnCountdownInterval);
    console.log(`[RETURN COUNTDOWN] Cleared countdown interval for room ${roomCode}`);
    room.returnCountdownInterval = null;
    room.returningToLobby = false;
  }
}

function startTurnTimer(roomCode) {
  const room = rooms[roomCode];
  if (!room) {
    console.log(`[TIMER] ERROR: Room ${roomCode} not found`);
    return;
  }
  
  if (!room.roundActive) {
    console.log(`[TIMER] ERROR: Round not active in room ${roomCode}, cannot start timer`);
    return;
  }

  const currentId = room.currentPlayerOrder[room.turnIndex];
  const currentPlayer = room.players[currentId];
  
  if (!currentPlayer) {
    console.log(`[TIMER] ERROR: No current player found for room ${roomCode} at index ${room.turnIndex}`);
    return;
  }

  // Clear any existing timer WITHOUT emitting null deadline
  if (room.turnTimer) {
    console.log(`[TIMER] Clearing existing timer before starting new one for room ${roomCode}`);
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
  }

  console.log(`[TIMER] Starting 15s timer for ${currentPlayer.name} in room ${roomCode} (isBot: ${currentPlayer.isBot})`);

  // Handle bot turns immediately
  if (currentPlayer.isBot) {
    console.log(`[TIMER] Bot turn - scheduling decision for ${currentPlayer.name}`);
    // For bots, don't set a timer, just process their decision
    setTimeout(() => {
      // Double-check room is still active
      if (!room.roundActive || room.endingRound) {
        console.log(`[BOT] Skipping bot decision - round no longer active`);
        return;
      }
      
      const decision = getBotDecision(currentPlayer, room);
      console.log(`[BOT] ${currentPlayer.name} decides to ${decision}`);
      
      if (decision === 'hit') {
        // Bot hits
        if (room.deck.length < 5) {
          room.deck = createDeck();
          shuffle(room.deck);
        }
        currentPlayer.hand.push(room.deck.pop());
        if (handValue(currentPlayer.hand) > 21) {
          currentPlayer.busted = true;
        }
      } else {
        // Bot stands
        currentPlayer.stood = true;
      }
      
      nextTurn(roomCode);
    }, 1000 + Math.random() * 2000); // 1-3 second delay for realism
    
    return;
  }

  // Human player turn - ALWAYS set fresh timer
  const deadline = Date.now() + TURN_MS;
  room.turnDeadline = deadline;
  
  // Emit the deadline to all clients FIRST
  io.to(roomCode).emit('turnDeadline', { deadline: deadline + TURN_EMIT_BUFFER_MS });
  console.log(`[TIMER] ✅ SENT turnDeadline event for ${currentPlayer.name} in room ${roomCode} - deadline: ${new Date(deadline + TURN_EMIT_BUFFER_MS)}`);

  // THEN set the server timeout
  room.turnTimer = setTimeout(() => {
    console.log(`[TIMEOUT] Timer fired for ${currentPlayer.name} in room ${roomCode}`);
    
    const p = room.players[currentId];
    if (p && p.alive && !p.busted && !p.stood) {
      p.stood = true;
      io.to(roomCode).emit('log', `⏰ ${p.name} ran out of time and auto-stood`);
      console.log(`[TIMEOUT] ${p.name} timed out in room ${roomCode} - calling nextTurn`);
      nextTurn(roomCode);
    } else {
      console.log(`[TIMEOUT] Player ${currentPlayer.name} no longer valid for timeout action`);
    }
    
    // Clear timer after timeout
    room.turnTimer = null;
    room.turnDeadline = null;
  }, TURN_MS + 50);
  
  console.log(`[TIMER] ✅ Timer successfully set for ${currentPlayer.name} in room ${roomCode}`);
}

// CRITICAL: Timer verification function - ensures timer is always running when it should be
function verifyTimerState(roomCode) {
  const room = rooms[roomCode];
  if (!room || !room.roundActive || room.endingRound) return;
  
  const currentId = room.currentPlayerOrder[room.turnIndex];
  const currentPlayer = room.players[currentId];
  
  if (currentPlayer && currentPlayer.alive && !currentPlayer.busted && !currentPlayer.stood) {
    // We have a valid current player who should have a timer
    if (!currentPlayer.isBot && !room.turnTimer) {
      console.log(`[TIMER VERIFY] ⚠️ MISSING TIMER for ${currentPlayer.name} in room ${roomCode} - starting now!`);
      startTurnTimer(roomCode);
    }
  }
}

function nextTurn(roomCode) {
  const room = rooms[roomCode];
  if (!room) {
    console.log(`[NEXT TURN] ERROR: Room ${roomCode} not found`);
    return;
  }

  console.log(`[NEXT TURN] Called for room ${roomCode}, roundActive: ${room.roundActive}, endingRound: ${room.endingRound}`);

  // Don't advance turns if round is ending or not active
  if (!room.roundActive || room.endingRound) {
    console.log(`[NEXT TURN] Skipping - round not active or ending in room ${roomCode}`);
    return;
  }

  // CRITICAL: Always clear existing timer when advancing turns
  if (room.turnTimer) {
    clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnDeadline = null;
    console.log(`[NEXT TURN] Cleared existing timer in room ${roomCode}`);
  }

  const order = room.currentPlayerOrder;
  
  // Step 1: Make sure we have players to check
  if (order.length === 0) {
    console.log(`[NEXT TURN] No players left, ending round in room ${roomCode}`);
    endRound(roomCode);
    return;
  }
  
  // 🎯 IMPROVED: Check if current player disconnected and inform others
  const currentPlayerId = order[room.turnIndex];
  const currentPlayer = room.players[currentPlayerId];
  
  if (!currentPlayer) {
    // Current player disconnected, find next valid player
    io.to(roomCode).emit('log', `⏭️ Skipping disconnected player's turn`);
  }
  
  // Find next valid player
  let foundValidPlayer = false;
  for (let i = 1; i <= order.length; i++) {
    const idx = (room.turnIndex + i) % order.length;
    const p = room.players[order[idx]];
    if (p && p.alive && !p.busted && !p.stood) {
      // Step 2: Make sure index is valid before setting
      room.turnIndex = Math.max(0, Math.min(idx, order.length - 1));
      console.log(`[NEXT TURN] Moving to ${p.name} (index ${room.turnIndex}) in room ${roomCode}`);
      
      foundValidPlayer = true;
      
      // CRITICAL: Update state BEFORE starting timer
      updateState(roomCode);
      
      // CRITICAL: ALWAYS start fresh timer for new player - GUARANTEED
      console.log(`[NEXT TURN] About to start timer for ${p.name} in room ${roomCode}`);
      startTurnTimer(roomCode);
      console.log(`[NEXT TURN] Timer start completed for ${p.name} in room ${roomCode}`);
      
      // CRITICAL: Verify timer was actually set (failsafe)
      setTimeout(() => verifyTimerState(roomCode), 100);
      
      return;
    }
  }
  
  if (!foundValidPlayer) {
    console.log(`[NEXT TURN] No more players with turns, ending round in room ${roomCode}`);
    endRound(roomCode);
  }
}

function startRound(roomCode) {
  clearNextRoundCountdown(roomCode);
  setPhase(roomCode, 'round');
  const room = rooms[roomCode];
  if (!room || room.roundActive) return;

  // 🎯 Show Second Chance Card status at round start
  Object.values(room.players).forEach(p => {
    p.ready = false;
    
    // Show Second Chance Card status
    if (p.hasSecondChance && !p.secondChanceUsed) {
      console.log(`[SECOND CHANCE] ${p.name} has a Second Chance Card for this game`);
    }
  });

  clearReadyCountdown(roomCode);

  const alivePlayers = Object.values(room.players)
    .filter(p => p.alive && !p.spectator);

  // 🛑 Guard: need at least 2 players
  if (alivePlayers.length < 2) {
    io.to(roomCode).emit('log', 'Not enough players to start the round.');
    return;
  }

  room.deck = createDeck();
  shuffle(room.deck);

  alivePlayers.forEach(p => {
    p.hand = [room.deck.pop(), room.deck.pop()];
    p.busted = false;
    p.stood = false;
  });

  room.currentPlayerOrder = alivePlayers.map(p => p.id);
  room.turnIndex = 0;
  room.roundActive = true;

  // 🎯 Enhanced game log messages for spectators
  const spectatorCount = Object.values(room.players).filter(p => p.spectator).length;
  io.to(roomCode).emit('log', `🔄 Round ${room.roundsPlayed + 1} started with ${alivePlayers.length} players!`);
  if (spectatorCount > 0) {
    io.to(roomCode).emit('log', `👁️ ${spectatorCount} spectator${spectatorCount > 1 ? 's' : ''} watching`);
  }
  
  updateState(roomCode);
  startTurnTimer(roomCode);
  
  // CRITICAL: Verify first player gets timer (failsafe)
  setTimeout(() => verifyTimerState(roomCode), 100);
}


function endRound(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.endingRound || !room.roundActive) return;

  room.endingRound = true;
  room.triggerLocked = true;

  clearTurnTimer(roomCode);

  const alive = Object.values(room.players).filter(p => p.alive && !p.spectator);

  // 🏆 CRITICAL: Check for victory condition FIRST
  if (alive.length === 1) {
    clearNextRoundCountdown(roomCode);
    const winner = alive[0];

    room.winnerId = winner.id;
    room.gameOver = true;
    room.roundActive = false;
    room.endingRound = false;
    room.triggerLocked = false;

    winner.wins++;

    setPhase(roomCode, 'postgame');

    // 🔥 IMMEDIATE victory event - no delays
    io.to(roomCode).emit('victory', {
      winnerId: winner.id,
      winnerName: winner.name
    });

    updateState(roomCode);

    // 🔄 Auto-return to lobby after 8 seconds
    setTimeout(() => {
      resetRoomToLobby(roomCode);
    }, RETURN_TO_LOBBY_SECONDS * 1000);

    return; // ⛔ NOTHING ELSE RUNS
  }

  // 🛑 SAFETY: If no alive players, reset safely
  if (alive.length === 0) {
    console.warn('[END ROUND] No alive players found. Resetting round safely.');
    room.roundActive = false;
    room.endingRound = false;
    room.triggerLocked = false;
    
    Object.values(room.players).forEach(p => {
      p.hand = [];
      p.busted = false;
      p.stood = false;
      p.ready = false;
    });

    updateState(roomCode);
    
    if (!room.gameOver) {
      startNextRoundCountdown(roomCode);
    }
    
    return;
  }

  const busted = alive.filter(p => p.busted);
  const nonBusted = alive.filter(p => !p.busted);

  // 🎯 NEW: Show all hands for spectators and players
  io.to(roomCode).emit('log', '📊 Final hands:');
  alive.forEach(p => {
    const handVal = handValue(p.hand);
    const status = p.busted ? '💥 BUSTED' : `${handVal}`;
    io.to(roomCode).emit('log', `   ${p.name}: ${status}`);
  });

  let candidates;

  // 🎯 NEW: Final 2 Bust Override Rule (applies to both modes)
  const isFinalTwo = alive.length === 2;
  if (isFinalTwo && busted.length === 1) {
    // FINAL 2 RULE: If exactly one player is busted, they must go to roulette regardless of mode
    candidates = busted;
    console.log(`[ROULETTE] Final 2 Bust Override - busted player selected regardless of elimination mode`);
    io.to(roomCode).emit('log', '⚡ Final 2 rule applied: Bust overrides Lowest-Hand Mode');
  } else {
    // 🎯 NORMAL: Mode-aware loser selection logic
    if (room.rules.eliminationMode === 'lowestHand') {
      // LOWEST-HAND MODE: Always select lowest hand, ignore bust status for roulette
      console.log(`[ROULETTE] Lowest-Hand Mode - selecting from all alive players by lowest hand`);
    
    // Calculate lowest hand among ALL alive players (busted or not)
    const lowestValue = Math.min(
      ...alive.map(p => handValue(p.hand))
    );

    candidates = alive.filter(
      p => handValue(p.hand) === lowestValue
    );

    console.log(`[ROULETTE] All alive players: ${alive.map(p => `${p.name}(${handValue(p.hand)}${p.busted ? ', BUSTED' : ''})`).join(', ')}`);
    console.log(`[ROULETTE] Lowest value: ${lowestValue}, candidates: ${candidates.map(p => p.name).join(', ')}`);

    io.to(roomCode).emit(
      'log',
      `⚖️ Lowest-Hand Mode: Lowest hand (${lowestValue}) — at risk`
    );
  } else {
    // STANDARD MODE: Original logic (busted players prioritized)
    // RULE 1: If anyone busted → busted players ONLY
    if (busted.length > 0) {
      candidates = busted;
      console.log(`[ROULETTE] Standard Mode - Busted players found - selecting from busted players`);
      console.log(`[ROULETTE] Busted candidates: ${busted.map(p => `${p.name}(secondChance:${p.hasSecondChance && !p.secondChanceUsed})`).join(', ')}`);
      io.to(roomCode).emit(
        'log',
        '💥 Busting players are at highest risk!'
      );
    }
    // RULE 2: No one busted → lowest hand players
    else {
      console.log(`[ROULETTE] Standard Mode - No one busted - selecting from lowest hand players`);
      
      // Calculate lowest hand among all non-busted players
      const lowestValue = Math.min(
        ...nonBusted.map(p => handValue(p.hand))
      );

      candidates = nonBusted.filter(
        p => handValue(p.hand) === lowestValue
      );

      console.log(`[ROULETTE] Non-busted players: ${nonBusted.map(p => `${p.name}(${handValue(p.hand)}, secondChance:${p.hasSecondChance && !p.secondChanceUsed})`).join(', ')}`);
      console.log(`[ROULETTE] Lowest value: ${lowestValue}, candidates: ${candidates.map(p => p.name).join(', ')}`);

      io.to(roomCode).emit(
        'log',
        `⚖️ Lowest hand (${lowestValue}) — at risk`
      );
    }
  }
  } // End of Final 2 override else block

  // Select from candidates (Second Chance Cards are player choices)
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  
  console.log(`[ROULETTE] Selected ${chosen.name} from ${candidates.length} eligible candidates`);
  
  setPhase(roomCode, 'trigger');

  // 🎯 NEW: Show roulette choice to the chosen player (Second Chance Card option)
  room.rouletteChoiceActive = true;
  room.rouletteChoicePlayer = chosen.id;
  room.rouletteChoices = null;
  room.rouletteChoiceStartTime = Date.now();

  // Handle bot roulette choice
  if (chosen.isBot) {
    const botChoice = getBotRouletteChoice(chosen, room);
    console.log(`[BOT] ${chosen.name} chooses:`, botChoice);
    
    setTimeout(() => {
      processRouletteChoice(roomCode, chosen.id, botChoice);
    }, 2000 + Math.random() * 3000); // 2-5 second delay
    
    io.to(roomCode).emit('log', `${chosen.name} (Bot) is making their roulette choice...`);
    return;
  }

  // Send roulette choice to human player (with Second Chance Card option)
  io.to(chosen.id).emit('rouletteChoice', {
    playerName: chosen.name,
    hasSecondChance: chosen.hasSecondChance && !chosen.secondChanceUsed,
    playersRemaining: alive.length
  });

  // Send notification to other players
  if (chosen.hasSecondChance && !chosen.secondChanceUsed) {
    io.to(roomCode).emit('log', `${chosen.name} is making their roulette choice... (Second Chance Card available)`);
  } else {
    io.to(roomCode).emit('log', `${chosen.name} is making their roulette choice... (No Second Chance Card)`);
  }

  // Auto-fallback after timeout
  room.rouletteChoiceTimer = setTimeout(() => {
    if (room.rouletteChoiceActive && room.rouletteChoicePlayer === chosen.id) {
      console.log(`[ROULETTE] Auto-fallback for ${chosen.name}`);
      processRouletteChoice(roomCode, chosen.id, {
        useSecondChance: false,
        timing: 'pullNow'
      });
    }
  }, ROULETTE_CHOICE_TIMEOUT_MS);
  
  // 🔒 DELAY ELIMINATION UNTIL AFTER TRIGGER ANIMATION
  // NOTE: This is now handled by the new roulette choice system
  // The old elimination timeout logic has been removed to prevent conflicts
  
  // The rest of the round ending logic is now handled in executeRoulette()
  // after the player makes their roulette choices
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
io.to(roomCode).emit('gameReset');

updateState(roomCode);
 
}


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

  io.to(roomCode).emit('readyCountdown', {
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
  io.to(roomCode).emit('readyCountdown', { endsAt: null });
}

function startNextRoundCountdown(roomCode) {
  const room = rooms[roomCode];
  if (!room || room.roundActive || room.gameOver) return;

  if (room.nextRoundTimer) return;

  console.log(`[NEXT ROUND] Starting countdown for room ${roomCode}`);

  room.nextRoundEndsAt = Date.now() + NEXT_ROUND_COUNTDOWN_MS;

  io.to(roomCode).emit(
  'log',
  '⏳ Next round will start in 10 seconds...'
);

  io.to(roomCode).emit('nextRoundCountdown', {
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

  io.to(roomCode).emit('nextRoundCountdown', { endsAt: null });
}

function processRouletteChoice(roomCode, playerId, choices) {
  const room = rooms[roomCode];
  if (!room || !room.rouletteChoiceActive || room.rouletteChoicePlayer !== playerId) {
    return;
  }

  console.log(`[ROULETTE] Processing choices for ${playerId}:`, choices);

  // Clear the choice timer
  if (room.rouletteChoiceTimer) {
    clearTimeout(room.rouletteChoiceTimer);
    room.rouletteChoiceTimer = null;
  }

  room.rouletteChoiceActive = false;
  room.rouletteChoices = choices;

  const player = room.players[playerId];
  if (!player) return;

  // Handle Second Chance Card usage
  if (choices.useSecondChance && player.hasSecondChance && !player.secondChanceUsed) {
    io.to(roomCode).emit('log', `🃏 ${player.name} chose to use their Second Chance Card!`);
    console.log(`[SECOND CHANCE] ${player.name} chose to use their Second Chance Card`);
  } else {
    io.to(roomCode).emit('log', `⚖️ ${player.name} chose Normal risk`);
  }

  // Apply timing choice with enhanced realism
  let triggerDelay = 0;
  let triggerMessage = `${player.name} is pulling the trigger...`;
  
  switch (choices.timing) {
    case 'spinChamber':
      // First show spinning message
      io.to(roomCode).emit('log', `${player.name} spins the chamber... *click click click*`);
      
      // Emit spinning event for visual effects
      io.to(roomCode).emit('chamberSpin', {
        playerId: playerId,
        playerName: player.name
      });
      
      // After 3 seconds, show pulling trigger message
      setTimeout(() => {
        io.to(roomCode).emit('log', `${player.name} is pulling the trigger...`);
      }, 3000);
      
      triggerDelay = 5000; // Total delay: 3s spin + 2s trigger
      triggerMessage = `${player.name} spins the chamber... *click click click*`;
      break;
    default: // 'pullNow'
      triggerDelay = 500;
      break;
  }

  // Emit trigger pull with chosen timing
  if (!room.gameOver && Object.values(room.players).filter(p => p.alive && !p.spectator).length > 1) {
    io.to(roomCode).emit('triggerPull', {
      loserId: playerId,
      loserName: player.name,
      timing: choices.timing,
      useSecondChance: choices.useSecondChance || false
    });
  }

  io.to(roomCode).emit('log', triggerMessage);

  // Process the actual roulette after timing delay
  setTimeout(() => {
    executeRouletteResult(roomCode, playerId, ELIM_THRESHOLD, choices.useSecondChance || false);
  }, triggerDelay);
}

function executeRouletteResult(roomCode, playerId, elimThreshold, useSecondChance = false) {
  const room = rooms[roomCode];
  if (!room) return;

  const player = room.players[playerId];
  if (!player) return;

  const roll = Math.floor(Math.random() * 6) + 1;
  const wouldBeEliminated = roll <= elimThreshold;

  // 🎯 CRITICAL FIX: Calculate timing for suspense preservation
  const alivePlayers = Object.values(room.players).filter(p => p.alive && !p.spectator);
  const isFinalTwo = alivePlayers.length === 2;
  const triggerAnimationDuration = isFinalTwo ? 5000 : 3500; // Match client-side timing

  console.log(`[ROULETTE] ${player.name} rolled ${roll}, threshold ${elimThreshold}, would be eliminated: ${wouldBeEliminated}, using Second Chance: ${useSecondChance}`);

  // 🃏 NEW: Second Chance Card logic (player choice)
  let actuallyEliminated = wouldBeEliminated;
  let secondChanceUsed = false;

  if (useSecondChance && player.hasSecondChance && !player.secondChanceUsed) {
    // Player chose to use Second Chance Card!
    actuallyEliminated = false; // Card prevents elimination regardless of roll
    secondChanceUsed = true;
    player.hasSecondChance = false;
    player.secondChanceUsed = true;
    
    console.log(`[SECOND CHANCE] ${player.name} used Second Chance Card by choice`);
    
    // Emit Second Chance event for client-side effects
    io.to(roomCode).emit('secondChanceUsed', {
      playerId: playerId,
      playerName: player.name,
      roll: roll,
      threshold: elimThreshold
    });
  }

  console.log(`[SUSPENSE] Delaying result messages for ${triggerAnimationDuration}ms to preserve suspense`);

  // 🎯 DELAY RESULT MESSAGES: Send after trigger animation completes
  setTimeout(() => {
    if (secondChanceUsed) {
      io.to(roomCode).emit('log', `💀 ${player.name} rolled ${roll}/${elimThreshold} and should have been eliminated...`);
      setTimeout(() => {
        io.to(roomCode).emit('log', `🃏 ${player.name} used their Second Chance Card and survived!`);
      }, 1000);
    } else if (actuallyEliminated) {
      io.to(roomCode).emit('log', `💀 ${player.name} rolled ${roll}/${elimThreshold} and was ELIMINATED!`);
      // Add additional context for spectators
      setTimeout(() => {
        io.to(roomCode).emit('log', `👻 ${player.name} is now spectating the game`);
      }, 6000); // After death animation completes
    } else {
      io.to(roomCode).emit('log', `🟢 ${player.name} rolled ${roll}/${elimThreshold} and SURVIVED!`);
    }
  }, triggerAnimationDuration + 500); // Extra 500ms buffer for perfect timing

  // Send elimination event FIRST (for death animation) - only if actually eliminated
  if (actuallyEliminated) {
    io.to(playerId).emit('eliminated', { winnerName: null });
    room.roundsPlayed++;
    
    // Delay actual elimination to allow death animation
    setTimeout(() => {
      if (room.players[playerId]) {
        room.players[playerId].alive = false;
        room.players[playerId].spectator = true;
        room.players[playerId].ready = false;
        room.players[playerId].host = false;
        
        reassignHost(room);
        updateState(roomCode);
        
        // Check for victory after elimination
        checkForVictoryAfterElimination(roomCode);
      }
    }, 5000); // 5 seconds for death animation
  }

  // 🎯 FIXED: Delay round summary until after death/survival animations complete
  const summaryDelay = actuallyEliminated ? 7000 : 5000; // 7s for death animation + transition, 5s for survival
  setTimeout(() => {
    // Double-check that the game is still active before sending summary
    if (!room.gameOver && rooms[roomCode]) {
      console.log(`[ROUND SUMMARY] Sending summary after ${summaryDelay}ms delay for ${player.name}`);
      sendRoundSummary(roomCode, player, roll, actuallyEliminated, secondChanceUsed);
    }
  }, summaryDelay);

  // Clean up hands
  Object.values(room.players).forEach(p => {
    p.hand = [];
    p.busted = false;
    p.stood = false;
  });

  room.endingRound = false;
  room.roundActive = false;
  room.triggerLocked = false;
  updateState(roomCode);

  // If player survived (including Second Chance), start next round countdown after delay
  if (!actuallyEliminated) {
    setTimeout(() => {
      const remainingAlive = Object.values(room.players).filter(p => p.alive && !p.spectator);
      if (remainingAlive.length > 1 && !room.gameOver) {
        console.log(`[NEXT ROUND] Starting countdown after survivor processed result`);
        startNextRoundCountdown(roomCode);
      }
    }, summaryDelay + 1000); // Extra delay after round summary
  }
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

    setTimeout(() => {
      io.to(roomCode).emit('victory', {
        winnerId: winner.id,
        winnerName: winner.name
      });
      updateState(roomCode);
      
      // Auto-return to lobby after victory animation
      setTimeout(() => {
        resetRoomToLobby(roomCode);
      }, RETURN_TO_LOBBY_SECONDS * 1000);
    }, 1000); // 1 second delay to ensure elimination is processed
  } else if (remainingAlive.length > 1 && !room.gameOver) {
    // Continue game - start next round countdown
    setTimeout(() => {
      console.log(`[NEXT ROUND] Starting countdown after elimination processed`);
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
    io.to(p.id).emit('roundSummary', summaryData);
  });
}




const onConnection = socket => {

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
        io.to(socket.id).emit('victory', {
          winnerId: winner.id,
          winnerName: winner.name
        });
      }, 100); // Small delay to ensure client is ready
    }
  }

  io.to(socket.id).emit('phaseChange', {
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
      io.to(cleanCode).emit('log', `👁️ ${room.players[socket.id].name} joined as spectator (game in progress)`);
      console.log(`[JOIN] ${socket.id} joined room ${cleanCode} as spectator (game active)`);
    } else {
      io.to(cleanCode).emit('log', `🎮 ${room.players[socket.id].name} joined the game`);
      console.log(`[JOIN] ${socket.id} joined room ${cleanCode} as player (lobby)`);
    }

    io.to(socket.id).emit('phaseChange', {
  phase: room.phase || 'lobby'
});

    updateState(cleanCode);

    
    const token = makeToken();
    socket.data.token = token;
    savePlayerToken(socket, token);
    socket.emit('assignToken', { token });


    socket.emit('roomJoined', { roomCode: cleanCode });
    
  });

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
    io.to(roomCode).emit('log', `Host has unbanned a player - they can now rejoin the room`);
    
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
    const kickTargetSocket = io.sockets.get(targetPlayerId);
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
    io.to(roomCode).emit('log', `${targetPlayer.name} was removed from the room by the host`);
    
    // Update all remaining players
    updateState(roomCode);
    
    // Emit updated player list
    io.to(roomCode).emit('playerList',
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
    io.to(roomCode).emit('log', `👁️ ${name} stopped spectating`);
    
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
    io.to(roomCode).emit('log', leaveMessage);
    io.to(roomCode).emit('log', `⚡ ${name} was automatically eliminated for leaving`);
    
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
    io.to(roomCode).emit('log', leaveMessage);
    
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
        io.to(roomCode).emit('playerList',
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

  io.to(roomCode).emit(
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

  io.to(roomCode).emit(
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
    io.to(socket.data.roomCode).emit('log', '🔄 Deck reshuffled!');
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


  socket.on('spectate', () => {
    const room = rooms[socket.data.roomCode];
    const p = room?.players[socket.id];
    if (!p) return;
    
    // Add game log message for manual spectating
    io.to(socket.data.roomCode).emit('log', `👁️ ${p.name} chose to spectate the game`);
    
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
    
    io.to(roomCode).emit('log', `🎮 ${p.name} will join the next game`);
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
    io.to(roomCode).emit('eliminationModeChanged', {
      mode: mode,
      hostName: player.name
    });

    // Log the change
    const modeNames = {
      'standard': 'Standard Mode',
      'lowestHand': 'Lowest-Hand Mode'
    };
    io.to(roomCode).emit('log', `🎯 ${player.name} set elimination mode to: ${modeNames[mode]}`);
  });

  // 🃏 NEW: Handle roulette choice submission (Second Chance Card)
  socket.on('submitRouletteChoice', (choices) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;

    processRouletteChoice(roomCode, socket.id, choices);
  });

  // 👁️ NEW: Handle spectator reactions
  socket.on('spectatorReaction', (data) => {
    const roomCode = socket.data.roomCode;
    const room = rooms[roomCode];
    if (!room) return;

    const player = room.players[socket.id];
    if (!player || !player.spectator) return; // Only spectators can react

    const { emoji } = data;
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
    io.to(roomCode).emit('spectatorReactionReceived', {
      emoji,
      playerName: player.name,
      playerId: socket.id
    });

    console.log(`[SPECTATOR] ${player.name} reacted with ${emoji}`);
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
    io.to(roomCode).emit('log', `👁️ ${name} disconnected while spectating`);
    
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
    io.to(roomCode).emit('log', disconnectMessage);
    io.to(roomCode).emit('log', `⚡ ${name} was automatically eliminated due to disconnection`);
    
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
    io.to(roomCode).emit('cancelTriggerAnimation');
    
    // Immediate victory announcement
    io.to(roomCode).emit('log', `🏆 ${winner.name} wins by default - opponent disconnected!`);
    
    setTimeout(() => {
      io.to(roomCode).emit('victory', {
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
      io.to(roomCode).emit('log', `⚠️ Host disconnected - game continues with new host`);
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
    io.to(roomCode).emit('log', disconnectMessage);
    updateState(roomCode);
  }
});


};

setInterval(() => {
  const now = Date.now();
  for (const token of Object.keys(playersByToken)) {
    if (now - playersByToken[token].lastSeen > RECONNECT_WINDOW_MS * 10) {
      delete playersByToken[token];
    }
  }
}, 60000);

function attach(namespace) {
  io = namespace;
  io.on('connection', onConnection);
}

module.exports = { attach };
