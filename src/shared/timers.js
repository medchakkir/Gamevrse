// Drop-in replacements for setTimeout/setInterval whose callbacks can't take the
// process down: a thrown error (or rejected promise) is logged instead. The raw
// timer handle is returned, so clearTimeout/clearInterval keep working.
function guard(label, fn) {
  const report = (err) => console.error(`[gamevrse] timer error in ${label}:`, err);
  return function guarded(...args) {
    try {
      const result = fn.apply(this, args);
      if (result && typeof result.catch === 'function') result.catch(report);
    } catch (err) {
      report(err);
    }
  };
}

function safeTimeout(label, fn, ms) {
  return setTimeout(guard(label, fn), ms);
}

function safeInterval(label, fn, ms) {
  return setInterval(guard(label, fn), ms);
}

module.exports = { safeTimeout, safeInterval };
