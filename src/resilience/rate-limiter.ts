// =====================================================
// JSDB v2.0 - Rate Limiter & Throttling
// Token bucket, sliding window, per-tenant limits
// =====================================================
import { createLogger } from '../utils/logger.js';

export interface RateLimiterConfig {
  windowSizeMs: number;
  maxRequests: number;
  burstSize: number;
  refillRate: number;
  perTenantLimit: boolean;
  gracefulDegradation: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetMs: number;
  retryAfterMs?: number;
}

export interface RateLimitStats {
  totalRequests: number;
  allowedRequests: number;
  rejectedRequests: number;
  throttledRequests: number;
  avgWaitTimeMs: number;
  tenantStats: Map<string, { requests: number; rejected: number }>;
}

// Token Bucket Algorithm
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private config: { capacity: number; refillRate: number; refillIntervalMs: number };

  constructor(config: { capacity: number; refillRate: number; refillIntervalMs: number }) {
    this.config = config;
    this.tokens = config.capacity;
    this.lastRefill = Date.now();
  }

  consume(tokens = 1): { allowed: boolean; tokens: number; retryAfterMs?: number } {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return { allowed: true, tokens: this.tokens };
    }

    const deficit = tokens - this.tokens;
    const retryAfterMs = (deficit / this.config.refillRate) * this.config.refillIntervalMs;
    return { allowed: false, tokens: this.tokens, retryAfterMs };
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refillCount = (elapsed / this.config.refillIntervalMs) * this.config.refillRate;
    this.tokens = Math.min(this.config.capacity, this.tokens + refillCount);
    this.lastRefill = now;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// Sliding Window Counter
export class SlidingWindowCounter {
  private windows: Map<number, number> = new Map();
  private windowSizeMs: number;
  private maxRequests: number;

  constructor(windowSizeMs: number, maxRequests: number) {
    this.windowSizeMs = windowSizeMs;
    this.maxRequests = maxRequests;
  }

  increment(): { allowed: boolean; count: number; retryAfterMs?: number } {
    const now = Date.now();
    const windowKey = Math.floor(now / this.windowSizeMs);

    // Clean old windows
    for (const [key] of this.windows) {
      if (key < windowKey - 1) {
        this.windows.delete(key);
      }
    }

    // Get current and previous window counts
    const currentCount = this.windows.get(windowKey) ?? 0;
    const prevCount = this.windows.get(windowKey - 1) ?? 0;

    // Calculate weighted count
    const elapsed = now % this.windowSizeMs;
    const weight = 1 - elapsed / this.windowSizeMs;
    const weightedCount = prevCount * weight + currentCount;

    if (weightedCount >= this.maxRequests) {
      const retryAfterMs = this.windowSizeMs - elapsed;
      return { allowed: false, count: Math.floor(weightedCount), retryAfterMs };
    }

    this.windows.set(windowKey, currentCount + 1);
    return { allowed: true, count: Math.floor(weightedCount) + 1 };
  }

  getCount(): number {
    const now = Date.now();
    const windowKey = Math.floor(now / this.windowSizeMs);
    return this.windows.get(windowKey) ?? 0;
  }
}

// Rate Limiter with multiple strategies
export class RateLimiter {
  private config: RateLimiterConfig;
  private buckets = new Map<string, TokenBucket>();
  private windows = new Map<string, SlidingWindowCounter>();
  private logger = createLogger('info', 'JSDB:RateLimit');
  private stats: RateLimitStats;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = {
      windowSizeMs: config?.windowSizeMs ?? 60000,
      maxRequests: config?.maxRequests ?? 1000,
      burstSize: config?.burstSize ?? 100,
      refillRate: config?.refillRate ?? 10,
      perTenantLimit: config?.perTenantLimit ?? true,
      gracefulDegradation: config?.gracefulDegradation ?? true,
    };

    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      rejectedRequests: 0,
      throttledRequests: 0,
      avgWaitTimeMs: 0,
      tenantStats: new Map(),
    };
  }

  check(key: string): RateLimitResult {
    this.stats.totalRequests++;

    // Update tenant stats
    if (!this.stats.tenantStats.has(key)) {
      this.stats.tenantStats.set(key, { requests: 0, rejected: 0 });
    }
    const tenantStat = this.stats.tenantStats.get(key)!;
    tenantStat.requests++;

    // Try token bucket first (for burst handling)
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket({
        capacity: this.config.burstSize,
        refillRate: this.config.refillRate,
        refillIntervalMs: 1000,
      });
      this.buckets.set(key, bucket);
    }

    const bucketResult = bucket.consume();
    if (!bucketResult.allowed) {
      this.stats.rejectedRequests++;
      tenantStat.rejected++;
      return {
        allowed: false,
        remaining: 0,
        limit: this.config.burstSize,
        resetMs: bucketResult.retryAfterMs ?? 1000,
        retryAfterMs: bucketResult.retryAfterMs,
      };
    }

    // Check sliding window
    let window = this.windows.get(key);
    if (!window) {
      window = new SlidingWindowCounter(this.config.windowSizeMs, this.config.maxRequests);
      this.windows.set(key, window);
    }

    const windowResult = window.increment();
    if (!windowResult.allowed) {
      this.stats.rejectedRequests++;
      tenantStat.rejected++;
      return {
        allowed: false,
        remaining: 0,
        limit: this.config.maxRequests,
        resetMs: windowResult.retryAfterMs ?? this.config.windowSizeMs,
        retryAfterMs: windowResult.retryAfterMs,
      };
    }

    this.stats.allowedRequests++;
    return {
      allowed: true,
      remaining: this.config.maxRequests - windowResult.count,
      limit: this.config.maxRequests,
      resetMs: this.config.windowSizeMs,
    };
  }

  getStats(): RateLimitStats {
    return { ...this.stats };
  }

  reset(key?: string): void {
    if (key) {
      this.buckets.delete(key);
      this.windows.delete(key);
    } else {
      this.buckets.clear();
      this.windows.clear();
      this.stats = {
        totalRequests: 0,
        allowedRequests: 0,
        rejectedRequests: 0,
        throttledRequests: 0,
        avgWaitTimeMs: 0,
        tenantStats: new Map(),
      };
    }
  }
}
