// Game registry: validates game modules and attaches them to the Socket.IO server.
const { validateGameModule } = require('./game-interface');

function createRegistry() {
  const games = new Map();

  function register(mod) {
    const errors = validateGameModule(mod);
    if (errors.length) throw new Error(`Invalid game module${mod?.id ? ` "${mod.id}"` : ''}: ${errors.join('; ')}`);
    if (games.has(mod.id)) throw new Error(`Game "${mod.id}" is already registered`);
    games.set(mod.id, mod);
    return mod;
  }

  const get = (id) => games.get(id);
  const list = () => [...games.values()];
  const namespaceOf = (mod) => `/${mod.id}`;

  // Attaches one registered game to its namespace "/<id>". `prepare(nsp)` runs first
  // so the host can install cross-cutting wrappers (e.g. handler error guards).
  async function attach(id, io, app, prepare) {
    const mod = games.get(id);
    if (!mod) throw new Error(`Unknown game "${id}"`);
    const nsp = io.of(namespaceOf(mod));
    if (prepare) prepare(nsp);
    await mod.attach(nsp, app);
    return mod;
  }

  // Calls every game's optional shutdown(); one failing game must not stop the rest.
  async function shutdownAll() {
    for (const mod of games.values()) {
      if (typeof mod.shutdown !== 'function') continue;
      try {
        await mod.shutdown();
      } catch (err) {
        console.error(`[gamevrse] shutdown error in ${mod.id}:`, err);
      }
    }
  }

  return { register, get, list, attach, namespaceOf, shutdownAll };
}

module.exports = { createRegistry };
