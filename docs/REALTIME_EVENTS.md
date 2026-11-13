# Realtime events (Socket.IO)

> **Generated file - do not edit by hand.** Regenerate with `npm run docs:events`.
> `tests/realtime-events.test.js` fails when this file is out of date.

Each game owns one namespace (`/colorrush`, `/blackjack`, `/rankly`). This inventory comes from a static scan of
`src/games/<game>` (handlers and `emit` calls) and `public/games/<game>` (browser clients). Limits of that scan:

- Payloads are the top-level keys of an object literal at the call site; non-literal payloads show as the expression.
- "Sent to" is the literal receiver expression (for example `io.to(roomCode)` is the room, `socket` is the caller),
  not a resolved audience. Judge ambiguous variables such as `r.id` from the source.
- It does not execute code, so it says nothing about *when* an event fires or about field types.
- Naming differs per game today (ColorRush and Blackjack use camelCase events; Rankly uses snake_case and acknowledgement
  callbacks). Standardising names is a planned, compatibility-sensitive change, not something this file prescribes.

## blackjack

Namespace: `/blackjack`

### Client to server

| Event | Handler params | Payload keys read | Acknowledgement | Source |
|---|---|---|---|---|
| `createPracticeRoom` | `settings` | `botCount`, `difficulty`, `eliminationMode` | no | `handlers/lobby.js:457` |
| `createRoom` | _none_ | _none_ | no | `handlers/lobby.js:13` |
| `disconnect` | _none_ | _none_ | no | `handlers/disconnect.js:11` |
| `hit` | _none_ | _none_ | no | `handlers/gameplay.js:55` |
| `identify` | `token` | _used as a whole_ | no | `handlers/lobby.js:57` |
| `joinNextGame` | _none_ | _none_ | no | `handlers/lobby.js:544` |
| `joinRoom` | `code` | _used as a whole_ | no | `handlers/lobby.js:145` |
| `kickPlayer` | `targetPlayerId` | _used as a whole_ | no | `handlers/moderation.js:49` |
| `leave` | _none_ | _none_ | no | `handlers/lobby.js:223` |
| `requestNewGame` | _none_ | _none_ | no | `handlers/lobby.js:572` |
| `setEliminationMode` | `mode` | _used as a whole_ | no | `handlers/gameplay.js:109` |
| `setName` | `name` | _used as a whole_ | no | `handlers/lobby.js:364` |
| `spectate` | _none_ | _none_ | no | `handlers/lobby.js:524` |
| `spectatorReaction` | `data` | `emoji`, `roomCode` | no | `handlers/gameplay.js:164` |
| `stand` | _none_ | _none_ | no | `handlers/gameplay.js:87` |
| `startRound` | _none_ | _none_ | no | `handlers/gameplay.js:14` |
| `submitRouletteChoice` | `choices` | _used as a whole_ | no | `handlers/gameplay.js:154` |
| `toggleReady` | _none_ | _none_ | no | `handlers/lobby.js:421` |
| `unbanPlayer` | `targetPlayerId` | _used as a whole_ | no | `handlers/moderation.js:8` |

### Server to client

