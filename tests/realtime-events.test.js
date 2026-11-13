const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { render, OUT } = require('../scripts/generate-realtime-events');

test('docs/REALTIME_EVENTS.md is up to date (run `npm run docs:events`)', () => {
  assert.strictEqual(fs.readFileSync(OUT, 'utf8'), render());
});

test('the inventory covers every event handled or emitted by the servers', () => {
  const doc = render();
  // Spot-check events from each game, in both directions.
  for (const ev of ['hit', 'stand', 'state', 'victory', 'createRoom', 'roomState', 'submitSequence', 'create_room', 'attempt_reconnect', 'room_update', 'reconnect_state']) {
    assert.ok(doc.includes('`' + ev + '`'), `missing ${ev}`);
  }
  // The scan fails loudly on dynamic event names rather than silently skipping them.
  assert.ok(!/undefined/.test(doc));
});
