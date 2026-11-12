// =============================================================
// rankingService.js — Ranking logic with strict validation
// =============================================================

import { JUDGE_BONUS_POINTS, ROUND_PHASES, ROOM_STATES } from "./config.js";
import { countConnectedPlayers, resetAllPlayersReadyState, broadcastRoom } from "./roomManager.js";
import { clearRankingTimer } from "./gameEngine.js";

// ✅ FIX 2: Helper to clear auto-return timer
export function clearAutoReturnTimer(room) {
  if (room._autoReturnTimer) {
    clearInterval(room._autoReturnTimer);
    room._autoReturnTimer = null;
  }
}

export function submitRank(roomId, roundId, ranks, rooms, io, startRoundNow, autoRank = false) {
  const room = rooms[roomId];
  if (!room || !room.round) {
    console.log(`[submitRank] No room or round found`);
    return;
  }
  
  const round = room.round;
  
  // Verify round ID matches
  if (round.id !== roundId) {
    console.log(`[submitRank] Round ID mismatch: ${roundId} vs ${round.id}`);
    return;
  }
  
  // ✅ PHASE VALIDATION: Must be in ranking phase
  if (round.phase !== ROUND_PHASES.RANKING) {
    console.log(`[submitRank] Wrong phase: ${round.phase}, expected ${ROUND_PHASES.RANKING}`);
    return;
  }

  // ✅ FIX 3: Prevent late submissions after ranking closed (but allow auto-ranking)
  if (round.rankingClosed && !autoRank) {
    console.log(`[submitRank] Ranking already closed, rejecting late submission`);
    return;
  }
  
  // ✅ CLEAR RANKING TIMER (judge submitted in time)
  clearRankingTimer(room);
  
  // Validate ranks is an array
  if (!Array.isArray(ranks)) {
    console.log(`[submitRank] Ranks must be an array`);
    return;
  }
  
  const answers = round.answers;

  // Separate valid from timed-out answers
  const validAnswers = answers.filter(a => !a.timedOut);
  const timedOutAnswers = answers.filter(a => a.timedOut);

  // EDGE CASE: All players timed out - no ranking needed
  if (validAnswers.length === 0) {
    console.log(`[submitRank] All players timed out - skipping ranking`);
    processAllTimedOut(room, roomId, timedOutAnswers, io, startRoundNow);
    return;
  }

  // ✅ STRICT VALIDATION: Rank count must match valid answers count
  if (ranks.length !== validAnswers.length) {
    console.log(`[submitRank] Rank count mismatch: ${ranks.length} vs ${validAnswers.length}`);
    return;
  }

  // ✅ STRICT VALIDATION: All submitted ranks must reference valid answers only
  for (const r of ranks) {
    const isValid = validAnswers.some(a => a.id === r.answerId);
    if (!isValid) {
      console.log(`[submitRank] Invalid answerId detected: ${r.answerId}`);
      return;
    }
  }

  // ✅ STRICT VALIDATION: Rank values must be 1..N (no gaps, no duplicates)
  const rankValues = ranks.map(r => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < rankValues.length; i++) {
    if (rankValues[i] !== i + 1) {
      console.log(`[submitRank] Invalid rank sequence: expected ${i + 1}, got ${rankValues[i]}`);
      return;
    }
  }

  // ✅ STRICT VALIDATION: No duplicate ranks
  const used = new Set();
  for (const r of ranks) {
    if (used.has(r.rank)) {
      console.log(`[submitRank] Duplicate rank detected: ${r.rank}`);
      return;
    }
    used.add(r.rank);
  }

  // ✅ STRICT VALIDATION: Rank values must be in range 1..N
  for (const r of ranks) {
    if (r.rank < 1 || r.rank > validAnswers.length) {
      console.log(`[submitRank] Rank out of range: ${r.rank} (valid: 1-${validAnswers.length})`);
      return;
    }
  }

  // ✅ TRANSITION TO RESULTS PHASE
  round.phase = ROUND_PHASES.RESULTS;
  round._phaseStartedAt = Date.now();
  
  console.log(`[submitRank] Round ${round.id} → RESULTS phase`);

  // SCORING: Only score valid answers
  for (const r of ranks) {
    const ans = validAnswers.find(a => a.id === r.answerId);
    if (!ans) continue;

    const points = Math.max(0, validAnswers.length - r.rank + 1) * 10 * room.rules.multiplier;
    room.players[ans.playerSocketId].score += points;
    
    io.to(ans.playerSocketId).emit("player_points_earned", {
      points: points,
      rank: r.rank,
      totalAnswers: validAnswers.length
    });
  }

  // Judge bonus points
  if (room.judgeSocketId && room.players[room.judgeSocketId]) {
    room.players[room.judgeSocketId].score += JUDGE_BONUS_POINTS;
    
    io.to(room.judgeSocketId).emit("judge_bonus", {
      points: JUDGE_BONUS_POINTS
    });
  }

  const leaderboard = Object.values(room.players)
    .sort((a,b)=>b.score - a.score)
    .map(p=>({ socketId:p.socketId, name:p.name, score:p.score, avatarColor:p.avatarColor, avatarTextColor:p.avatarTextColor }));

  room.leaderboard = leaderboard;

  // Find winner (from valid answers only)
  const top = ranks.find(r=>r.rank===1);
  let winner = null;
  if (top) {
    const ans = validAnswers.find(a=>a.id===top.answerId);
    winner = ans?.playerSocketId || null;
  }

  const idx = room.currentRoundIndex;
  const total = room.rules.numRounds;
  const roundsRemaining = idx + 1 < total;

  // Build results array (valid answers only)
  const validResults = ranks.map(r=>{
    const a = validAnswers.find(x=>x.id===r.answerId);
    return {
      rank: r.rank,
      answerText: a?.text || "",
      playerName: room.players[a?.playerSocketId]?.name || "Unknown",
      points: Math.max(0, validAnswers.length - r.rank + 1) * 10 * room.rules.multiplier
    };
  }).sort((a,b)=>a.rank - b.rank);

  // Add timed-out results (0 points, no rank)
  const timedOutResults = timedOutAnswers.map(a => ({
    rank: null,
    answerText: a.text,
    playerName: room.players[a.playerSocketId]?.name || "Unknown",
    points: 0,
    timedOut: true
  }));

  io.to(roomId).emit("ranking_result", {
    phase: ROUND_PHASES.RESULTS, // ✅ Explicit phase
    results: [...validResults, ...timedOutResults],
    leaderboard,
    winnerSocketId: winner,
    roundsRemaining
  });

  // Clear round (results phase complete)
  room.round = null;

  // Check if only 2 players remain (judge + 1 answerer) - auto-end game
  const connectedCount = countConnectedPlayers(room);
  if (connectedCount <= 2) {
    console.log(`[submitRank] Only ${connectedCount} players remaining - ending game`);
    
    room.state = ROOM_STATES.LOBBY;
    room.currentRoundIndex = 0;
    room.pendingQuestion = null;

    // Wait 3 seconds to show results, then return to lobby
    setTimeout(() => {
      io.to(roomId).emit("game_ended_due_to_low_players", {
        reason: "Not enough players to continue",
        leaderboard: room.leaderboard
      });
      io.to(roomId).emit("return_to_lobby");
      broadcastRoom(roomId, rooms, io);
    }, 3000);
    
    return;
  }

  if (!roundsRemaining) {
    // Game ended - enter winner ceremony state
    room.state = ROOM_STATES.GAME_ENDED; // ✅ Use GAME_ENDED state instead of LOBBY
    room.currentRoundIndex = 0;
    room.pendingQuestion = null;

    resetAllPlayersReadyState(room);

    io.to(roomId).emit("game_ended", {
      leaderboard: room.leaderboard
    });

    broadcastRoom(roomId, rooms, io);

    // Start 30-second auto-return timer
    let countdown = 30;
    const autoReturnInterval = setInterval(() => {
      countdown--;
      io.to(roomId).emit("auto_return_countdown", { seconds: countdown });
      
      if (countdown <= 0) {
        clearInterval(autoReturnInterval);
        
        // ✅ Only transition to lobby and emit return_to_lobby if still in GAME_ENDED state
        const currentRoom = rooms[roomId];
        if (currentRoom && currentRoom.state === ROOM_STATES.GAME_ENDED) {
          currentRoom.state = ROOM_STATES.LOBBY;
          io.to(roomId).emit("return_to_lobby");
          broadcastRoom(roomId, rooms, io);
        }
      }
    }, 1000);

    room._autoReturnTimer = autoReturnInterval;
  } else {
    // Move to next round
    room.state = ROOM_STATES.BETWEEN_ROUNDS;
    room.currentRoundIndex++;
    
    // Start 15-second auto-advance timer
    startBetweenRoundsTimer(room, roomId, io, startRoundNow);
  }

  broadcastRoom(roomId, rooms, io);
}

