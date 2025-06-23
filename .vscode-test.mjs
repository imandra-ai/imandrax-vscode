import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  mocha: {
    timeout: 40_000
  },
  files: 'src/out/test/**/*.test.js',
});
