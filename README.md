# Gamevrse

A hub of real-time multiplayer party games that run in the browser.

| Game | Path | Description |
|---|---|---|
| ColorRush | `/games/colorrush/` | Memory-sequence game with power-ups |
| Rankly | `/games/rankly/` | Family-Feud-style ranking game with a judge |
| Blackjack | `/games/blackjack/` | "Blackjack roulette" elimination game with bots and spectators |

## Quick start
```bash
npm install
npm start        # http://localhost:3000
npm run dev      # auto-restart on change
npm test         # smoke tests
npm run lint
```
Copy `.env.example` to `.env` if you want to override settings. Game state lives in memory, so rooms are lost on restart.

## Layout
```
src/server.js          Express + Socket.IO bootstrap; mounts every game
src/config.js          Environment configuration
src/games/<game>/      Server logic; exports attach(namespace)
public/index.html      Homepage
public/games/<game>/   Client HTML, JS, CSS and assets for each game
tests/                 Node test runner tests
docs/DEPLOYMENT.md     Deployment guide
```
Each game gets its own Socket.IO namespace (`/colorrush`, `/rankly`, `/blackjack`) on the same port.

## Adding a game
1. Create `src/games/<name>/index.js` exporting `attach(namespace)`.
2. Call it from `src/server.js` with `io.of('/<name>')`.
3. Put the client in `public/games/<name>/` and connect with `io('/<name>')`.
4. Add a card to `public/index.html`.
