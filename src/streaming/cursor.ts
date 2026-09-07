// =====================================================
// JSDB v2.0 - Streaming Cursor for Large Datasets
// Memory-efficient processing of millions of records
// =====================================================
import { createLogger } from '../utils/logger.js';
import type { Document, Filter, FindOptions } from '../types/index.js';

export interface CursorConfig {
  batchSize: number;
  maxMemoryMb: number;
  enableParallel: boolean;
  maxParallelStreams: number;
  prefetchEnabled: boolean;
  prefetchSize: number;
}

export interface CursorStats {
  totalProcessed: number;
  batchCount: number;
  avgBatchTimeMs: number;
  memoryUsageMb: number;
  isExhausted: boolean;
}

export type TransformFn<T = Document> = (doc: Document) => T | Promise<T>;
export type FilterFn = (doc: Document) => boolean;
export type ConsumerFn<T = Document> = (batch: T[]) => Promise<void>;

export class StreamingCursor<T = Document> {
  private config: CursorConfig;
  private fetchFn: (offset: number, limit: number) => Promise<Document[]>;
  private transformFn?: TransformFn<T>;
  private filterFn?: FilterFn;
  private offset = 0;
  private totalProcessed = 0;
  private batchCount = 0;
  private batchTimes: number[] = [];
  private exhausted = false;
  private logger = createLogger('info', 'JSDB:Cursor');

  constructor(
    fetchFn: (offset: number, limit: number) => Promise<Document[]>,
    config?: Partial<CursorConfig>,
    transformFn?: TransformFn<T>,
    filterFn?: FilterFn
  ) {
    this.fetchFn = fetchFn;
    this.config = {
      batchSize: config?.batchSize ?? 1000,
      maxMemoryMb: config?.maxMemoryMb ?? 100,
      enableParallel: config?.enableParallel ?? false,
      maxParallelStreams: config?.maxParallelStreams ?? 4,
      prefetchEnabled: config?.prefetchEnabled ?? true,
      prefetchSize: config?.prefetchSize ?? 2,
    };
    this.transformFn = transformFn;
    this.filterFn = filterFn;
  }

  async next(): Promise<T[] | null> {
    if (this.exhausted) return null;

    const startTime = Date.now();

    try {
      const docs = await this.fetchFn(this.offset, this.config.batchSize);

      if (docs.length === 0) {
        this.exhausted = true;
        return null;
      }

      let processed = docs;

      // Apply filter
      if (this.filterFn) {
        processed = processed.filter(this.filterFn);
      }

      // Apply transform
      let result: T[];
      if (this.transformFn) {
        result = await Promise.all(processed.map(this.transformFn));
      } else {
        result = processed as T[];
      }

      this.offset += docs.length;
      this.totalProcessed += result.length;
      this.batchCount++;

      const duration = Date.now() - startTime;
      this.batchTimes.push(duration);
      if (this.batchTimes.length > 100) this.batchTimes.shift();

      return result;
    } catch (err) {
      this.logger.error('Cursor fetch error', { error: (err as Error).message });
      throw err;
    }
  }

  async forEach(consumer: ConsumerFn<T>): Promise<void> {
    while (true) {
      const batch = await this.next();
      if (batch === null) break;
      await consumer(batch);
    }
  }

  async toArray(): Promise<T[]> {
    const results: T[] = [];
    while (true) {
      const batch = await this.next();
      if (batch === null) break;
      results.push(...batch);
    }
    return results;
  }

  async reduce<R>(reducer: (acc: R, batch: T[]) => Promise<R> | R, initial: R): Promise<R> {
    let acc = initial;
    while (true) {
      const batch = await this.next();
      if (batch === null) break;
      acc = await reducer(acc, batch);
    }
    return acc;
  }

  async map<U>(mapper: (batch: T[]) => Promise<U[]> | U[]): Promise<StreamingCursor<U>> {
    const parentCursor = this;
    const mapped = new StreamingCursor<U>(
      (offset, limit) => parentCursor.fetchFn(offset, limit),
      this.config
    );
    return mapped;
  }

  getStats(): CursorStats {
    const avgBatchTime =
      this.batchTimes.length > 0
        ? this.batchTimes.reduce((a, b) => a + b, 0) / this.batchTimes.length
        : 0;

    return {
      totalProcessed: this.totalProcessed,
      batchCount: this.batchCount,
      avgBatchTimeMs: avgBatchTime,
      memoryUsageMb: this.estimateMemoryUsage(),
      isExhausted: this.exhausted,
    };
  }

  reset(): void {
    this.offset = 0;
    this.totalProcessed = 0;
    this.batchCount = 0;
    this.batchTimes = [];
    this.exhausted = false;
  }

  private estimateMemoryUsage(): number {
    // Rough estimate based on batch size
    return (this.config.batchSize * 1024) / (1024 * 1024); // Assume 1KB per doc
  }
}

// Parallel streaming for multiple collections
export class ParallelStreamManager {
  private config: CursorConfig;
  private logger = createLogger('info', 'JSDB:ParallelStream');

  constructor(config?: Partial<CursorConfig>) {
    this.config = {
      batchSize: config?.batchSize ?? 1000,
      maxMemoryMb: config?.maxMemoryMb ?? 500,
      enableParallel: true,
      maxParallelStreams: config?.maxParallelStreams ?? 4,
      prefetchEnabled: config?.prefetchEnabled ?? true,
      prefetchSize: config?.prefetchSize ?? 2,
    };
  }

  async processParallel<T>(
    streams: Array<{
      name: string;
      fetchFn: (offset: number, limit: number) => Promise<Document[]>;
      consumer: ConsumerFn<T>;
      transformFn?: TransformFn<T>;
    }>
  ): Promise<void> {
    const semaphore = new Semaphore(this.config.maxParallelStreams);

    const promises = streams.map((stream) =>
      semaphore.acquire().then(async (release) => {
        try {
          const cursor = new StreamingCursor<T>(
            stream.fetchFn,
            this.config,
            stream.transformFn
          );
          await cursor.forEach(stream.consumer);
          this.logger.info('Stream completed', { name: stream.name });
        } finally {
          release();
        }
      })
    );

    await Promise.all(promises);
  }
}

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

// Helper to create streaming cursor from collection
export function createStreamingCursor<T = Document>(
  collection: { find: (filter?: Filter, options?: FindOptions) => Promise<Document[]> },
  filter?: Filter,
  options?: Partial<CursorConfig> & FindOptions,
  transformFn?: TransformFn<T>
): StreamingCursor<T> {
  const fetchFn = async (offset: number, limit: number): Promise<Document[]> => {
    return collection.find(filter, { ...options, offset, limit });
  };

  return new StreamingCursor<T>(fetchFn, options, transformFn);
}
