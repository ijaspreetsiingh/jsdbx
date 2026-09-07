// =====================================================
// JSDB v2.0 - Enterprise Features Export
// High-performance, scalable components for production
// =====================================================

// Connection Pool
export {
  EnterpriseConnectionPool,
  type PoolConfig,
  type PooledConnection,
  type PoolMetrics,
  type ConnectionFactory,
} from '../pool/connection-pool.js';

// LRU Cache
export {
  LRUCache,
  QueryCache,
  type LRUCacheConfig,
  type CacheStats,
} from '../cache/lru-cache.js';

// Circuit Breaker & Retry
export {
  CircuitBreaker,
  RetryMechanism,
  ResilienceManager,
  type CircuitState,
  type CircuitBreakerConfig,
  type CircuitStats,
  type RetryConfig,
  type RetryStats,
} from '../resilience/circuit-breaker.js';

// Query Batching & Bulk Operations
export {
  QueryBatchEngine,
  BulkOperations,
  type BatchConfig,
  type BatchedQuery,
  type BatchResult,
  type BatchExecutor,
  type BulkInsertOptions,
  type BulkInsertResult,
  type BulkUpdateOptions,
  type BulkUpdateResult,
} from '../query/batch-engine.js';

// Streaming Cursor
export {
  StreamingCursor,
  ParallelStreamManager,
  createStreamingCursor,
  type CursorConfig,
  type CursorStats,
  type TransformFn,
  type FilterFn,
  type ConsumerFn,
} from '../streaming/cursor.js';

// Rate Limiter
export {
  RateLimiter as EnterpriseRateLimiter,
  TokenBucket,
  SlidingWindowCounter,
  type RateLimiterConfig,
  type RateLimitResult,
  type RateLimitStats,
} from '../resilience/rate-limiter.js';

// Performance Monitor
export {
  PerformanceMonitor,
  SlowQueryDetector,
  N1Detector,
  type MetricsConfig,
  type MetricsSnapshot,
  type HistogramBucket,
} from '../monitoring/metrics.js';

// Memory Pool
export {
  ObjectPool,
  DocumentPool,
  getDocumentPool,
  resetDocumentPool,
  type PoolStats,
  type PooledDocument,
} from '../pool/memory-pool.js';

// Query Optimizer
export {
  QueryOptimizer,
  QueryRewriter,
  type OptimizationConfig,
  type CostEstimate,
  type OptimizationHint,
  type OptimizedPlan,
} from '../planner/query-optimizer.js';
