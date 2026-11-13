// Characterization tests for the Rankly namespace (wire level only: Rankly keeps its
// room state private to its module). They pin CURRENT lobby, host, kick, ready,
// start-validation and reconnection behaviour so Rankly can move onto the game
// registry without silently changing it.
const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../src/server');

let server, shutdown, base;
const open = [];

test.before(async () => {
  ({ server, shutdown } = await createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(async () => {
  for (const s of open) s.close();
  await shutdown();
});

const client = () =>
  new Promise((res, rej) => {
    const s = connect(`${base}/rankly`, { transports: ['websocket'] });
    open.push(s);
    s.lastUpdate = null;
    s.on('room_update', (u) => (s.lastUpdate = u));
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
const ack = (s, ev, payload) => new Promise((res) => s.emit(ev, payload, res));
const once = (s, ev, ms = 2000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms);
    s.once(ev, (d) => {
      clearTimeout(t);
      res(d);
    });
  });
const quiet = (s, ev, ms = 300) =>
  new Promise((res) => {
    const t = setTimeout(() => res(true), ms);
    s.once(ev, () => {
      clearTimeout(t);
      res(false);
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const updateWhere = (s, pred, ms = 2000) =>
  new Promise((res, rej) => {
    if (s.lastUpdate && pred(s.lastUpdate)) return res(s.lastUpdate);
    const t = setTimeout(() => rej(new Error('timeout waiting for room_update')), ms);
    const h = (u) => {
      if (pred(u)) {
        clearTimeout(t);
        s.off('room_update', h);
        res(u);
      }
    };
    s.on('room_update', h);
  });

async function makeRoom(name = 'Host', extra = {}) {
  const host = await client();
  const res = await ack(host, 'create_room', { name, ...extra });
  assert.strictEqual(res.ok, true);
  return { host, roomId: res.roomId, res };
}
async function addGuest(roomId, name) {
  const g = await client();
  const res = await ack(g, 'join_room', { roomId, name });
  return { g, res };
}

test('create_room: ack has room, players, token; creator is host; defaults', async () => {
  const { host, roomId, res } = await makeRoom('Alice');
  assert.match(roomId, /^[A-Z0-9_-]{6}$/);
  assert.strictEqual(res.mode, 'normal');
  assert.strictEqual(res.players.length, 1);
  assert.strictEqual(res.players[0].name, 'Alice');
  assert.strictEqual(res.players[0].socketId, host.id);
  assert.strictEqual(res.room.hostSocketId, host.id);
  assert.strictEqual(res.room.state, 'lobby');
  assert.deepStrictEqual(res.room.rules, { minPlayers: 3, turnTime: 45000, multiplier: 1, numRounds: 5 });
  assert.strictEqual(typeof res.playerToken, 'string');
  assert.strictEqual(res.playerToken.length, 16);
  assert.ok(!('playerToken' in res.players[0]), 'token is not leaked in the player list');
});

test('create_room: mode "custom" is honoured, anything else becomes "normal"', async () => {
  assert.strictEqual((await makeRoom('A', { mode: 'custom' })).res.mode, 'custom');
  assert.strictEqual((await makeRoom('B', { mode: 'weird' })).res.mode, 'normal');
});

test('create_room: a socket already in a room cannot create another', async () => {
  const { host } = await makeRoom();
  const second = await ack(host, 'create_room', { name: 'Again' });
  assert.deepStrictEqual(second, { ok: false, error: 'already_in_room' });
});

test('join_room: unknown room, already in a room, and success with room_update broadcast', async () => {
  const { host, roomId } = await makeRoom('Host');
  const nf = await ack(await client(), 'join_room', { roomId: 'NOPE00', name: 'x' });
  assert.deepStrictEqual(nf, { ok: false, error: 'Room not found' });

  const { g, res } = await addGuest(roomId, 'Guest');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.players.length, 2);
  assert.strictEqual(res.room.hostSocketId, host.id);
  assert.strictEqual(res.playerToken.length, 16);
  const u = await updateWhere(host, (x) => x.players.length === 2);
  assert.deepStrictEqual(u.players.map((p) => p.name).sort(), ['Guest', 'Host']);

  assert.deepStrictEqual(await ack(g, 'join_room', { roomId, name: 'Guest' }), { ok: false, error: 'already_in_room' });
});

test('join_room: names are cleaned and bad avatar colours replaced', async () => {
  const { roomId } = await makeRoom();
  const { res } = await addGuest(roomId, '<i>' + 'z'.repeat(40));
  const me = res.players.find((p) => p.name.startsWith('i'));
  assert.strictEqual(me.name, 'i' + 'z'.repeat(19));
  const g = await client();
  const r2 = await ack(g, 'join_room', { roomId, name: 'Colors', avatarColor: 'red', avatarTextColor: '#12' });
  const me2 = r2.players.find((p) => p.name === 'Colors');
  assert.strictEqual(me2.avatarColor, '#4d73ff');
  assert.strictEqual(me2.avatarTextColor, '#ffffff');
});

test('toggle_ready: guests can ready; the host cannot; ready_count_update excludes the host', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  const count = once(host, 'ready_count_update');
  g.emit('toggle_ready', { roomId, ready: true });
  assert.deepStrictEqual(await count, { ready: 1, total: 1 });
  await updateWhere(host, (u) => u.players.find((p) => p.name === 'Guest')?.ready === true);

  host.emit('toggle_ready', { roomId, ready: true });
  assert.strictEqual(await quiet(host, 'ready_count_update'), true, 'host toggle_ready is ignored');
});

test('update_avatar: updates in the lobby and broadcasts', async () => {
  const { host, roomId } = await makeRoom();
  host.emit('update_avatar', { roomId, avatarColor: '#112233', avatarTextColor: '#fff' });
  const u = await updateWhere(host, (x) => x.players[0].avatarColor === '#112233');
  assert.strictEqual(u.players[0].avatarTextColor, '#fff');
});

test('leave_room: not-in-room is reported; leaving emits left_room and updates the others', async () => {
  const { host, roomId } = await makeRoom();
  const stranger = await client();
  const bad = once(stranger, 'left_room');
  stranger.emit('leave_room', { roomId });
  assert.deepStrictEqual(await bad, { ok: false, error: 'not_in_room' });

  const { g } = await addGuest(roomId, 'Guest');
  await updateWhere(host, (u) => u.players.length === 2);
  const left = once(g, 'left_room');
  g.emit('leave_room', { roomId });
  assert.deepStrictEqual(await left, { ok: true, roomId });
  await updateWhere(host, (u) => u.players.length === 1);
});

test('leave_room: host leaving promotes the remaining player; last leaver deletes the room', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  await updateWhere(g, (u) => u.players.length === 2);
  host.emit('leave_room', { roomId });
  const u = await updateWhere(g, (x) => x.players.length === 1 && x.hostSocketId === g.id);
  assert.strictEqual(u.hostSocketId, g.id);

  g.emit('leave_room', { roomId });
  await sleep(200);
  const late = await ack(await client(), 'join_room', { roomId, name: 'Late' });
  assert.deepStrictEqual(late, { ok: false, error: 'Room not found' });
});

test('kick_player: host removes a guest; non-host, self and unknown targets are ignored', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  const { g: h } = await addGuest(roomId, 'Third');
  await updateWhere(host, (u) => u.players.length === 3);

  let changed = false;
  host.on('room_update', (u) => u.players.length !== 3 && (changed = true));
  g.emit('kick_player', { roomId, targetSocketId: h.id }); // non-host
  host.emit('kick_player', { roomId, targetSocketId: host.id }); // self
  host.emit('kick_player', { roomId, targetSocketId: 'nobody' });
  await sleep(250);
  assert.strictEqual(changed, false);

  const kicked = once(g, 'kicked_from_room');
  const left = once(g, 'left_room');
  host.emit('kick_player', { roomId, targetSocketId: g.id });
  assert.deepStrictEqual(await kicked, { reason: 'You were kicked from the room by the host.' });
  assert.deepStrictEqual(await left, { ok: true, roomId });
  await updateWhere(host, (u) => u.players.length === 2 && !u.players.some((p) => p.socketId === g.id));
  // No ban list: the kicked player can rejoin.
  assert.strictEqual((await ack(g, 'join_room', { roomId, name: 'Guest' })).ok, true);
});

test('close_room: host-only; members get room_closed and the room is gone', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  g.emit('close_room', { roomId });
  assert.strictEqual(await quiet(host, 'room_closed'), true, 'non-host cannot close');

  const closed = once(g, 'room_closed');
  host.emit('close_room', { roomId });
  assert.deepStrictEqual(await closed, { reason: 'host_closed' });
  await sleep(100);
  assert.deepStrictEqual(await ack(await client(), 'join_room', { roomId, name: 'x' }), { ok: false, error: 'Room not found' });
});

test('start_game: host-only; numRounds is validated; custom mode validates the question list', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  const base = { roomId, minPlayers: 3, turnTime: 30000, multiplier: 1 };

  g.emit('start_game', { ...base, numRounds: 3 });
  assert.strictEqual(await quiet(host, 'start_countdown'), true, 'non-host cannot start');

  for (const numRounds of [0, -1, 21, undefined]) {
    const err = once(host, 'start_error');
    host.emit('start_game', { ...base, numRounds });
    assert.deepStrictEqual(await err, { error: 'invalid_num_rounds' }, String(numRounds));
  }

  const c = await makeRoom('CustomHost', { mode: 'custom' });
  const err = once(c.host, 'start_error');
  c.host.emit('start_game', { roomId: c.roomId, minPlayers: 3, turnTime: 30000, multiplier: 1, numRounds: 3, customQuestions: ['only one'] });
  assert.deepStrictEqual(await err, { error: 'invalid_custom_questions' });
});

test('start_game: normal mode with valid settings begins the start countdown', async () => {
  const { host, roomId } = await makeRoom();
  await addGuest(roomId, 'A');
  await addGuest(roomId, 'B');
  const countdown = once(host, 'start_countdown');
  host.emit('start_game', { roomId, minPlayers: 3, turnTime: 30000, multiplier: 1, numRounds: 3 });
  const c = await countdown;
  assert.ok(c && typeof c === 'object');
  const u = await updateWhere(host, (x) => x.players.find((p) => p.socketId === host.id)?.ready === true);
  assert.ok(u, 'host is marked ready when starting');
});

test('reconnect: a dropped player can return with roomId + playerToken on a new socket', async () => {
  const { host, roomId } = await makeRoom();
  const { g, res } = await addGuest(roomId, 'Guest');
  const token = res.playerToken;
  await updateWhere(host, (u) => u.players.length === 2);
  g.close();
  await updateWhere(host, (u) => u.players.length === 1); // only connected players are listed

  const g2 = await client();
  const snapshot = once(g2, 'reconnect_state');
  const result = await ack(g2, 'attempt_reconnect', { roomId, playerToken: token });
  assert.strictEqual(result.ok, true);
  await snapshot;
  const u = await updateWhere(host, (x) => x.players.length === 2);
  assert.ok(u.players.some((p) => p.socketId === g2.id && p.name === 'Guest'));
});

test('reconnect: wrong room, wrong token, and non-string payloads are rejected', async () => {
  const { roomId, res } = await makeRoom();
  const s = await client();
  assert.deepStrictEqual(await ack(s, 'attempt_reconnect', { roomId: 'NOPE00', playerToken: res.playerToken }), { ok: false, error: 'room_not_found' });
  assert.deepStrictEqual(await ack(s, 'attempt_reconnect', { roomId, playerToken: 'wrong' }), { ok: false, error: 'invalid_token' });
  assert.deepStrictEqual(await ack(s, 'attempt_reconnect', { roomId, playerToken: 12345 }), { ok: false, error: 'invalid_token' });
  assert.deepStrictEqual(await ack(s, 'attempt_reconnect', null), { ok: false, error: 'room_not_found' });
});

test('reconnect: a token from one room cannot be used in another', async () => {
  const a = await makeRoom('A');
  const b = await makeRoom('B');
  const s = await client();
  assert.deepStrictEqual(await ack(s, 'attempt_reconnect', { roomId: b.roomId, playerToken: a.res.playerToken }), { ok: false, error: 'invalid_token' });
});

test('chat: messages stay inside the room', async () => {
  const a = await makeRoom('A');
  const b = await makeRoom('B');
  let leaked = false;
  b.host.on('chat_message_broadcast', () => (leaked = true));
  const got = once(a.host, 'chat_message_broadcast');
  a.host.emit('chat_message', { roomId: a.roomId, text: 'hello' });
  assert.strictEqual((await got).text, 'hello');
  await sleep(150);
  assert.strictEqual(leaked, false);
});
