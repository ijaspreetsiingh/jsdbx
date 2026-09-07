// =====================================================
// JSDB v2.0 - Performance Monitor & Metrics Collector
// Real-time metrics, histograms, percentiles
// =====================================================
import { createLogger } from '../utils/logger.js';
import { generateId } from '../utils/id.js';

export interface MetricsConfig {
  enableHistograms: boolean;
  histogramBucketCount: number;
  enablePercentiles: boolean;
  percentiles: number[];
  windowSizeMs: number;
  exportIntervalMs: number;
}

export interface HistogramBucket {
  lower: number;
  upper: number;
  count: number;
}

export interface MetricsSnapshot {
  timestamp: number;
  queries: {
    total: number;
    perSecond: number;
    avgLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    maxLatencyMs: number;
    errorRate: number;
  };
  connections: {
    active: number;
    idle: number;
    waiting: number;
    totalCreated: number;
    totalDestroyed: number;
  };
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    size: number;
  };
  memory: {
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    rssMb: number;
  };
  operations: {
    reads: number;
    writes: number;
    deletes: number;
    aggregations: number;
  };
}

export class PerformanceMonitor {
  private config: MetricsConfig;
  private logger = createLogger('info', 'JSDB:Monitor');

  // Query metrics
  private queryLatencies: number[] = [];
  private queryTimestamps: number[] = [];
  private queryErrors = 0;
  private totalQueries = 0;

  // Operation counters
  private reads = 0;
  private writes = 0;
  private deletes = 0;
  private aggregations = 0;

  // Histogram
  private histogramBuckets: HistogramBucket[] = [];

  // Sliding window
  private windowStart = Date.now();

  constructor(config?: Partial<MetricsConfig>) {
    this.config = {
      enableHistograms: config?.enableHistograms ?? true,
      histogramBucketCount: config?.histogramBucketCount ?? 20,
      enablePercentiles: config?.enablePercentiles ?? true,
      percentiles: config?.percentiles ?? [50, 75, 90, 95, 99],
      windowSizeMs: config?.windowSizeMs ?? 60000,
      exportIntervalMs: config?.exportIntervalMs ?? 10000,
    };

    this.initializeHistogram();
  }

  recordQuery(latencyMs: number, isError: boolean = false): void {
    this.totalQueries++;
    this.queryLatencies.push(latencyMs);
    this.queryTimestamps.push(Date.now());

    if (isError) this.queryErrors++;

    // Keep only last N entries
    const maxEntries = 10000;
    if (this.queryLatencies.length > maxEntries) {
      this.queryLatencies = this.queryLatencies.slice(-maxEntries);
      this.queryTimestamps = this.queryTimestamps.slice(-maxEntries);
    }

    // Update histogram
    if (this.config.enableHistograms) {
      this.updateHistogram(latencyMs);
    }

    // Clean old entries
    const cutoff = Date.now() - this.config.windowSizeMs;
    while (this.queryTimestamps.length > 0 && this.queryTimestamps[0]! < cutoff) {
      this.queryTimestamps.shift();
      this.queryLatencies.shift();
    }
  }

  recordRead(): void { this.reads++; }
  recordWrite(): void { this.writes++; }
  recordDelete(): void { this.deletes++; }
  recordAggregation(): void { this.aggregations++; }

  getSnapshot(
    connectionMetrics?: { active: number; idle: number; waiting: number; totalCreated: number; totalDestroyed: number },
    cacheMetrics?: { hits: number; misses: number; hitRate: number; evictions: number; size: number }
  ): MetricsSnapshot {
    const sorted = [...this.queryLatencies].sort((a, b) => a - b);
    const now = Date.now();
    const windowMs = now - this.windowStart;
    const windowQueries = this.queryTimestamps.filter((t) => t >= this.windowStart).length;

    const mem = process.memoryUsage();

    return {
      timestamp: now,
      queries: {
        total: this.totalQueries,
        perSecond: windowMs > 0 ? (windowQueries / windowMs) * 1000 : 0,
        avgLatencyMs: sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
        p50LatencyMs: this.getPercentile(sorted, 50),
        p95LatencyMs: this.getPercentile(sorted, 95),
        p99LatencyMs: this.getPercentile(sorted, 99),
        maxLatencyMs: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
        errorRate: this.totalQueries > 0 ? this.queryErrors / this.totalQueries : 0,
      },
      connections: connectionMetrics ?? { active: 0, idle: 0, waiting: 0, totalCreated: 0, totalDestroyed: 0 },
      cache: cacheMetrics ?? { hits: 0, misses: 0, hitRate: 0, evictions: 0, size: 0 },
      memory: {
        heapUsedMb: mem.heapUsed / (1024 * 1024),
        heapTotalMb: mem.heapTotal / (1024 * 1024),
        externalMb: mem.external / (1024 * 1024),
        rssMb: mem.rss / (1024 * 1024),
      },
      operations: {
        reads: this.reads,
        writes: this.writes,
        deletes: this.deletes,
        aggregations: this.aggregations,
      },
    };
  }

