// =============================================================
// index.js — Main server entry point
// =============================================================

import { nanoid } from "nanoid";

// Import configuration
import { DEFAULT_RULES } from "./config.js";

// Import services
import { prepareRoomQuestions, validateCustomQuestions } from "./questionService.js";
import { 
  broadcastRoom, 
  countConnectedPlayers, 
  resetAllPlayersReadyState,
  buildRoomSnapshot,
  promoteNewHost,
  reassignJudge
} from "./roomManager.js";
import { beginStartCountdown, cancelStartCountdown } from "./countdownService.js";
import { startRoundNow, beginNextTurn, clearTurnTimer } from "./gameEngine.js";
import { submitRank } from "./rankingService.js";
import { handleDisconnect, attemptReconnect } from "./reconnectService.js";
import { setupAdminRoutes } from "./adminRoutes.js";


// -------------------------------------------------------------
// Express + Socket.IO Setup
// -------------------------------------------------------------
// io (Socket.IO namespace) and app (Express) are provided by attach()
let io;

// -------------------------------------------------------------
// Setup Admin Routes
// -------------------------------------------------------------

// -------------------------------------------------------------
// Shared State
// -------------------------------------------------------------
const rooms = {};
const chatTimestamps = {};

// -------------------------------------------------------------
// Helper wrappers for services that need rooms/io
// -------------------------------------------------------------
const wrappedBroadcastRoom = (roomId) => broadcastRoom(roomId, rooms, io);

const wrappedBeginNextTurn = (roomId) => beginNextTurn(roomId, rooms, io);

const wrappedStartRoundNow = (roomId) => startRoundNow(roomId, rooms, io, wrappedBeginNextTurn);

const wrappedBeginStartCountdown = (roomId, question, countdownMs) => 
  beginStartCountdown(roomId, question, rooms, io, wrappedStartRoundNow, countdownMs);

const wrappedCancelStartCountdown = (roomId, reason) => 
  cancelStartCountdown(roomId, rooms, io, wrappedBroadcastRoom, reason);

const wrappedSubmitRank = (roomId, roundId, ranks) => 
  submitRank(roomId, roundId, ranks, rooms, io, wrappedStartRoundNow);

