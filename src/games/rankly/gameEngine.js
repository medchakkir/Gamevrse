// =============================================================
// gameEngine.js — Phase-driven game state machine
// =============================================================

import { nanoid } from "nanoid";
import { shuffle } from "./utils.js";
import { pickJudge, countConnectedPlayers, resetAllPlayersReadyState, broadcastRoom, reassignJudge } from "./roomManager.js";
import { ROUND_PHASES, ROOM_STATES, RANKING_TIME } from "./config.js";

export function clearTurnTimer(room) {
  if (room._turnTimer) {
    clearTimeout(room._turnTimer);
    room._turnTimer = null;
  }
}

export function clearRankingTimer(room) {
  if (room._rankingTimer) {
    clearTimeout(room._rankingTimer);
    room._rankingTimer = null;
  }
}

export function startRoundNow(roomId, rooms, io, beginNextTurn) {
  const room = rooms[roomId];
  if (!room) return;

  // ✅ FIX 2: Clear auto-return timer when starting new round
  if (room._autoReturnTimer) {
    clearInterval(room._autoReturnTimer);
    room._autoReturnTimer = null;
  }

  // Clear leftover timers safely
  if (room._turnTimer) {
    clearTimeout(room._turnTimer);
    room._turnTimer = null;
  }

  // Only allow starting from specific states
  if (![ROOM_STATES.LOBBY, ROOM_STATES.STARTING, ROOM_STATES.BETWEEN_ROUNDS].includes(room.state)) {
    console.log(`[startRoundNow] Cannot start from state: ${room.state}`);
    return;
  }

  const connectedCount = countConnectedPlayers(room);
  if (connectedCount < room.rules.minPlayers) {
    room.state = ROOM_STATES.LOBBY;
    broadcastRoom(roomId, rooms, io);
    return;
  }

  const idx = room.currentRoundIndex || 0;
  const questionObj = room.pendingQuestion || room.questions[idx];

  if (!questionObj || !questionObj.text) {
    console.log("[startRoundNow] No valid question object found");
    room.state = ROOM_STATES.LOBBY;
    room.round = null;
    room.currentRoundIndex = 0;
    broadcastRoom(roomId, rooms, io);
    return;
  }

  const players = Object.keys(room.players).filter(id => room.players[id].connected);

  // Pick judge
  room.judgeSocketId = pickJudge(room);

  const answerers = players.filter(id => id !== room.judgeSocketId);
  shuffle(answerers);

  // Initialize round with explicit phase
  room.state = ROOM_STATES.IN_ROUND;
  room.round = {
    id: nanoid(8),
    question: questionObj.text,
    difficulty: questionObj.difficulty,
    phase: ROUND_PHASES.ANSWERING, // ✅ Explicit phase
    answers: [],
    turnOrder: answerers,
    currentTurnIndex: 0,
    _phaseStartedAt: Date.now() // Track phase start time
  };

  room.pendingQuestion = null;

  for (const p in room.players) room.players[p].ready = false;

  io.to(roomId).emit("game_started", {
    hostSocketId: room.hostSocketId,
    judgeSocketId: room.judgeSocketId,
    roundId: room.round.id,
    question: questionObj.text,
    difficulty: questionObj.difficulty,
    phase: ROUND_PHASES.ANSWERING, // ✅ Send phase to clients
    turnOrder: answerers.map(id => ({
      socketId: id,
      name: room.players[id].name
    })),
    currentRoundIndex: idx + 1,
    totalRounds: room.rules.numRounds
  });

  broadcastRoom(roomId, rooms, io);
  
  // ✅ Call beginNextTurn with all required parameters
  if (beginNextTurn) {
    beginNextTurn(roomId, rooms, io);
  }
}

export function beginNextTurn(roomId, rooms, io) {
  const room = rooms[roomId];
  if (!room || !room.round) return;

  const round = room.round;
  const { turnOrder, answers } = round;

  // Verify we're in answering phase
  if (round.phase !== ROUND_PHASES.ANSWERING) {
    console.log(`[beginNextTurn] Wrong phase: ${round.phase}, expected ${ROUND_PHASES.ANSWERING}`);
    return;
  }

  const nextIndex = answers.length;

  // All players have answered → transition to ranking phase
  if (nextIndex >= turnOrder.length) {
    clearTurnTimer(room);
    transitionToRanking(roomId, rooms, io);
    return;
  }

  const sid = turnOrder[nextIndex];
  
  // Safety: Check if player still exists and is connected
  if (!room.players[sid] || !room.players[sid].connected) {
    console.log(`[beginNextTurn] Player ${sid} no longer exists or disconnected, skipping their turn`);
    
    // Add a "No Answer" entry for the disconnected player so we can move forward
    round.answers.push({
      id: nanoid(6),
      text: "(No Answer)",
      playerSocketId: sid,
      timedOut: true,
      disconnected: true
    });
    
    // Player left - skip their turn by recursively calling next turn
    beginNextTurn(roomId, rooms, io);
    return;
  }

  io.to(roomId).emit("next_turn", {
    socketId: sid,
    index: nextIndex + 1,
    name: room.players[sid].name
  });

  // Start timer for this player
  const turnTime = room.rules.turnTime;
  io.to(sid).emit("your_turn", { time: turnTime });

  clearTurnTimer(room);
  
  // Track when turn started for reconnection time calculation
  room._turnStartedAt = Date.now();

  // Auto-timeout
  room._turnTimer = setTimeout(() => {
    io.to(sid).emit("time_up");
    
    // Player ran out of time
    round.answers.push({
      id: nanoid(6),
      text: "(No Answer)",
      playerSocketId: sid,
      timedOut: true
    });

    beginNextTurn(roomId, rooms, io);
  }, turnTime);
}

