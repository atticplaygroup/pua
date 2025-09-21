import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    testTimeout: 30_000,
    // setupFiles: ['./vitest.setup.ts'],
    pool: 'forks',
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
