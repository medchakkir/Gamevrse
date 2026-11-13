// Room-code generator shared by games. Always ROOM_CODE_LENGTH characters from
// ROOM_CODE_ALPHABET, drawn from a CSPRNG (crypto.randomInt) so codes are not
// predictable from Math.random's state.
const crypto = require('crypto');

const ROOM_CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ROOM_CODE_LENGTH = 6;

// `isTaken(code)` lets the caller reject codes already in use. Throws after
// `maxAttempts` collisions so callers can report failure instead of looping.
function generateRoomCode(isTaken = () => false, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[crypto.randomInt(ROOM_CODE_ALPHABET.length)];
    if (!isTaken(code)) return code;
  }
  throw new Error('Could not generate a unique room code');
}

module.exports = { generateRoomCode, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH };
