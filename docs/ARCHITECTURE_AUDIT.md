# Gamevrse – Phase 0 Audit (baseline)

Scope: read-only audit of the repository at commit `35814f9`, as required by the
architecture blueprint (Phase 0). No application code was changed.

## 1. Baseline

- `npm ci && npm test`: **18 tests, 18 pass** (`tests/smoke.test.js` only). `npm run lint`: clean.
- Without `npm ci` the suite fails on a missing `socket.io-client`; that is an environment issue, not a regression.
- Test coverage is smoke level: pages are served, namespaces accept connections, ColorRush and
  Blackjack can create/join a room. There are **no tests of game rules, reconnection, spectators,
  timer cleanup or private-state leakage**. This is the main blocker for safe refactoring.

## 2. Current structure (verified)

- `src/server.js`: Express + Socket.IO. One namespace per game (`/colorrush`, `/blackjack`,
  `/rankly`). `guardNamespace` wraps every `socket.on` handler so thrown errors are logged
  instead of crashing the process. Global `uncaughtException`/`unhandledRejection` logging.
  `/healthz` exists. No graceful shutdown handler.
- `src/shared/`: `logger.js`, `timers.js` (`safeTimeout`/`safeInterval`), `validate.js`
  (`cleanName`, `cleanHexColor`). This is the only shared code between games.
- Games are **mixed module systems**: ColorRush and Blackjack are CommonJS; Rankly is ESM
  (`src/games/rankly/package.json`, because `nanoid` is ESM-only) and is loaded with dynamic
  `import()`. Rankly's `attach(namespace, app)` also mounts Express admin routes.
- Each game keeps its state in module-level in-memory objects (`rooms`, plus per-game maps).

| Game | Size | Structure | Room ID |
|---|---|---|---|
| ColorRush | ~2.9k lines | `state/rooms/lobby/rounds/suddenDeath/timers/disconnect/powerups` + `handlers/` | 6 chars, `Math.random` |
| Blackjack | ~1.6k lines | `state/roomState/turns/roulette/bots/countdowns` + `handlers/` | 6 chars |
| Rankly | ~2.8k lines | service-style (`roomManager`, `reconnectService`, `rankingService`, `gameEngine`, …); `index.js` is 800 lines | `nanoid(6)` |

## 3. Event inventory (client → server, from `socket.on` registrations)

- **ColorRush**: `createRoom registerName joinRoom leaveRoom kickPlayer toggleReady playerReady
  playerReadyForSequence startGame cancelGameStart updateGameSettings restartGame sequenceWatched
  submitSequence secondChanceReplayComplete activateFreeze activatePatternPeek
  activateSecondChance chatMessage requestSync disconnect` (camelCase).
- **Blackjack**: `identify setName createRoom createPracticeRoom joinRoom leave kickPlayer
  unbanPlayer toggleReady startRound hit stand submitRouletteChoice setEliminationMode
  requestNewGame joinNextGame spectate spectatorReaction disconnect` (camelCase).
- **Rankly**: `create_room join_room leave_room kick_player toggle_ready start_game cancel_start
  submit_answer submit_rank host_next_round host_end_game close_room manual_exit_to_lobby
  update_avatar chat_message attempt_reconnect disconnect` (snake_case).

Server → client event names and payloads are **not yet inventoried**; do that next, per game,
before changing any of them.

## 4. Duplication and inconsistency (what should become shared)

1. **Room lifecycle**: each game has its own `rooms` object, creation, join, leave, kick, ready,
   host handling and cleanup. All three implement the same concepts differently.
2. **Event naming**: camelCase (ColorRush, Blackjack) vs snake_case (Rankly); acknowledgement
   styles differ (Rankly uses `cb({ok, error})`; the others emit events).
3. **Reconnection** is three different mechanisms: Rankly has a `playerToken` plus
   `reconnectService`/`attempt_reconnect`; Blackjack has `identify` plus `playersByToken` with a
   60 s window; ColorRush has disconnect handling (`disconnect.js`) but no reconnect token found
   in a grep for `reconnect|token`.
4. **Identity** is socket-id keyed in ColorRush and Rankly (`players[socket.id]`), so identity
   does not survive a connection change without game-specific recovery code.
5. **Validation** is per handler. Only name/colour cleaning is shared; payload schemas, rate
   limiting and phase checks are ad hoc (Blackjack has `ACTION_COOLDOWN_MS`; Rankly has chat
   timestamps).
6. **Timers**: `safeTimeout`/`safeInterval` are wrappers that catch errors, but timers are still
   stored on room objects ad hoc (ColorRush rooms hold several timer fields), and there is no
   common "dispose room" step that guarantees all are cleared.
7. **Room codes**: ColorRush uses `Math.random`, which is not suited to anything security
   sensitive; uniqueness is checked only within that game.

## 5. Risks for migration

- Mixed CJS/ESM boundary: a shared game contract must be consumable from both, or Rankly
  must be converted (`nanoid` could be replaced by `crypto.randomBytes`/`randomInt`).
- Client protocols are the compatibility surface. Renaming events (blueprint section 7.1)
  breaks the three browser clients unless done behind an adapter or per game with its client.
- Module-level singleton state in every game makes unit testing hard and blocks multiple
  instances (Phase 5), but is fine for a single process.
- Active rooms are lost on restart; no graceful shutdown exists.
- Very large files (`colorrush/rounds.js` 706, `rankly/index.js` 800, `suddenDeath.js` 522,
  `blackjack/turns.js` 473) carry game rules that tests do not yet pin down.
- Deployment is Render (`render.yaml`); any change must keep `npm start` and `/healthz` working.

## 6. Recommended next steps (proposal, not yet applied)

1. **Characterization tests first**: multi-client Socket.IO tests per game covering join/leave,
   host leaving, disconnect/reconnect, kick, spectators (Blackjack), and room cleanup.
2. Inventory server → client events and payloads in `docs/REALTIME_EVENTS.md`.
3. Add platform pieces that do not touch gameplay: graceful shutdown, secure room-code
   generator (`crypto.randomInt`), shared payload validation and rate limiting.
4. Define `game-interface.js` and a registry, then migrate the **smallest-lifecycle game as the
   proof of concept** behind an adapter that preserves its existing event names.
5. Only then consider shared player identity and PostgreSQL (Phase 2).

Open decision for the owner: which game to use as the proof of concept. Blackjack's
`identify`/token flow is closest to the target reconnection model; ColorRush has the most
timer/state complexity and is the riskiest to migrate first.
