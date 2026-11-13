const { ctx } = require('../state');
const { activateFreeze, activateSecondChance } = require('../powerups');
const { PHASE_PLAY, TIMER_UPDATE_INTERVAL, log, playerRoom } = require('../state');
const { handleRoundTimeout, updateRoundTimer } = require('../timers');
const { getRoom } = require('../rooms');
const { safeInterval, safeTimeout } = require('../../../shared/timers');

function register(socket) {

  // NEW: Client finished watching Second Chance replay
  socket.on("secondChanceReplayComplete", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room) return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // Handle sudden death Second Chance replay completion
    if (room.isSuddenDeath) {
      if (!player.secondChanceActive) {
        log(`[sudden-death] ${player.name} replay complete but secondChanceActive already false`);
        return;
      }
      
      log(`[sudden-death] ${player.name} finished Second Chance replay - resuming timer from ${player.secondChanceRemaining}ms`);
      
      // Clear Second Chance active flag and restore personal deadline
      player.secondChanceActive = false;
      player.personalDeadline = Date.now() + player.secondChanceRemaining;
      
      log(`[sudden-death] ${player.name} timer RESUMED, personal deadline set to ${new Date(player.personalDeadline).toISOString()}`);
      return;
    }
    
    // Normal gameplay Second Chance
    if (room.currentPhase !== PHASE_PLAY) return;
    if (socket.id !== room.secondChancePlayerId) return;
    
    log(`[${room.id}] ${player.name} finished Second Chance replay - resuming timer from ${room.secondChanceRemainingTime}ms`);
    
    // Resume timer from stored remaining time
    room.roundEndTimestamp = Date.now() + room.secondChanceRemainingTime;
    room.freezeActive = false;
    
    // Restart timer interval
    room.timerInterval = safeInterval('colorrush/handlers/powerups#1', () => {
      updateRoundTimer(room);
    }, TIMER_UPDATE_INTERVAL);
    
    // Restart round timeout with remaining time
    room.roundTimeout = safeTimeout('colorrush/handlers/powerups#2', () => {
      handleRoundTimeout(room);
    }, room.secondChanceRemainingTime);
    
    // Notify client to resume
    ctx.io.to(socket.id).emit("secondChanceTimerResume", {
      remainingTime: room.secondChanceRemainingTime
    });
    
    // Clear Second Chance state
    room.secondChanceRemainingTime = null;
    room.secondChancePlayerId = null;
  });

  // Power-up activation handlers
  // NEW SECOND CHANCE ACTIVATION HANDLER
  socket.on("activateSecondChance", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.phase !== "game") return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // 🔥 HARD GUARD: Reject eliminated players
    if (!player.alive) {
      log(`[activateSecondChance] ⚠️ HARD GUARD: Eliminated player ${player.name} attempted to use Second Chance! REJECTED.`);
      return;
    }
    
    // CRITICAL: Check if power-ups are enabled
    if (!room.settings.powerUpsEnabled) {
      log(`[activateSecondChance] Rejected - power-ups disabled in room ${roomId}`);
      return;
    }
    
    // PHASE CHECK: Only allow Second Chance during PLAY phase
    if (room.currentPhase !== PHASE_PLAY) {
      log(`[activateSecondChance] Rejected from ${socket.id} - wrong phase: ${room.currentPhase}`);
      return;
    }

    // Use Second Chance activation
    const success = activateSecondChance(room, socket.id);
    
    if (success) {
      ctx.io.to(socket.id).emit("secondChanceActivated");
      ctx.io.to(room.id).emit("powerUpUsed", { playerId: socket.id, type: "secondChance" });

      // Broadcast updated room state
      ctx.io.to(room.id).emit("roomState", {
        roomId: room.id,
        hostId: room.hostId,
        players: Object.values(room.players),
        maxPlayers: room.settings.maxPlayers,
        phase: room.phase
      });

      log(`[${room.id}] ${player.name} activated Second Chance (one-time use)`);
    }
  });

  socket.on("activateFreeze", () => {
    const roomId = playerRoom[socket.id];
    const room = getRoom(roomId);
    if (!room || room.phase !== "game") return;
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // 🔥 HARD GUARD: Reject eliminated players
    if (!player.alive) {
      log(`[activateFreeze] ⚠️ HARD GUARD: Eliminated player ${player.name} attempted to use freeze! REJECTED.`);
      return;
    }
    
    // CRITICAL: Check if power-ups are enabled
    if (!room.settings.powerUpsEnabled) {
      log(`[activateFreeze] Rejected - power-ups disabled in room ${roomId}`);
      return;
    }
    
    // PHASE CHECK: Only allow freeze during PLAY phase
    if (room.currentPhase !== PHASE_PLAY) {
      log(`[activateFreeze] Rejected from ${socket.id} - wrong phase: ${room.currentPhase}`);
      return;
    }

    // Use server-side freeze activation
    const success = activateFreeze(room, socket.id);
    
    if (success) {
      ctx.io.to(socket.id).emit("freezeActivated");
      ctx.io.to(room.id).emit("powerUpUsed", { playerId: socket.id, type: "freeze" });

      // Broadcast updated room state
      ctx.io.to(room.id).emit("roomState", {
        roomId: room.id,
        hostId: room.hostId,
        players: Object.values(room.players),
        maxPlayers: room.settings.maxPlayers,
        phase: room.phase
      });

      log(`[${room.id}] ${player.name} activated Time Freeze power-up`);
    }
  });

  // Pattern Peek power-up activation
  socket.on("activatePatternPeek", (data) => {
    log(`[activatePatternPeek] ========== START ==========`);
    log(`[activatePatternPeek] Received from ${socket.id}`);
    log(`[activatePatternPeek] Data received:`, JSON.stringify(data));
    
    const roomId = playerRoom[socket.id];
    log(`[activatePatternPeek] Room ID: ${roomId}`);
    
    const room = getRoom(roomId);
    log(`[activatePatternPeek] Room found: ${!!room}, room.phase: ${room?.phase}`);
    
    if (!room || room.phase !== "game") {
      log(`[activatePatternPeek] Early exit - no room or wrong phase`);
      return;
    }
    
    const player = room.players[socket.id];
    if (!player) return;
    
    // 🔥 HARD GUARD: Reject eliminated players
    if (!player.alive) {
      log(`[activatePatternPeek] ⚠️ HARD GUARD: Eliminated player ${player.name} attempted to use Pattern Peek! REJECTED.`);
      return;
    }
    
    // CRITICAL: Check if power-ups are enabled
    if (!room.settings.powerUpsEnabled) {
      log(`[activatePatternPeek] Rejected - power-ups disabled in room ${roomId}`);
      return;
    }
    
    log(`[activatePatternPeek] Current phase: ${room.currentPhase}, PHASE_PLAY: ${PHASE_PLAY}`);
    
    // PHASE CHECK: Pattern Peek can only be activated during PLAY phase
    if (room.currentPhase !== PHASE_PLAY) {
      log(`[activatePatternPeek] Rejected from ${socket.id} - wrong phase: ${room.currentPhase}`);
      return;
    }
    
    log(`[activatePatternPeek] Player found: ${!!player}, alive: ${player?.alive}`);
    log(`[activatePatternPeek] Player powerups:`, JSON.stringify(player.powerups));
    
    // Check if already used
    if (player.powerups.patternPeek.used) {
      log(`[activatePatternPeek] Rejected from ${socket.id} - already used`);
      return;
    }
    
    // Check if player has already submitted
    if (player.answered) {
      log(`[activatePatternPeek] Rejected from ${socket.id} - already answered`);
      return;
    }
    
    // Use client's current input length (more accurate than server's stored value)
    const currentInputLength = data?.currentInputLength ?? 0;
    const nextIndex = currentInputLength;
    
    log(`[activatePatternPeek] Client's current input length: ${currentInputLength}`);
    log(`[activatePatternPeek] Next index to reveal: ${nextIndex}`);
    log(`[activatePatternPeek] Room sequence:`, room.sequence);
    log(`[activatePatternPeek] Room sequence length: ${room.sequence.length}`);
    
    // Check if player already finished sequence
    if (nextIndex >= room.sequence.length) {
      log(`[activatePatternPeek] Rejected from ${socket.id} - sequence already complete (nextIndex=${nextIndex}, length=${room.sequence.length})`);
      return;
    }
    
    const nextColor = room.sequence[nextIndex];
    
    log(`[activatePatternPeek] Next color at index ${nextIndex}: ${nextColor}`);
    
    // Mark as used
    player.powerups.patternPeek.used = true;
    
    log(`[${room.id}] ${player.name} activated Pattern Peek - revealing tile ${nextIndex}: ${nextColor}`);
    
    // Emit to ONLY this player
    ctx.io.to(socket.id).emit("peekReveal", {
      index: nextIndex,
      color: nextColor
    });
    
    log(`[activatePatternPeek] Emitted peekReveal to ${socket.id}: index=${nextIndex}, color=${nextColor}`);
    
    // Broadcast that power-up was used (but not what was revealed)
    ctx.io.to(room.id).emit("powerUpUsed", { playerId: socket.id, type: "peek" });
    
    log(`[activatePatternPeek] ========== END ==========`);
  });
}

module.exports = { register };
