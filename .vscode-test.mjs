import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  mocha: {
    timeout: 25_000
  },
  files: 'src/out/test/**/*.test.js',
});
