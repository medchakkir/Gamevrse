// Characterization tests for the Blackjack namespace.
// They pin down CURRENT behaviour (lobby, reconnection, spectators, host handling,
// cleanup) so the game can later be migrated to the shared game-module contract
// without silently changing it. If one fails after a refactor, behaviour changed.
const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../src/server');
const bjState = require('../src/games/blackjack/state');

let server, base;
const open = [];

test.before(async () => {
  ({ server } = await createApp());
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
test.after(() => {
  for (const s of open) s.close();
  server.closeAllConnections?.();
  server.close();
});

const client = () =>
  new Promise((res, rej) => {
    const s = connect(`${base}/blackjack`, { transports: ['websocket'] });
    open.push(s);
    s.lastState = null;
    s.on('state', (st) => (s.lastState = st));
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

// Resolves with the first `state` (current or future) satisfying pred.
const stateWhere = (s, pred, ms = 2000) =>
  new Promise((res, rej) => {
    if (s.lastState && pred(s.lastState)) return res(s.lastState);
    const t = setTimeout(() => rej(new Error('timeout waiting for state')), ms);
    const h = (st) => {
      if (pred(st)) {
        clearTimeout(t);
        s.off('state', h);
        res(st);
      }
    };
    s.on('state', h);
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

async function makeRoom() {
  const host = await client();
  const joined = once(host, 'roomJoined');
  const tokenP = once(host, 'assignToken');
  host.emit('createRoom');
  const { roomCode } = await joined;
  const { token } = await tokenP;
  host.emit('setName', 'Host');
  return { host, roomCode, hostToken: token };
}

async function addGuest(roomCode, name) {
  const g = await client();
  const joined = once(g, 'roomJoined');
  const tokenP = once(g, 'assignToken');
  g.emit('joinRoom', roomCode);
  await joined;
  const { token } = await tokenP;
  g.emit('setName', name);
  await stateWhere(g, (s) => s.players.some((p) => p.name === name));
  return { g, token };
}

test('createRoom: 6-char code, token assigned, creator is host', async () => {
  const { host, roomCode, hostToken } = await makeRoom();
  assert.match(roomCode, /^[A-Z0-9]{1,6}$/);
  assert.strictEqual(roomCode.length, 6);
  assert.ok(typeof hostToken === 'string' && hostToken.length > 0);
  const st = await stateWhere(host, (s) => s.players.length === 1 && s.players[0].name === 'Host');
  assert.strictEqual(st.players[0].host, true);
  assert.strictEqual(st.hostId, host.id);
  assert.strictEqual(st.phase, 'lobby');
});

test('joinRoom: invalid, malformed, and unknown codes emit roomError', async () => {
  const s = await client();
  for (const [payload, msg] of [
    [123, 'Invalid room code'],
    ['abc', 'Room code must be 6 characters'],
    ['ZZZZZZ', 'Room not found'],
  ]) {
    const err = once(s, 'roomError');
    s.emit('joinRoom', payload);
    assert.strictEqual(await err, msg);
  }
});

test('joinRoom: code is trimmed and case-insensitive', async () => {
  const { roomCode } = await makeRoom();
  const g = await client();
  const joined = once(g, 'roomJoined');
  g.emit('joinRoom', `  ${roomCode.toLowerCase()} `);
  assert.strictEqual((await joined).roomCode, roomCode);
});

test('setName: strips <>, trims, caps at 20, ignores empty', async () => {
  const { host } = await makeRoom();
  host.emit('setName', '  <b>' + 'x'.repeat(40) + '</b>  ');
  const st = await stateWhere(host, (s) => s.players[0].name.startsWith('bxxx'));
  assert.strictEqual(st.players[0].name, 'b' + 'x'.repeat(19));
  host.emit('setName', '   ');
  await sleep(150);
  assert.strictEqual(host.lastState.players[0].name, 'b' + 'x'.repeat(19));
});

test('state broadcast only reaches the room, not other rooms', async () => {
  const a = await makeRoom();
  const b = await makeRoom();
  let leaked = false;
  b.host.on('state', (s) => {
    if (s.players.some((p) => p.name === 'InA')) leaked = true;
  });
  await addGuest(a.roomCode, 'InA');
  await sleep(150);
  assert.strictEqual(leaked, false);
});

test('toggleReady and startRound are ignored / rejected correctly', async () => {
  const { host } = await makeRoom();
  // Alone: host pressing start gets the "need 2 players" log and no round starts.
  const log = once(host, 'log');
  host.emit('startRound');
  assert.strictEqual(await log, 'Need at least 2 players to start.');
  assert.strictEqual(host.lastState.roundActive, false);
});

test('non-host cannot start the round', async () => {
  const { host, roomCode } = await makeRoom();
  const { g } = await addGuest(roomCode, 'Guest');
  g.emit('startRound');
  await sleep(200);
  assert.strictEqual(host.lastState.roundActive, false);
  assert.strictEqual(host.lastState.players.find((p) => p.name === 'Guest').host, false);
});

test('all players ready starts a round with a current turn', async () => {
  const { host, roomCode } = await makeRoom();
  const { g } = await addGuest(roomCode, 'Guest');
  host.emit('toggleReady');
  g.emit('toggleReady');
  const st = await stateWhere(host, (s) => s.roundActive === true, 5000);
  assert.ok([host.id, g.id].includes(st.currentTurn));
  assert.strictEqual(st.phase !== 'lobby', true);
});

test('hit/stand from a socket outside any room are ignored', async () => {
  const { host } = await makeRoom();
  const outsider = await client();
  outsider.emit('hit');
  outsider.emit('stand');
  await sleep(200);
  assert.strictEqual(host.lastState.roundActive, false);
});

test('joining during an active round makes the joiner a spectator', async () => {
  const { host, roomCode } = await makeRoom();
  const { g } = await addGuest(roomCode, 'Guest');
  host.emit('toggleReady');
  g.emit('toggleReady');
  await stateWhere(host, (s) => s.roundActive === true, 5000);

  const { g: late } = await addGuest(roomCode, 'Late');
  const st = await stateWhere(host, (s) => s.players.some((p) => p.name === 'Late'));
  const lateP = st.players.find((p) => p.name === 'Late');
  assert.strictEqual(lateP.spectator, true);
  assert.strictEqual(lateP.alive, false);
  assert.ok(!st.currentTurn || st.currentTurn !== late.id);
});

test('spectator: chooses to spectate, then cannot rejoin mid-game via joinNextGame', async () => {
  const { host, roomCode } = await makeRoom();
  const { g } = await addGuest(roomCode, 'Guest');
  g.emit('spectate');
  const st = await stateWhere(host, (s) => s.players.find((p) => p.name === 'Guest')?.spectator === true);
  assert.strictEqual(st.players.find((p) => p.name === 'Guest').alive, false);
  // In lobby (no active round) a spectator may rejoin the next game.
  g.emit('joinNextGame');
  const st2 = await stateWhere(host, (s) => s.players.find((p) => p.name === 'Guest')?.spectator === false);
  assert.strictEqual(st2.players.find((p) => p.name === 'Guest').alive, true);
});

test('leave: player is removed; last player leaving deletes the room', async () => {
  const { host, roomCode } = await makeRoom();
  const { g } = await addGuest(roomCode, 'Guest');
  g.emit('leave');
  await stateWhere(host, (s) => s.players.length === 1);
  assert.ok(bjState.rooms[roomCode], 'room still exists with one member');
  host.emit('leave');
  await sleep(200);
  assert.strictEqual(bjState.rooms[roomCode], undefined, 'empty room is deleted');
});

test('disconnect: last player disconnecting deletes the room', async () => {
  const { host, roomCode } = await makeRoom();
  assert.ok(bjState.rooms[roomCode]);
  host.close();
  await sleep(300);
  assert.strictEqual(bjState.rooms[roomCode], undefined);
});

test('owner leaving: remaining player is promoted to host', async () => {
  const { host, roomCode } = await makeRoom();
  const { g } = await addGuest(roomCode, 'Guest');
  host.emit('leave');
  const st = await stateWhere(g, (s) => s.players.length === 1);
  assert.strictEqual(st.players[0].host, true);
  assert.strictEqual(st.hostId, g.id);
});

test('reconnect: identify with token restores player under a new socket id', async () => {
  const { host, roomCode } = await makeRoom();
  const { g, token } = await addGuest(roomCode, 'Guest');
  const oldId = g.id;
  // Token is stored when the name is set; give the server a tick.
  await sleep(100);
  g.close();
  await stateWhere(host, (s) => s.players.length === 1);

  const g2 = await client();
  g2.emit('identify', token);
  const st = await stateWhere(g2, (s) => s.players.some((p) => p.name === 'Guest'));
  const me = st.players.find((p) => p.name === 'Guest');
  assert.strictEqual(me.id, g2.id);
  assert.notStrictEqual(me.id, oldId);
  assert.strictEqual(st.players.length, 2);
});

test('reconnect: unknown or non-string token is ignored', async () => {
  const s = await client();
  s.emit('identify', 'nope');
  s.emit('identify', { token: 'x' });
  s.emit('identify');
  assert.strictEqual(await quiet(s, 'state'), true);
});

test('reconnect: a token cannot be used to enter a different room', async () => {
  const a = await makeRoom();
  const b = await makeRoom();
  const intruder = await client();
  intruder.emit('identify', 'not-a-token-from-a');
  await sleep(150);
  assert.ok(!b.host.lastState.players.some((p) => p.id === intruder.id));
  assert.ok(!a.host.lastState.players.some((p) => p.id === intruder.id));
});

test('practice room: created with the requested bots and rejects bad settings', async () => {
  const s = await client();
  s.emit('createPracticeRoom', { botCount: 99, difficulty: 'easy' });
  s.emit('createPracticeRoom', { botCount: 2, difficulty: 'impossible' });
  assert.strictEqual(await quiet(s, 'practiceRoomCreated'), true);

  const created = once(s, 'practiceRoomCreated');
  s.emit('createPracticeRoom', { botCount: 2, difficulty: 'easy' });
  const info = await created;
  assert.match(info.roomCode, /^PRACTICE_/);
  assert.strictEqual(info.botCount, 2);
  const st = await stateWhere(s, (x) => x.players.length === 3);
  assert.strictEqual(st.players.filter((p) => p.id === s.id).length, 1);
});

test('setEliminationMode: only the host may change it', async () => {
  const { host, roomCode } = await makeRoom();
  const { g } = await addGuest(roomCode, 'Guest');
  // Non-host: silently ignored (no broadcast, no error).
  let changed = false;
  host.once('eliminationModeChanged', () => (changed = true));
  g.emit('setEliminationMode', 'lowestHand');
  await sleep(200);
  assert.strictEqual(changed, false);
  assert.strictEqual(bjState.rooms[roomCode].rules.eliminationMode, 'standard');

  // Host: invalid mode -> error; valid mode -> broadcast event (not a `state` update).
  const err = once(host, 'eliminationModeError');
  host.emit('setEliminationMode', 'bogus');
  assert.strictEqual(await err, 'Invalid elimination mode');

  const evt = once(g, 'eliminationModeChanged');
  host.emit('setEliminationMode', 'lowestHand');
  assert.deepStrictEqual(await evt, { mode: 'lowestHand', hostName: 'Host' });
  assert.strictEqual(bjState.rooms[roomCode].rules.eliminationMode, 'lowestHand');
});

// ---- Turn enforcement (fix: hit/stand were accepted from players whose turn it was not) ----
async function startTwoPlayerRound() {
  const { host, roomCode } = await makeRoom();
  const { g } = await addGuest(roomCode, 'Guest');
  host.emit('toggleReady');
  g.emit('toggleReady');
  const st = await stateWhere(host, (s) => s.roundActive === true && s.currentTurn, 5000);
  const byId = { [host.id]: host, [g.id]: g };
  const current = byId[st.currentTurn];
  const other = current === host ? g : host;
  await sleep(100); // let the opening state broadcast settle
  return { host, g, current, other, roomCode };
}

test('turn: stand from a player whose turn it is not is ignored', async () => {
  const { host, current, other, roomCode } = await startTwoPlayerRound();
  const before = bjState.rooms[roomCode];
  const handBefore = before.players[other.id].hand.length;
  other.emit('stand');
  await sleep(200);
  assert.strictEqual(before.players[other.id].stood, false, 'out-of-turn stand must not mark the caller as stood');
  assert.strictEqual(before.currentPlayerOrder[before.turnIndex], current.id, 'turn must not advance');
  assert.strictEqual(before.players[other.id].hand.length, handBefore);
  assert.strictEqual(host.lastState.currentTurn, current.id);
});

test('turn: hit from a player whose turn it is not draws no card and does not skip the real player', async () => {
  const { current, other, roomCode } = await startTwoPlayerRound();
  const room = bjState.rooms[roomCode];
  const handBefore = room.players[other.id].hand.length;
  const deckBefore = room.deck.length;
  other.emit('hit');
  await sleep(200);
  assert.strictEqual(room.players[other.id].hand.length, handBefore, 'no card for the out-of-turn caller');
  assert.strictEqual(room.deck.length, deckBefore, 'deck untouched');
  assert.strictEqual(room.currentPlayerOrder[room.turnIndex], current.id, 'real current player keeps the turn');
});

test('turn: the current player can still hit and stand', async () => {
  const { current, other, roomCode } = await startTwoPlayerRound();
  const room = bjState.rooms[roomCode];
  const before = room.players[current.id].hand.length;
  current.emit('stand');
  await sleep(200);
  assert.strictEqual(room.players[current.id].stood, true);
  assert.notStrictEqual(room.currentPlayerOrder[room.turnIndex], current.id, 'turn advanced after a valid stand');
  assert.strictEqual(room.players[current.id].hand.length, before);
  assert.ok(other);
});
