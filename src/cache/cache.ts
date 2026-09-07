// =====================================================
// JSDB - Cache System (Memory + Redis-compatible)
// =====================================================
import type { CacheConfig } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

export interface CacheProvider {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  deletePattern(pattern: string): Promise<void>;
  clear(): Promise<void>;
  has(key: string): Promise<boolean>;
}

// ---- Memory Cache ----

interface MemoryEntry {
  value: string;
  expiresAt: number | null;
}

export class MemoryCacheProvider implements CacheProvider {
  private store = new Map<string, MemoryEntry>();
  private maxSize: number;
  private defaultTtl: number;

  constructor(maxSize = 1000, defaultTtlSeconds = 300) {
    this.maxSize = maxSize;
    this.defaultTtl = defaultTtlSeconds;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    // Evict if at capacity (LRU approximation: delete oldest entry)
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    const ttl = ttlSeconds ?? this.defaultTtl;
    this.store.set(key, {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deletePattern(pattern: string): Promise<void> {
    // Simple glob-style pattern (supports * wildcard)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    for (const key of this.store.keys()) {
      if (regex.test(key)) this.store.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  size(): number {
    return this.store.size;
  }
}

// ---- No-op Cache ----

export class NoCacheProvider implements CacheProvider {
  async get(_key: string): Promise<null> { return null; }
  async set(_key: string, _value: string, _ttl?: number): Promise<void> {}
  async delete(_key: string): Promise<void> {}
  async deletePattern(_pattern: string): Promise<void> {}
  async clear(): Promise<void> {}
  async has(_key: string): Promise<boolean> { return false; }
}

// ---- Redis-compatible Cache ----
// Uses ioredis-compatible API (set, get, del, keys, flushdb)

export class RedisCacheProvider implements CacheProvider {
  private client: RedisLike | null = null;
  private defaultTtl: number;
  private url: string;

  constructor(url: string, defaultTtlSeconds = 300) {
    this.url = url;
    this.defaultTtl = defaultTtlSeconds;
  }

  async connect(): Promise<void> {
    try {
      // Dynamic import — ioredis is optional; not installed by default
      // @ts-expect-error ioredis is an optional peer dependency
      const RedisModule = await import('ioredis') as unknown as { default: new (url: string) => RedisLike };
      this.client = new RedisModule.default(this.url);
    } catch {
      throw new Error('ioredis not installed. Run: npm install ioredis');
    }
  }

  private getClient(): RedisLike {
    if (!this.client) throw new Error('Redis not connected');
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.getClient().get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.defaultTtl;
    if (ttl > 0) {
      await this.getClient().set(key, value, 'EX', ttl);
    } else {
      await this.getClient().set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.getClient().del(key);
  }

  async deletePattern(pattern: string): Promise<void> {
    const keys = await this.getClient().keys(pattern);
    if (keys.length > 0) {
      await this.getClient().del(...keys);
    }
  }

  async clear(): Promise<void> {
    await this.getClient().flushdb();
  }

  async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }
}

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys(pattern: string): Promise<string[]>;
  flushdb(): Promise<unknown>;
}

// ---- Cache Manager ----

export class CacheManager {
  private provider: CacheProvider;
  private namespace: string;
  private logger = createLogger('info', 'JSDB:Cache');

  constructor(provider: CacheProvider, namespace = 'jsdb') {
    this.provider = provider;
    this.namespace = namespace;
  }

  buildKey(parts: string[]): string {
    return `${this.namespace}:${parts.join(':')}`;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.provider.get(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      await this.provider.set(key, JSON.stringify(value), ttlSeconds);
    } catch (err) {
      this.logger.warn('Cache set failed', { key, error: (err as Error).message });
    }
  }

  async delete(key: string): Promise<void> {
    await this.provider.delete(key);
  }

  async invalidateCollection(collection: string): Promise<void> {
    await this.provider.deletePattern(`${this.namespace}:${collection}:*`);
  }

  async invalidateAll(): Promise<void> {
    await this.provider.deletePattern(`${this.namespace}:*`);
  }

  async has(key: string): Promise<boolean> {
    return this.provider.has(key);
  }

  getProvider(): CacheProvider {
    return this.provider;
  }
}

export function createCacheManager(config?: CacheConfig): CacheManager {
  if (!config || config.provider === 'none' || !config.provider) {
    return new CacheManager(new NoCacheProvider());
  }
  if (config.provider === 'memory') {
    return new CacheManager(
      new MemoryCacheProvider(config.maxSize ?? 1000, config.ttlSeconds ?? 300)
    );
  }
  if (config.provider === 'redis') {
    const redisProvider = new RedisCacheProvider(
      config.redisUrl ?? 'redis://localhost:6379',
      config.ttlSeconds ?? 300
    );
    // Connect lazily
    return new CacheManager(redisProvider);
  }
  return new CacheManager(new NoCacheProvider());
}
