// Characterization tests for the ColorRush namespace: they pin CURRENT lobby, host,
// kick, settings and cleanup behaviour so the game can move onto the game registry
// (and later onto shared room services) without silently changing it.
const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../src/server');
const crRooms = require('../src/games/colorrush/rooms').rooms;

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
    const s = connect(`${base}/colorrush`, { transports: ['websocket'] });
    open.push(s);
    s.lastRoomState = null;
    s.on('roomState', (st) => (s.lastRoomState = st));
    s.on('connect', () => res(s));
    s.on('connect_error', rej);
  });
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
const stateWhere = (s, pred, ms = 2000) =>
  new Promise((res, rej) => {
    if (s.lastRoomState && pred(s.lastRoomState)) return res(s.lastRoomState);
    const t = setTimeout(() => rej(new Error('timeout waiting for roomState')), ms);
    const h = (st) => {
      if (pred(st)) {
        clearTimeout(t);
        s.off('roomState', h);
        res(st);
      }
    };
    s.on('roomState', h);
  });

async function makeRoom(name = 'Host', options = {}) {
  const host = await client();
  const created = once(host, 'roomCreated');
  host.emit('createRoom', { name, options });
  const info = await created;
  return { host, roomId: info.roomId, info };
}
async function addGuest(roomId, name) {
  const g = await client();
  const joined = once(g, 'roomJoined');
  g.emit('joinRoom', { roomId, name });
  return { g, info: await joined };
}

test('createRoom: 6-char code, creator is host, default settings, phase lobby', async () => {
  const { host, roomId, info } = await makeRoom('Alice');
  const youAreHost = once(host, 'youAreHost').catch(() => null);
  assert.match(roomId, /^[A-Z0-9]{6}$/);
  assert.strictEqual(info.isHost, true);
  assert.strictEqual(info.hostId, host.id);
  assert.strictEqual(info.phase, 'lobby');
  assert.deepStrictEqual(info.settings, { maxPlayers: 6, maxRounds: 15, powerUpsEnabled: true });
  assert.strictEqual(info.players.length, 1);
  assert.strictEqual(info.players[0].name, 'Alice');
  assert.strictEqual(info.players[0].lives, 2);
  assert.ok(crRooms[roomId]);
  void youAreHost;
});

test('createRoom: name is cleaned (<> stripped, capped at 20); empty name gets a default', async () => {
  const a = await makeRoom('<b>' + 'n'.repeat(40));
  assert.strictEqual(a.info.players[0].name, 'b' + 'n'.repeat(19));
  const b = await makeRoom('');
  assert.match(b.info.players[0].name, /^Player-/);
});

test('joinRoom: invalid format, wrong length and unknown code produce joinError', async () => {
  const s = await client();
  for (const [payload, msg] of [
    [{ roomId: 5, name: 'x' }, 'Invalid room code format'],
    [{ roomId: 'ABC', name: 'x' }, 'Room code must be 6 characters'],
    [{ roomId: 'ZZZZZZ', name: 'x' }, 'Room not found. It may have expired or the server restarted.'],
  ]) {
    const err = once(s, 'joinError');
    s.emit('joinRoom', payload);
    assert.strictEqual(await err, msg);
  }
});

test('joinRoom: code is trimmed and case-insensitive; joiner and host both see the new player', async () => {
  const { host, roomId } = await makeRoom('Host');
  const g = await client();
  const joined = once(g, 'roomJoined');
  g.emit('joinRoom', { roomId: ` ${roomId.toLowerCase()} `, name: 'Guest' });
  const info = await joined;
  assert.strictEqual(info.roomId, roomId);
  assert.strictEqual(info.isHost, false);
  assert.strictEqual(info.hostId, host.id);
  const st = await stateWhere(host, (s) => s.players.length === 2);
  assert.deepStrictEqual(st.players.map((p) => p.name).sort(), ['Guest', 'Host']);
});

test('joinRoom: joining the same room twice is rejected', async () => {
  const { roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  const err = once(g, 'joinError');
  g.emit('joinRoom', { roomId, name: 'Guest' });
  assert.strictEqual(await err, 'You are already in this room');
});

test('joinRoom: a full room rejects further players (maxPlayers set via updateGameSettings)', async () => {
  const { host, roomId } = await makeRoom();
  await addGuest(roomId, 'Guest');
  await stateWhere(host, (s) => s.players.length === 2);
  host.emit('updateGameSettings', { maxPlayers: 2 });
  await stateWhere(host, (s) => s.settings.maxPlayers === 2);
  const third = await client();
  const err = once(third, 'joinError');
  third.emit('joinRoom', { roomId, name: 'Third' });
  assert.strictEqual(await err, 'Room is full');
});

test('updateGameSettings: host-only, lobby-only, and range-validated', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');

  let err = once(g, 'settingsUpdateError');
  g.emit('updateGameSettings', { maxPlayers: 3 });
  assert.strictEqual(await err, 'Only host can update settings');

  for (const [settings, msg] of [
    [{ maxPlayers: 1 }, 'Max players must be between 2 and 6'],
    [{ maxPlayers: 7 }, 'Max players must be between 2 and 6'],
    [{ maxRounds: 14 }, 'Max rounds must be between 15 and 30'],
    [{ maxRounds: 31 }, 'Max rounds must be between 15 and 30'],
  ]) {
    err = once(host, 'settingsUpdateError');
    host.emit('updateGameSettings', settings);
    assert.strictEqual(await err, msg);
  }

  host.emit('updateGameSettings', { maxRounds: 20, maxPlayers: 4 });
  const st = await stateWhere(host, (s) => s.settings.maxRounds === 20);
  assert.strictEqual(st.settings.maxRounds, 20);
  assert.strictEqual(st.settings.maxPlayers, 4);
  assert.strictEqual(crRooms[roomId].settings.maxRounds, 20);
});

