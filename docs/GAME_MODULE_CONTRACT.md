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
| `shutdown()` | no | clear timers so the process can exit |

v0 intentionally excludes the per-room lifecycle methods (`createRoom`, `joinRoom`,
`handleAction`, ...) from the blueprint; they are added in later versions, one at a
time, once the games are migrated and covered by tests.

## Migration status

| Game | On registry | Notes |
|---|---|---|
| Blackjack | yes (`src/games/blackjack/module.js`) | adapter only; events, payloads and rules unchanged |
| ColorRush | no | still attached directly in `server.js` |
| Rankly | no | ESM; needs the CJS/ESM boundary resolved first |

## Known behaviours deliberately preserved (fix later, separately)

- Blackjack `hit`/`stand` do not check that it is the caller's turn at handler level.
- Blackjack room codes use `Math.random().toString(36).slice(2,8)` and may be shorter than 6 characters.
- Blackjack kicks ban by IP.
