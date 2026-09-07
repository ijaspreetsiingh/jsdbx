// =====================================================
// JSDB - JavaScript Database Runtime
// Main Public API
// =====================================================

// Load .env if present (non-fatal) — users should call dotenv.config() in their app
// JSDB does not auto-load .env at module load to avoid side effects
// Use: import 'dotenv/config'; before importing jsdb

// Core Client
export { JSDBClient, createClient, createClientFromEnv } from './client/client.js';
export { JSDBCollection, CollectionQueryChain } from './client/collection.js';

// Types
export type {
  JSDBConfig,
  DatabaseType,
  Document,
  Filter,
  Update,
  SortSpec,
  ProjectionSpec,
  AggregationStage,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  FindOptions,
  FieldDefinition,
  CollectionSchema,
  SchemaDefinition,
  IndexDefinition,
  QueryTrace,
  PortabilityWarning,
  PortabilityReport,
  Logger,
  LogLevel,
  CacheConfig,
  TenancyConfig,
  Transaction,
  JoinClause,
  JoinType,
  JoinCondition,
  RecursiveCTEDefinition,
  StoredProcedureCall,
  StoredFunctionCall,
  ChangeEvent,
  WatchOptions,
  CursorPaginationOptions,
  CursorPaginationResult,
  AggregateSetWindowFields,
  AggregateBucket,
  AggregateBucketAuto,
  AggregateFacet,
  AggregateRedact,
  AggregateGraphLookup,
  AggregateUnionWith,
  AggregateSample,
  AggregateSortByCount,
  AggregateOut,
  AggregateMerge,
} from './types/index.js';

// Errors
export {
  JSDBError,
  JSDBConnectionError,
  JSDBQueryError,
  JSDBUnsupportedOperationError,
  JSDBTransactionError,
  JSDBValidationError,
  JSDBConfigurationError,
  JSDBSchemaError,
  JSDBMigrationError,
  JSDBAuthorizationError,
  JSDBTenantIsolationError,
  JSDBRateLimitError,
  normalizeError,
} from './errors/index.js';

// IR / AST
export { IRBuilder } from './ir/builder.js';
export { parseSQL, sqlToIR } from './ir/sql-parser.js';
export { nativeQueryToIR, detectDialect, checkPortability } from './ir/native-query.js';
export type {
  IRNode,
  ExecutionPlan,
  IRJoinNode,
  IRRecursiveCTENode,
  IRStoredProcedureNode,
  IRStoredFunctionNode,
  IRWatchNode,
  IRCursorPaginateNode,
  IRBatchNode,
  IROperationType,
} from './ir/nodes.js';
export type { ParsedSQL, ParsedSelect, ParsedInsert, ParsedUpdate, ParsedDelete } from './ir/sql-parser.js';

// Capabilities
export { globalRegistry, CapabilityRegistry } from './capabilities/index.js';
export type { CapabilityEntry, CapabilityStatus } from './capabilities/registry.js';

// Query Planner
export { QueryPlanner, queryPlanner, strictPlanner } from './planner/planner.js';
export { PlanCache, globalPlanCache } from './planner/cache.js';
export { QueryOptimizer, PipelineOptimizer } from './planner/optimizer.js';
export type { OptimizedPlan, OptimizationHint } from './planner/optimizer.js';

// Query Builder
export { QueryBuilder, TableQueryBuilder } from './query/builder.js';
export { QueryBatcher, BatchExecutor } from './query/batch.js';
export type { BatchOptions, BatchResult } from './query/batch.js';

// Real-time
export {
  ChangeListener,
  MongoChangeListener,
  PostgresChangeListener,
  PollingChangeListener,
  RealtimeManager,
} from './realtime/index.js';
export type { ChangeStreamOptions, RealtimeConnection } from './realtime/index.js';

// Cache
export {
  CacheManager,
  MemoryCacheProvider,
  NoCacheProvider,
  RedisCacheProvider,
  createCacheManager,
} from './cache/cache.js';

// Schema Engine
export { SchemaEngine } from './schema/engine.js';
export type { DDLStatement } from './schema/engine.js';

// Migration
export { MigrationEngine } from './migration/engine.js';
export type { MigrationContext } from './migration/engine.js';

// Analyzers
export { PortabilityAnalyzer, portabilityAnalyzer } from './analyzers/portability.js';
export { PerformanceAnalyzer, performanceAnalyzer } from './analyzers/performance.js';
export { SecurityAnalyzer, securityAnalyzer } from './analyzers/security.js';

// Security
export {
  SecurityManager,
  RBACManager,
  FieldAccessControl,
  TenantIsolation,
  RateLimiter,
  AuditLogger,
} from './security/index.js';
export type { SecurityContext, RoleDefinition, FieldAccessPolicy } from './security/index.js';

