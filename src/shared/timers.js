// Drop-in replacements for setTimeout/setInterval whose callbacks can't take the
// process down: a thrown error (or rejected promise) is logged instead. The raw
// timer handle is returned, so clearTimeout/clearInterval keep working.
//
// Every timer created here is also tracked (by label) so a graceful shutdown can
// clear them all with clearTimers(prefix). Tracking uses WeakRefs so timers that
// callers clear themselves, or that have fired, never accumulate.
const tracked = new Map(); // WeakRef<handle> -> label
const refs = new WeakMap(); // handle -> its WeakRef (so a fired timeout can untrack itself)
const reaper = new FinalizationRegistry((ref) => tracked.delete(ref));

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

function track(handle, label) {
  const ref = new WeakRef(handle);
  tracked.set(ref, label);
  refs.set(handle, ref);
  reaper.register(handle, ref);
  return handle;
}

function untrack(handle) {
  const ref = refs.get(handle);
  if (ref) tracked.delete(ref);
}

function safeTimeout(label, fn, ms) {
  const guarded = guard(label, fn);
  const handle = setTimeout((...args) => {
    untrack(handle);
    guarded(...args);
  }, ms);
  return track(handle, label);
}

function safeInterval(label, fn, ms) {
  return track(setInterval(guard(label, fn), ms), label);
}

function live(prefix = '') {
  const out = [];
  for (const [ref, label] of tracked) {
    const handle = ref.deref();
    if (!handle) tracked.delete(ref);
    else if (label.startsWith(prefix)) out.push([ref, handle]);
  }
  return out;
}

// Number of tracked timers whose label starts with `prefix` (all when omitted).
// Timers a caller already cleared itself may still be counted until the GC runs.
function activeTimerCount(prefix = '') {
  return live(prefix).filter(([, h]) => !h._destroyed).length;
}

// Clears (and untracks) every tracked timer whose label starts with `prefix`.
// Returns how many were cleared.
function clearTimers(prefix = '') {
  let n = 0;
  for (const [ref, handle] of live(prefix)) {
    if (!handle._destroyed) n++;
    clearTimeout(handle); // clearTimeout and clearInterval are interchangeable in Node
    tracked.delete(ref);
  }
  return n;
}

module.exports = { safeTimeout, safeInterval, clearTimers, activeTimerCount };
