// Vitest config for JSDB compatibility matrix tests
// Runs all input-driver × target-database cells in-process
// against the MemoryAdapter (no external services needed).
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/compat/matrix/**/*.proof.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Each describe block manages its own MemoryAdapter instance.
    // Run sequentially to avoid shared-state interference from
    // the singleton setSharedAdapter/resetSharedAdapter pattern.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@jsdb': resolve(__dirname, 'src'),
    },
  },
});
