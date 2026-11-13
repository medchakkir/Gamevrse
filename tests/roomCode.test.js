const test = require('node:test');
const assert = require('node:assert');
const { generateRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } = require('../src/shared/roomCode');

test('generateRoomCode: fixed length, restricted alphabet', () => {
  assert.strictEqual(ROOM_CODE_LENGTH, 6);
  for (let i = 0; i < 2000; i++) {
    const c = generateRoomCode();
    assert.strictEqual(c.length, 6);
    assert.match(c, /^[A-Z0-9]{6}$/);
  }
});

test('generateRoomCode: uses the whole alphabet and does not use Math.random', () => {
  const real = Math.random;
  Math.random = () => {
    throw new Error('Math.random must not be used for room codes');
  };
  try {
    const seen = new Set();
    for (let i = 0; i < 4000; i++) for (const ch of generateRoomCode()) seen.add(ch);
    assert.strictEqual(seen.size, ROOM_CODE_ALPHABET.length);
  } finally {
    Math.random = real;
  }
});

test('generateRoomCode: avoids codes already taken', () => {
  const taken = (c) => c.startsWith('A');
  for (let i = 0; i < 500; i++) assert.ok(!generateRoomCode(taken).startsWith('A'));
});

test('generateRoomCode: throws if it cannot find a free code', () => {
  assert.throws(() => generateRoomCode(() => true, 5), /unique room code/);
});
