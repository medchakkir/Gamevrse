// Gamevrse: one Express + Socket.IO server hosting every game.
// Each game lives in src/games/<name> and exports attach(namespace[, app]).
const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { Server } = require('socket.io');
const config = require('./config');
const logger = require('./shared/logger');
const { createRegistry } = require('./games/registry');
const { clearTimers } = require('./shared/timers');

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

// Last-resort safety net: log (don't crash on) anything that escapes every guard.
process.on('uncaughtException', (err) => {
  console.error('[gamevrse] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[gamevrse] unhandledRejection:', reason);
});

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

  guardNamespace(io.of('/rankly')); // Rankly is not on the registry yet (ES module)

  const registry = createRegistry();
  for (const mod of [require('./games/colorrush/module'), require('./games/blackjack/module')]) {
    registry.register(mod);
    await registry.attach(mod.id, io, app, guardNamespace);
  }
  // Rankly is an ES module (nanoid is ESM-only), so it is loaded dynamically.
  const rankly = await import('./games/rankly/index.js');
  rankly.attach(io.of('/rankly'), app);

  // Graceful shutdown: stop accepting connections, disconnect sockets, then clear
  // game timers (after the disconnect handlers have run, since they schedule timers).
  let stopping = null;
  function shutdown() {
    if (stopping) return stopping;
    stopping = (async () => {
      if (server.listening) {
        await new Promise((resolve) => io.close(() => resolve())); // also closes the HTTP server
      }
      server.closeAllConnections?.();
      await new Promise((resolve) => setImmediate(resolve));
      await registry.shutdownAll();
      clearTimers(); // games not yet on the registry (Rankly)
    })();
    return stopping;
  }

  return { app, server, io, shutdown };
}

if (require.main === module) {
  createApp().then(({ server, shutdown }) => {
    server.listen(config.port, () => {
      logger.info(`[gamevrse] listening on http://localhost:${config.port}`);
    });

    let signalled = false;
    const onSignal = (signal) => {
      if (signalled) process.exit(1); // second signal: stop waiting
      signalled = true;
      logger.info(`[gamevrse] ${signal} received, shutting down`);
      const force = setTimeout(() => {
        console.error('[gamevrse] shutdown timed out, forcing exit');
        process.exit(1);
      }, 10000);
      force.unref();
      shutdown().then(
        () => process.exit(0),
        (err) => {
          console.error('[gamevrse] error during shutdown:', err);
          process.exit(1);
        }
      );
    };
    process.on('SIGTERM', () => onSignal('SIGTERM'));
    process.on('SIGINT', () => onSignal('SIGINT'));
  });
}

module.exports = { createApp, guardHandler };
