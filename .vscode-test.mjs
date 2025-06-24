import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  mocha: {
    // ci is *really* slow
    timeout: 120_000
  },
  files: 'src/out/test/**/*.test.js'
});
