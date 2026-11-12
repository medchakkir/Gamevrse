// =============================================================
// reconnectService.js — Pure state restoration (no lifecycle transitions)
// =============================================================

import { DISCONNECT_GRACE_PERIOD, ROUND_PHASES, ROOM_STATES, RANKING_TIME } from "./config.js";
import { promoteNewHost, reassignJudge, countConnectedPlayers, resetAllPlayersReadyState, broadcastRoom } from "./roomManager.js";
import { clearTurnTimer, clearRankingTimer } from "./gameEngine.js";

// ✅ PURE STATE RESTORATION: No lifecycle transitions during reconnect
export function attemptReconnect(socket, roomId, playerToken, rooms, io, buildRoomSnapshot) {
  const room = rooms[roomId];
  
  if (!room) {
    return { ok: false, error: "room_not_found" };
  }
  
  // Find player by token
  let reconnectingPlayer = null;
  let oldSocketId = null;
  
  for (const sid in room.players) {
    if (room.players[sid].playerToken === playerToken) {
      reconnectingPlayer = room.players[sid];
      oldSocketId = sid;
      break;
    }
  }
  
  if (!reconnectingPlayer) {
    return { ok: false, error: "invalid_token" };
  }
  
  // Check if player is still in grace period or already connected
  if (reconnectingPlayer.connected && oldSocketId === socket.id) {
    // Same socket trying to reconnect - they're already connected
    return { ok: false, error: "already_connected" };
  }
  
  // If player is marked as connected but with different socket ID,
  // it means disconnect hasn't been processed yet - allow reconnection
  if (reconnectingPlayer.connected && oldSocketId !== socket.id) {
    console.log(`[reconnect] Player ${reconnectingPlayer.name} reconnecting before disconnect processed - allowing`);
  }
  
  console.log(`[reconnect] ${reconnectingPlayer.name} reconnecting to room ${roomId}`);
  
  // Clear grace timer
  if (reconnectingPlayer._graceTimer) {
    clearTimeout(reconnectingPlayer._graceTimer);
    reconnectingPlayer._graceTimer = null;
  }
  
  // Update socket ID if changed
  if (oldSocketId !== socket.id) {
    // Transfer player data to new socket ID (exclude internal properties)
    const { _graceTimer, ...playerData } = reconnectingPlayer;
    room.players[socket.id] = playerData;
    room.players[socket.id].socketId = socket.id;
    delete room.players[oldSocketId];
    
    // Update host if necessary
    if (room.hostSocketId === oldSocketId) {
      room.hostSocketId = socket.id;
    }
    
    // Update judge if necessary
    if (room.judgeSocketId === oldSocketId) {
      room.judgeSocketId = socket.id;
    }
    
    // Update turn order if in round
    if (room.round && room.round.turnOrder) {
      room.round.turnOrder = room.round.turnOrder.map(id => 
        id === oldSocketId ? socket.id : id
      );
    }
    
    // Update answers if in round
    if (room.round && room.round.answers) {
      room.round.answers = room.round.answers.map(a => ({
        ...a,
        playerSocketId: a.playerSocketId === oldSocketId ? socket.id : a.playerSocketId
      }));
    }
    
    // Update judge queue
    room.judgeQueue = room.judgeQueue.map(id => 
      id === oldSocketId ? socket.id : id
    );
  }
  
  // Mark as connected
  room.players[socket.id].connected = true;
  room.players[socket.id].disconnectedAt = null;
  
  // Rejoin room
  socket.join(roomId);
  
  // Notify room
  io.to(roomId).emit("player_reconnected", {
    socketId: socket.id,
    name: room.players[socket.id].name
  });
  
  // Build safe room data without circular references
  const safeRoomData = {
    hostSocketId: room.hostSocketId,
    judgeSocketId: room.judgeSocketId,
    state: room.state,
    mode: room.mode || "normal",
    currentRoundIndex: room.currentRoundIndex,
    leaderboard: (room.leaderboard || []).map(p => ({
      socketId: p.socketId,
      name: p.name,
      score: p.score,
      avatarColor: p.avatarColor,
      avatarTextColor: p.avatarTextColor
    })),
    rules: room.rules
  };
  
  // Add round data if in round (without circular refs)
  if (room.round) {
    safeRoomData.round = {
      id: room.round.id,
      question: room.round.question,
      difficulty: room.round.difficulty,
      phase: room.round.phase, // ✅ Include phase
      currentTurnIndex: room.round.currentTurnIndex
    };
  }
  
  // Build safe players list
  const safePlayers = Object.values(room.players)
    .filter(p => p.connected)
    .map(p => ({
      socketId: p.socketId,
      name: p.name,
      score: p.score,
      ready: p.ready,
      avatarColor: p.avatarColor,
      avatarTextColor: p.avatarTextColor
    }));
  
  // ✅ Send phase-aware state snapshot for UI rehydration
  const snapshot = buildRoomSnapshot(room, socket.id);
  console.log(`[reconnect] ===== SENDING SNAPSHOT =====`);
  console.log(`[reconnect] socketId: ${socket.id}`);
  console.log(`[reconnect] roomState: ${snapshot.roomState}`);
  console.log(`[reconnect] inRoundData exists: ${!!snapshot.inRoundData}`);
  if (snapshot.inRoundData) {
    console.log(`[reconnect] phase: ${snapshot.inRoundData.phase}`);
    console.log(`[reconnect] isJudge: ${snapshot.inRoundData.isJudge}`);
    console.log(`[reconnect] answersForRanking exists: ${!!snapshot.inRoundData.answersForRanking}`);
    console.log(`[reconnect] answersForRanking length: ${snapshot.inRoundData.answersForRanking?.length}`);
  }
  console.log(`[reconnect] =====================================`);
  socket.emit("reconnect_state", snapshot);
  
  broadcastRoom(roomId, rooms, io);
  
  return { 
    ok: true, 
    roomId, 
    room: safeRoomData,
    players: safePlayers,
    mode: room.mode || "normal"
  };
}

