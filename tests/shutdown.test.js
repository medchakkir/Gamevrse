const test = require('node:test');
const assert = require('node:assert');
const { io: connect } = require('socket.io-client');
const timers = require('../src/shared/timers');
const { createApp } = require('../src/server');
const { createRegistry } = require('../src/games/registry');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('timers: tracked timeouts/intervals can be cleared by label prefix', async () => {
  let fired = 0;
  timers.clearTimers(); // start clean
  timers.safeTimeout('x/a', () => fired++, 30);
  timers.safeInterval('x/b', () => fired++, 10);
  const keep = timers.safeTimeout('y/c', () => fired++, 30);
  assert.strictEqual(timers.activeTimerCount('x/'), 2);
  assert.strictEqual(timers.activeTimerCount(), 3);
  assert.strictEqual(timers.clearTimers('x/'), 2);
  assert.strictEqual(timers.activeTimerCount('x/'), 0);
  await sleep(80);
  assert.strictEqual(fired, 1, 'only the y/ timer fired');
  assert.ok(keep);
  assert.strictEqual(timers.activeTimerCount(), 0, 'fired timeouts are no longer tracked');
});

test('timers: still return a raw handle and callbacks stay error-guarded', async () => {
  const h = timers.safeTimeout('z/err', () => {
    throw new Error('boom');
  }, 5);
  assert.strictEqual(typeof h.ref, 'function');
  const origErr = console.error;
  let logged = 0;
  console.error = () => logged++;
  await sleep(40);
  console.error = origErr;
  assert.strictEqual(logged, 1);
  const h2 = timers.safeTimeout('z/cleared', () => assert.fail('should not run'), 20);
  clearTimeout(h2); // games clear their own handles directly
  await sleep(50);
});

test('registry.shutdownAll calls each game shutdown and survives a throwing one', async () => {
  const r = createRegistry();
  const calls = [];
  const mk = (id, shutdown) => ({ id, name: id, version: '1.0.0', config: { minPlayers: 1, maxPlayers: null, supportsSpectators: false }, attach() {}, shutdown });
  r.register(mk('a', () => calls.push('a')));
  r.register(mk('b', () => { throw new Error('bad'); }));
  r.register(mk('c', undefined));
  r.register(mk('d', async () => calls.push('d')));
  const origErr = console.error;
  console.error = () => {};
  await r.shutdownAll();
  console.error = origErr;
  assert.deepStrictEqual(calls, ['a', 'd']);
});

test('createApp().shutdown: stops listening, disconnects clients, clears game timers, is idempotent', async () => {
  const { server, shutdown } = await createApp();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const s = connect(`http://localhost:${port}/blackjack`, { transports: ['websocket'] });
  await new Promise((res, rej) => { s.on('connect', res); s.on('connect_error', rej); });
  const created = new Promise((r) => s.once('roomJoined', r));
  s.emit('createRoom');
  await created;
  assert.ok(timers.activeTimerCount('blackjack/') > 0, 'blackjack has recurring timers while running');

  const disconnected = new Promise((r) => s.once('disconnect', r));
  await shutdown();
  await disconnected;

  assert.strictEqual(timers.activeTimerCount(), 0, 'no tracked timers remain');
  assert.strictEqual(server.listening, false);
  await assert.rejects(() => fetch(`http://localhost:${port}/healthz`));
  await shutdown(); // second call is a no-op
  s.close();
});