test('startGame: needs 2 players; only the host may start', async () => {
  const { host, roomId } = await makeRoom();
  const err = once(host, 'gameStartError');
  host.emit('startGame');
  assert.strictEqual(await err, 'Need at least 2 players to start');

  const { g } = await addGuest(roomId, 'Guest');
  g.emit('startGame'); // non-host: silently ignored
  await sleep(200);
  assert.strictEqual(crRooms[roomId].startRequested, false);
  assert.strictEqual(crRooms[roomId].phase, 'lobby');
});

test('start: host start + guest ready begins the game; late joiners are rejected', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  g.emit('toggleReady');
  await stateWhere(host, (s) => s.players.find((p) => p.name === 'Guest')?.isReady === true);
  const phase = once(host, 'phaseChange', 3000);
  host.emit('startGame');
  assert.deepStrictEqual(await phase, { phase: 'game', roomId });
  assert.strictEqual(crRooms[roomId].gameStarted, true);

  const late = await client();
  const err = once(late, 'joinError');
  late.emit('joinRoom', { roomId, name: 'Late' });
  assert.strictEqual(await err, 'Game is already in progress');
});

test('toggleReady flips the caller\'s lobby ready flag', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  g.emit('toggleReady');
  await stateWhere(host, (s) => s.players.find((p) => p.name === 'Guest')?.isReady === true);
  g.emit('toggleReady');
  await stateWhere(host, (s) => s.players.find((p) => p.name === 'Guest')?.isReady === false);
  assert.ok(crRooms[roomId]);
});

test('kickPlayer: host removes a player; non-host, self and unknown targets are ignored', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  const { g: h } = await addGuest(roomId, 'Third');
  await stateWhere(host, (s) => s.players.length === 3);

  g.emit('kickPlayer', { playerId: h.id }); // non-host
  host.emit('kickPlayer', { playerId: host.id }); // self
  host.emit('kickPlayer', { playerId: 'nobody' });
  await sleep(200);
  assert.strictEqual(Object.keys(crRooms[roomId].players).length, 3);

  const kicked = once(g, 'kicked');
  host.emit('kickPlayer', { playerId: g.id });
  assert.deepStrictEqual(await kicked, { message: 'You were removed from the room by the host.' });
  const st = await stateWhere(host, (s) => s.players.length === 2);
  assert.ok(!st.players.some((p) => p.id === g.id));
  // Unlike Blackjack, ColorRush keeps no ban list: a kicked player may rejoin.
  const rejoined = once(g, 'roomJoined');
  g.emit('joinRoom', { roomId, name: 'Guest' });
  assert.strictEqual((await rejoined).roomId, roomId);
});

test('leaveRoom: host leaving transfers host to the next player; last leaver deletes the room', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  const newHost = once(g, 'youAreHost');
  host.emit('leaveRoom');
  await newHost;
  const st = await stateWhere(g, (s) => s.players.length === 1);
  assert.strictEqual(st.hostId, g.id);
  g.emit('leaveRoom');
  await sleep(200);
  assert.strictEqual(crRooms[roomId], undefined);
});

test('disconnect: host disconnect in the lobby transfers host; last disconnect deletes the room', async () => {
  const { host, roomId } = await makeRoom();
  const { g } = await addGuest(roomId, 'Guest');
  const newHost = once(g, 'youAreHost');
  host.close();
  await newHost;
  assert.strictEqual(crRooms[roomId].hostId, g.id);
  g.close();
  await sleep(300);
  assert.strictEqual(crRooms[roomId], undefined);
});

test('chat: messages reach only the room', async () => {
  const a = await makeRoom('A');
  const b = await makeRoom('B');
  const got = once(a.host, 'chatMessage');
  let leaked = false;
  b.host.on('chatMessage', () => (leaked = true));
  a.host.emit('chatMessage', 'hello');
  assert.strictEqual((await got).text, 'hello');
  await sleep(150);
  assert.strictEqual(leaked, false);
  assert.strictEqual(await quiet(b.host, 'chatMessage', 100), true);
});
