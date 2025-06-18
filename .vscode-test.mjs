import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  mocha: {
    timeout: 100_000
  },
  files: 'src/out/test/**/*.test.js',
  workspaceFolder: 'src/test'
});
