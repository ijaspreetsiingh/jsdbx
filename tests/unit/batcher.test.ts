// =====================================================
// JSDB - Query Batcher Unit Tests
// =====================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryBatcher, BatchExecutor } from '../../src/query/batch.js';
import type { IRNode } from '../../src/ir/nodes.js';

describe('QueryBatcher', () => {
  let executeFn: ReturnType<typeof vi.fn>;
  let batcher: QueryBatcher;

  beforeEach(() => {
    executeFn = vi.fn().mockResolvedValue({ data: [] });
  });

  afterEach(() => {
    batcher?.destroy();
  });

  it('should batch multiple queries', async () => {
    batcher = new QueryBatcher(executeFn, { maxBatchSize: 3, timeoutMs: 100 });

    const ir1: IRNode = { type: 'find', collection: 'users', filter: {}, metadata: { timestamp: new Date() } };
    const ir2: IRNode = { type: 'find', collection: 'users', filter: {}, metadata: { timestamp: new Date() } };
    const ir3: IRNode = { type: 'find', collection: 'users', filter: {}, metadata: { timestamp: new Date() } };

    const promises = [
      batcher.add(ir1),
      batcher.add(ir2),
      batcher.add(ir3),
    ];

    await Promise.all(promises);

    // Should execute as batch
    expect(executeFn).toHaveBeenCalled();
  });

  it('should flush on timeout', async () => {
    batcher = new QueryBatcher(executeFn, { maxBatchSize: 10, timeoutMs: 50 });

    const ir: IRNode = { type: 'find', collection: 'users', filter: {}, metadata: { timestamp: new Date() } };
    batcher.add(ir);

    // Wait for timeout
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(executeFn).toHaveBeenCalled();
  });

  it('should report pending count', () => {
    batcher = new QueryBatcher(executeFn, { maxBatchSize: 10, timeoutMs: 1000 });

    expect(batcher.getPendingCount()).toBe(0);
    expect(batcher.isIdle()).toBe(true);
  });

  it('should destroy and reject pending queries', async () => {
    batcher = new QueryBatcher(executeFn, { maxBatchSize: 10, timeoutMs: 10000 });

    const ir: IRNode = { type: 'find', collection: 'users', filter: {}, metadata: { timestamp: new Date() } };
    const promise = batcher.add(ir);

    batcher.destroy();

    await expect(promise).rejects.toThrow('QueryBatcher destroyed');
  });
});

describe('BatchExecutor', () => {
  it('should execute queries through batcher', async () => {
    const executeFn = vi.fn().mockResolvedValue({ data: [] });
    const executor = new BatchExecutor(executeFn, { maxBatchSize: 5, timeoutMs: 50 });

    const ir: IRNode = { type: 'find', collection: 'users', filter: {}, metadata: { timestamp: new Date() } };
    await executor.execute(ir);

    // Wait for batch to execute
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(executeFn).toHaveBeenCalled();
  });

  it('should report stats', () => {
    const executeFn = vi.fn();
    const executor = new BatchExecutor(executeFn);

    const stats = executor.getStats();
    expect(stats.totalPending).toBe(0);
    expect(stats.batcherCount).toBe(0);
  });

  it('should destroy all batchers', () => {
    const executeFn = vi.fn();
    const executor = new BatchExecutor(executeFn);

    executor.destroy();
    const stats = executor.getStats();
    expect(stats.batcherCount).toBe(0);
  });
});
