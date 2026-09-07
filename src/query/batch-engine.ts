// =====================================================
// JSDB v2.0 - Query Batching & Bulk Operations Engine
// Optimized for high-throughput workloads
// =====================================================
import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';
import type { Document, Filter, Update, InsertOneResult, InsertManyResult, UpdateResult, DeleteResult } from '../types/index.js';

export interface BatchConfig {
  maxBatchSize: number;
  maxWaitTimeMs: number;
  enableSmartBatching: boolean;
  maxConcurrency: number;
  bulkInsertChunkSize: number;
  bulkUpdateChunkSize: number;
}

export interface BatchedQuery<T = unknown> {
  id: string;
  operation: string;
  collection: string;
  params: unknown;
  resolve: (result: T) => void;
  reject: (err: Error) => void;
  timestamp: number;
}

export interface BatchResult<T = unknown> {
  id: string;
  result: T;
  duration: number;
  batchIndex: number;
}

export interface BulkInsertOptions {
  chunkSize: number;
  ordered: boolean;
  concurrency: number;
}

export interface BulkInsertResult {
  totalInserted: number;
  chunks: number;
  duration: number;
  errors: Array<{ index: number; error: Error }>;
}

export interface BulkUpdateOptions {
  chunkSize: number;
  concurrency: number;
}

export interface BulkUpdateResult {
  totalUpdated: number;
  chunks: number;
  duration: number;
  errors: Array<{ filter: Filter; error: Error }>;
}

export type BatchExecutor<T = unknown> = (queries: BatchedQuery<T>[]) => Promise<Map<string, T>>;

export type BulkInsertExecutor<T extends Document> = (chunk: T[]) => Promise<InsertManyResult>;

export class QueryBatchEngine<T = unknown> {
  private config: BatchConfig;
  private pending: BatchedQuery<T>[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private executor: BatchExecutor<T>;
  private logger = createLogger('info', 'JSDB:Batch');
  private processing = false;

  constructor(executor: BatchExecutor<T>, config?: Partial<BatchConfig>) {
    this.executor = executor;
    this.config = {
      maxBatchSize: config?.maxBatchSize ?? 100,
      maxWaitTimeMs: config?.maxWaitTimeMs ?? 50,
      enableSmartBatching: config?.enableSmartBatching ?? true,
      maxConcurrency: config?.maxConcurrency ?? 10,
      bulkInsertChunkSize: config?.bulkInsertChunkSize ?? 1000,
      bulkUpdateChunkSize: config?.bulkUpdateChunkSize ?? 500,
    };
  }

  async add(query: Omit<BatchedQuery<T>, 'id' | 'resolve' | 'reject' | 'timestamp'>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const batchedQuery: BatchedQuery<T> = {
        id: generateId(),
        ...query,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.pending.push(batchedQuery);

      // Start batch timer if not already running
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => this.processBatch(), this.config.maxWaitTimeMs);
      }

      // Process immediately if batch is full
      if (this.pending.length >= this.config.maxBatchSize) {
        this.processBatch();
      }
    });
  }

  async addMany(
    queries: Array<Omit<BatchedQuery<T>, 'id' | 'resolve' | 'reject' | 'timestamp'>>
  ): Promise<T[]> {
    const promises = queries.map((q) => this.add(q));
    return Promise.all(promises);
  }

  private async processBatch(): Promise<void> {
    if (this.processing || this.pending.length === 0) return;

    this.processing = true;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const batch = this.pending.splice(0, this.config.maxBatchSize);
    this.logger.debug('Processing batch', { size: batch.length });

    try {
      const results = await this.executor(batch);
      const duration = Date.now() - batch[0]!.timestamp;

      for (const query of batch) {
        const result = results.get(query.id);
        if (result !== undefined) {
          query.resolve(result);
        } else {
          query.reject(new Error('No result for batch query'));
        }
      }

      this.logger.debug('Batch processed', {
        size: batch.length,
        duration,
      });
    } catch (err) {
      for (const query of batch) {
        query.reject(err as Error);
      }
    } finally {
      this.processing = false;

      // Process remaining queries if any
      if (this.pending.length > 0) {
        this.processBatch();
      }
    }
  }

  getPendingCount(): number {
    return this.pending.length;
  }

  flush(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    this.processBatch();
  }
}

