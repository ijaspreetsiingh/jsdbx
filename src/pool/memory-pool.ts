// =====================================================
// JSDB v2.0 - Memory Pool Manager
// Object pooling for zero-copy operations
// =====================================================
import { createLogger } from '../utils/logger.js';

export interface PoolStats {
  totalObjects: number;
  activeObjects: number;
  idleObjects: number;
  totalAcquires: number;
  totalReleases: number;
  poolHits: number;
  poolMisses: number;
  avgAcquireTimeMs: number;
  maxPoolSize: number;
}

export class ObjectPool<T> {
  private factory: () => T;
  private reset: (obj: T) => void;
  private validate?: (obj: T) => boolean;
  private idle: T[] = [];
  private active = new Set<T>();
  private maxSize: number;
  private stats: PoolStats;
  private logger = createLogger('info', 'JSDB:ObjectPool');
  private name: string;

  constructor(
    name: string,
    factory: () => T,
    resetFn: (obj: T) => void,
    config?: {
      maxSize?: number;
      validate?: (obj: T) => boolean;
    }
  ) {
    this.name = name;
    this.factory = factory;
    this.reset = resetFn;
    this.validate = config?.validate;
    this.maxSize = config?.maxSize ?? 1000;

    this.stats = {
      totalObjects: 0,
      activeObjects: 0,
      idleObjects: 0,
      totalAcquires: 0,
      totalReleases: 0,
      poolHits: 0,
      poolMisses: 0,
      avgAcquireTimeMs: 0,
      maxPoolSize: this.maxSize,
    };
  }

  acquire(): T {
    const startTime = Date.now();
    this.stats.totalAcquires++;

    // Try to get from pool
    while (this.idle.length > 0) {
      const obj = this.idle.pop()!;

      // Validate if validator exists
      if (this.validate && !this.validate(obj)) {
        continue;
      }

      this.active.add(obj);
      this.stats.poolHits++;
      this.updateAcquireMetrics(startTime);
      return obj;
    }

    // Create new object
    this.stats.poolMisses++;
    const obj = this.factory();
    this.active.add(obj);
    this.stats.totalObjects = this.active.size + this.idle.length;
    this.updateAcquireMetrics(startTime);
    return obj;
  }

  release(obj: T): void {
    if (!this.active.has(obj)) return;

    this.active.delete(obj);
    this.stats.totalReleases++;

    // Reset object
    try {
      this.reset(obj);
    } catch (err) {
      this.logger.warn('Error resetting pooled object', { error: (err as Error).message });
    }

    // Return to pool if under limit
    if (this.idle.length < this.maxSize) {
      this.idle.push(obj);
    }

    this.updateStats();
  }

  releaseAll(): void {
    for (const obj of this.active) {
      this.release(obj);
    }
  }

  clear(): void {
    this.idle = [];
    this.active.clear();
    this.updateStats();
  }

  getStats(): PoolStats {
    return { ...this.stats };
  }

  private updateAcquireMetrics(startTime: number): void {
    const duration = Date.now() - startTime;
    const total = this.stats.totalAcquires;
    this.stats.avgAcquireTimeMs =
      (this.stats.avgAcquireTimeMs * (total - 1) + duration) / total;
  }

  private updateStats(): void {
    this.stats.activeObjects = this.active.size;
    this.stats.idleObjects = this.idle.length;
    this.stats.totalObjects = this.active.size + this.idle.length;
  }
}

// Document pool for query results
export interface PooledDocument {
  [key: string]: unknown;
  __poolId?: string;
  __createdAt?: number;
}

export class DocumentPool {
  private pool: ObjectPool<PooledDocument>;
  private logger = createLogger('info', 'JSDB:DocPool');

  constructor(maxSize = 5000) {
    this.pool = new ObjectPool<PooledDocument>(
      'Document',
      () => ({}),
      (doc) => {
        const keys = Object.keys(doc);
        for (const key of keys) {
          delete doc[key];
        }
      },
      {
        maxSize,
        validate: (doc) => typeof doc === 'object' && doc !== null,
      }
    );
  }

  acquire(): PooledDocument {
    const doc = this.pool.acquire();
    doc.__poolId = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    doc.__createdAt = Date.now();
    return doc;
  }

  release(doc: PooledDocument): void {
    this.pool.release(doc);
  }

  acquireMany(count: number): PooledDocument[] {
    const docs: PooledDocument[] = [];
    for (let i = 0; i < count; i++) {
      docs.push(this.acquire());
    }
    return docs;
  }

  releaseAll(docs: PooledDocument[]): void {
    for (const doc of docs) {
      this.release(doc);
    }
  }

  getStats() {
    return this.pool.getStats();
  }
}

// Global document pool instance
let globalDocPool: DocumentPool | null = null;

export function getDocumentPool(maxSize?: number): DocumentPool {
  if (!globalDocPool) {
    globalDocPool = new DocumentPool(maxSize);
  }
  return globalDocPool;
}

export function resetDocumentPool(): void {
  if (globalDocPool) {
    globalDocPool.getStats(); // Just to ensure it's accessed
    globalDocPool = null;
  }
}
