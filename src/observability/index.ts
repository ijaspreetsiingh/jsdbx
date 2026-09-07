// =====================================================
// JSDB - Observability / Structured Tracing
// =====================================================
import type { DatabaseType, QueryTrace } from '../types/index.js';
import { generateId } from '../utils/id.js';
import { createLogger } from '../utils/logger.js';

export type TraceHandler = (trace: QueryTrace) => void;

export class ObservabilityManager {
  private handlers: TraceHandler[] = [];
  private logger = createLogger('info', 'JSDB:Observability');
  private slowQueryThresholdMs: number;
  private enabled: boolean;

  constructor(options: { slowQueryThresholdMs?: number; enabled?: boolean } = {}) {
    this.slowQueryThresholdMs = options.slowQueryThresholdMs ?? 1000;
    this.enabled = options.enabled ?? true;
  }

  addHandler(handler: TraceHandler): void {
    this.handlers.push(handler);
  }

  removeHandler(handler: TraceHandler): void {
    this.handlers = this.handlers.filter((h) => h !== handler);
  }

  startTrace(
    operation: string,
    collection: string,
    database: DatabaseType,
    meta?: { requestId?: string; tenantId?: string }
  ): TraceContext {
    return new TraceContext(
      operation,
      collection,
      database,
      this,
      meta?.requestId ?? generateId(),
      meta?.tenantId
    );
  }

  emit(trace: QueryTrace): void {
    if (!this.enabled) return;

    // Log slow queries
    if (trace.duration > this.slowQueryThresholdMs) {
      this.logger.warn('Slow query detected', {
        operation: trace.operation,
        collection: trace.collection,
        duration: trace.duration,
        database: trace.database,
      });
    }

    // Log errors
    if (trace.error) {
      this.logger.error('Query error', {
        operation: trace.operation,
        collection: trace.collection,
        error: trace.error,
        database: trace.database,
      });
    }

    // Call registered handlers
    for (const handler of this.handlers) {
      try {
        handler(trace);
      } catch {
        // Handler errors must not affect query execution
      }
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
}

export class TraceContext {
  private startTime: number;
  public readonly queryId: string;
  public readonly requestId: string;

  constructor(
    private operation: string,
    private collection: string,
    private database: DatabaseType,
    private manager: ObservabilityManager,
    requestId: string,
    private tenantId?: string
  ) {
    this.startTime = Date.now();
    this.queryId = generateId();
    this.requestId = requestId;
  }

  end(options: { cacheHit?: boolean; error?: string } = {}): QueryTrace {
    const duration = Date.now() - this.startTime;
    const trace: QueryTrace = {
      requestId: this.requestId,
      queryId: this.queryId,
      database: this.database,
      adapter: this.database,
      operation: this.operation,
      collection: this.collection,
      duration,
      cacheHit: options.cacheHit ?? false,
      error: options.error,
      timestamp: new Date(),
      tenantId: this.tenantId,
    };
    this.manager.emit(trace);
    return trace;
  }
}

// Singleton
export const globalObservability = new ObservabilityManager();

// N+1 Detection
export class N1Detector {
  private callCounts = new Map<string, number>();
  private threshold: number;

  constructor(threshold = 10) {
    this.threshold = threshold;
  }

  record(collection: string, operation: string): boolean {
    const key = `${collection}:${operation}`;
    const count = (this.callCounts.get(key) ?? 0) + 1;
    this.callCounts.set(key, count);

    if (count >= this.threshold) {
      return true; // N+1 detected
    }
    return false;
  }

  getCount(collection: string, operation: string): number {
    return this.callCounts.get(`${collection}:${operation}`) ?? 0;
  }

  reset(): void {
    this.callCounts.clear();
  }

  getWarnings(): Array<{ collection: string; operation: string; count: number }> {
    const warnings: Array<{ collection: string; operation: string; count: number }> = [];
    for (const [key, count] of this.callCounts.entries()) {
      if (count >= this.threshold) {
        const [collection, operation] = key.split(':');
        warnings.push({ collection, operation, count });
      }
    }
    return warnings;
  }
}
