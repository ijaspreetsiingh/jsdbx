// =====================================================
// JSDB - Test Setup
// =====================================================
import { vi } from 'vitest';

// Silence logger during tests
vi.mock('../src/utils/logger.ts', () => ({
  createLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
    setLevel: () => {},
  }),
  getLogger: () => ({
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  }),
  setLogger: () => {},
  silentLogger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
  JSDBLogger: class {
    debug() {}
    info() {}
    warn() {}
    error() {}
    child() { return this; }
    setLevel() {}
  },
}));
