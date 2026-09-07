// =====================================================
// JSDB - Performance Analyzer
// =====================================================
import type { QueryTrace } from '../types/index.js';

export interface PerformanceFinding {
  type: 'n_plus_1' | 'slow_query' | 'missing_pagination' | 'select_all' | 'repeated_query' | 'large_payload' | 'cache_opportunity';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
  affectedOperations?: string[];
}

export interface PerformanceReport {
  findings: PerformanceFinding[];
  totalQueries: number;
  slowQueries: number;
  averageDuration: number;
  p95Duration: number;
  cacheHitRate: number;
  recommendations: string[];
}

export class PerformanceAnalyzer {
  private traces: QueryTrace[] = [];
  private slowThresholdMs: number;

  constructor(slowThresholdMs = 1000) {
    this.slowThresholdMs = slowThresholdMs;
  }

  recordTrace(trace: QueryTrace): void {
    this.traces.push(trace);
  }

  analyze(): PerformanceReport {
    const findings: PerformanceFinding[] = [];
    const traces = this.traces;

    if (traces.length === 0) {
      return {
        findings: [],
        totalQueries: 0,
        slowQueries: 0,
        averageDuration: 0,
        p95Duration: 0,
        cacheHitRate: 0,
        recommendations: ['No queries recorded yet. Run some queries to get performance analysis.'],
      };
    }

    // --- N+1 Detection ---
    const collectionOpCounts = new Map<string, number>();
    for (const trace of traces) {
      const key = `${trace.collection}:${trace.operation}`;
      collectionOpCounts.set(key, (collectionOpCounts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of collectionOpCounts.entries()) {
      if (count >= 10) {
        const [collection, operation] = key.split(':');
        findings.push({
          type: 'n_plus_1',
          severity: count >= 50 ? 'critical' : 'high',
          description: `Potential N+1 query detected: "${operation}" on "${collection}" called ${count} times`,
          suggestion: `Use batch loading, aggregation, or relationship loading to reduce individual queries`,
          affectedOperations: [key],
        });
      }
    }

    // --- Slow Queries ---
    const slowQueries = traces.filter((t) => t.duration > this.slowThresholdMs);
    if (slowQueries.length > 0) {
      findings.push({
        type: 'slow_query',
        severity: 'high',
        description: `${slowQueries.length} slow queries detected (>${this.slowThresholdMs}ms)`,
        suggestion: `Add indexes, optimize filters, or add pagination to slow queries`,
        affectedOperations: slowQueries.map((t) => `${t.operation}:${t.collection}`),
      });
    }

    // --- Repeated Queries ---
    const queryHashes = new Map<string, number>();
    for (const trace of traces) {
      const hash = `${trace.operation}:${trace.collection}`;
      queryHashes.set(hash, (queryHashes.get(hash) ?? 0) + 1);
    }
    for (const [hash, count] of queryHashes.entries()) {
      if (count > 5) {
        findings.push({
          type: 'repeated_query',
          severity: 'medium',
          description: `Query "${hash}" executed ${count} times — consider caching`,
          suggestion: `Enable JSDB cache: JSDB_CACHE=memory or JSDB_CACHE=redis`,
          affectedOperations: [hash],
        });
      }
    }

    // --- Cache Hit Rate ---
    const cacheHits = traces.filter((t) => t.cacheHit).length;
    const cacheHitRate = traces.length > 0 ? cacheHits / traces.length : 0;
    if (cacheHitRate < 0.2 && traces.length > 10) {
      findings.push({
        type: 'cache_opportunity',
        severity: 'medium',
        description: `Cache hit rate is ${(cacheHitRate * 100).toFixed(1)}% — many queries are not cached`,
        suggestion: `Enable caching: JSDB_CACHE=memory with JSDB_CACHE_TTL=300`,
      });
    }

    // --- Stats ---
    const durations = traces.map((t) => t.duration).sort((a, b) => a - b);
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const p95Index = Math.floor(durations.length * 0.95);
    const p95Duration = durations[p95Index] ?? durations[durations.length - 1] ?? 0;

    const recommendations = findings.map((f) => f.suggestion);
    if (recommendations.length === 0) {
      recommendations.push('Performance looks good! Keep monitoring query patterns as usage grows.');
    }

    return {
      findings,
      totalQueries: traces.length,
      slowQueries: slowQueries.length,
      averageDuration: Math.round(avgDuration),
      p95Duration: Math.round(p95Duration),
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      recommendations,
    };
  }

  formatReport(report: PerformanceReport): string {
    const lines = [
      ``,
      `╔══════════════════════════════════════════╗`,
      `║        JSDB PERFORMANCE REPORT           ║`,
      `╚══════════════════════════════════════════╝`,
      ``,
      `Total Queries:   ${report.totalQueries}`,
      `Slow Queries:    ${report.slowQueries}`,
      `Avg Duration:    ${report.averageDuration}ms`,
      `P95 Duration:    ${report.p95Duration}ms`,
      `Cache Hit Rate:  ${(report.cacheHitRate * 100).toFixed(1)}%`,
      ``,
    ];

    if (report.findings.length === 0) {
      lines.push(`  ✓  No performance issues detected`);
    } else {
      lines.push(`── Findings ─────────────────────────────────`);
      for (const f of report.findings) {
        const icon = f.severity === 'critical' ? '🔴' : f.severity === 'high' ? '🟠' : f.severity === 'medium' ? '🟡' : '🟢';
        lines.push(``, `  ${icon} [${f.severity.toUpperCase()}] ${f.description}`);
        lines.push(`     → ${f.suggestion}`);
      }
    }

    if (report.recommendations.length > 0) {
      lines.push(``, `── Recommendations ──────────────────────────`);
      for (const r of report.recommendations) {
        lines.push(`  •  ${r}`);
      }
    }

    lines.push(``);
    return lines.join('\n');
  }

  clear(): void {
    this.traces = [];
  }
}

export const performanceAnalyzer = new PerformanceAnalyzer();
