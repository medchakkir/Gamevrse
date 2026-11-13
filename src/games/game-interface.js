// Game-module contract, version 0 (transitional).
//
// A game module is a plain object the platform can register without knowing the
// game's rules. v0 deliberately covers only what every existing game can honour
// today; the per-room lifecycle methods from the architecture blueprint
// (createRoom, joinRoom, handleAction, ...) are added in later contract versions,
// one concern at a time, once the games have been migrated.
//
// Required:
//   id        string   unique, lowercase [a-z0-9-]; also the Socket.IO namespace "/<id>"
//   name      string   display name
//   version   string   semver of the game module
//   config    { minPlayers: integer >= 1,
//               maxPlayers: integer >= minPlayers | null  (null = the game enforces no cap),
//               supportsSpectators: boolean }
//   attach    (namespace, app) => void | Promise<void>
//             Registers the game's socket handlers on its namespace.
//
// Optional:
//   listRooms () => string[]   ids of active rooms (for health checks / admin)
//   shutdown  () => void       clear timers/intervals so the process can exit cleanly

const ID_PATTERN = /^[a-z0-9-]+$/;

function validateGameModule(mod) {
  const errors = [];
  if (!mod || typeof mod !== 'object') return ['game module must be an object'];

  if (typeof mod.id !== 'string' || !ID_PATTERN.test(mod.id)) errors.push('id must match /^[a-z0-9-]+$/');
  if (typeof mod.name !== 'string' || !mod.name.trim()) errors.push('name must be a non-empty string');
  if (typeof mod.version !== 'string' || !/^\d+\.\d+\.\d+/.test(mod.version)) errors.push('version must be a semver string');

  const c = mod.config;
  if (!c || typeof c !== 'object') {
    errors.push('config is required');
  } else {
    if (!Number.isInteger(c.minPlayers) || c.minPlayers < 1) errors.push('config.minPlayers must be an integer >= 1');
    const maxOk = c.maxPlayers === null || (Number.isInteger(c.maxPlayers) && c.maxPlayers >= c.minPlayers);
    if (!maxOk) errors.push('config.maxPlayers must be null or an integer >= minPlayers');
    if (typeof c.supportsSpectators !== 'boolean') errors.push('config.supportsSpectators must be a boolean');
  }

  if (typeof mod.attach !== 'function') errors.push('attach must be a function');
  for (const optional of ['listRooms', 'shutdown']) {
    if (mod[optional] !== undefined && typeof mod[optional] !== 'function') errors.push(`${optional} must be a function when provided`);
  }
  return errors;
}

module.exports = { validateGameModule };
