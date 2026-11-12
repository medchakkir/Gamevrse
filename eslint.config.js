const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**'] },
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2023, globals: globals.node },
    rules: { 'no-undef': 'error' },
  },
  {
    // Pre-existing undefined references (latent bugs); tracked as warnings until fixed.
    files: ['src/games/colorrush/index.js', 'src/games/rankly/rankingService.js'],
    rules: { 'no-undef': 'warn' },
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
    files: ['public/games/rankly/client.js', 'public/games/colorrush/client.js'],
    rules: { 'no-undef': 'warn' },
  },
  {
    files: ['public/games/blackjack/js/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
];
