// =============================================================
// roomManager.js — Room lifecycle with phase-aware snapshots
// =============================================================

import { shuffle } from "./utils.js";
import { ROUND_PHASES, ROOM_STATES, RANKING_TIME } from "./config.js";

export function pickJudge(room) {
  const playerIds = Object.keys(room.players);
  if (playerIds.length === 0) return null;

  room.judgeQueue = room.judgeQueue.filter(id =>
    room.players[id] && room.players[id].connected
  );

  if (room.judgeQueue.length === 0) {
    room.judgeQueue = [...playerIds].filter(id => room.players[id].connected);
    shuffle(room.judgeQueue);
  }

  const judgeId = room.judgeQueue.shift();
  
  return judgeId;
}

export function promoteNewHost(room, roomId, io) {
  const connectedPlayers = Object.keys(room.players).filter(
    id => room.players[id].connected
  );
  
  if (connectedPlayers.length === 0) {
    return null;
  }
  
  const newHostId = connectedPlayers[0];
  room.hostSocketId = newHostId;
  
  io.to(roomId).emit("host_changed", {
    newHostSocketId: newHostId,
    newHostName: room.players[newHostId].name
  });
  
  return newHostId;
}

export function reassignJudge(room, roomId, io) {
  const connectedPlayers = Object.keys(room.players).filter(
    id => room.players[id].connected && id !== room.judgeSocketId
  );
  
  if (connectedPlayers.length === 0) {
    return null;
  }
  
  // Remove old judge from queue if present
  room.judgeQueue = room.judgeQueue.filter(id => id !== room.judgeSocketId);
  
  // Pick new judge
  const newJudgeId = pickJudge(room);
  if (!newJudgeId) return null;
  
  room.judgeSocketId = newJudgeId;
  
  io.to(roomId).emit("judge_reassigned", {
    newJudgeSocketId: newJudgeId,
    newJudgeName: room.players[newJudgeId].name
  });
  
  return newJudgeId;
}

export function countConnectedPlayers(room) {
  return Object.values(room.players).filter(p => p.connected).length;
}

export function resetAllPlayersReadyState(room) {
  Object.values(room.players).forEach(player => {
    player.ready = false;
    player.score = 0;
  });
}