// Observability
export {
  ObservabilityManager,
  TraceContext,
  globalObservability,
  N1Detector,
} from './observability/index.js';

// Utilities
export { createLogger, setLogger, getLogger, silentLogger } from './utils/logger.js';
export { loadConfigFromEnv, mergeConfig, validateConfig } from './utils/config.js';
export { generateId, generateUUID, validateIdentifier, validateCollectionName } from './utils/id.js';

// Adapters (for advanced usage)
export { MySQLAdapter } from './adapters/mysql/adapter.js';
export { MongoDBAdapter } from './adapters/mongodb/adapter.js';
export { PostgreSQLAdapter } from './adapters/postgres/adapter.js';
export { SQLiteAdapter } from './adapters/sqlite/adapter.js';
export { createAdapter } from './adapters/index.js';

// Enterprise Features (v2.0)
export {
  EnterpriseConnectionPool,
  LRUCache,
  QueryCache,
  CircuitBreaker,
  RetryMechanism,
  ResilienceManager,
  QueryBatchEngine,
  BulkOperations,
  StreamingCursor,
  ParallelStreamManager,
  EnterpriseRateLimiter,
  PerformanceMonitor,
  SlowQueryDetector,
  ObjectPool,
  DocumentPool,
} from './enterprise/index.js';

export { QueryOptimizer as EnterpriseQueryOptimizer } from './enterprise/index.js';

// Translation System (v2.0)
export {
  SQLToMongoTranslator,
  MongoToSQLTranslator,
  PortabilityAnalyzer as TranslationAnalyzer,
  portabilityAnalyzer as translationAnalyzer,
  type TranslationStatus,
  type FeatureTranslation,
  type TranslationReport,
  type SQLToMongoResult,
  type MongoToSQLResult,
  type AnalyzeResult,
  type ExplainResult,
  type DryRunResult,
} from './translation/index.js';

// Schema Mapping System
export {
  SchemaMappingManager,
  schemaMappingManager,
  DEFAULT_TYPE_MAPPINGS,
  type CollectionMapping,
  type FieldMapping,
  type RelationshipMapping,
  type SchemaMapping,
  type TypeMappingEntry,
} from './schema/mapping.js';

// MySQL Compiler (advanced usage)
export {
  compileFilter as mysqlCompileFilter,
  compileSort as mysqlCompileSort,
  compileProjection as mysqlCompileProjection,
  compileUpdate as mysqlCompileUpdate,
  compileAggregation as mysqlCompileAggregation,
  compileDeepJoin as mysqlCompileDeepJoin,
  compileRecursiveCTE as mysqlCompileRecursiveCTE,
  compileWindowFunction as mysqlCompileWindowFunction,
  compileFacet as mysqlCompileFacet,
  compileBucket as mysqlCompileBucket,
  compileStoredProcedure as mysqlCompileStoredProcedure,
  compileStoredFunction as mysqlCompileStoredFunction,
  compileCursorPagination as mysqlCompileCursorPagination,
} from './adapters/mysql/compiler.js';

// MongoDB Compiler (advanced usage)
export {
  compileFilter as mongoCompileFilter,
  compileSort as mongoCompileSort,
  compileProjection as mongoCompileProjection,
  compileUpdate as mongoCompileUpdate,
  compileAggregationPipeline as mongoCompileAggregationPipeline,
} from './adapters/mongodb/compiler.js';

// PostgreSQL Compiler (advanced usage)
export {
  compileFilter as pgCompileFilter,
  compileSort as pgCompileSort,
  compileProjection as pgCompileProjection,
  compileUpdate as pgCompileUpdate,
  compileAggregation as pgCompileAggregation,
  compileDeepJoin as pgCompileDeepJoin,
  compileRecursiveCTE as pgCompileRecursiveCTE,
  compileWindowFunction as pgCompileWindowFunction,
  compileFacet as pgCompileFacet,
  compileBucket as pgCompileBucket,
  compileStoredProcedure as pgCompileStoredProcedure,
  compileStoredFunction as pgCompileStoredFunction,
  compileCursorPagination as pgCompileCursorPagination,
} from './adapters/postgres/compiler.js';

// Compatibility Layer (driver proxies for existing projects)
export { execSQL, ensureConnected, getSharedAdapter, setSharedAdapter, getSharedConfig, resetSharedAdapter } from './compat/index.js';
export type { CompatQueryResult } from './compat/index.js';

// MongoDB compat proxy exports
export { MongoClient, ObjectId, GridFSBucket, MongoError, MongoServerError, MongoNetworkError } from './compat/mongodb.js';
