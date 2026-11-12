// =============================================================
// countdownService.js — Countdown and auto-start logic
// =============================================================

import { countConnectedPlayers } from "./roomManager.js";

export function beginStartCountdown(roomId, question, rooms, io, startRoundNow, countdownMs = 60000) {
  const room = rooms[roomId];
  if (!room) return;

  room.state = "starting";
  room.pendingQuestion = question;
  room.startExpiresAt = Date.now() + countdownMs; // Track expiration time

  if (room._startTimer) clearTimeout(room._startTimer);

  const hostId = room.hostSocketId;
  const nonHost = Object.keys(room.players).filter(id => 
    id !== hostId && room.players[id].connected
  );
  const readyCount = nonHost.filter(id => room.players[id].ready).length;

  io.to(roomId).emit("start_countdown", {
    expiresAt: room.startExpiresAt,
    countdownMs,
    ready: readyCount,
    total: nonHost.length
  });

  // ✅ CHECK: If all non-host players are already ready, start immediately
  if (nonHost.length > 0 && readyCount === nonHost.length) {
    console.log(`[auto-start] All players ready - starting immediately`);
    startRoundNow(roomId);
    return;
  }

  room._startTimer = setTimeout(() => {
    room._startTimer = null;

    // 🛑 SAFETY: only start if still in countdown
    if (room.state !== "starting") return;

    const connectedCount = countConnectedPlayers(room);
    if (connectedCount < room.rules.minPlayers) {
      io.to(roomId).emit("countdown_cancelled", {
        reason: "not_enough_players"
      });
      room.state = "lobby";
      room.startExpiresAt = null;
      return;
    }

    startRoundNow(roomId);
  }, countdownMs);
}

export function cancelStartCountdown(roomId, rooms, io, broadcastRoom, reason="cancelled") {
  const room = rooms[roomId];
  if (!room) return;

  if (room._startTimer) clearTimeout(room._startTimer);
  room.state = "lobby";
  room.pendingQuestion = null;
  room.startExpiresAt = null; // Clear expiration time

  io.to(roomId).emit("countdown_cancelled", { reason });
  broadcastRoom(roomId, rooms, io);
}
