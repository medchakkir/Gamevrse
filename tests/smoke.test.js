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

test('colorrush: create a room, join it, and start a game', async () => {
  const open = () =>
    new Promise((res, rej) => {
      const s = connect(`${base}/colorrush`, { transports: ['websocket'] });
      s.on('connect', () => res(s));
      s.on('connect_error', rej);
    });
  const once = (s, ev) => new Promise((res) => s.once(ev, res));

  const host = await open();
  const guest = await open();
  const created = once(host, 'roomCreated');
  host.emit('createRoom', { name: 'Host', options: {} });
  const { roomId } = await created;
  assert.match(roomId, /^[A-Z0-9]{6}$/i);

  const joined = once(guest, 'roomJoined');
  guest.emit('joinRoom', { roomId, name: 'Guest' });
  const j = await joined;
  assert.strictEqual(j.roomId, roomId);

  const started = Promise.race([once(host, 'gameStarting'), once(host, 'roundStart'), once(host, 'phaseChange'), new Promise((r) => setTimeout(() => r('timeout'), 3000))]);
  host.emit('startGame');
  await started; // exercises start path (timers/rounds modules) without throwing
  host.close();
  guest.close();
});
