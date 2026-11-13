const test = require('node:test');
const assert = require('node:assert');
const { validateGameModule } = require('../src/games/game-interface');
const { createRegistry } = require('../src/games/registry');
const blackjack = require('../src/games/blackjack/module');

const good = () => ({
  id: 'demo',
  name: 'Demo',
  version: '1.0.0',
  config: { minPlayers: 2, maxPlayers: 4, supportsSpectators: false },
  attach() {},
});

test('blackjack descriptor satisfies the contract', () => {
  assert.deepStrictEqual(validateGameModule(blackjack), []);
  assert.strictEqual(blackjack.id, 'blackjack');
  assert.strictEqual(typeof blackjack.listRooms(), 'object');
});

test('validateGameModule rejects each malformed field', () => {
  assert.ok(validateGameModule(null).length);
  const cases = [
    { id: 'Bad Id' },
    { id: 5 },
    { name: '' },
    { version: 'one' },
    { config: null },
    { config: { minPlayers: 0, maxPlayers: 2, supportsSpectators: true } },
    { config: { minPlayers: 3, maxPlayers: 2, supportsSpectators: true } },
    { config: { minPlayers: 2, maxPlayers: 2, supportsSpectators: 'yes' } },
    { attach: undefined },
    { listRooms: 'nope' },
    { shutdown: 1 },
  ];
  for (const patch of cases) {
    assert.ok(validateGameModule({ ...good(), ...patch }).length > 0, JSON.stringify(patch));
  }
  assert.deepStrictEqual(validateGameModule(good()), []);
  assert.deepStrictEqual(validateGameModule({ ...good(), config: { minPlayers: 2, maxPlayers: null, supportsSpectators: true } }), []);
});

test('registry: register validates, rejects duplicates, lists and gets', () => {
  const r = createRegistry();
  assert.throws(() => r.register({ id: 'x' }), /Invalid game module "x"/);
  r.register(good());
  assert.throws(() => r.register(good()), /already registered/);
  assert.strictEqual(r.get('demo').name, 'Demo');
  assert.deepStrictEqual(r.list().map((g) => g.id), ['demo']);
});

test('registry: attach runs prepare, then the module on namespace /<id>', async () => {
  const r = createRegistry();
  const calls = [];
  r.register({ ...good(), attach: async (nsp, app) => calls.push(['attach', nsp.name, app]) });
  const io = { of: (n) => ({ name: n }) };
  await r.attach('demo', io, 'APP', (nsp) => calls.push(['prepare', nsp.name]));
  assert.deepStrictEqual(calls, [['prepare', '/demo'], ['attach', '/demo', 'APP']]);
  await assert.rejects(() => r.attach('missing', io, null), /Unknown game/);
});
