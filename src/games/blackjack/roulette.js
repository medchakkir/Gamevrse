Object.assign(module.exports, { processRouletteChoice, executeRouletteResult }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { startNextRoundCountdown } = require('./countdowns');
const { checkForVictoryAfterElimination, reassignHost, sendRoundSummary, updateState } = require('./roomState');
const { ELIM_THRESHOLD, rooms } = require('./state');


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
    ctx.io.to(roomCode).emit('log', `🃏 ${player.name} chose to use their Second Chance Card!`);
    console.log(`[SECOND CHANCE] ${player.name} chose to use their Second Chance Card`);
  } else {
    ctx.io.to(roomCode).emit('log', `⚖️ ${player.name} chose Normal risk`);
  }

  // Apply timing choice with enhanced realism
  let triggerDelay = 0;
  let triggerMessage = `${player.name} is pulling the trigger...`;
  
  switch (choices.timing) {
    case 'spinChamber':
      // First show spinning message
      ctx.io.to(roomCode).emit('log', `${player.name} spins the chamber... *click click click*`);
      
      // Emit spinning event for visual effects
      ctx.io.to(roomCode).emit('chamberSpin', {
        playerId: playerId,
        playerName: player.name
      });
      
      // After 3 seconds, show pulling trigger message
      setTimeout(() => {
        ctx.io.to(roomCode).emit('log', `${player.name} is pulling the trigger...`);
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
    ctx.io.to(roomCode).emit('triggerPull', {
      loserId: playerId,
      loserName: player.name,
      timing: choices.timing,
      useSecondChance: choices.useSecondChance || false
    });
  }

  ctx.io.to(roomCode).emit('log', triggerMessage);

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
    ctx.io.to(roomCode).emit('secondChanceUsed', {
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
      ctx.io.to(roomCode).emit('log', `💀 ${player.name} rolled ${roll}/${elimThreshold} and should have been eliminated...`);
      setTimeout(() => {
        ctx.io.to(roomCode).emit('log', `🃏 ${player.name} used their Second Chance Card and survived!`);
      }, 1000);
    } else if (actuallyEliminated) {
      ctx.io.to(roomCode).emit('log', `💀 ${player.name} rolled ${roll}/${elimThreshold} and was ELIMINATED!`);
      // Add additional context for spectators
      setTimeout(() => {
        ctx.io.to(roomCode).emit('log', `👻 ${player.name} is now spectating the game`);
      }, 6000); // After death animation completes
    } else {
      ctx.io.to(roomCode).emit('log', `🟢 ${player.name} rolled ${roll}/${elimThreshold} and SURVIVED!`);
    }
  }, triggerAnimationDuration + 500); // Extra 500ms buffer for perfect timing

  // Send elimination event FIRST (for death animation) - only if actually eliminated
  if (actuallyEliminated) {
    ctx.io.to(playerId).emit('eliminated', { winnerName: null });
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