// -------------------------------------------------------------
// Socket.IO Events
// -------------------------------------------------------------
const onConnection = socket => {
  console.log("[connected]", socket.id);

  // -----------------------------------------------------------
  // CREATE ROOM
  // -----------------------------------------------------------
  socket.on("create_room", ({ name, avatarColor, avatarTextColor, mode }, cb) => {
    // prevent double room
    for (const rid in rooms)
      if (rooms[rid].players[socket.id])
        return cb({ ok:false, error:"already_in_room" });

    // Validate mode
    const gameMode = (mode === "custom") ? "custom" : "normal";

    const roomId = nanoid(6).toUpperCase();
    const playerToken = nanoid(16); // Generate unique token for reconnection
    
    rooms[roomId] = {
      players: {
        [socket.id]: {
          socketId: socket.id,
          name,
          score: 0,
          ready: false,
          avatarColor,
          avatarTextColor,
          playerToken,
          connected: true,
          disconnectedAt: null,
          _graceTimer: null
        }
      },
      hostSocketId: socket.id,
      judgeSocketId: null,
      judgeQueue: [],     
      state:"lobby",
      leaderboard: [],
      rules: { ...DEFAULT_RULES },
      round:null,
      pendingQuestion:null,
      _startTimer:null,
      startExpiresAt: null, 
      customQuestions:[],
      questions:[],
      currentRoundIndex:0,
      mode: gameMode,
      usedQuestionTexts: new Set()
    };

    socket.join(roomId);
    
    // Send safe room data without circular references
    const safeRoomData = {
      hostSocketId: rooms[roomId].hostSocketId,
      judgeSocketId: rooms[roomId].judgeSocketId,
      state: rooms[roomId].state,
      mode: rooms[roomId].mode || "normal",
      currentRoundIndex: rooms[roomId].currentRoundIndex,
      leaderboard: rooms[roomId].leaderboard || [],
      rules: rooms[roomId].rules
    };

    // Send safe players list without circular references
    const safePlayers = Object.values(rooms[roomId].players).map(p => ({
      socketId: p.socketId,
      name: p.name,
      score: p.score,
      ready: p.ready,
      avatarColor: p.avatarColor,
      avatarTextColor: p.avatarTextColor
    }));

    cb({ ok:true, roomId, players: safePlayers, room: safeRoomData, mode: gameMode, playerToken });
    wrappedBroadcastRoom(roomId);
  });

  // -----------------------------------------------------------
  // JOIN ROOM
  // -----------------------------------------------------------
  socket.on("join_room", ({ roomId, name, avatarColor, avatarTextColor }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb({ ok:false, error:"Room not found" });

    // HARD ROOM LOCK: Block join if game is in progress
    if (room.state !== "lobby") {
      return cb({
        ok: false,
        error: "game_in_progress",
        round: room.currentRoundIndex + 1,
        totalRounds: room.rules.numRounds
      });
    }

    for (const rid in rooms)
      if (rooms[rid].players[socket.id])
        return cb({ ok:false, error:"already_in_room" });

    const playerToken = nanoid(16); // Generate unique token for reconnection
    
    room.players[socket.id] = {
      socketId: socket.id,
      name,
      score: 0,
      ready: false,
      avatarColor,
      avatarTextColor,
      playerToken,
      connected: true,
      disconnectedAt: null,
      _graceTimer: null
    };
    socket.join(roomId);

    // Send safe room data without circular references
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

    // Send safe players list without circular references
    const safePlayers = Object.values(room.players).map(p => ({
      socketId: p.socketId,
      name: p.name,
      score: p.score,
      ready: p.ready,
      avatarColor: p.avatarColor,
      avatarTextColor: p.avatarTextColor
    }));

    cb({ ok:true, roomId, players: safePlayers, room: safeRoomData, mode: room.mode || "normal", playerToken });
    wrappedBroadcastRoom(roomId);
  });

  // -----------------------------------------------------------
  // EXIT ROOM
  // -----------------------------------------------------------
  socket.on("leave_room", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id])
      return socket.emit("left_room", { ok:false, error:"not_in_room" });

    const wasJudge = (room.judgeSocketId === socket.id);
    const wasHost = (room.hostSocketId === socket.id);
    const playerName = room.players[socket.id].name;

    delete room.players[socket.id];
    socket.leave(roomId);

    // Immediately tell the leaving player they've left
    socket.emit("left_room", { ok:true, roomId });

    // Remove from judge queue if player leaves
    room.judgeQueue = room.judgeQueue.filter(id => id !== socket.id);

    // ❌ Judge left during an active round → cancel round safely
    if (room.round && wasJudge) {
      room.round = null;
      room.state = "lobby";
      room.currentRoundIndex = 0;

      // Reset all players' ready state and scores for next game
      resetAllPlayersReadyState(room);

      // ✅ FIX 2: Clear auto-return timer when returning to lobby
      if (room._autoReturnTimer) {
        clearInterval(room._autoReturnTimer);
        room._autoReturnTimer = null;
      }

      io.to(roomId).emit("game_ended_due_to_low_players", {
        reason: "Judge left the game"
      });
      io.to(roomId).emit("return_to_lobby");
    }

    // 🔥 CLEAN GAME STATE IF ACTIVE ROUND (non-judge player left)
    if (room.round && !wasJudge) {
      // Remove from turn order
      room.round.turnOrder = room.round.turnOrder.filter(id => id !== socket.id);

      // Remove any pending answers (don't keep their timeout answer)
      room.round.answers = room.round.answers.filter(a => a.playerSocketId !== socket.id);

      // Notify remaining players
      io.to(roomId).emit("chat_message_broadcast", {
        name: "System",
        text: `${playerName} left the game.`
      });

      // If it was their turn → advance to next turn
      clearTurnTimer(room);
      wrappedBeginNextTurn(roomId);
    }

    // If host left → replace or delete room
    if (wasHost) {
      const ids = Object.keys(room.players);

      if (ids.length === 0) {
        if (room._startTimer) clearTimeout(room._startTimer);
        if (room._turnTimer) clearTimeout(room._turnTimer);
        if (room._nextRoundTimer) clearInterval(room._nextRoundTimer);
        delete rooms[roomId];
        return;
      }

      // Promote new host using helper function (ensures connected player)
      promoteNewHost(room, roomId, io);
    }

    if (room._startTimer) {
      clearTimeout(room._startTimer);
      room._startTimer = null;
      room.state = "lobby";

      io.to(roomId).emit("countdown_cancelled", {
        reason: "player_left"
      });
    }

    // Check minimum players
    const connectedCount = countConnectedPlayers(room);
    if (room.round && connectedCount < 2) {
      // Immediately end round
      room.round = null;
      room.state = "lobby";
      room.currentRoundIndex = 0;
      
      // Reset all players' ready state and scores for next game
      resetAllPlayersReadyState(room);
      
      io.to(roomId).emit("game_ended_due_to_low_players", {
        reason: "Not enough players to continue"
      });
      io.to(roomId).emit("return_to_lobby");
    }

    wrappedBroadcastRoom(roomId);
  });

  // -----------------------------------------------------------
  // HOST CLOSES ROOM
  // -----------------------------------------------------------
  socket.on("close_room", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    if (socket.id !== room.hostSocketId) return;

    io.to(roomId).emit("room_closed", { reason:"host_closed" });

    // Clean up timers
    if (room._startTimer) clearTimeout(room._startTimer);
    if (room._turnTimer) clearTimeout(room._turnTimer);
    if (room._nextRoundTimer) clearInterval(room._nextRoundTimer);
    // ✅ FIX 2: Clear auto-return timer
    if (room._autoReturnTimer) clearInterval(room._autoReturnTimer);

    // remove all players
    for (const sid in room.players)
      io.sockets.get(sid)?.leave(roomId);

    delete rooms[roomId];
  });

  // -----------------------------------------------------------
  // HOST KICKS PLAYER (FIXED & SAFE)
  // -----------------------------------------------------------
  socket.on("kick_player", ({ roomId, targetSocketId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // ❌ Do NOT allow kicking the judge during an active round
    if (room.round && targetSocketId === room.judgeSocketId) {
      return;
    }

    // Host-only
    if (socket.id !== room.hostSocketId) return;

    // Cannot kick host
    if (targetSocketId === room.hostSocketId) return;

    const targetPlayer = room.players[targetSocketId];
    if (!targetPlayer) return;

    const targetName = targetPlayer.name;

    // 🔥 CLEAN GAME STATE IF ACTIVE ROUND
    if (room.round) {
      // Remove from turn order
      room.round.turnOrder = room.round.turnOrder.filter(id => id !== targetSocketId);

      // Remove any pending answers (don't keep their timeout answer)
      room.round.answers = room.round.answers.filter(a => a.playerSocketId !== targetSocketId);

      // If it was their turn → advance to next turn
      clearTurnTimer(room);
      wrappedBeginNextTurn(roomId);
    }

    // Remove player from room
    delete room.players[targetSocketId];

    const targetSocket = io.sockets.get(targetSocketId);
    if (targetSocket) {
      targetSocket.leave(roomId);

      // 🔔 Tell kicked user (IMPORTANT)
      targetSocket.emit("kicked_from_room", {
        reason: "You were kicked from the room by the host."
      });

      // 🔄 FORCE CLIENT CLEANUP
      targetSocket.emit("left_room", { ok: true, roomId });
    }

    // Inform remaining players
    io.to(roomId).emit("chat_message_broadcast", {
      name: "System",
      text: `${targetName} was kicked from the room.`
    });

    // Check minimum players
    const connectedCount = countConnectedPlayers(room);
    if (room.round && connectedCount < 2) {
      // Immediately end round
      room.round = null;
      room.state = "lobby";
      room.currentRoundIndex = 0;
      
      // Reset all players' ready state and scores for next game
      resetAllPlayersReadyState(room);
      
      io.to(roomId).emit("game_ended_due_to_low_players", {
        reason: "Not enough players to continue"
      });
      io.to(roomId).emit("return_to_lobby");
    }

    wrappedBroadcastRoom(roomId);
  });

  // -----------------------------------------------------------
  // READY TOGGLE
  // -----------------------------------------------------------
  socket.on("toggle_ready", ({ roomId, ready }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id === room.hostSocketId) return;
    
    // Safety check: player must exist in room
    if (!room.players[socket.id]) {
      console.log(`[toggle_ready] Player ${socket.id} not found in room ${roomId}`);
      return;
    }

    room.players[socket.id].ready = ready;

    const players = Object.values(room.players)
      .filter(p => p.socketId !== room.hostSocketId);

    const readyCount = players.filter(p => p.ready).length;

    // 🔁 UPDATE EVERYONE
    io.to(roomId).emit("ready_count_update", {
      ready: readyCount,
      total: players.length
    });
    
    // 🔁 BROADCAST ROOM UPDATE (so player list shows ready state)
    wrappedBroadcastRoom(roomId);

    // ✅ ALL READY → START IMMEDIATELY
    if (room.state === "starting" && readyCount === players.length) {
      if (room._startTimer) {
        clearTimeout(room._startTimer);
        room._startTimer = null;
      }
      wrappedStartRoundNow(roomId);
    }
  });

  socket.on("update_avatar", ({ roomId, avatarColor, avatarTextColor }) => {
    const room = rooms[roomId];
    // ✅ Allow avatar updates in lobby or game_ended state
    if (!room || (room.state !== "lobby" && room.state !== "game_ended")) return;
    if (!room.players[socket.id]) return;

    room.players[socket.id].avatarColor = avatarColor;
    room.players[socket.id].avatarTextColor = avatarTextColor;

    wrappedBroadcastRoom(roomId);
  });

  // -----------------------------------------------------------
  // SUBMIT ANSWER (PLAYER TURN)
  // -----------------------------------------------------------
  socket.on("submit_answer", ({ roomId, roundId, answer }, cb = () => {}) => {
    const room = rooms[roomId];
    if (!room || !room.round) {
      return cb({ ok: false, error: "no_round" });
    }

    // ❌ Judge cannot answer
    if (socket.id === room.judgeSocketId) {
      return cb({ ok: false, error: "judge_cannot_answer" });
    }

    const round = room.round;
    if (round.id !== roundId) {
      return cb({ ok: false, error: "round_mismatch" });
    }

    const clean = answer?.trim();
    if (!clean) return cb({ ok:false, error:"empty" });

    // ❌ prevent double answering by same player
    if (round.answers.some(a => a.playerSocketId === socket.id)) {
      return cb({ ok:false, error:"already_answered" });
    }

    // ❌ prevent duplicate answers (case-insensitive)
    const normalized = clean.toLowerCase();
    if (
      round.answers.some(a => a.text.toLowerCase() === normalized)
    ) {
      return cb({
        ok: false,
        error: "duplicate_answer"
      });
    }
    clearTurnTimer(room);

    round.answers.push({
      id: nanoid(6),
      text: clean,
      playerSocketId: socket.id
    });

    wrappedBeginNextTurn(roomId);

    cb({ ok:true });
  });

  // -----------------------------------------------------------
  // START GAME (HOST)
  // -----------------------------------------------------------
  socket.on("start_game", ({ roomId, question, customQuestions, minPlayers, turnTime, multiplier, numRounds }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostSocketId) return;
    
    // ✅ Allow starting from lobby or game_ended state
    if (room.state !== "lobby" && room.state !== "game_ended") return;
    
    // ✅ If in game_ended state, clear auto-return timer
    if (room.state === "game_ended") {
      if (room._autoReturnTimer) {
        clearInterval(room._autoReturnTimer);
        room._autoReturnTimer = null;
      }
    }

    // SAFETY: Validate numRounds
    if (!numRounds || numRounds <= 0 || numRounds > 20) {
      return socket.emit("start_error", { error: "invalid_num_rounds" });
    }

    room.rules.minPlayers = minPlayers;
    room.rules.turnTime = turnTime;
    room.rules.multiplier = multiplier;
    room.rules.numRounds = numRounds;

    // 🎮 CUSTOM MODE: PART 3 - SERVER SIDE HARD VALIDATION (CRITICAL)
    if (room.mode === "custom") {
      const validation = validateCustomQuestions(customQuestions, numRounds);
      
      if (!validation.valid) {
        console.log(`[start_game] Custom question validation failed`);
        return socket.emit("start_error", { error: validation.error });
      }
      
      // PART 7: FINAL SAFETY GUARANTEE - All conditions met
      if (room.state !== "lobby" && room.state !== "game_ended") {
        console.log(`[start_game] Room not in valid state: ${room.state}`);
        return socket.emit("start_error", { error: "invalid_room_state" });
      }
      
      // PART 5: SERVER STATE SAFETY - Use validated custom questions
      room.questions = validation.questions;
      room.currentRoundIndex = 0;
      room.pendingQuestion = room.questions[0];
      
      console.log(`[start_game] Custom Mode: ${validation.questions.length} questions validated and loaded`);
    } else {
      // 🎮 NORMAL MODE: Use built-in questions
      // Reject custom questions in Normal Mode
      if (question && question.trim()) {
        question = null; // Silently ignore custom question
      }
      
      room.questions = prepareRoomQuestions(room, numRounds);
      room.pendingQuestion = room.questions[0];
    }

    room.currentRoundIndex = 0;

    if (room._startTimer) {
      clearTimeout(room._startTimer);
      room._startTimer = null;
    }
    room.state = "lobby";

    // ✅ Set host as ready when starting game
    if (room.players[socket.id]) {
      room.players[socket.id].ready = true;
    }

    wrappedBeginStartCountdown(roomId, room.pendingQuestion, 60000);
    
    // ✅ Broadcast updated room state to show host as ready
    wrappedBroadcastRoom(roomId);
  });

  // -----------------------------------------------------------
  // CANCEL START (HOST)
  // -----------------------------------------------------------
  socket.on("cancel_start", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    if (socket.id !== room.hostSocketId) return;

    wrappedCancelStartCountdown(roomId, "host_cancelled");
  });

  // -----------------------------------------------------------
  // SUBMIT RANK (HOST)
  // -----------------------------------------------------------
  socket.on("submit_rank", ({ roomId, roundId, ranks }) => {
    const room = rooms[roomId];
    if (!room) return;
    // Only the judge can submit rankings
    if (socket.id !== room.judgeSocketId) return;
    
    wrappedSubmitRank(roomId, roundId, ranks);
  });

  // -----------------------------------------------------------
  // HOST NEXT ROUND
  // -----------------------------------------------------------
  socket.on("host_next_round", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostSocketId) return;

    if (room.currentRoundIndex >= room.questions.length)
      return;

    // Clear auto-advance timer if host manually starts
    if (room._nextRoundTimer) {
      clearInterval(room._nextRoundTimer);
      room._nextRoundTimer = null;
    }

    wrappedStartRoundNow(roomId);
  });

  socket.on("host_end_game", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || socket.id !== room.hostSocketId) return;

    // 🔒 STOP ANY TIMERS
    if (room._startTimer) {
      clearTimeout(room._startTimer);
      room._startTimer = null;
    }
    if (room._turnTimer) {
      clearTimeout(room._turnTimer);
      room._turnTimer = null;
    }
    if (room._nextRoundTimer) {
      clearInterval(room._nextRoundTimer);
      room._nextRoundTimer = null;
    }
    // ✅ FIX 2: Clear auto-return timer
    if (room._autoReturnTimer) {
      clearInterval(room._autoReturnTimer);
      room._autoReturnTimer = null;
    }

    // 🔁 FULL RESET
    room.state = "lobby";
    room.round = null;
    room.currentRoundIndex = 0;
    room.pendingQuestion = null;
    room.judgeQueue = [];
    room.questions = [];
    room.leaderboard = [];

    // ✅ RESET PLAYERS *AND READY STATE*
    for (const p of Object.values(room.players)) {
      p.ready = false;
      p.score = 0;
    }

    // 🔔 FORCE CLIENTS TO RESET READY UI
    io.to(roomId).emit("force_ready_reset");
    io.to(roomId).emit("countdown_cancelled", { reason: "game_reset" });
    io.to(roomId).emit("return_to_lobby");
    wrappedBroadcastRoom(roomId);
  });

  // -----------------------------------------------------------
  // CHAT (simple anti-spam included)
  // -----------------------------------------------------------
  socket.on("chat_message", ({ roomId, name, text }) => {
    const now = Date.now();
    if (now - (chatTimestamps[socket.id] || 0) < 500) return;
    chatTimestamps[socket.id] = now;
    
    const room = rooms[roomId];
    if (!room) return;
    
    // SERVER-AUTHORITATIVE: Block chat during "starting" and "in_round" states
    if (room.state === "starting" || room.state === "in_round") {
      return; // Silently ignore - do not broadcast
    }
    
    // Allow chat in "lobby" and "between_rounds"
    io.to(roomId).emit("chat_message_broadcast", { name, text });
  });

  // -----------------------------------------------------------
  // MANUAL EXIT TO LOBBY (Exit to Room button)
  // -----------------------------------------------------------
  socket.on("manual_exit_to_lobby", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]) return;
    
    // ✅ Allow if room is in lobby OR game_ended state
    if (room.state !== "lobby" && room.state !== "game_ended") return;
    
    // ✅ If in game_ended state, clear auto-return timer and transition to lobby
    if (room.state === "game_ended") {
      if (room._autoReturnTimer) {
        clearInterval(room._autoReturnTimer);
        room._autoReturnTimer = null;
      }
      room.state = "lobby";
    }
    
    // Reset this player's ready state
    room.players[socket.id].ready = false;
    
    // Send return_to_lobby to this specific player to reset their UI
    socket.emit("return_to_lobby");
    
    // Broadcast updated room state to all players
    wrappedBroadcastRoom(roomId);
  });

  // -----------------------------------------------------------
  // DISCONNECT
  // -----------------------------------------------------------
  socket.on("disconnect", () => {
    handleDisconnect(socket.id, rooms, io, wrappedBeginNextTurn, wrappedCancelStartCountdown, wrappedStartRoundNow, chatTimestamps);
  });

  // -----------------------------------------------------------
  // ATTEMPT RECONNECT
  // -----------------------------------------------------------
  socket.on("attempt_reconnect", ({ roomId, playerToken }, cb) => {
    const result = attemptReconnect(socket, roomId, playerToken, rooms, io, buildRoomSnapshot);
    cb(result);
  });
};

export function attach(namespace, app) {
  io = namespace;
  setupAdminRoutes(app);
  io.on("connection", onConnection);
}
