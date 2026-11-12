Object.assign(module.exports, { activateSecondChance, processSecondChanceRetry, resetSecondChanceRoundState, resetSecondChanceForNewMatch, activateFreeze, resumePlayerTimer }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { log, playerFreezeTimeouts } = require('./state');


// ---------- Helpers ----------
// NEW SECOND CHANCE POWERUP SYSTEM - Server-side functions
function activateSecondChance(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.alive) return false;
  
  // Validation: Second Chance must be available and not already used
  if (!player.powerups.secondChance.available) return false;
  if (player.powerups.secondChance.used) return false;
  if (player.powerups.secondChance.active) return false; // Already active
  
  // Activate Second Chance for current round
  player.powerups.secondChance.active = true;
  
  log(`[${room.id}] ${player.name} activated Second Chance (one-time use)`);
  return true;
}


function processSecondChanceRetry(room, playerId) {
  const player = room.players[playerId];
  if (!player) return false;
  
  // Check if Second Chance can be triggered
  const canTrigger = player.powerups.secondChance.active && 
                    !player.powerups.secondChance.used;
  
  if (canTrigger) {
    // Second Chance triggers - give player a retry
    player.powerups.secondChance.active = false;
    player.powerups.secondChance.used = true; // Permanently used
    
    // Reset player state for retry
    player.answered = false;
    player.time = 0;
    // DO NOT reduce lives or eliminate
    
    log(`[${room.id}] Second Chance triggered for ${player.name} - permanently used`);
    return true;
  }
  
  return false;
}


function resetSecondChanceRoundState(player) {
  // Reset only round-specific state, NOT the used flag
  player.powerups.secondChance.active = false;
  // DO NOT reset player.powerups.secondChance.used - it's permanent
}


function resetSecondChanceForNewMatch(player) {
  // Only reset for completely new match
  player.powerups.secondChance.available = true;
  player.powerups.secondChance.active = false;
  player.powerups.secondChance.used = false;
}


function activateFreeze(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.alive) {
    log(`[activateFreeze] Player not found or not alive: ${playerId}`);
    return false;
  }
  
  // Validation
  if (!player.powerups || !player.powerups.freeze || !player.powerups.freeze.available) {
    log(`[activateFreeze] Freeze not available for ${player.name}`);
    return false;
  }
  if (player.powerups.freeze.roundUsed === room.round) {
    log(`[activateFreeze] Freeze already used this round by ${player.name}`);
    return false;
  }
  if (player.freezeActive === true) {
    log(`[activateFreeze] Freeze already active for ${player.name}`);
    return false;
  }
  
  // Calculate current remaining time for THIS player
  const currentRemaining = Math.max(0, room.roundEndTimestamp - Date.now());
  if (currentRemaining <= 0) {
    log(`[activateFreeze] Round already ended, cannot activate freeze`);
    return false;
  }
  
  // Store remaining time for THIS player only
  player.freezeRemaining = currentRemaining;
  player.freezeActive = true;
  player.freezeStartTime = Date.now();
  
  // Mark powerup as used
  player.powerups.freeze.used = true;
  player.powerups.freeze.active = true;
  player.powerups.freeze.roundUsed = room.round;
  
  const freezeDuration = 3000; // 3 seconds
  
  // Emit freeze activation ONLY to this player
  ctx.io.to(playerId).emit("timerFrozen", { 
    duration: freezeDuration,
    remainingTime: player.freezeRemaining 
  });
  
  // Set timeout to resume timer for THIS player (store in Map to avoid circular reference)
  const timeout = setTimeout(() => {
    resumePlayerTimer(room, playerId);
    playerFreezeTimeouts.delete(playerId);
  }, freezeDuration);
  playerFreezeTimeouts.set(playerId, timeout);
  
  log(`[${room.id}] ${player.name} activated freeze for ${freezeDuration}ms, ${player.freezeRemaining}ms remaining (PERSONAL)`);
  return true;
}


function resumePlayerTimer(room, playerId) {
  const player = room.players[playerId];
  if (!player || !player.freezeActive) return;
  
  // Resume timer for THIS player only
  player.freezeActive = false;
  
  // Set personal deadline: current time + remaining time from freeze
  player.personalDeadline = Date.now() + player.freezeRemaining;
  
  // Emit timer resumed ONLY to this player
  ctx.io.to(playerId).emit("timerResumed", {
    remainingTime: player.freezeRemaining
  });
  
  log(`[${room.id}] ${player.name}'s freeze ended, timer resumed with ${player.freezeRemaining}ms (deadline: ${new Date(player.personalDeadline).toISOString()})`);
}