// ✅ EXPLICIT PHASE TRANSITION: answering → ranking
function transitionToRanking(roomId, rooms, io) {
  const room = rooms[roomId];
  if (!room || !room.round) return;

  const round = room.round;
  
  // Verify current phase
  if (round.phase !== ROUND_PHASES.ANSWERING) {
    console.log(`[transitionToRanking] Wrong phase: ${round.phase}`);
    return;
  }

  // Check if judge is disconnected
  const connectedCount = countConnectedPlayers(room);
  const judgeExists = room.judgeSocketId && room.players[room.judgeSocketId] && room.players[room.judgeSocketId].connected;
  
  if (!judgeExists) {
    console.log(`[transitionToRanking] Judge disconnected - attempting reassignment`);
    
    // Try to reassign judge
    const newJudge = reassignJudge(room, roomId, io);
    
    if (!newJudge) {
      // No one available to judge - skip this round
      console.log(`[transitionToRanking] No judge available - skipping round`);
      skipRound(roomId, rooms, io, "Judge disconnected before ranking");
      return;
    }
    
    console.log(`[transitionToRanking] New judge assigned: ${newJudge}`);
  }
  
  // Check minimum players
  if (connectedCount < 3) {
    console.log(`[transitionToRanking] Not enough players (${connectedCount}) - ending game`);
    endGameDueToLowPlayers(roomId, rooms, io, "Not enough players to continue");
    return;
  }

  // ✅ TRANSITION TO RANKING PHASE
  round.phase = ROUND_PHASES.RANKING;
  round._phaseStartedAt = Date.now();

  console.log(`[transitionToRanking] Round ${round.id} → RANKING phase`);

  // ✅ START RANKING TIMER (60 seconds)
  room._rankingStartedAt = Date.now();
  room._rankingTimer = setTimeout(() => {
    console.log(`[ranking timeout] Judge did not rank in time - auto-ranking randomly`);
    autoRankAnswers(roomId, rooms, io);
  }, RANKING_TIME);

  io.to(roomId).emit("enter_ranking", {
    phase: ROUND_PHASES.RANKING, // ✅ Explicit phase
    rankingTime: RANKING_TIME, // Send timer duration
    answersAnon: round.answers.map(a => ({
      answerId: a.id,
      text: a.text,
      timedOut: a.timedOut || false
    }))
  });
}

// ✅ AUTO-RANK: Randomly rank answers if judge times out
export function autoRankAnswers(roomId, rooms, io) {
  const room = rooms[roomId];
  if (!room || !room.round) return;

  const round = room.round;
  
  // Verify we're still in ranking phase
  if (round.phase !== ROUND_PHASES.RANKING) {
    console.log(`[autoRankAnswers] Wrong phase: ${round.phase}`);
    return;
  }

  // ✅ FIX 3: Notify clients that ranking phase has ended
  io.to(roomId).emit("ranking_phase_ended");

  const validAnswers = round.answers.filter(a => !a.timedOut);
  
  if (validAnswers.length === 0) {
    console.log(`[autoRankAnswers] No valid answers to rank`);
    // ✅ Mark as closed even if no valid answers
    round.rankingClosed = true;
    return;
  }

  // Create random ranking
  const shuffledAnswers = [...validAnswers];
  shuffle(shuffledAnswers);
  
  const randomRanks = shuffledAnswers.map((answer, index) => ({
    answerId: answer.id,
    rank: index + 1
  }));

  console.log(`[autoRankAnswers] Auto-ranked ${randomRanks.length} answers randomly`);

  // ✅ FIX 3: Mark ranking as closed BEFORE calling submitRank
  // This prevents manual submissions but we'll allow this auto-submission
  round.rankingClosed = true;

  // Import submitRank dynamically to avoid circular dependency
  import("./rankingService.js").then(({ submitRank }) => {
    // Pass the startRoundNow function
    const wrappedStartRoundNow = (rid) => startRoundNow(rid, rooms, io, beginNextTurn);
    submitRank(roomId, round.id, randomRanks, rooms, io, wrappedStartRoundNow, true); // ✅ Pass autoRank flag
  });
}

// Helper: Skip round and continue game
function skipRound(roomId, rooms, io, reason) {
  const room = rooms[roomId];
  if (!room) return;

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
    reason,
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
    broadcastRoom(roomId, rooms, io);
  }
}

// Helper: End game due to low players
function endGameDueToLowPlayers(roomId, rooms, io, reason) {
  const room = rooms[roomId];
  if (!room) return;

  const round = room.round;
  
  // Award points for submitted answers before ending
  if (round && round.answers) {
    const validAnswers = round.answers.filter(a => !a.timedOut);
    if (validAnswers.length > 0) {
      // Give points in order of submission (first = most points)
      validAnswers.forEach((ans, index) => {
        const points = Math.max(0, validAnswers.length - index) * 10 * room.rules.multiplier;
        if (room.players[ans.playerSocketId]) {
          room.players[ans.playerSocketId].score += points;
        }
      });
    }
  }
  
  const leaderboard = Object.values(room.players)
    .filter(p => p.connected)
    .sort((a,b)=>b.score - a.score)
    .map(p=>({ socketId:p.socketId, name:p.name, score:p.score, avatarColor:p.avatarColor, avatarTextColor:p.avatarTextColor }));

  room.leaderboard = leaderboard;
  room.round = null;
  room.state = ROOM_STATES.LOBBY;
  room.currentRoundIndex = 0;
  room.pendingQuestion = null;

  resetAllPlayersReadyState(room);

  io.to(roomId).emit("game_ended_due_to_low_players", {
    reason,
    leaderboard: room.leaderboard
  });
  
  io.to(roomId).emit("return_to_lobby");
  broadcastRoom(roomId, rooms, io);
}
