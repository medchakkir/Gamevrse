Object.assign(module.exports, { clearTurnTimer, startTurnTimer, verifyTimerState, nextTurn, startRound, endRound }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { getBotDecision, getBotRouletteChoice } = require('./bots');
const { createDeck, handValue, shuffle } = require('./cards');
const { clearNextRoundCountdown, clearReadyCountdown, startNextRoundCountdown } = require('./countdowns');
const { resetRoomToLobby, setPhase, updateState } = require('./roomState');
const { processRouletteChoice } = require('./roulette');
const { RETURN_TO_LOBBY_SECONDS, ROULETTE_CHOICE_TIMEOUT_MS, TURN_EMIT_BUFFER_MS, TURN_MS, bots, rooms } = require('./state');


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
    ctx.io.to(roomCode).emit('turnDeadline', { deadline: null });
    console.log(`[TIMER] Sent null turnDeadline to clear client timers for room ${roomCode}`);
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
  ctx.io.to(roomCode).emit('turnDeadline', { deadline: deadline + TURN_EMIT_BUFFER_MS });
  console.log(`[TIMER] ✅ SENT turnDeadline event for ${currentPlayer.name} in room ${roomCode} - deadline: ${new Date(deadline + TURN_EMIT_BUFFER_MS)}`);

  // THEN set the server timeout
  room.turnTimer = setTimeout(() => {
    console.log(`[TIMEOUT] Timer fired for ${currentPlayer.name} in room ${roomCode}`);
    
    const p = room.players[currentId];
    if (p && p.alive && !p.busted && !p.stood) {
      p.stood = true;
      ctx.io.to(roomCode).emit('log', `⏰ ${p.name} ran out of time and auto-stood`);
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
    ctx.io.to(roomCode).emit('log', `⏭️ Skipping disconnected player's turn`);
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
    ctx.io.to(roomCode).emit('log', 'Not enough players to start the round.');
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
  ctx.io.to(roomCode).emit('log', `🔄 Round ${room.roundsPlayed + 1} started with ${alivePlayers.length} players!`);
  if (spectatorCount > 0) {
    ctx.io.to(roomCode).emit('log', `👁️ ${spectatorCount} spectator${spectatorCount > 1 ? 's' : ''} watching`);
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
    ctx.io.to(roomCode).emit('victory', {
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
  ctx.io.to(roomCode).emit('log', '📊 Final hands:');
  alive.forEach(p => {
    const handVal = handValue(p.hand);
    const status = p.busted ? '💥 BUSTED' : `${handVal}`;
    ctx.io.to(roomCode).emit('log', `   ${p.name}: ${status}`);
  });

  let candidates;

  // 🎯 NEW: Final 2 Bust Override Rule (applies to both modes)
  const isFinalTwo = alive.length === 2;
  if (isFinalTwo && busted.length === 1) {
    // FINAL 2 RULE: If exactly one player is busted, they must go to roulette regardless of mode
    candidates = busted;
    console.log(`[ROULETTE] Final 2 Bust Override - busted player selected regardless of elimination mode`);
    ctx.io.to(roomCode).emit('log', '⚡ Final 2 rule applied: Bust overrides Lowest-Hand Mode');
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

    ctx.io.to(roomCode).emit(
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
      ctx.io.to(roomCode).emit(
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

      ctx.io.to(roomCode).emit(
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
    
    ctx.io.to(roomCode).emit('log', `${chosen.name} (Bot) is making their roulette choice...`);
    return;
  }

  // Send roulette choice to human player (with Second Chance Card option)
  ctx.io.to(chosen.id).emit('rouletteChoice', {
    playerName: chosen.name,
    hasSecondChance: chosen.hasSecondChance && !chosen.secondChanceUsed,
    playersRemaining: alive.length
  });

  // Send notification to other players
  if (chosen.hasSecondChance && !chosen.secondChanceUsed) {
    ctx.io.to(roomCode).emit('log', `${chosen.name} is making their roulette choice... (Second Chance Card available)`);
  } else {
    ctx.io.to(roomCode).emit('log', `${chosen.name} is making their roulette choice... (No Second Chance Card)`);
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