// Helper: Process all timed-out scenario
function processAllTimedOut(room, roomId, timedOutAnswers, io, startRoundNow) {
  // Still award judge bonus
  if (room.judgeSocketId && room.players[room.judgeSocketId]) {
    room.players[room.judgeSocketId].score += JUDGE_BONUS_POINTS;
    
    io.to(room.judgeSocketId).emit("judge_bonus", {
      points: JUDGE_BONUS_POINTS
    });
  }

  const leaderboard = Object.values(room.players)
    .sort((a,b)=>b.score - a.score)
    .map(p=>({ socketId:p.socketId, name:p.name, score:p.score, avatarColor:p.avatarColor, avatarTextColor:p.avatarTextColor }));

  room.leaderboard = leaderboard;

  const idx = room.currentRoundIndex;
  const total = room.rules.numRounds;
  const roundsRemaining = idx + 1 < total;

  // Build timed-out results only
  const timedOutResults = timedOutAnswers.map(a => ({
    rank: null,
    answerText: a.text,
    playerName: room.players[a.playerSocketId]?.name || "Unknown",
    points: 0,
    timedOut: true
  }));

  io.to(roomId).emit("ranking_result", {
    phase: ROUND_PHASES.RESULTS,
    results: timedOutResults,
    leaderboard,
    winnerSocketId: null,
    roundsRemaining
  });

  room.round = null;

  // Check if only 2 players remain
  const connectedCount = countConnectedPlayers(room);
  if (connectedCount <= 2) {
    console.log(`[processAllTimedOut] Only ${connectedCount} players remaining - ending game`);
    
    room.state = ROOM_STATES.LOBBY;
    room.currentRoundIndex = 0;
    room.pendingQuestion = null;

    setTimeout(() => {
      io.to(roomId).emit("game_ended_due_to_low_players", {
        reason: "Not enough players to continue",
        leaderboard: room.leaderboard
      });
      io.to(roomId).emit("return_to_lobby");
      broadcastRoom(roomId, rooms, io);
    }, 3000);
    
    return;
  }

  if (!roundsRemaining) {
    room.state = ROOM_STATES.LOBBY;
    room.currentRoundIndex = 0;
    room.pendingQuestion = null;

    resetAllPlayersReadyState(room);

    io.to(roomId).emit("game_ended", {
      leaderboard: room.leaderboard
    });
    
    broadcastRoom(roomId, rooms, io);
  } else {
    room.state = ROOM_STATES.BETWEEN_ROUNDS;
    
    startBetweenRoundsTimer(room, roomId, io, startRoundNow);
  }
}

// Helper: Start between-rounds timer
function startBetweenRoundsTimer(room, roomId, io, startRoundNow) {
  let countdown = 15;
  
  // Clear any existing timer
  if (room._nextRoundTimer) {
    clearInterval(room._nextRoundTimer);
    room._nextRoundTimer = null;
  }
  
  // Track when timer started for reconnection
  room._betweenRoundsStartedAt = Date.now();
  room._betweenRoundsDuration = 15000; // 15 seconds
  
  const nextRoundInterval = setInterval(() => {
    countdown--;
    io.to(roomId).emit("next_round_countdown", { seconds: countdown });
    
    if (countdown <= 0) {
      clearInterval(nextRoundInterval);
      room._nextRoundTimer = null;
      room._betweenRoundsStartedAt = null;
      room._betweenRoundsDuration = null;
      
      // Auto-start next round
      if (room.state === ROOM_STATES.BETWEEN_ROUNDS && room.currentRoundIndex < room.questions.length) {
        console.log(`[auto-advance] Starting round ${room.currentRoundIndex + 1} automatically`);
        startRoundNow(roomId);
      }
    }
  }, 1000);
  
  room._nextRoundTimer = nextRoundInterval;
}
