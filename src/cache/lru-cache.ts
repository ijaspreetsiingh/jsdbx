// =====================================================
// JSDB v2.0 - LRU Cache with size-based eviction
// Multi-level caching: L1 (memory) + L2 (optional Redis)
// =====================================================
import { createLogger } from '../utils/logger.js';

export interface LRUCacheConfig {
  maxSize: number;
  defaultTtlMs: number;
  enableStats: boolean;
  evictionBatchSize: number;
  warmupEnabled: boolean;
}

interface CacheNode<K, V> {
  key: K;
  value: V;
  expiresAt: number | null;
  frequency: number;
  lastAccessed: number;
  prev: CacheNode<K, V> | null;
  next: CacheNode<K, V> | null;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  expired: number;
  size: number;
  hitRate: number;
  avgAccessTimeMs: number;
  totalAccesses: number;
}

export class LRUCache<K = string, V = unknown> {
  private config: LRUCacheConfig;
  private store = new Map<K, CacheNode<K, V>>();
  private head: CacheNode<K, V> | null = null;
  private tail: CacheNode<K, V> | null = null;
  private stats: CacheStats;
  private logger = createLogger('info', 'JSDB:LRU');

  constructor(config?: Partial<LRUCacheConfig>) {
    this.config = {
      maxSize: config?.maxSize ?? 10000,
      defaultTtlMs: config?.defaultTtlMs ?? 300000,
      enableStats: config?.enableStats ?? true,
      evictionBatchSize: config?.evictionBatchSize ?? 100,
      warmupEnabled: config?.warmupEnabled ?? false,
    };

    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expired: 0,
      size: 0,
      hitRate: 0,
      avgAccessTimeMs: 0,
      totalAccesses: 0,
    };
  }

  get(key: K): V | null {
    const startTime = Date.now();
    const node = this.store.get(key);

    if (!node) {
      this.stats.misses++;
      this.updateStats(startTime);
      return null;
    }

    // Check expiration
    if (node.expiresAt !== null && Date.now() > node.expiresAt) {
      this.remove(key);
      this.stats.misses++;
      this.updateStats(startTime);
      return null;
    }

    // Move to front (most recently used)
    this.moveToFront(node);
    node.frequency++;
    node.lastAccessed = Date.now();

    this.stats.hits++;
    this.updateStats(startTime);
    return node.value;
  }

  set(key: K, value: V, ttlMs?: number): void {
    const existing = this.store.get(key);
    if (existing) {
      existing.value = value;
      existing.expiresAt = ttlMs ? Date.now() + ttlMs : this.config.defaultTtlMs > 0 ? Date.now() + this.config.defaultTtlMs : null;
      existing.frequency++;
      existing.lastAccessed = Date.now();
      this.moveToFront(existing);
      return;
    }

    // Evict if at capacity
    if (this.store.size >= this.config.maxSize) {
      this.evict(this.config.evictionBatchSize);
    }

    const newNode: CacheNode<K, V> = {
      key,
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : this.config.defaultTtlMs > 0 ? Date.now() + this.config.defaultTtlMs : null,
      frequency: 0,
      lastAccessed: Date.now(),
      prev: null,
      next: this.head,
    };

    if (this.head) {
      this.head.prev = newNode;
    }
    this.head = newNode;

    if (!this.tail) {
      this.tail = newNode;
    }

    this.store.set(key, newNode);
    this.stats.size = this.store.size;
  }

  delete(key: K): boolean {
    const node = this.store.get(key);
    if (!node) return false;

    this.removeNode(node);
    this.store.delete(key);
    this.stats.size = this.store.size;
    return true;
  }

  has(key: K): boolean {
    const node = this.store.get(key);
    if (!node) return false;
    if (node.expiresAt !== null && Date.now() > node.expiresAt) {
      this.remove(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.store.clear();
    this.head = null;
    this.tail = null;
    this.stats.size = 0;
  }

  getOrSet(key: K, factory: () => V | Promise<V>, ttlMs?: number): V | Promise<V> {
    const cached = this.get(key);
    if (cached !== null) return cached;

    const value = factory();
    if (value instanceof Promise) {
      return value.then((v) => {
        this.set(key, v, ttlMs);
        return v;
      });
    }
    this.set(key, value, ttlMs);
    return value;
  }

  mget(keys: K[]): Map<K, V | null> {
    const result = new Map<K, V | null>();
    for (const key of keys) {
      result.set(key, this.get(key));
    }
    return result;
  }

  mset(entries: Map<K, V>, ttlMs?: number): void {
    for (const [key, value] of entries) {
      this.set(key, value, ttlMs);
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  resize(newMaxSize: number): void {
    this.config.maxSize = newMaxSize;
    while (this.store.size > newMaxSize) {
      this.evict(1);
    }
  }

  private moveToFront(node: CacheNode<K, V>): void {
    if (node === this.head) return;

    // Detach
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.tail) this.tail = node.prev;

    // Attach to front
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    this.head = node;

    if (!this.tail) this.tail = node;
  }

  private removeNode(node: CacheNode<K, V>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;
  }

  private evict(count: number): void {
    let evicted = 0;
    while (this.tail && evicted < count) {
      const node = this.tail;
      this.removeNode(node);
      this.store.delete(node.key);
      this.stats.evictions++;
      evicted++;
    }
    this.stats.size = this.store.size;
  }

  private remove(key: K): void {
    const node = this.store.get(key);
    if (node) {
      this.removeNode(node);
      this.store.delete(key);
      this.stats.expired++;
      this.stats.size = this.store.size;
    }
  }

  private updateStats(startTime: number): void {
    if (!this.config.enableStats) return;
    const duration = Date.now() - startTime;
    this.stats.totalAccesses++;
    this.stats.avgAccessTimeMs =
      (this.stats.avgAccessTimeMs * (this.stats.totalAccesses - 1) + duration) /
      this.stats.totalAccesses;
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }
}

// Query-specific cache with automatic key generation
export class QueryCache {
  private lru: LRUCache<string, unknown>;
  private logger = createLogger('info', 'JSDB:QueryCache');

  constructor(config?: Partial<LRUCacheConfig>) {
    this.lru = new LRUCache<string, unknown>(config);
  }

  generateKey(operation: string, collection: string, params: unknown): string {
    const sorted = JSON.stringify(params, Object.keys(params as object).sort());
    return `${operation}:${collection}:${sorted}`;
  }

  async get<T>(key: string): Promise<T | null> {
    return this.lru.get(key) as T | null;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    this.lru.set(key, value, ttlMs);
  }

  async invalidateCollection(collection: string): Promise<void> {
    // For now, just clear all - in production use pattern matching
    this.lru.clear();
  }

  getStats() {
    return this.lru.getStats();
  }
}
