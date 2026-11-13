// Minimal levelled logger. LOG_LEVEL=debug|info|warn|error (default: info).
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold() {
  const level = String(process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[level] || LEVELS.info;
}

// Read the level on every call so it can be changed at runtime (and in tests).
function make(level, sink) {
  return (...args) => {
    if (LEVELS[level] >= threshold()) console[sink](...args);
  };
}

module.exports = {
  debug: make('debug', 'log'),
  info: make('info', 'log'),
  warn: make('warn', 'warn'),
  error: make('error', 'error'),
};
