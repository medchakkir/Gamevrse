const globals = require('globals');

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
    files: ['public/games/blackjack/js/**/*.js'],
    languageOptions: { sourceType: 'module' },
  },
];
