// =====================================================
// JSDB - Query Plan Cache
// Caches frequently used execution plans (adapter-aware)
// =====================================================
import type { DatabaseType } from '../types/index.js';
import type { IRNode, ExecutionPlan } from '../ir/nodes.js';

interface PlanCacheEntry {
  plan: ExecutionPlan;
  hits: number;
  createdAt: Date;
  lastUsed: Date;
}

export class PlanCache {
  private cache = new Map<string, PlanCacheEntry>();
  private maxEntries: number;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
  }

  private buildKey(ir: IRNode, database: DatabaseType): string {
    // Build a deterministic key from the IR structure (excluding runtime metadata)
    const { metadata: _meta, ...irWithoutMeta } = ir as IRNode & { metadata?: unknown };
    return `${database}:${ir.type}:${ir.collection}:${JSON.stringify(irWithoutMeta)}`;
  }

  get(ir: IRNode, database: DatabaseType): ExecutionPlan | null {
    const key = this.buildKey(ir, database);
    const entry = this.cache.get(key);
    if (entry) {
      entry.hits++;
      entry.lastUsed = new Date();
      return entry.plan;
    }
    return null;
  }

  set(ir: IRNode, database: DatabaseType, plan: ExecutionPlan): void {
    const key = this.buildKey(ir, database);
    if (this.cache.size >= this.maxEntries) {
      // Evict least recently used
      let lruKey = '';
      let lruTime = Date.now();
      for (const [k, v] of this.cache.entries()) {
        if (v.lastUsed.getTime() < lruTime) {
          lruTime = v.lastUsed.getTime();
          lruKey = k;
        }
      }
      if (lruKey) this.cache.delete(lruKey);
    }
    this.cache.set(key, {
      plan,
      hits: 0,
      createdAt: new Date(),
      lastUsed: new Date(),
    });
  }

  has(ir: IRNode, database: DatabaseType): boolean {
    return this.cache.has(this.buildKey(ir, database));
  }

  invalidate(collection: string, database: DatabaseType): void {
    const prefix = `${database}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) && key.includes(`:"${collection}"`)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  stats(): { size: number; totalHits: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    return { size: this.cache.size, totalHits };
  }
}

export const globalPlanCache = new PlanCache();