  getHistogram(): HistogramBucket[] {
    return this.histogramBuckets;
  }

  reset(): void {
    this.queryLatencies = [];
    this.queryTimestamps = [];
    this.queryErrors = 0;
    this.totalQueries = 0;
    this.reads = 0;
    this.writes = 0;
    this.deletes = 0;
    this.aggregations = 0;
    this.windowStart = Date.now();
    this.initializeHistogram();
  }

  private initializeHistogram(): void {
    this.histogramBuckets = [];
    const maxLatency = 10000; // 10 seconds
    const step = maxLatency / this.config.histogramBucketCount;

    for (let i = 0; i < this.config.histogramBucketCount; i++) {
      this.histogramBuckets.push({
        lower: i * step,
        upper: (i + 1) * step,
        count: 0,
      });
    }
  }

  private updateHistogram(latencyMs: number): void {
    for (const bucket of this.histogramBuckets) {
      if (latencyMs >= bucket.lower && latencyMs < bucket.upper) {
        bucket.count++;
        break;
      }
    }
  }

  private getPercentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)]!;
  }
}

// Slow query detector
export class SlowQueryDetector {
  private thresholdMs: number;
  private recentQueries: Array<{ operation: string; collection: string; duration: number; timestamp: number }> = [];
  private maxEntries: number;
  private logger = createLogger('info', 'JSDB:SlowQuery');

  constructor(thresholdMs = 1000, maxEntries = 1000) {
    this.thresholdMs = thresholdMs;
    this.maxEntries = maxEntries;
  }

  record(operation: string, collection: string, durationMs: number): boolean {
    if (durationMs > this.thresholdMs) {
      this.recentQueries.push({
        operation,
        collection,
        duration: durationMs,
        timestamp: Date.now(),
      });

      if (this.recentQueries.length > this.maxEntries) {
        this.recentQueries.shift();
      }

      this.logger.warn('Slow query detected', {
        operation,
        collection,
        duration: durationMs,
      });

      return true;
    }
    return false;
  }

  getSlowQueries(limit = 10): Array<{ operation: string; collection: string; duration: number }> {
    return this.recentQueries
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, limit);
  }

  getStats(): { total: number; slowCount: number; avgSlowDuration: number } {
    const slow = this.recentQueries;
    return {
      total: slow.length,
      slowCount: slow.length,
      avgSlowDuration: slow.length > 0 ? slow.reduce((a, b) => a + b.duration, 0) / slow.length : 0,
    };
  }
}

// N+1 Query Detector
export class N1Detector {
  private patterns = new Map<string, { count: number; timestamps: number[] }>();
  private threshold: number;
  private windowMs: number;

  constructor(threshold = 10, windowMs = 1000) {
    this.threshold = threshold;
    this.windowMs = windowMs;
  }

  record(pattern: string): boolean {
    const now = Date.now();
    const entry = this.patterns.get(pattern) ?? { count: 0, timestamps: [] };

    // Clean old timestamps
    entry.timestamps = entry.timestamps.filter((t) => now - t < this.windowMs);
    entry.timestamps.push(now);
    entry.count = entry.timestamps.length;

    this.patterns.set(pattern, entry);

    return entry.count >= this.threshold;
  }

  getWarnings(): Array<{ pattern: string; count: number }> {
    const warnings: Array<{ pattern: string; count: number }> = [];
    for (const [pattern, entry] of this.patterns) {
      if (entry.count >= this.threshold) {
        warnings.push({ pattern, count: entry.count });
      }
    }
    return warnings;
  }

  reset(): void {
    this.patterns.clear();
  }
}