// ✅ PHASE-AWARE STATE SNAPSHOT for reconnection
export function buildRoomSnapshot(room, socketId) {
  const snapshot = {
    roomState: room.state,
    hostSocketId: room.hostSocketId,
    judgeSocketId: room.judgeSocketId,
    rules: room.rules,
    leaderboard: (room.leaderboard || []).map(p => ({
      socketId: p.socketId,
      name: p.name,
      score: p.score,
      avatarColor: p.avatarColor,
      avatarTextColor: p.avatarTextColor
    })),
    players: Object.values(room.players)
      .filter(p => p.connected)
      .map(p => ({
        socketId: p.socketId,
        name: p.name,
        score: p.score,
        ready: p.ready,
        avatarColor: p.avatarColor,
        avatarTextColor: p.avatarTextColor
      })),
    currentRoundIndex: room.currentRoundIndex || 0,
    totalRounds: room.rules.numRounds,
    mode: room.mode || "normal"
  };

  // CASE: Starting (countdown)
  if (room.state === ROOM_STATES.STARTING && room.startExpiresAt) {
    snapshot.startingData = {
      expiresAt: room.startExpiresAt,
      remainingTime: Math.max(0, room.startExpiresAt - Date.now())
    };
  }

  // CASE: In Round (with explicit phase)
  if (room.state === ROOM_STATES.IN_ROUND && room.round) {
    const round = room.round;
    const playerAnswered = round.answers.some(a => a.playerSocketId === socketId);
    const isJudge = (room.judgeSocketId === socketId);
    
    // Find current turn
    const currentTurnIndex = round.answers.length;
    const isCurrentTurn = (currentTurnIndex < round.turnOrder.length && 
                          round.turnOrder[currentTurnIndex] === socketId);
    
    snapshot.inRoundData = {
      roundId: round.id,
      question: round.question,
      difficulty: round.difficulty,
      phase: round.phase, // ✅ Explicit phase
      turnOrder: round.turnOrder.map(id => ({
        socketId: id,
        name: room.players[id]?.name || "Player"
      })),
      currentTurnIndex: currentTurnIndex,
      totalAnswerers: round.turnOrder.length,
      answersSubmitted: round.answers.length,
      playerAnswered: playerAnswered,
      isJudge: isJudge,
      isCurrentTurn: isCurrentTurn
    };
    
    // PHASE: ANSWERING
    if (round.phase === ROUND_PHASES.ANSWERING) {
      // If it's their turn and timer is active, calculate remaining time
      if (isCurrentTurn && room._turnTimer) {
        const turnTime = room.rules.turnTime;
        const elapsed = Date.now() - (room._turnStartedAt || Date.now());
        const remaining = Math.max(0, turnTime - elapsed);
        
        if (remaining > 0) {
          snapshot.inRoundData.remainingTurnTime = remaining;
        }
      }
    }
    
    // PHASE: RANKING
    if (round.phase === ROUND_PHASES.RANKING) {
      console.log(`[buildRoomSnapshot] ===== RANKING PHASE DEBUG =====`);
      console.log(`[buildRoomSnapshot] socketId: ${socketId}`);
      console.log(`[buildRoomSnapshot] judgeSocketId: ${room.judgeSocketId}`);
      console.log(`[buildRoomSnapshot] isJudge: ${isJudge}`);
      console.log(`[buildRoomSnapshot] round.answers length: ${round.answers?.length}`);
      console.log(`[buildRoomSnapshot] =====================================`);
      
      // Include answers for judge to rank
      if (isJudge) {
        snapshot.inRoundData.answersForRanking = round.answers.map(a => ({
          answerId: a.id,
          text: a.text,
          timedOut: a.timedOut || false
        }));
        console.log(`[buildRoomSnapshot] ✅ Added answersForRanking for judge: ${snapshot.inRoundData.answersForRanking.length} answers`);
      } else {
        console.log(`[buildRoomSnapshot] ❌ Not adding answersForRanking - player is not judge`);
      }
      
      // Include remaining ranking time for all players
      if (room._rankingStartedAt) {
        const elapsed = Date.now() - room._rankingStartedAt;
        const remaining = Math.max(0, RANKING_TIME - elapsed);
        
        if (remaining > 0) {
          snapshot.inRoundData.remainingRankingTime = remaining;
        }
      }
    }
    
    // PHASE: RESULTS
    if (round.phase === ROUND_PHASES.RESULTS) {
      // Results phase - client should show results screen
      snapshot.inRoundData.showingResults = true;
    }
  }

  // CASE: Between Rounds
  if (room.state === ROOM_STATES.BETWEEN_ROUNDS) {
    snapshot.betweenRoundsData = {
      leaderboard: (room.leaderboard || []).map(p => ({
        socketId: p.socketId,
        name: p.name,
        score: p.score,
        avatarColor: p.avatarColor,
        avatarTextColor: p.avatarTextColor
      }))
    };
    
    // Include remaining timer if active
    if (room._betweenRoundsStartedAt && room._betweenRoundsDuration) {
      const elapsed = Date.now() - room._betweenRoundsStartedAt;
      const remaining = Math.max(0, room._betweenRoundsDuration - elapsed);
      
      if (remaining > 0) {
        snapshot.betweenRoundsData.remainingTime = remaining;
        snapshot.betweenRoundsData.remainingSeconds = Math.ceil(remaining / 1000);
      }
    }
  }

  return snapshot;
}

export function broadcastRoom(roomId, rooms, io) {
  const room = rooms[roomId];
  if (!room) return;

  // Only send connected players
  const players = Object.values(room.players)
    .filter(p => p.connected)
    .map(p => ({
      socketId: p.socketId,
      name: p.name,
      score: p.score,
      ready: p.ready || false, // ✅ Include ready state
      avatarColor: p.avatarColor,
      avatarTextColor: p.avatarTextColor
    }));

  const leaderboard =
    room.leaderboard?.map(e => ({
      socketId: e.socketId,
      name:     e.name,
      score:    e.score,
      avatarColor: e.avatarColor,
      avatarTextColor: e.avatarTextColor
    })) ||
    players.slice().sort((a,b)=>b.score - a.score);

  io.to(roomId).emit("room_update", {
    players,
    leaderboard,
    state: room.state,
    mode: room.mode || "normal",
    hostSocketId: room.hostSocketId,
    // Include phase if in round
    ...(room.round && room.round.phase ? { phase: room.round.phase } : {})
  });
}
