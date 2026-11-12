const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../src/server');

let server, base;
test.before(async () => {
  ({ server } = await createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => {
  server.closeAllConnections?.();
  server.close();
});

test('homepage and game pages are served', async () => {
  for (const p of ['/', '/games/colorrush/', '/games/rankly/', '/games/blackjack/', '/healthz']) {
    const res = await fetch(base + p);
    assert.strictEqual(res.status, 200, p);
  }
});

for (const ns of ['colorrush', 'rankly', 'blackjack']) {
  test(`socket namespace /${ns} accepts connections`, async () => {
    const s = connect(`${base}/${ns}`, { transports: ['websocket'] });
    await new Promise((res, rej) => {
      s.on('connect', res);
      s.on('connect_error', rej);
    });
    s.close();
  });
}
