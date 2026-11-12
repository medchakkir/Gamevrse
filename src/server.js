// Gamevrse: one Express + Socket.IO server hosting every game.
// Each game lives in src/games/<name> and exports attach(namespace[, app]).
const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const config = require('./config');

// Wraps every listener a game registers with socket.on so a thrown error (or a
// rejected promise) is logged instead of crashing the process. Must be attached
// before the game's own connection handler so it sees every socket.on call.
function guardHandler(label, fn) {
  const report = (err) => console.error(`[gamevrse] handler error in ${label}:`, err);
  return function guarded(...args) {
    try {
      const result = fn.apply(this, args);
      if (result && typeof result.catch === 'function') result.catch(report);
      return result;
    } catch (err) {
      report(err);
    }
  };
}

function guardNamespace(nsp) {
  nsp.on('connection', (socket) => {
    const on = socket.on.bind(socket);
    socket.on = (event, fn) => (typeof fn === 'function' ? on(event, guardHandler(`${nsp.name}:${event}`, fn)) : on(event, fn));
  });
}

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression());
  app.use(express.json());
  app.use(
    express.static(PUBLIC_DIR, {
      maxAge: config.isProduction ? '1h' : 0,
    })
  );
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  const io = new Server(server);

  for (const ns of ['/colorrush', '/blackjack', '/rankly']) guardNamespace(io.of(ns));

  require('./games/colorrush').attach(io.of('/colorrush'));
  require('./games/blackjack').attach(io.of('/blackjack'));
  // Rankly is an ES module (nanoid is ESM-only), so it is loaded dynamically.
  const rankly = await import('./games/rankly/index.js');
  rankly.attach(io.of('/rankly'), app);

  return { app, server, io };
}

if (require.main === module) {
  createApp().then(({ server }) => {
    server.listen(config.port, () => {
      console.log(`[gamevrse] listening on http://localhost:${config.port}`);
    });
  });
}

module.exports = { createApp, guardHandler };
