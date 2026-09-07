// =====================================================
// JSDB - Real-time Module Unit Tests
// =====================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PollingChangeListener, RealtimeManager } from '../../src/realtime/index.js';

describe('PollingChangeListener', () => {
  let executeQuery: ReturnType<typeof vi.fn>;
  let listener: PollingChangeListener;

  beforeEach(() => {
    executeQuery = vi.fn().mockResolvedValue([]);
    listener = new PollingChangeListener(executeQuery, 100);
  });

  it('should create change tracking table on start', async () => {
    await listener.start();
    expect(executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS _jsdb_changes')
    );
  });

  it('should subscribe to changes', () => {
    const callback = vi.fn();
    const id = listener.subscribe('orders', callback);
    expect(id).toBeDefined();
    expect(typeof id).toBe('string');
  });

  it('should unsubscribe from changes', () => {
    const callback = vi.fn();
    const id = listener.subscribe('orders', callback);
    listener.unsubscribe(id);
    // No error should occur
  });
});

describe('RealtimeManager', () => {
  it('should register and use listeners', async () => {
    const manager = new RealtimeManager();
    const executeQuery = vi.fn().mockResolvedValue([]);
    const listener = new PollingChangeListener(executeQuery, 100);

    manager.registerListener('mysql', listener);
    expect(manager).toBeDefined();
  });

  it('should throw for unregistered database type', async () => {
    const manager = new RealtimeManager();
    const callback = vi.fn();

    await expect(
      manager.watch('unknown', 'orders', callback)
    ).rejects.toThrow('No change listener registered');
  });
});
