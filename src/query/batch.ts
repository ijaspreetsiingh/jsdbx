// =====================================================
// JSDB - Query Batching
// Batch multiple queries for better performance
// =====================================================
import type { IRNode } from '../ir/nodes.js';
import type { Document } from '../types/index.js';

export interface BatchOptions {
  maxBatchSize?: number;
  timeoutMs?: number;
  parallel?: boolean;
}

export interface BatchResult {
  results: unknown[];
  errors: (Error | null)[];
  duration: number;
}

export interface PendingQuery {
  id: string;
  ir: IRNode;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timestamp: number;
}

/**
 * Query Batch Collector
 * Collects queries and executes them in batches for better performance
 */
export class QueryBatcher {
  private pending: PendingQuery[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private executing = false;

  constructor(
    private executeFn: (ir: IRNode) => Promise<unknown>,
    private options: BatchOptions = {}
  ) {
    this.options = {
      maxBatchSize: options.maxBatchSize || 10,
      timeoutMs: options.timeoutMs || 50,
      parallel: options.parallel !== false,
    };
  }

  /**
   * Add a query to the batch
   */
  add(ir: IRNode): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const query: PendingQuery = {
        id: `batch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        ir,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.pending.push(query);

      // Start batch timer if not already running
      if (!this.timer) {
        this.timer = setTimeout(() => this.flush(), this.options.timeoutMs);
      }

      // Flush if batch is full
      if (this.pending.length >= this.options.maxBatchSize!) {
        this.flush();
      }
    });
  }

  /**
   * Flush pending queries
   */
  async flush(): Promise<void> {
    if (this.executing || this.pending.length === 0) return;

    this.executing = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const batch = this.pending.splice(0, this.options.maxBatchSize);
    const startTime = Date.now();

    try {
      if (this.options.parallel) {
        // Execute all queries in parallel
        const results = await Promise.allSettled(
          batch.map(q => this.executeFn(q.ir))
        );

        for (let i = 0; i < batch.length; i++) {
          const result = results[i];
          if (result.status === 'fulfilled') {
            batch[i].resolve(result.value);
          } else {
            batch[i].reject(result.reason);
          }
        }
      } else {
        // Execute queries sequentially
        for (const query of batch) {
          try {
            const result = await this.executeFn(query.ir);
            query.resolve(result);
          } catch (error) {
            query.reject(error as Error);
          }
        }
      }
    } finally {
      this.executing = false;

      // Flush remaining if any
      if (this.pending.length > 0) {
        this.timer = setTimeout(() => this.flush(), this.options.timeoutMs);
      }
    }
  }

  /**
   * Get pending query count
   */
  getPendingCount(): number {
    return this.pending.length;
  }

  /**
   * Check if batcher is idle
   */
  isIdle(): boolean {
    return this.pending.length === 0 && !this.executing;
  }

  /**
   * Destroy batcher and reject all pending queries
   */
  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    for (const query of this.pending) {
      query.reject(new Error('QueryBatcher destroyed'));
    }
    this.pending = [];
  }
}

/**
 * Query Executor with automatic batching support
 */
export class BatchExecutor {
  private batchers: Map<string, QueryBatcher> = new Map();

  constructor(
    private executeFn: (ir: IRNode) => Promise<unknown>,
    private options: BatchOptions = {}
  ) {}

  /**
   * Get or create a batcher for a collection
   */
  private getBatcher(collection: string): QueryBatcher {
    if (!this.batchers.has(collection)) {
      this.batchers.set(collection, new QueryBatcher(this.executeFn, this.options));
    }
    return this.batchers.get(collection)!;
  }

  /**
   * Execute a query (possibly batched)
   */
  async execute(ir: IRNode): Promise<unknown> {
    const batcher = this.getBatcher(ir.collection);
    return batcher.add(ir);
  }

  /**
   * Flush all pending queries
   */
  async flushAll(): Promise<void> {
    const flushes = Array.from(this.batchers.values()).map(b => b.flush());
    await Promise.all(flushes);
  }

  /**
   * Get statistics
   */
  getStats(): { totalPending: number; batcherCount: number } {
    let totalPending = 0;
    for (const batcher of this.batchers.values()) {
      totalPending += batcher.getPendingCount();
    }
    return {
      totalPending,
      batcherCount: this.batchers.size,
    };
  }

  /**
   * Destroy all batchers
   */
  destroy(): void {
    for (const batcher of this.batchers.values()) {
      batcher.destroy();
    }
    this.batchers.clear();
  }
}