// ✅ HANDLE DISCONNECT: Immediate action only for critical phases
export function handleDisconnect(socketId, rooms, io, beginNextTurn, cancelStartCountdown, startRoundNow, chatTimestamps) {
  delete chatTimestamps[socketId];
  
  // Find which room this socket was in
  let disconnectedRoomId = null;
  for (const rid in rooms) {
    if (rooms[rid].players[socketId]) {
      disconnectedRoomId = rid;
      break;
    }
  }
  
  if (!disconnectedRoomId) return;
  
  const room = rooms[disconnectedRoomId];
  const player = room.players[socketId];
  
  if (!player) return;
  
  console.log(`[disconnect] ${player.name} (${socketId}) from room ${disconnectedRoomId}`);
  
  // Mark player as disconnected
  player.connected = false;
  player.disconnectedAt = Date.now();
  
  // Start grace timer for ALL players (including judges)
  // They have 60 seconds to reconnect
  player._graceTimer = setTimeout(() => {
    handlePermanentDisconnect(socketId, disconnectedRoomId, rooms, io, beginNextTurn, cancelStartCountdown, startRoundNow);
  }, DISCONNECT_GRACE_PERIOD);
  
  // Notify room about temporary disconnect
  io.to(disconnectedRoomId).emit("player_disconnected", {
    socketId: socketId,
    name: player.name,
    temporary: true
  });
  
  broadcastRoom(disconnectedRoomId, rooms, io);
}

