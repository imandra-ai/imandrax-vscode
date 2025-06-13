import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'src/out/test/**/*.test.js',
});