// Bulk operations optimizer
export class BulkOperations {
  private logger = createLogger('info', 'JSDB:Bulk');

  async bulkInsert<T extends Document>(
    items: T[],
    insertFn: BulkInsertExecutor<T>,
    options?: Partial<BulkInsertOptions>
  ): Promise<BulkInsertResult> {
    const opts: BulkInsertOptions = {
      chunkSize: options?.chunkSize ?? 1000,
      ordered: options?.ordered ?? false,
      concurrency: options?.concurrency ?? 5,
    };

    const startTime = Date.now();
    const chunks: T[][] = [];
    const errors: Array<{ index: number; error: Error }> = [];
    let totalInserted = 0;

    // Split into chunks
    for (let i = 0; i < items.length; i += opts.chunkSize) {
      chunks.push(items.slice(i, i + opts.chunkSize));
    }

    this.logger.info('Starting bulk insert', {
      total: items.length,
      chunks: chunks.length,
      chunkSize: opts.chunkSize,
    });

    if (opts.ordered) {
      // Sequential execution
      for (let i = 0; i < chunks.length; i++) {
        try {
          const result = await insertFn(chunks[i]!);
          totalInserted += result.insertedCount;
        } catch (err) {
          errors.push({ index: i * opts.chunkSize, error: err as Error });
          if (opts.ordered) break;
        }
      }
    } else {
      // Parallel execution with concurrency limit
      const semaphore = new Semaphore(opts.concurrency);
      const promises = chunks.map((chunk, i) =>
        semaphore.acquire().then(async (release) => {
          try {
            const result = await insertFn(chunk);
            totalInserted += result.insertedCount;
          } catch (err) {
            errors.push({ index: i * opts.chunkSize, error: err as Error });
          } finally {
            release();
          }
        })
      );
      await Promise.all(promises);
    }

    const duration = Date.now() - startTime;
    this.logger.info('Bulk insert completed', {
      totalInserted,
      errors: errors.length,
      duration,
    });

    return { totalInserted, chunks: chunks.length, duration, errors };
  }

  async bulkUpdate<T extends Document>(
    items: Array<{ filter: Filter; update: Update }>,
    updateFn: (filter: Filter, update: Update) => Promise<UpdateResult>,
    options?: Partial<BulkUpdateOptions>
  ): Promise<BulkUpdateResult> {
    const opts: BulkUpdateOptions = {
      chunkSize: options?.chunkSize ?? 500,
      concurrency: options?.concurrency ?? 5,
    };

    const startTime = Date.now();
    const errors: Array<{ filter: Filter; error: Error }> = [];
    let totalUpdated = 0;

    const semaphore = new Semaphore(opts.concurrency);
    const chunks: Array<Array<{ filter: Filter; update: Update }>> = [];

    for (let i = 0; i < items.length; i += opts.chunkSize) {
      chunks.push(items.slice(i, i + opts.chunkSize));
    }

    const promises = chunks.map((chunk) =>
      semaphore.acquire().then(async (release) => {
        try {
          for (const item of chunk) {
            const result = await updateFn(item.filter, item.update);
            totalUpdated += result.modifiedCount ?? 0;
          }
        } catch (err) {
          errors.push({ filter: chunk[0]!.filter, error: err as Error });
        } finally {
          release();
        }
      })
    );
    await Promise.all(promises);

    const duration = Date.now() - startTime;
    this.logger.info('Bulk update completed', {
      totalUpdated,
      errors: errors.length,
      duration,
    });

    return { totalUpdated, chunks: chunks.length, duration, errors };
  }
}

// Simple semaphore for concurrency control
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    if (this.permits > 0) {
      this.permits--;
      return () => this.release();
    }

    return new Promise<() => void>((resolve) => {
      this.queue.push(() => {
        this.permits--;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.permits++;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }
}
