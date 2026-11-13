Object.assign(module.exports, { handlePlayerDisconnect, calculateRoomState, makeDisconnectDecision, executeDisconnectDecision, buildRoomState }); // function declarations are hoisted, so cyclic requires resolve
const { ctx } = require('./state');
const { clearGameCountdown, updatePlayerList } = require('./lobby');
const { getDisconnectPhaseCategory, getTopPlayers, transitionToRoundEndPhase } = require('./rounds');
const { log, playerRoom } = require('./state');
const { endSuddenDeath } = require('./suddenDeath');
const { clearAllRoomTimers, clearPhaseTimers, clearRoundTimer, safeEndGame } = require('./timers');
const { removeRoom } = require('./rooms');
const logger = require('../../shared/logger');

// ============================================================================
// CENTRALIZED DISCONNECT SYSTEM - PRODUCTION GRADE
// ============================================================================

/**
 * Centralized disconnect decision system
 * This is the ONLY place where disconnect logic should exist
 * All state recalculation happens here in deterministic order
 */
function handlePlayerDisconnect(socket, room, roomId) {
  // ========================================
  // STEP 1: CAPTURE INITIAL STATE
  // ========================================
  const disconnectedId = socket.id;
  const wasHost = disconnectedId === room.hostId;
  const playerName = room.players[disconnectedId]?.name || 'Unknown';
  const wasAlive = room.players[disconnectedId]?.alive || false;
  const colorIndex = room.players[disconnectedId]?.colorIndex ?? 0;
  const wasSuddenDeathParticipant = room.tiePlayers?.includes(disconnectedId);
  
  log(`========================================`);
  log(`[DISCONNECT] Player: ${disconnectedId} (${playerName})`);
  log(`[DISCONNECT] Room: ${roomId}`);
  log(`[DISCONNECT] Phase: ${room.phase}/${room.currentPhase}`);
  log(`[DISCONNECT] Before: ${Object.keys(room.players).length} players`);
  log(`[DISCONNECT] Was Host: ${wasHost}, Alive: ${wasAlive}`);
  log(`[DISCONNECT] Sudden Death: ${room.isSuddenDeath}, Participant: ${wasSuddenDeathParticipant}`);
  
  // ========================================
  // STEP 2: ATOMIC PLAYER REMOVAL
  // ========================================
  delete room.players[disconnectedId];
  delete playerRoom[disconnectedId];
  
  // Remove from sudden death participants
  if (room.tiePlayers?.includes(disconnectedId)) {
    room.tiePlayers = room.tiePlayers.filter(id => id !== disconnectedId);
  }
  
  // ========================================
  // STEP 3: RECALCULATE ROOM STATE
  // ========================================
  const state = calculateRoomState(room);
  
  log(`[DISCONNECT] After: ${state.totalPlayers} players, ${state.alivePlayers} alive`);
  log(`[DISCONNECT] Sudden Death Players: ${state.suddenDeathPlayers}`);
  
  // Emit playerEliminated if they were alive
  if (wasAlive) {
    ctx.io.to(roomId).emit("playerEliminated", {
      id: disconnectedId,
      name: playerName,
      colorIndex: colorIndex
    });
  }
  
  // ========================================
  // STEP 4: MAKE DECISION
  // ========================================
  const decision = makeDisconnectDecision(room, state, wasHost);
  
  log(`[DISCONNECT] Decision: ${decision.action}`);
  log(`[DISCONNECT] Reason: ${decision.reason}`);
  
  // ========================================
  // STEP 5: EXECUTE DECISION
  // ========================================
  executeDisconnectDecision(room, roomId, decision, disconnectedId, playerName);
  
  log(`========================================`);
}


/**
 * Calculate current room state after player removal
 * This is a pure function - no side effects
 */
function calculateRoomState(room) {
  const playerIds = Object.keys(room.players);
  const aliveIds = playerIds.filter(id => room.players[id].alive);
  
  return {
    totalPlayers: playerIds.length,
    alivePlayers: aliveIds.length,
    playerIds: playerIds,
    aliveIds: aliveIds,
    suddenDeathPlayers: room.tiePlayers?.length || 0,
    phase: room.phase,
    currentPhase: room.currentPhase,
    isSuddenDeath: room.isSuddenDeath,
    gameEnding: room.gameEnding,
    hasCountdown: !!room.startCountdownTimer
  };
}


/**
 * Make disconnect decision based on room state
 * This is a pure function - returns decision object
 */
