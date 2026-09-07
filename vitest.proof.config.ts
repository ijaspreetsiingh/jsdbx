// ================================================================
// Vitest config for JSDB proof tests
//
// Tier 1 (always):  in-memory adapter, no external services
// Tier 2 (Docker):  real MySQL + MongoDB + PostgreSQL
//                   Set PROOF_USE_DOCKER=1 to enable
// ================================================================
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/proof/**/*.proof.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    // Run proof tests sequentially — each file manages its own adapter
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    reporters: ['verbose'],
    env: {
      // Load .env.proof if it exists; variables already in process.env take precedence
    },
  },
  resolve: {
    alias: {
      '@jsdb': resolve(__dirname, 'src'),
    },
  },
});
