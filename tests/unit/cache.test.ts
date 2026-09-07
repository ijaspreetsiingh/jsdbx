import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryCacheProvider, NoCacheProvider, CacheManager } from '../../src/cache/cache.js';

describe('MemoryCacheProvider', () => {
  let cache: MemoryCacheProvider;

  beforeEach(() => {
    cache = new MemoryCacheProvider(100, 60);
  });

  it('stores and retrieves values', async () => {
    await cache.set('key1', 'value1');
    expect(await cache.get('key1')).toBe('value1');
  });

  it('returns null for missing keys', async () => {
    expect(await cache.get('nonexistent')).toBeNull();
  });

  it('deletes a key', async () => {
    await cache.set('key1', 'value1');
    await cache.delete('key1');
    expect(await cache.get('key1')).toBeNull();
  });

  it('clears all entries', async () => {
    await cache.set('k1', 'v1');
    await cache.set('k2', 'v2');
    await cache.clear();
    expect(await cache.get('k1')).toBeNull();
    expect(await cache.get('k2')).toBeNull();
  });

  it('respects TTL', async () => {
    await cache.set('key1', 'value1', 0.001); // 1ms TTL
    await new Promise((r) => setTimeout(r, 50));
    expect(await cache.get('key1')).toBeNull();
  });

  it('checks has()', async () => {
    await cache.set('key1', 'value1');
    expect(await cache.has('key1')).toBe(true);
    expect(await cache.has('nope')).toBe(false);
  });

  it('deletes by pattern', async () => {
    await cache.set('users:1', 'a');
    await cache.set('users:2', 'b');
    await cache.set('orders:1', 'c');
    await cache.deletePattern('users:*');
    expect(await cache.get('users:1')).toBeNull();
    expect(await cache.get('users:2')).toBeNull();
    expect(await cache.get('orders:1')).toBe('c');
  });

  it('evicts when at capacity', async () => {
    const small = new MemoryCacheProvider(3, 60);
    await small.set('k1', 'v1');
    await small.set('k2', 'v2');
    await small.set('k3', 'v3');
    await small.set('k4', 'v4'); // Should evict k1
    expect(small.size()).toBe(3);
  });
});

describe('NoCacheProvider', () => {
  it('always returns null', async () => {
    const cache = new NoCacheProvider();
    await cache.set('key', 'value');
    expect(await cache.get('key')).toBeNull();
    expect(await cache.has('key')).toBe(false);
  });
});

describe('CacheManager', () => {
  let manager: CacheManager;

  beforeEach(() => {
    manager = new CacheManager(new MemoryCacheProvider());
  });

  it('stores and retrieves JSON values', async () => {
    const key = manager.buildKey(['users', 'find', '{}']);
    await manager.set(key, [{ name: 'Alice' }]);
    const result = await manager.get<Array<{ name: string }>>(key);
    expect(result?.[0].name).toBe('Alice');
  });

  it('returns null for missing keys', async () => {
    expect(await manager.get('missing')).toBeNull();
  });

  it('invalidates collection', async () => {
    const k1 = manager.buildKey(['users', 'find', '{}']);
    const k2 = manager.buildKey(['users', 'findOne', '{"id":"1"}']);
    const k3 = manager.buildKey(['orders', 'find', '{}']);
    await manager.set(k1, []);
    await manager.set(k2, null);
    await manager.set(k3, []);

    await manager.invalidateCollection('users');

    expect(await manager.has(k1)).toBe(false);
    expect(await manager.has(k2)).toBe(false);
    expect(await manager.has(k3)).toBe(true);
  });

  it('builds namespaced keys', () => {
    const key = manager.buildKey(['users', 'find', '{}']);
    expect(key).toMatch(/^jsdb:/);
  });
});
