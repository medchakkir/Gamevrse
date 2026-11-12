// Shared input validators for socket payloads (CommonJS; importable from ESM too).

// Modeled on Blackjack's setName: trim, strip angle brackets, cap length.
// Non-strings yield '' so callers can fall back to a default name.
function cleanName(str, max = 20) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, max)
    .trim();
}

// Accepts only #rgb or #rrggbb; anything else gets the fallback.
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
function cleanHexColor(value, fallback) {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}

module.exports = { cleanName, cleanHexColor };
