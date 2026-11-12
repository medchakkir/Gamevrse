const fs = require('fs');
const path = require('path');
const espree = require('espree');
const globals = require('globals');

// Classic scripts share one global scope, so every top-level declaration in a
// directory of split scripts is a global for the others.
function scriptGlobals(dir) {
  const out = {};
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const ast = espree.parse(fs.readFileSync(path.join(dir, f), 'utf8'), { ecmaVersion: 2023, sourceType: 'script' });
    for (const n of ast.body) {
      if (n.type === 'FunctionDeclaration') out[n.id.name] = 'writable';
      else if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.name) out[d.id.name] = 'writable';
    }
  }
  return out;
}

module.exports = [
  { ignores: ['node_modules/**'] },
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: globals.node },
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['src/games/rankly/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', ecmaVersion: 2023, globals: { ...globals.browser, io: 'readonly', confetti: 'readonly', showError: 'readonly', showConfirm: 'readonly' } },
    rules: { 'no-undef': 'error' },
  },
  {
    files: ['public/games/colorrush/js/*.js'],
    languageOptions: {
      globals: { ...globals.browser, io: 'readonly', confetti: 'readonly', showError: 'readonly', showConfirm: 'readonly', ...scriptGlobals('public/games/colorrush/js') },
    },
    rules: { 'no-redeclare': 'off' },
  },
  {
    files: ['public/games/blackjack/js/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
];
