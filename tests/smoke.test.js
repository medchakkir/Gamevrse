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

test('blackjack: create a room, join it, and set a name', async () => {
  const open = () =>
    new Promise((res, rej) => {
      const s = connect(`${base}/blackjack`, { transports: ['websocket'] });
      s.on('connect', () => res(s));
      s.on('connect_error', rej);
    });
  const once = (s, ev) => new Promise((res) => s.once(ev, res));

  const host = await open();
  const guest = await open();
  const created = once(host, 'roomJoined');
  host.emit('createRoom');
  const { roomCode } = await created;
  assert.strictEqual(roomCode.length, 6);

  const joined = once(guest, 'roomJoined');
  guest.emit('joinRoom', roomCode);
  assert.strictEqual((await joined).roomCode, roomCode);

  const state = once(host, 'state');
  guest.emit('setName', 'Guest');
  const s = await state;
  assert.strictEqual(s.players.length, 2);
  host.close();
  guest.close();
});

const openSocket = (ns) =>
  new Promise((res, rej) => {
    const s = connect(`${base}/${ns}`, { transports: ['websocket'] });
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
const nextEvent = (s, ev, ms = 400) =>
  new Promise((res) => {
    const t = setTimeout(() => res(null), ms);
    s.once(ev, (data) => {
      clearTimeout(t);
      res(data);
    });
  });

test('rankly: chat from a socket outside the room is not broadcast', async () => {
  const host = await openSocket('rankly');
  const outsider = await openSocket('rankly');
  const { roomId } = await new Promise((r) => host.emit('create_room', { name: 'Host' }, r));

  const received = nextEvent(host, 'chat_message_broadcast');
  outsider.emit('chat_message', { roomId, name: 'Intruder', text: 'hello' });
  assert.strictEqual(await received, null);
  host.close();
  outsider.close();
});

test('rankly: spoofed chat name is replaced with the real player name', async () => {
  const host = await openSocket('rankly');
  const { roomId } = await new Promise((r) => host.emit('create_room', { name: 'RealHost' }, r));

  const received = nextEvent(host, 'chat_message_broadcast', 2000);
  host.emit('chat_message', { roomId, name: 'Admin', text: '  hi  ' });
  const msg = await received;
  assert.strictEqual(msg.name, 'RealHost');
  assert.strictEqual(msg.text, 'hi');
  host.close();
});

test('colorrush: over-long chat message is truncated to 200 characters', async () => {
  const host = await openSocket('colorrush');
  const created = new Promise((r) => host.once('roomCreated', r));
  host.emit('createRoom', { name: 'Host', options: {} });
  await created;

  const received = nextEvent(host, 'chatMessage', 2000);
  host.emit('chatMessage', 'x'.repeat(500));
  const msg = await received;
  assert.strictEqual(msg.text.length, 200);
  host.close();
});

// ---- Hardening: malformed payloads must never take the server down ----
const MAIN_EVENTS = {
  colorrush: ['createRoom', 'joinRoom', 'registerName', 'updateGameSettings', 'kickPlayer', 'submitSequence', 'activatePatternPeek', 'chatMessage'],
  rankly: ['create_room', 'join_room', 'leave_room', 'close_room', 'kick_player', 'toggle_ready', 'update_avatar', 'submit_answer', 'start_game', 'submit_rank', 'chat_message', 'attempt_reconnect'],
  blackjack: ['createRoom', 'joinRoom', 'identify', 'setName', 'createPracticeRoom', 'setEliminationMode', 'submitRouletteChoice', 'spectatorReaction', 'kickPlayer', 'unbanPlayer'],
};

for (const [ns, events] of Object.entries(MAIN_EVENTS)) {
  test(`${ns}: malformed payloads (none, null, string) do not crash the server`, async () => {
    const uncaught = [];
    const onUncaught = (err) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);
    process.on('unhandledRejection', onUncaught);
    const s = await openSocket(ns);
    for (const ev of events) {
      s.emit(ev);
      s.emit(ev, null);
      s.emit(ev, 'garbage');
      s.emit(ev, null, null); // callback slot not a function
      s.emit(ev, 'garbage', 'not-a-function');
    }
    await new Promise((r) => setTimeout(r, 300));
    process.off('uncaughtException', onUncaught);
    process.off('unhandledRejection', onUncaught);
    assert.deepStrictEqual(
      uncaught.map((e) => e?.message),
      [],
      'handlers must not throw'
    );
    const fresh = await openSocket(ns); // server still accepts connections
    fresh.close();
    s.close();
    const res = await fetch(`${base}/healthz`);
    assert.deepStrictEqual(await res.json(), { ok: true });
  });
}

test('colorrush: 500-character name is capped at 20', async () => {
  const s = await openSocket('colorrush');
  const created = new Promise((r) => s.once('roomCreated', r));
  s.emit('createRoom', { name: 'n'.repeat(500), options: {} });
  const msg = await created;
  const state = JSON.stringify(msg);
  assert.ok(!state.includes('n'.repeat(21)), 'name must be capped');
  assert.ok(state.includes('n'.repeat(20)));
  s.close();
});

test('rankly: 500-character name is capped and bad avatar colors are replaced', async () => {
  const s = await openSocket('rankly');
  const res = await new Promise((r) =>
    s.emit('create_room', { name: 'n'.repeat(500), avatarColor: 'url(javascript:alert(1))', avatarTextColor: '#12' }, r)
  );
  assert.strictEqual(res.ok, true);
  const me = res.players[0];
  assert.strictEqual(me.name.length, 20);
  assert.strictEqual(me.avatarColor, '#4d73ff');
  assert.strictEqual(me.avatarTextColor, '#ffffff');

  const good = await new Promise((r) => {
    const j = openSocket('rankly').then((g) => {
      g.emit('join_room', { roomId: res.roomId, name: 'G', avatarColor: '#abc', avatarTextColor: '#A1B2C3' }, (x) => {
        g.close();
        r(x);
      });
    });
    return j;
  });
  const guest = good.players.find((p) => p.name === 'G');
  assert.strictEqual(guest.avatarColor, '#abc');
  assert.strictEqual(guest.avatarTextColor, '#A1B2C3');
  s.close();
});
