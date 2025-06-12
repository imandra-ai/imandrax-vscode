const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig([{
  files: 'src/out/test/**/*.test.js', mocha: {
    ui: 'tdd',
    timeout: 20_000
  }
}]);