| Event | Payload | Sent to | Source |
|---|---|---|---|
| `assignToken` | `{ token }` | `socket` | `handlers/lobby.js:49`, `handlers/lobby.js:215`, `handlers/lobby.js:510` |
| `cancelTriggerAnimation` | `_none_` | `io.to(roomCode)` | `handlers/disconnect.js:162` |
| `chamberSpin` | `{ playerId, playerName }` | `io.to(roomCode)` | `roulette.js:48` |
| `eliminated` | `{ winnerName }` | `io.to(playerId)` | `roulette.js:146` |
| `eliminationModeChanged` | `{ mode, hostName }` | `io.to(roomCode)` | `handlers/gameplay.js:139` |
| `eliminationModeError` | `'Cannot change elimination mode durin...` | `socket` | `handlers/gameplay.js:123` |
|  | `'Invalid elimination mode'` | `socket` | `handlers/gameplay.js:130` |
| `gameReset` | `_none_` | `io.to(roomCode)` | `roomState.js:316`, `roomState.js:374` |
| `kicked` | `{ hostName }` | `kickTargetSocket`, `socket` | `handlers/lobby.js:392`, `handlers/moderation.js:118` |
| `kickError` | `'Cannot kick players during active ro...` | `return socket` | `handlers/moderation.js:71` |
|  | `'Cannot kick yourself'` | `return socket` | `handlers/moderation.js:77` |
|  | `'Only the host can kick players'` | `return socket` | `handlers/moderation.js:65` |
|  | `'Player not found'` | `return socket` | `handlers/moderation.js:84` |
| `kickSuccess` | `{ playerName }` | `socket` | `handlers/moderation.js:144` |
| `log` | `'⏳ Next round will start in 10 second...` | `io.to(roomCode)` | `countdowns.js:94` |
|  | `'⚡ Final 2 rule applied: Bust overrid...` | `io.to(roomCode)` | `turns.js:357` |
|  | `'💥 Busting players are at highest ri...` | `io.to(roomCode)` | `turns.js:387` |
|  | `'📊 Final hands:'` | `io.to(roomCode)` | `turns.js:342` |
|  | `'🔄 Deck reshuffled!'` | `io.to(socket.data.roomCode)` | `handlers/gameplay.js:71` |
|  | `'Cannot join during active game. Wait...` | `socket` | `handlers/lobby.js:552` |
|  | `'Need at least 2 players to start.'` | `socket` | `handlers/gameplay.js:29` |
|  | `'Not enough players to start the round.'` | `io.to(roomCode)` | `turns.js:240` |
|  | `` ${p.name}: ${status}`` | `io.to(roomCode)` | `turns.js:346` |
|  | ``⏭️ Skipping disconnected player's turn`` | `io.to(roomCode)` | `turns.js:180` |
|  | ``⏰ ${currentPlayer.name} auto-stood d...` | `io.to(roomCode)` | `roomState.js:192` |
|  | ``⏰ ${p.name} ran out of time and auto...` | `io.to(roomCode)` | `turns.js:108` |
|  | ``⚖️ ${player.name} chose Normal risk`` | `io.to(roomCode)` | `roulette.js:35` |
|  | ``⚖️ Lowest hand (${lowestValue}) — at...` | `io.to(roomCode)` | `turns.js:408` |
|  | ``⚖️ Lowest-Hand Mode: Lowest hand (${...` | `io.to(roomCode)` | `turns.js:376` |
|  | ``⚠️ Host disconnected - game continue...` | `io.to(roomCode)` | `handlers/disconnect.js:200` |
|  | ``⚡ ${name} was automatically eliminat...` | `io.to(roomCode)` | `handlers/disconnect.js:79`, `handlers/lobby.js:291` |
|  | ``🃏 ${player.name} chose to use their...` | `io.to(roomCode)` | `roulette.js:32` |
|  | ``🃏 ${player.name} used their Second ...` | `io.to(roomCode)` | `roulette.js:131` |
|  | ``🎮 ${p.name} will join the next game`` | `io.to(roomCode)` | `handlers/lobby.js:561` |
|  | ``🎮 ${room.players[socket.id].name} j...` | `io.to(cleanCode)` | `handlers/lobby.js:201` |
|  | ``🎯 ${player.name} set elimination mo...` | `io.to(roomCode)` | `handlers/gameplay.js:149` |
|  | ``🏆 ${winner.name} wins by default - ...` | `io.to(roomCode)` | `handlers/disconnect.js:165` |
|  | ``👁️ ${name} disconnected while spect...` | `io.to(roomCode)` | `handlers/disconnect.js:37` |
|  | ``👁️ ${name} stopped spectating`` | `io.to(roomCode)` | `handlers/lobby.js:251` |
|  | ``👁️ ${p.name} chose to spectate the ...` | `io.to(socket.data.roomCode)` | `handlers/lobby.js:530` |
|  | ``👁️ ${room.players[socket.id].name} ...` | `io.to(cleanCode)` | `handlers/lobby.js:198` |
|  | ``👁️ ${spectatorCount} spectator${spe...` | `io.to(roomCode)` | `turns.js:261` |
|  | ``👻 ${player.name} is now spectating ...` | `io.to(roomCode)` | `roulette.js:137` |
|  | ``💀 ${player.name} rolled ${roll}/${e...` | `io.to(roomCode)` | `roulette.js:129`, `roulette.js:134` |
|  | ``🔄 Round ${room.roundsPlayed + 1} st...` | `io.to(roomCode)` | `turns.js:259` |
|  | ``🟢 ${player.name} rolled ${roll}/${e...` | `io.to(roomCode)` | `roulette.js:140` |
|  | ``${chosen.name} (Bot) is making their...` | `io.to(roomCode)` | `turns.js:438` |
|  | ``${chosen.name} is making their roule...` | `io.to(roomCode)` | `turns.js:451`, `turns.js:453` |
|  | ``${host.name} started the round`` | `io.to(roomCode)` | `handlers/gameplay.js:36` |
|  | ``${p.name} is ${p.ready ? 'READY' : '...` | `io.to(roomCode)` | `handlers/lobby.js:430` |
|  | ``${player.name} is pulling the trigge...` | `io.to(roomCode)` | `roulette.js:55` |
|  | ``${player.name} spins the chamber... ...` | `io.to(roomCode)` | `roulette.js:45` |
|  | ``${targetPlayer.name} was removed fro...` | `io.to(roomCode)` | `handlers/moderation.js:126` |
|  | ``Host has unbanned a player - they ca...` | `io.to(roomCode)` | `handlers/moderation.js:40` |
|  | `disconnectMessage` | `io.to(roomCode)` | `handlers/disconnect.js:78`, `handlers/disconnect.js:216` |
|  | `leaveMessage` | `io.to(roomCode)` | `handlers/lobby.js:290`, `handlers/lobby.js:327` |
|  | `triggerMessage` | `io.to(roomCode)` | `roulette.js:76` |
| `nextRoundCountdown` | `{ endsAt }` | `io.to(roomCode)` | `countdowns.js:99`, `countdowns.js:126` |
| `phaseChange` | `{ phase }` | `io.to(roomCode)`, `io.to(socket.id)` | `handlers/lobby.js:128`, `handlers/lobby.js:205`, `roomState.js:39` |
| `playerList` | `Object.values(room.players).map(p => ...` | `io.to(roomCode)` | `handlers/lobby.js:398`, `handlers/moderation.js:132`, `roomState.js:145` |
| `practiceRoomCreated` | `{ roomCode, botCount, difficulty, eliminationMode }` | `socket` | `handlers/lobby.js:512` |
| `readyCountdown` | `{ endsAt }` | `io.to(roomCode)` | `countdowns.js:58`, `countdowns.js:80` |
| `returnToLobbyCountdown` | `{ timeLeft }` | `io.to(roomCode)` | `roomState.js:273`, `roomState.js:280` |
| `roomError` | `'Failed to create room. Please try ag...` | `return socket` | `handlers/lobby.js:20` |
|  | `'Invalid room code'` | `return socket` | `handlers/lobby.js:148` |
|  | `'Room code must be 6 characters'` | `return socket` | `handlers/lobby.js:156` |
|  | `'Room not found'` | `if (!room) return socket` | `handlers/lobby.js:161` |
|  | `'You cannot join this room because yo...` | `return socket` | `handlers/lobby.js:166` |
| `roomJoined` | `{ roomCode }` | `socket` | `handlers/lobby.js:52`, `handlers/lobby.js:218` |
| `rouletteChoice` | `{ playerName, hasSecondChance, playersRemaining }` | `io.to(chosen.id)` | `turns.js:443` |
| `roundSummary` | `summaryData` | `io.to(p.id)` | `roomState.js:447` |
| `secondChanceUsed` | `{ playerId, playerName, roll, threshold }` | `io.to(roomCode)` | `roulette.js:116` |
| `spectatorReactionReceived` | `{ emoji, playerName, playerId }` | `io.to(roomCode)` | `handlers/gameplay.js:189` |
| `state` | `{ players, currentTurn, roundActive, gameOver, winnerId, hostId, roundsPlayed, phase }` | `io.to(roomCode)` | `roomState.js:121` |
| `triggerPull` | `{ loserId, loserName, timing, useSecondChance }` | `io.to(roomCode)` | `roulette.js:68` |
| `turnDeadline` | `{ deadline }` | `io.to(roomCode)` | `turns.js:23`, `turns.js:98` |
| `unbanError` | `'Only the host can unban players'` | `return socket` | `handlers/moderation.js:22` |
|  | `'Player is not banned'` | `return socket` | `handlers/moderation.js:27` |
| `unbanSuccess` | `{ playerId }` | `socket` | `handlers/moderation.js:43` |
| `victory` | `{ winnerId, winnerName }` | `io.to(roomCode)`, `io.to(socket.id)` | `handlers/disconnect.js:168`, `handlers/lobby.js:120`, `roomState.js:245` (+2) |

### Cross-check against the browser client

- Server emits, but the client has no listener: `unbanError`, `unbanSuccess`
- Client listens, but the server never emits: _none_
- Client emits, but the server has no handler: _none_
- Server handles, but no client emit was found: `unbanPlayer`

_A "no client emit found" entry means the scan found no literal `emit("name")` call in the client source; the event may still be sent some other way._

## colorrush

Namespace: `/colorrush`

### Client to server

| Event | Handler params | Payload keys read | Acknowledgement | Source |
|---|---|---|---|---|
| `activateFreeze` | _none_ | _none_ | no | `handlers/powerups.js:114` |
| `activatePatternPeek` | `data` | `currentInputLength` | no | `handlers/powerups.js:161` |
| `activateSecondChance` | _none_ | _none_ | no | `handlers/powerups.js:68` |
| `cancelGameStart` | _none_ | _none_ | no | `handlers/lobby.js:317` |
| `chatMessage` | `msg` | _used as a whole_ | no | `handlers/gameplay.js:401` |
| `createRoom` | `payload` | `options`, `name` | no | `handlers/lobby.js:15` |
| `disconnect` | _none_ | _none_ | no | `handlers/disconnect.js:11` |
| `joinRoom` | `payload` | `roomId`, `name` | no | `handlers/lobby.js:54` |
| `kickPlayer` | `payload` | `playerId` | no | `handlers/lobby.js:352` |
| `leaveRoom` | _none_ | _none_ | no | `handlers/lobby.js:144` |
| `playerReady` | _none_ | _none_ | no | `handlers/gameplay.js:18` |
| `playerReadyForSequence` | _none_ | _none_ | no | `handlers/gameplay.js:25` |
| `registerName` | `name` | _used as a whole_ | no | `handlers/lobby.js:204` |
| `requestSync` | _none_ | _none_ | no | `handlers/lobby.js:186` |
| `restartGame` | _none_ | _none_ | no | `handlers/lobby.js:394` |
| `secondChanceReplayComplete` | _none_ | _none_ | no | `handlers/powerups.js:11` |
| `sequenceWatched` | _none_ | _none_ | no | `handlers/gameplay.js:57` |
| `startGame` | _none_ | _none_ | no | `handlers/lobby.js:218` |
| `submitSequence` | `data` | `inputSequence`, `timeTaken` | no | `handlers/gameplay.js:116` |
| `toggleReady` | _none_ | _none_ | no | `handlers/lobby.js:332` |
| `updateGameSettings` | `rawSettings` | _used as a whole_ | no | `handlers/lobby.js:243` |

### Server to client

| Event | Payload | Sent to | Source |
|---|---|---|---|
| `chatMessage` | `{ name, colorIndex, text }` | `io.to(room.id)` | `handlers/gameplay.js:415` |
| `correct` | `{ streak, streakBonus }` | `io.to(decision.winnerId)`, `io.to(r.id)`, `io.to(socket.id)` | `disconnect.js:236`, `handlers/gameplay.js:380`, `suddenDeath.js:297` |
| `eliminated` | `{ is1v1Endgame, round }` | `io.to(id)` | `rounds.js:326`, `rounds.js:363` |
|  | `{ is1v1Endgame, round, isDraw }` | `io.to(id)`, `io.to(playerId)` | `lobby.js:46`, `rounds.js:465` |
| `enterPlayPhase` | `{ round, roundDuration }` | `io.to(id)` | `rounds.js:223` |
|  | `{ round, timeLimit }` | `io.to(room.id)` | `suddenDeath.js:170` |
| `enterRoundEndPhase` | `{ round }` | `io.to(room.id)` | `rounds.js:274` |
| `enterSequencePhase` | `{ round, sequence }` | `io.to(room.id)` | `rounds.js:152` |
|  | `{ sequence, round }` | `io.to(room.id)` | `suddenDeath.js:115` |
| `freezeActivated` | `_none_` | `io.to(socket.id)` | `handlers/powerups.js:144` |
| `gameOver` | `{ winner, winnerName, colorIndex, isDraw, scoreboard, gameStats }` | `io.to(room.id)` | `rounds.js:666` |
| `gameStartCancelled` | `_none_` | `io.to(room.id)` | `lobby.js:163` |
|  | `{ reason }` | `io.to(roomId)` | `disconnect.js:213` |
| `gameStartError` | `"Need at least 2 players to start"` | `io.to(room.id)`, `socket` | `handlers/lobby.js:228`, `lobby.js:220` |
| `gameStarting` | `{ endsAt, duration }` | `io.to(room.id)` | `lobby.js:143` |
| `joinError` | `"Game is already in progress"` | `socket` | `handlers/lobby.js:110` |
|  | `"Invalid room code format"` | `socket` | `handlers/lobby.js:61` |
|  | `"Room code must be 6 characters"` | `socket` | `handlers/lobby.js:71` |
|  | `"Room is full"` | `socket` | `handlers/lobby.js:104` |
|  | `"Room not found. It may have expired ...` | `socket` | `handlers/lobby.js:88` |
|  | `"You are already in this room"` | `socket` | `handlers/lobby.js:98` |
| `kicked` | `{ message }` | `io.to(playerId)` | `handlers/lobby.js:371` |
| `lifeLost` | `{ livesLeft }` | `io.to(r.id)`, `io.to(socket.id)` | `handlers/gameplay.js:305`, `handlers/gameplay.js:325`, `suddenDeath.js:299` |
|  | `{ livesLeft, reason }` | `io.to(playerId)` | `timers.js:249`, `timers.js:269` |
| `matchStatusUpdate` | `matchStatus` | `io.to(id)` | `lobby.js:112` |
| `peekReveal` | `{ index, color }` | `io.to(socket.id)` | `handlers/powerups.js:240` |
| `phaseChange` | `{ phase, roomId }` | `io.to(room.id)`, `io.to(roomId)` | `disconnect.js:229`, `handlers/lobby.js:408`, `lobby.js:233` (+1) |
| `playerCount` | `Object.keys(room.players).length` | `io.to(room.id)` | `lobby.js:264` |
| `playerDisconnected` | `{ playerId, playerName }` | `io.to(roomId)` | `disconnect.js:239`, `disconnect.js:250`, `disconnect.js:265` (+2) |
| `playerEliminated` | `{ id, name, colorIndex }` | `io.to(playerId)`, `io.to(room.id)`, `io.to(roomId)` | `disconnect.js:60`, `handlers/gameplay.js:347`, `rounds.js:327` (+1) |
| `playerList` | `list` | `io.to(room.id)` | `lobby.js:263` |
| `pointsEarned` | `{ points, total }` | `io.to(socket.id)` | `handlers/gameplay.js:379` |
| `powerUpUsed` | `{ playerId, type }` | `io.to(room.id)` | `handlers/powerups.js:99`, `handlers/powerups.js:145`, `handlers/powerups.js:248` |
| `prepareNextRound` | `_none_` | `io.to(room.id)` | `rounds.js:602` |
| `roomCreated` | `{ roomId, isHost, hostId, players, maxPlayers, phase, settings }` | `socket` | `handlers/lobby.js:30` |
| `roomJoined` | `{ roomId, isHost, hostId, players, maxPlayers, phase, startCountdownEndsAt, settings }` | `socket` | `handlers/lobby.js:120` |
| `roomState` | `{ roomId, hostId, players, maxPlayers, phase }` | `io.to(room.id)` | `handlers/powerups.js:102`, `handlers/powerups.js:148` |
|  | `{ roomId, hostId, players, maxPlayers, phase, startCountdownEndsAt }` | `io.to(room.id)` | `rounds.js:695` |
|  | `{ roomId, hostId, players, maxPlayers, phase, startCountdownEndsAt, settings }` | `io.to(room.id)` | `lobby.js:25` |
|  | `buildRoomState(room)` | `io.to(roomId)` | `disconnect.js:214`, `disconnect.js:219`, `disconnect.js:230` (+1) |
| `roundStart` | `{ round, phase, getReadyDuration }` | `io.to(room.id)` | `rounds.js:109` |
| `secondChanceActivated` | `_none_` | `io.to(socket.id)` | `handlers/powerups.js:98` |
| `secondChanceTimerResume` | `{ remainingTime }` | `io.to(socket.id)` | `handlers/powerups.js:57` |
| `secondChanceTriggered` | `{ sequence, round, remainingTime }` | `io.to(socket.id)` | `handlers/gameplay.js:192`, `handlers/gameplay.js:285` |
| `settingsUpdateError` | `"Max players must be between 2 and 6"` | `socket` | `handlers/lobby.js:271` |
|  | `"Max rounds must be between 15 and 30"` | `socket` | `handlers/lobby.js:291` |
|  | `"Only host can update settings"` | `socket` | `handlers/lobby.js:256` |
|  | `"Power-ups enabled must be true or fa...` | `socket` | `handlers/lobby.js:302` |
|  | `"Room not found"` | `socket` | `handlers/lobby.js:250` |
|  | `"Settings can only be changed in lobby"` | `socket` | `handlers/lobby.js:262` |
|  | ``Cannot set max players below current...` | `socket` | `handlers/lobby.js:278` |
| `streakUpdate` | `{ active, streak }` | `io.to(socket.id)` | `handlers/gameplay.js:198`, `handlers/gameplay.js:291`, `handlers/gameplay.js:356` (+1) |
| `suddenDeathRoundStart` | `{ sequence, length, tiePlayers }` | `io.to(room.id)` | `suddenDeath.js:92` |
| `suddenDeathStart` | `{ players, names, length, reason }` | `io.to(room.id)` | `rounds.js:440`, `rounds.js:521` |
| `sync` | `{ players, hostId, gameStarted, round, sequenceLength, you }` | `io.to(socket.id)` | `handlers/lobby.js:192` |
| `tieBreakerRoundStart` | `{ sequence, tieRound, length, tiePlayers }` | `io.to(room.id)` | `suddenDeath.js:400` |
| `timerFrozen` | `{ duration, remainingTime }` | `io.to(playerId)` | `powerups.js:108` |
| `timerResumed` | `{ remainingTime }` | `io.to(playerId)` | `powerups.js:136` |
| `timerUpdate` | `{ remainingTime, freezeActive }` | `io.to(playerId)` | `timers.js:152` |
| `youAreHost` | `_none_` | `io.to(newHostId)`, `io.to(room.hostId)`, `socket` | `disconnect.js:199`, `handlers/lobby.js:44`, `handlers/lobby.js:162` |

### Cross-check against the browser client

- Server emits, but the client has no listener: `settingsUpdateError`
- Client listens, but the server never emits: `tieBreakerStart`
- Client emits, but the server has no handler: _none_
- Server handles, but no client emit was found: `chatMessage`, `registerName`, `restartGame`, `updateGameSettings`

_A "no client emit found" entry means the scan found no literal `emit("name")` call in the client source; the event may still be sent some other way._

## rankly

Namespace: `/rankly`

### Client to server

| Event | Handler params | Payload keys read | Acknowledgement | Source |
|---|---|---|---|---|
| `attempt_reconnect` | `payload`, `cb` | `roomId`, `playerToken` | yes (callback) | `index.js:784` |
| `cancel_start` | `payload` | `roomId` | no | `index.js:627` |
| `chat_message` | `payload` | `roomId`, `text` | no | `index.js:718` |
| `close_room` | `payload` | `roomId` | no | `index.js:337` |
| `create_room` | `payload`, `cb` | `mode`, `name`, `avatarColor`, `avatarTextColor` | yes (callback) | `index.js:77` |
| `disconnect` | _none_ | _none_ | no | `index.js:777` |
| `host_end_game` | `payload` | `roomId` | no | `index.js:669` |
| `host_next_round` | `payload` | `roomId` | no | `index.js:652` |
| `join_room` | `payload`, `cb` | `roomId`, `name`, `avatarColor`, `avatarTextColor` | yes (callback) | `index.js:156` |
| `kick_player` | `payload` | `roomId`, `targetSocketId` | no | `index.js:363` |
| `leave_room` | `payload` | `roomId` | no | `index.js:229` |
| `manual_exit_to_lobby` | `payload` | `roomId` | no | `index.js:747` |
| `start_game` | `payload` | `roomId`, `customQuestions`, `minPlayers`, `turnTime`, `multiplier`, `numRounds` | no | `index.js:550` |
| `submit_answer` | `payload`, `cb` | `roomId`, `roundId`, `answer` | yes (callback) | `index.js:498` |
| `submit_rank` | `payload` | `roomId`, `roundId`, `ranks` | no | `index.js:639` |
| `toggle_ready` | `payload` | `roomId`, `ready` | no | `index.js:442` |
| `update_avatar` | `payload` | `roomId`, `avatarColor`, `avatarTextColor` | no | `index.js:480` |

### Server to client

| Event | Payload | Sent to | Source |
|---|---|---|---|
| `auto_return_countdown` | `{ seconds }` | `io.to(roomId)` | `rankingService.js:230` |
| `chat_message_broadcast` | `{ name, text }` | `io.to(roomId)` | `index.js:278`, `index.js:414`, `index.js:741` |
| `countdown_cancelled` | `{ reason }` | `io.to(roomId)` | `countdownService.js:48`, `countdownService.js:69`, `index.js:309` (+1) |
| `enter_ranking` | `{ phase }` | `io.to(roomId)` | `gameEngine.js:242` |
| `force_ready_reset` | `_none_` | `io.to(roomId)` | `index.js:709` |
| `game_ended` | `{ leaderboard }` | `io.to(roomId)` | `gameEngine.js:334`, `rankingService.js:220`, `rankingService.js:326` (+1) |
| `game_ended_due_to_low_players` | `{ reason }` | `io.to(roomId)` | `index.js:263`, `index.js:325`, `index.js:430` (+2) |
|  | `{ reason, leaderboard }` | `io.to(roomId)` | `gameEngine.js:381`, `rankingService.js:201`, `rankingService.js:308` (+1) |
| `game_started` | `{ hostSocketId, judgeSocketId, roundId, question, difficulty, phase, currentRoundIndex, totalRounds }` | `io.to(roomId)` | `gameEngine.js:93` |
| `host_changed` | `{ newHostSocketId, newHostName }` | `io.to(roomId)` | `roomManager.js:39` |
| `judge_bonus` | `{ points }` | `io.to(room.judgeSocketId)` | `rankingService.js:136`, `rankingService.js:264` |
| `judge_reassigned` | `{ newJudgeSocketId, newJudgeName }` | `io.to(roomId)` | `roomManager.js:65` |
| `judge_reassigned_ranking` | `{ rankingTime, answersAnon }` | `io.to(newJudge)` | `reconnectService.js:447` |
| `kicked_from_room` | `{ reason }` | `targetSocket` | `index.js:405` |
| `left_room` | `{ ok, error }` | `return socket` | `index.js:233` |
|  | `{ ok, roomId }` | `socket`, `targetSocket` | `index.js:243`, `index.js:410` |
| `next_round_countdown` | `{ seconds }` | `io.to(roomId)` | `rankingService.js:354`, `reconnectService.js:408` |
| `next_turn` | `{ socketId, index, name }` | `io.to(roomId)` | `gameEngine.js:158` |
| `player_disconnected` | `{ socketId, name, temporary }` | `io.to(disconnectedRoomId)` | `reconnectService.js:207` |
| `player_permanently_disconnected` | `{ socketId, name }` | `io.to(roomId)` | `reconnectService.js:240` |
| `player_points_earned` | `{ points, rank, totalAnswers }` | `io.to(ans.playerSocketId)` | `rankingService.js:125` |
| `player_reconnected` | `{ socketId, name }` | `io.to(roomId)` | `reconnectService.js:103` |
| `ranking_phase_ended` | `_none_` | `io.to(roomId)` | `gameEngine.js:267` |
| `ranking_result` | `{ phase, leaderboard, winnerSocketId, roundsRemaining }` | `io.to(roomId)` | `rankingService.js:179` |
|  | `{ phase, results, leaderboard, winnerSocketId, roundsRemaining }` | `io.to(roomId)` | `rankingService.js:288` |
| `ready_count_update` | `{ ready, total }` | `io.to(roomId)` | `index.js:462` |
| `reconnect_state` | `snapshot` | `socket` | `reconnectService.js:161` |
| `return_to_lobby` | `_none_` | `io.to(roomId)`, `socket` | `gameEngine.js:386`, `index.js:266`, `index.js:328` (+9) |
| `room_closed` | `{ reason }` | `io.to(roomId)` | `index.js:344` |
| `room_update` | `{ players, leaderboard, state, mode, hostSocketId }` | `io.to(roomId)` | `roomManager.js:255` |
| `round_skipped` | `{ reason, leaderboard, roundsRemaining }` | `io.to(roomId)` | `gameEngine.js:320`, `reconnectService.js:374` |
| `start_countdown` | `{ expiresAt, countdownMs, ready, total }` | `io.to(roomId)` | `countdownService.js:26` |
| `start_error` | `{ error }` | `return socket` | `index.js:569`, `index.js:583`, `index.js:589` |
| `time_up` | `_none_` | `io.to(sid)` | `gameEngine.js:175` |
| `your_turn` | `{ time }` | `io.to(sid)` | `gameEngine.js:166` |

### Cross-check against the browser client

- Server emits, but the client has no listener: _none_
- Client listens, but the server never emits: _none_
- Client emits, but the server has no handler: _none_
- Server handles, but no client emit was found: `host_end_game`

_A "no client emit found" entry means the scan found no literal `emit("name")` call in the client source; the event may still be sent some other way._
