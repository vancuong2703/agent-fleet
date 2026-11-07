import './test/helpers/hidden-fork-setup.js';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/helpers/hidden-fork-setup.ts'],
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'test/e2e/**'],
  },
});