// ✅ HANDLE PERMANENT DISCONNECT: Only called after grace period expires
export function handlePermanentDisconnect(socketId, roomId, rooms, io, beginNextTurn, cancelStartCountdown, startRoundNow) {
  const room = rooms[roomId];
  if (!room || !room.players[socketId]) return;
  
  const player = room.players[socketId];
  console.log(`[permanent disconnect] ${player.name} (${socketId}) from room ${roomId}`);
  
  // Clear grace timer
  if (player._graceTimer) {
    clearTimeout(player._graceTimer);
    player._graceTimer = null;
  }
  
  const wasHost = (room.hostSocketId === socketId);
  const wasJudge = (room.judgeSocketId === socketId);
  
  // Remove player from room
  delete room.players[socketId];
  
  // Remove from judge queue
  room.judgeQueue = room.judgeQueue.filter(id => id !== socketId);
  
  // Notify room about permanent disconnect
  io.to(roomId).emit("player_permanently_disconnected", {
    socketId: socketId,
    name: player.name
  });
  
  // Check if room is now empty
  if (Object.keys(room.players).length === 0) {
    console.log(`[room empty] Deleting room ${roomId}`);
    if (room._startTimer) clearTimeout(room._startTimer);
    if (room._turnTimer) clearTimeout(room._turnTimer);
    if (room._nextRoundTimer) clearInterval(room._nextRoundTimer);
    delete rooms[roomId];
    return;
  }
  
  // CASE A: Disconnect in lobby or game_ended
  if (room.state === ROOM_STATES.LOBBY || room.state === ROOM_STATES.GAME_ENDED) {
    if (wasHost) {
      promoteNewHost(room, roomId, io);
    }
    broadcastRoom(roomId, rooms, io);
    return;
  }
  
  // CASE B: Disconnect during countdown (starting)
  if (room.state === ROOM_STATES.STARTING) {
    const connectedCount = countConnectedPlayers(room);
    
    if (connectedCount < room.rules.minPlayers) {
      cancelStartCountdown(roomId, rooms, io, broadcastRoom, "not_enough_players");
    }
    
    if (wasHost) {
      promoteNewHost(room, roomId, io);
    }
    
    broadcastRoom(roomId, rooms, io);
    return;
  }
  
  // CASE C: Disconnect during answer phase (in_round, answering)
  if (room.state === ROOM_STATES.IN_ROUND && room.round && room.round.phase === ROUND_PHASES.ANSWERING) {
    const wasCurrentTurn = (room.round.answers.length < room.round.turnOrder.length && 
                           room.round.turnOrder[room.round.answers.length] === socketId);
    
    // Remove from turn order
    room.round.turnOrder = room.round.turnOrder.filter(id => id !== socketId);
    
    // Remove any pending answers
    room.round.answers = room.round.answers.filter(a => a.playerSocketId !== socketId);
    
    // If judge disconnected during answer phase
    if (wasJudge) {
      // Continue answer phase, reassign judge when ranking begins
      console.log(`[judge disconnect] Judge disconnected during answer phase, will reassign at ranking`);
    } else if (wasCurrentTurn) {
      // If it was their turn, advance to next turn
      clearTurnTimer(room);
      beginNextTurn(roomId);
    }
    
    // Check minimum players
    const connectedCount = countConnectedPlayers(room);
    if (connectedCount < 2) {
      // Immediately end round
      room.round = null;
      room.state = ROOM_STATES.LOBBY;
      room.currentRoundIndex = 0;
      
      resetAllPlayersReadyState(room);
      
      io.to(roomId).emit("game_ended_due_to_low_players", {
        reason: "Not enough players to continue"
      });
      io.to(roomId).emit("return_to_lobby");
    }
    
    if (wasHost) {
      promoteNewHost(room, roomId, io);
    }
    
    broadcastRoom(roomId, rooms, io);
    return;
  }
  
  // CASE D: Disconnect during ranking phase (in_round, ranking)
  if (room.state === ROOM_STATES.IN_ROUND && room.round && wasJudge) {
    const inRankingPhase = (room.round.phase === ROUND_PHASES.RANKING);
    
    console.log(`[handlePermanentDisconnect] CASE D: wasJudge=${wasJudge}, phase=${room.round.phase}, inRankingPhase=${inRankingPhase}`);
    
    if (inRankingPhase) {
      // Judge disconnected during ranking phase
      console.log(`[judge disconnect] ⚠️ Judge disconnected during ranking phase - reassigning or skipping`);
      
      // Check if we have enough players to continue
      const connectedCount = countConnectedPlayers(room);
      if (connectedCount < room.rules.minPlayers) {
        // Not enough players - end game
        room.round = null;
        room.state = ROOM_STATES.LOBBY;
        room.currentRoundIndex = 0;
        
        resetAllPlayersReadyState(room);
        
        io.to(roomId).emit("game_ended_due_to_low_players", {
          reason: "Judge left during ranking"
        });
        io.to(roomId).emit("return_to_lobby");
        broadcastRoom(roomId, rooms, io);
        return;
      }
      
      // Try to reassign judge
      const newJudge = reassignJudge(room, roomId, io);
      
      if (!newJudge) {
        // No one available to judge - skip this round and move to next
        console.log(`[judge disconnect] No judge available - skipping round`);
        
        const idx = room.currentRoundIndex;
        const total = room.rules.numRounds;
        const roundsRemaining = idx + 1 < total;
        
        // Build leaderboard (no points awarded this round)
        const leaderboard = Object.values(room.players)
          .filter(p => p.connected)
          .sort((a,b)=>b.score - a.score)
          .map(p=>({ socketId:p.socketId, name:p.name, score:p.score, avatarColor:p.avatarColor, avatarTextColor:p.avatarTextColor }));
        
        room.leaderboard = leaderboard;
        room.round = null;
        
        // Notify players that round was skipped
        io.to(roomId).emit("round_skipped", {
          reason: "Judge disconnected during ranking",
          leaderboard,
          roundsRemaining
        });
        
        if (!roundsRemaining) {
          // Game over
          room.state = ROOM_STATES.LOBBY;
          room.currentRoundIndex = 0;
          room.pendingQuestion = null;
          
          resetAllPlayersReadyState(room);
          
          io.to(roomId).emit("game_ended", {
            leaderboard: room.leaderboard
          });
          
          broadcastRoom(roomId, rooms, io);
        } else {
          // Move to next round
          room.state = ROOM_STATES.BETWEEN_ROUNDS;
          room.currentRoundIndex++;
          
          // Start 15-second auto-advance timer
          let countdown = 15;
          
          if (room._nextRoundTimer) {
            clearInterval(room._nextRoundTimer);
            room._nextRoundTimer = null;
          }
          
          const nextRoundInterval = setInterval(() => {
            countdown--;
            io.to(roomId).emit("next_round_countdown", { seconds: countdown });
            
            if (countdown <= 0) {
              clearInterval(nextRoundInterval);
              room._nextRoundTimer = null;
              
              // Auto-start next round
              if (room.state === ROOM_STATES.BETWEEN_ROUNDS && room.currentRoundIndex < room.questions.length) {
                console.log(`[auto-advance] Starting round ${room.currentRoundIndex + 1} after skipped round`);
                startRoundNow(roomId);
              }
            }
          }, 1000);
          
          room._nextRoundTimer = nextRoundInterval;
          broadcastRoom(roomId, rooms, io);
        }
        
        if (wasHost) {
          promoteNewHost(room, roomId, io);
        }
        return;
      }
      
      // New judge assigned - notify and continue ranking
      console.log(`[judge disconnect] New judge assigned: ${newJudge}`);
      const answers = room.round.answers || [];
      
      // Clear old ranking timer and start new one for new judge
      clearRankingTimer(room);
      
      room._rankingStartedAt = Date.now();
      room._rankingTimer = setTimeout(async () => {
        console.log(`[ranking timeout] New judge did not rank in time - auto-ranking randomly`);
        const { autoRankAnswers } = await import("./gameEngine.js");
        autoRankAnswers(roomId, rooms, io);
      }, RANKING_TIME);
      
      // Send ranking interface to new judge
      io.to(newJudge).emit("judge_reassigned_ranking", {
        rankingTime: RANKING_TIME,
        answersAnon: answers.map(a => ({
          answerId: a.id,
          text: a.text,
          timedOut: a.timedOut || false
        }))
      });
      
      if (wasHost) {
        promoteNewHost(room, roomId, io);
      }
      
      broadcastRoom(roomId, rooms, io);
      return;
    }
  }
  
  // CASE E: Disconnect during between_rounds
  if (room.state === ROOM_STATES.BETWEEN_ROUNDS) {
    const connectedCount = countConnectedPlayers(room);
    
    if (connectedCount < room.rules.minPlayers) {
      // Not enough players to continue - end game
      room.state = ROOM_STATES.LOBBY;
      room.currentRoundIndex = 0;
      room.pendingQuestion = null;
      
      // Clear any timers
      if (room._nextRoundTimer) {
        clearInterval(room._nextRoundTimer);
        room._nextRoundTimer = null;
      }
      
      resetAllPlayersReadyState(room);
      
      const leaderboard = Object.values(room.players)
        .filter(p => p.connected)
        .sort((a,b)=>b.score - a.score)
        .map(p=>({ socketId:p.socketId, name:p.name, score:p.score, avatarColor:p.avatarColor, avatarTextColor:p.avatarTextColor }));
      
      io.to(roomId).emit("game_ended_due_to_low_players", {
        reason: "Not enough players to continue",
        leaderboard
      });
      
      io.to(roomId).emit("return_to_lobby");
      
      // Promote new host
      if (wasHost) {
        promoteNewHost(room, roomId, io);
      }
      
      broadcastRoom(roomId, rooms, io);
      return;
    }
    
    // Enough players to continue (3+)
    console.log(`[between_rounds disconnect] ${connectedCount} players remaining - continuing game`);
    
    // Promote new host if needed
    if (wasHost) {
      promoteNewHost(room, roomId, io);
    }
    
    // Reassign judge if needed (judge will be picked for next round)
    // Note: Judge is picked at the start of each round, so we don't need to reassign here
    // The next round will automatically pick a new judge
    
    broadcastRoom(roomId, rooms, io);
    return;
  }
  
  // CASE F: Disconnect during game_ended or lobby
  if ((room.state === ROOM_STATES.LOBBY || room.state === ROOM_STATES.GAME_ENDED) && wasHost) {
    promoteNewHost(room, roomId, io);
  }
  
  broadcastRoom(roomId, rooms, io);
}