function makeDisconnectDecision(room, state, wasHost) {
  const phaseCategory = getDisconnectPhaseCategory(room);
  
  // DECISION 1: Empty room
  if (state.totalPlayers === 0) {
    return { action: 'DELETE_ROOM', reason: 'Room empty' };
  }
  
  // DECISION 2: Lobby phase
  if (phaseCategory === 'LOBBY') {
    if (state.hasCountdown && state.totalPlayers < 2) {
      return { action: 'CANCEL_COUNTDOWN', reason: 'Not enough players', needsHostTransfer: wasHost };
    }
    return { action: 'UPDATE_LOBBY', reason: 'Lobby update', needsHostTransfer: wasHost };
  }
  
  // DECISION 3: GET_READY phase with < 2 players - cancel round and return to lobby
  if (phaseCategory === 'GET_READY' && state.totalPlayers < 2) {
    return { action: 'CANCEL_ROUND_TO_LOBBY', reason: 'GET_READY < 2 players', needsHostTransfer: wasHost };
  }
  
  // DECISION 4: Sudden death with 1 player remaining
  if (state.isSuddenDeath && state.suddenDeathPlayers === 1) {
    return { 
      action: 'END_SUDDEN_DEATH', 
      reason: 'Sudden death - 1 player remains',
      winnerId: room.tiePlayers[0]
    };
  }
  
  // DECISION 5: Sudden death with 0 players remaining
  if (state.isSuddenDeath && state.suddenDeathPlayers === 0) {
    const top = getTopPlayers(room, 1, false)[0];
    return { 
      action: 'END_GAME', 
      reason: 'Sudden death - all participants disconnected',
      winnerId: top?.id
    };
  }
  
  // DECISION 6: 1v1 becomes 1v0
  if (state.phase === 'game' && state.totalPlayers === 1) {
    return { 
      action: 'INSTANT_VICTORY', 
      reason: '1v1 → 1v0',
      winnerId: state.playerIds[0]
    };
  }
  
  // DECISION 7: Only 1 alive player remains
  if (state.phase === 'game' && state.alivePlayers === 1 && !state.gameEnding) {
    return { 
      action: 'END_GAME', 
      reason: 'Only 1 alive player',
      winnerId: state.aliveIds[0]
    };
  }
  
  // DECISION 8: PLAY phase - check if all alive players answered
  if (phaseCategory === 'PLAY') {
    const allAnswered = state.aliveIds.every(id => room.players[id].answered);
    if (allAnswered) {
      return { 
        action: 'END_ROUND', 
        reason: 'All remaining players answered',
        needsHostTransfer: wasHost
      };
    }
  }
  
  // DECISION 9: Continue game
  return { 
    action: 'CONTINUE_GAME', 
    reason: 'Game continues',
    needsHostTransfer: wasHost
  };
}


/**
 * Execute the disconnect decision
 * This is where side effects happen
 */
function executeDisconnectDecision(room, roomId, decision, disconnectedId, playerName) {
  // Transfer host if needed (do this first, before any other actions)
  if (decision.needsHostTransfer && Object.keys(room.players).length > 0) {
    const newHostId = Object.keys(room.players)[0];
    room.hostId = newHostId;
    ctx.io.to(newHostId).emit("youAreHost");
    log(`[DISCONNECT] Host transferred → ${newHostId}`);
  }
  
  // Execute action
  switch (decision.action) {
    case 'DELETE_ROOM':
      clearAllRoomTimers(room);
      removeRoom(roomId);
      logger.info(`[DISCONNECT] Room deleted`);
      break;
      
    case 'CANCEL_COUNTDOWN':
      clearGameCountdown(room);
      ctx.io.to(roomId).emit("gameStartCancelled", { reason: "Not enough players" });
      ctx.io.to(roomId).emit("roomState", buildRoomState(room));
      log(`[DISCONNECT] Countdown cancelled`);
      break;
      
    case 'UPDATE_LOBBY':
      ctx.io.to(roomId).emit("roomState", buildRoomState(room));
      log(`[DISCONNECT] Lobby updated`);
      break;
      
    case 'CANCEL_ROUND_TO_LOBBY':
      clearPhaseTimers(room);
      clearAllRoomTimers(room);
      room.phase = 'lobby';
      room.currentPhase = null;
      room.gameStarted = false;
      ctx.io.to(roomId).emit("phaseChange", { phase: 'lobby', roomId });
      ctx.io.to(roomId).emit("roomState", buildRoomState(room));
      log(`[DISCONNECT] Round cancelled → returned to lobby`);
      break;
      
    case 'END_SUDDEN_DEATH':
      // Emit feedback to winner
      ctx.io.to(decision.winnerId).emit("correct", { streak: 0, streakBonus: 0 });
      
      // Notify of disconnect
      ctx.io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      log(`[DISCONNECT] Sudden death instant win - winner: ${decision.winnerId}`);
      endSuddenDeath(room, decision.winnerId);
      break;
      
    case 'INSTANT_VICTORY':
      // Notify of disconnect
      ctx.io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      log(`[DISCONNECT] Instant victory - winner: ${decision.winnerId}`);
      // Fire immediately (no delay, no pre-setting gameEnding)
      safeEndGame(room, decision.winnerId);
      break;
      
    case 'END_GAME':
      room.gameEnding = true;
      clearAllRoomTimers(room);
      
      // Notify of disconnect
      ctx.io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      safeEndGame(room, decision.winnerId);
      log(`[DISCONNECT] Game ended - winner: ${decision.winnerId}`);
      break;
      
    case 'END_ROUND':
      // Notify of disconnect
      ctx.io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      updatePlayerList(room);
      clearRoundTimer(room);
      transitionToRoundEndPhase(room);
      log(`[DISCONNECT] Round ended - all answered`);
      break;
      
    case 'CONTINUE_GAME':
      // Notify of disconnect
      ctx.io.to(roomId).emit("playerDisconnected", {
        playerId: disconnectedId,
        playerName: playerName
      });
      
      updatePlayerList(room);
      log(`[DISCONNECT] Game continues`);
      break;
      
    case 'UPDATE_ROOM':
      ctx.io.to(roomId).emit("roomState", buildRoomState(room));
      log(`[DISCONNECT] Room state updated`);
      break;
      
    default:
      log(`[DISCONNECT] Unknown action: ${decision.action}`);
  }
}


/**
 * Build room state object for emission
 */
function buildRoomState(room) {
  return {
    roomId: room.id,
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
  };
}
