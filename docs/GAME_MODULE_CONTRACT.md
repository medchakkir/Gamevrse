# Game module contract (v0, transitional)

Source of truth: `src/games/game-interface.js` (`validateGameModule`). Registry: `src/games/registry.js`.

A game exports a descriptor object; the registry validates it, then attaches it to
the Socket.IO namespace `/<id>`. A cross-cutting `prepare(nsp)` hook (currently the
handler error guard in `server.js`) runs before the game's own `attach`.

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | unique `[a-z0-9-]+`; namespace is `/<id>` |
| `name`, `version` | yes | display name, semver |
| `config.minPlayers` | yes | integer >= 1 |
| `config.maxPlayers` | yes | integer >= minPlayers, or `null` if the game enforces no cap |
| `config.supportsSpectators` | yes | boolean |
| `attach(nsp, app)` | yes | registers the game's socket handlers (may be async) |
| `listRooms()` | no | active room ids |
| `shutdown()` | no | clear timers so the process can exit; called by `registry.shutdownAll()` |

v0 intentionally excludes the per-room lifecycle methods (`createRoom`, `joinRoom`,
`handleAction`, ...) from the blueprint; they are added in later versions, one at a
time, once the games are migrated and covered by tests.

## Migration status

| Game | On registry | Notes |
|---|---|---|
| Blackjack | yes (`src/games/blackjack/module.js`) | adapter only; events, payloads and rules unchanged |
| ColorRush | yes (`src/games/colorrush/module.js`) | adapter only; events, payloads and rules unchanged |
| Rankly | yes (`src/games/rankly/module.cjs`) | adapter only; the descriptor is `.cjs` because `src/games/rankly` is an ESM package, and it loads the game with a dynamic `import()` |

## Known behaviours: preserved during migration, then fixed or pending

- (fixed) Blackjack `hit`/`stand` now require it to be the caller's turn.
- (fixed) Blackjack room codes are now always 6 characters from a CSPRNG (`src/shared/roomCode.js`).
- (fixed) Blackjack no longer blocks joins by IP alone; kicks ban the socket id and the name+IP identity (enforced at setName).
- (fixed) Blackjack `unbanPlayer` now also lifts the name+IP identity ban from the same kick.

## Graceful shutdown

`createApp()` returns `shutdown()`; `npm start` calls it on SIGTERM/SIGINT (a second signal, or 10 s
without finishing, forces exit 1). Order: stop accepting connections and disconnect sockets, let
disconnect handlers run, call each registered game's `shutdown()`, then clear every remaining tracked
timer (safety net). Timers are tracked by
`src/shared/timers.js` (`safeTimeout`/`safeInterval`, labelled `<game>/...`).

Not done: active rooms are still lost on shutdown (no persistence), and clients get no
"server restarting" event; they just see a disconnect.

## ColorRush notes (observed, not changed)

- Room codes still come from ColorRush's own `Math.random` generator (always 6 chars, so not broken).
- `kickPlayer` keeps no ban list: a kicked player can rejoin the same room immediately.
- ColorRush has no spectator role; joining a game in progress is rejected (`Game is already in progress`).

## Rankly notes (observed, not changed)

- (fixed) In normal mode, `start_game` with a non-empty `question` used to throw (`const` reassignment) and silently never start; the field is now ignored.
- `start_game` stores the client's `minPlayers`, `turnTime` and `multiplier` in the room rules without validation.
- Room codes are `nanoid(6).toUpperCase()`, so they can contain `_` and `-`.
- `kick_player` keeps no ban list: a kicked player can rejoin.
- No player cap is enforced.
- Rankly keeps its `rooms` map private to the module; tests are wire-level only.
