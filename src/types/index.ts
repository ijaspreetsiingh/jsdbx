// =====================================================
// JSDB - Core Type Definitions
// =====================================================

export type DatabaseType = 'mysql' | 'mongodb' | 'postgres' | 'sqlite';

export type CapabilityStatus = 'native' | 'emulated' | 'unsupported';

export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

// ---------------------------------------------------
// Document Model
// ---------------------------------------------------
export type Scalar = string | number | boolean | null | Date;
export type DocumentValue = Scalar | Document | DocumentValue[] | undefined;
export interface Document {
  [key: string]: DocumentValue;
}

// ---------------------------------------------------
// Filter / Query Operators
// ---------------------------------------------------
export interface ComparisonFilter {
  $eq?: Scalar;
  $ne?: Scalar;
  $gt?: Scalar;
  $gte?: Scalar;
  $lt?: Scalar;
  $lte?: Scalar;
  $in?: Scalar[];
  $nin?: Scalar[];
  $like?: string;
  $ilike?: string;
  $regex?: string;
  $exists?: boolean;
  $type?: string;
  $elemMatch?: Filter;
  $all?: Scalar[];
  $size?: number;
}

export type FieldFilter = Scalar | ComparisonFilter;

export interface LogicalFilter {
  $and?: Filter[];
  $or?: Filter[];
  $nor?: Filter[];
  $not?: Filter;
}

export type Filter = LogicalFilter & {
  [field: string]: FieldFilter | Filter;
};

// ---------------------------------------------------
// Update Operators
// ---------------------------------------------------
export interface UpdateOperators {
  $set?: Document;
  $unset?: { [field: string]: '' };
  $inc?: { [field: string]: number };
  $push?: { [field: string]: DocumentValue };
  $pull?: { [field: string]: DocumentValue };
  $addToSet?: { [field: string]: DocumentValue };
  $rename?: { [field: string]: string };
  $mul?: { [field: string]: number };
  $min?: { [field: string]: Scalar };
  $max?: { [field: string]: Scalar };
  $currentDate?: { [field: string]: boolean | { $type: 'date' | 'timestamp' } };
}

export type Update = UpdateOperators | Document;

// ---------------------------------------------------
// Sort / Projection / Options
// ---------------------------------------------------
export type SortDirection = 1 | -1 | 'asc' | 'desc';
export type SortSpec = { [field: string]: SortDirection };
export type ProjectionSpec = { [field: string]: 0 | 1 | boolean };

export interface FindOptions {
  sort?: SortSpec;
  limit?: number;
  offset?: number;
  skip?: number;
  projection?: ProjectionSpec;
  hint?: string | Document;
  timeout?: number;
}

export interface InsertOneResult {
  insertedId: string;
  acknowledged: boolean;
}

export interface InsertManyResult {
  insertedIds: string[];
  insertedCount: number;
  acknowledged: boolean;
}

export interface UpdateResult {
  matchedCount: number;
  modifiedCount: number;
  upsertedId?: string;
  acknowledged: boolean;
}

export interface DeleteResult {
  deletedCount: number;
  acknowledged: boolean;
}

export interface CountResult {
  count: number;
}

// ---------------------------------------------------
// Aggregation Pipeline
// ---------------------------------------------------
// Aggregation Stages
// ---------------------------------------------------
export interface AggregateMatch { $match: Filter }
export interface AggregateGroup {
  $group: {
    _id: DocumentValue | null;
    [accumulator: string]: DocumentValue | AggregateAccumulator;
  };
}
export interface AggregateAccumulator {
  $sum?: DocumentValue;
  $avg?: DocumentValue;
  $min?: DocumentValue;
  $max?: DocumentValue;
  $count?: DocumentValue;
  $push?: DocumentValue;
  $addToSet?: DocumentValue;
  $first?: DocumentValue;
  $last?: DocumentValue;
}
export interface AggregateProject { $project: Document }
export interface AggregateSort { $sort: SortSpec }
export interface AggregateLimit { $limit: number }
export interface AggregateSkip { $skip: number }
export interface AggregateLookup {
  $lookup: {
    from: string;
    localField: string;
    foreignField: string;
    as: string;
    pipeline?: AggregationStage[];
  };
}
export interface AggregateUnwind {
  $unwind: string | {
    path: string;
    includeArrayIndex?: string;
    preserveNullAndEmptyArrays?: boolean;
  };
}
export interface AggregateAddFields { $addFields: Document }
export interface AggregateCount { $count: string }
export interface AggregateReplaceRoot { $replaceRoot: { newRoot: DocumentValue } }

// --- Advanced Aggregation Stages ---

export interface AggregateSetWindowFields {
  $setWindowFields: {
    partitionBy?: string;
    sortBy?: SortSpec;
    output: {
      [fieldName: string]: {
        $function: '$rank' | '$denseRank' | '$rowNumber' | '$sum' | '$avg' | '$min' | '$max' | '$first' | '$last' | '$shift' | '$expMovingAvg';
        $value?: DocumentValue;
        $order?: SortDirection;
        window?: {
          documents?: [number | string, number | string];
          range?: [number | string, number | string];
        };
      };
    };
  };
}

export interface AggregateBucket {
  $bucket: {
    groupBy: string;
    boundaries: unknown[];
    default?: string;
    output?: Document;
  };
}

export interface AggregateBucketAuto {
  $bucketAuto: {
    groupBy: string;
    buckets: number;
    output?: Document;
  };
}

export interface AggregateFacet {
  $facet: {
    [fieldName: string]: AggregationStage[];
  };
}

export interface AggregateRedact {
  $redact: {
    cond: Document;
    then?: '$$KEEP' | '$$PRUNE' | '$$DESCEND';
    else?: '$$KEEP' | '$$PRUNE' | '$$DESCEND';
  };
}

export interface AggregateGraphLookup {
  $graphLookup: {
    from: string;
    startWith: string | DocumentValue;
    connectFromField: string;
    connectToField: string;
    as: string;
    maxDepth?: number;
    depthField?: string;
    restrictSearchWith?: Filter;
  };
}

export interface AggregateUnionWith {
  $unionWith: {
    coll: string;
    pipeline?: AggregationStage[];
  };
}

export interface AggregateSample {
  $sample: { size: number };
}

export interface AggregateSortByCount {
  $sortByCount: string;
}

export interface AggregateOut {
  $out: string | { db: string; coll: string };
}

export interface AggregateMerge {
  $merge: {
    into: string | { db: string; coll: string };
    on?: string | string[];
    whenMatched?: 'replace' | 'merge' | 'keepExisting' | 'fail' | 'pipeline';
    whenNotMatched?: 'insert' | 'discard' | 'fail';
  };
}

export type AggregationStage =
  | AggregateMatch
  | AggregateGroup
  | AggregateProject
  | AggregateSort
  | AggregateLimit
  | AggregateSkip
  | AggregateLookup
  | AggregateUnwind
  | AggregateAddFields
  | AggregateCount
  | AggregateReplaceRoot
  | AggregateSetWindowFields
  | AggregateBucket
  | AggregateBucketAuto
  | AggregateFacet
  | AggregateRedact
  | AggregateGraphLookup
  | AggregateUnionWith
  | AggregateSample
  | AggregateSortByCount
  | AggregateOut
  | AggregateMerge
  | { [key: string]: unknown };

// ---------------------------------------------------
// Configuration
// ---------------------------------------------------
export interface MysqlConnectionConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | object;
  timezone?: string;
  charset?: string;
}

export interface MongoConnectionConfig {
  uri?: string;
  database?: string;
  tls?: boolean;
  authSource?: string;
  replicaSet?: string;
}

export interface PostgresConnectionConfig {
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | object;
  connectionString?: string;
}

export interface SqliteConnectionConfig {
  filename?: string;
  memory?: boolean;
  readonly?: boolean;
  fileMustExist?: boolean;
}

export type ConnectionConfig =
  | MysqlConnectionConfig
  | MongoConnectionConfig
  | PostgresConnectionConfig
  | SqliteConnectionConfig;

export interface PoolConfig {
  min?: number;
  max?: number;
  idleTimeoutMs?: number;
  acquireTimeoutMs?: number;
  createTimeoutMs?: number;
}

export interface LoggingConfig {
  level?: LogLevel;
  logger?: Logger;
  logQueries?: boolean;
  slowQueryThresholdMs?: number;
}

export interface CacheConfig {
  provider?: 'none' | 'memory' | 'redis';
  ttlSeconds?: number;
  redisUrl?: string;
  maxSize?: number;
}

export interface TenancyConfig {
  enabled?: boolean;
  tenantField?: string;
  getTenantId?: () => string | undefined;
}

export interface JSDBConfig {
  database: DatabaseType;
  connection?: ConnectionConfig;
  pool?: PoolConfig;
  logging?: LoggingConfig;
  cache?: CacheConfig;
  tenancy?: TenancyConfig;
  devMode?: boolean;
  queryTimeoutMs?: number;
}

// ---------------------------------------------------
// Logger Interface
// ---------------------------------------------------
export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ---------------------------------------------------
// Query Result
// ---------------------------------------------------
export interface QueryResult<T = Document> {
  data: T[];
  count?: number;
  metadata?: QueryMetadata;
}

export interface QueryMetadata {
  database: DatabaseType;
  operation: string;
  duration: number;
  cacheHit: boolean;
  warnings: string[];
  requestId?: string;
  queryId?: string;
}

// ---------------------------------------------------
// Transaction
// ---------------------------------------------------
export interface Transaction {
  id: string;
  database: DatabaseType;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  isActive(): boolean;
}

// ---------------------------------------------------
// Schema Types
// ---------------------------------------------------
export type FieldType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'objectId'
  | 'uuid'
  | 'json'
  | 'text'
  | 'float'
  | 'decimal'
  | 'binary'
  | 'array'
  | 'object';

export interface FieldDefinition {
  type: FieldType;
  required?: boolean;
  nullable?: boolean;
  default?: DocumentValue;
  unique?: boolean;
  index?: boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  references?: {
    collection: string;
    field: string;
  };
  enum?: Scalar[];
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  precision?: number;
  scale?: number;
}

export interface IndexDefinition {
  name?: string;
  fields: string[];
  unique?: boolean;
  sparse?: boolean;
  ttl?: number;
  fulltext?: boolean;
  partial?: Filter;
}

export interface CollectionSchema {
  name: string;
  fields: { [fieldName: string]: FieldDefinition };
  indexes?: IndexDefinition[];
  timestamps?: boolean;
  softDelete?: boolean;
}

export interface SchemaDefinition {
  collections: { [collectionName: string]: CollectionSchema };
  version?: string;
}

// ---------------------------------------------------
// Relationship Types
// ---------------------------------------------------
export type RelationshipType = 'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany';

export interface RelationshipDefinition {
  type: RelationshipType;
  from: string;
  to: string;
  localField: string;
  foreignField: string;
  as?: string;
}

// ---------------------------------------------------
// Portability
// ---------------------------------------------------
export interface PortabilityWarning {
  code: string;
  message: string;
  operation?: string;
  suggestion?: string;
  affectedDatabases?: DatabaseType[];
}

export interface PortabilityReport {
  database: DatabaseType;
  score: number;
  portable: string[];
  warnings: PortabilityWarning[];
  unsupported: string[];
}

// ---------------------------------------------------
// Observability
// ---------------------------------------------------
export interface QueryTrace {
  requestId: string;
  queryId: string;
  database: DatabaseType;
  adapter: DatabaseType;
  operation: string;
  collection: string;
  duration: number;
  cacheHit: boolean;
  error?: string;
  timestamp: Date;
  tenantId?: string;
}

// ---------------------------------------------------
// Migration
// ---------------------------------------------------
export interface MigrationRecord {
  id: string;
  name: string;
  appliedAt: Date;
  checksum: string;
}

export interface MigrationDefinition {
  id: string;
  name: string;
  up: (db: unknown) => Promise<void>;
  down?: (db: unknown) => Promise<void>;
}

// ---------------------------------------------------
// Deep Joins
// ---------------------------------------------------
export type JoinType = 'inner' | 'left' | 'right' | 'cross';

export interface JoinCondition {
  localField: string;
  foreignField: string;
  operator?: '=' | '!=' | '>' | '<' | '>=' | '<=';
}

export interface JoinClause {
  collection: string;
  as: string;
  on: JoinCondition;
  type?: JoinType;
}

// ---------------------------------------------------
// Recursive CTE
// ---------------------------------------------------
export type RecursiveSearchMode = 'depth' | 'breadth';

export interface RecursiveCTEDefinition {
  name: string;
  startWith: Filter;
  connectBy: {
    field: string;
    references: string;
  };
  maxDepth?: number;
  search?: RecursiveSearchMode;
  cycleDetection?: boolean;
}

// ---------------------------------------------------
// Stored Procedures / Functions
// ---------------------------------------------------
export interface StoredProcedureCall {
  name: string;
  parameters: unknown[];
  outputType?: 'resultset' | 'single' | 'void';
}

export interface StoredFunctionCall {
  name: string;
  parameters: unknown[];
}

// ---------------------------------------------------
// Real-time / Change Streams
// ---------------------------------------------------
export type ChangeOperationType = 'insert' | 'update' | 'replace' | 'delete' | 'invalidate' | 'drop';

export interface ChangeEvent {
  operationType: ChangeOperationType;
  ns: { db: string; coll: string };
  documentKey: { _id: unknown };
  fullDocument?: Document;
  updateDescription?: {
    updatedFields: Document;
    removedFields: string[];
  };
  clusterTime?: Date;
  operationTime?: Date;
}

export interface WatchOptions {
  fullDocument?: 'updateLookup' | 'default' | 'whenAvailable';
  resumeAfter?: unknown;
  startAfter?: unknown;
  startAtOperationTime?: Date;
}

// ---------------------------------------------------
// Cursor-based Pagination
// ---------------------------------------------------
export interface CursorPaginationOptions {
  after?: string;
  before?: string;
  limit: number;
  sortField?: string;
  sortOrder?: SortDirection;
}

export interface CursorPaginationResult<T = Document> {
  data: T[];
  hasNext: boolean;
  hasPrev: boolean;
  nextCursor?: string;
  prevCursor?: string;
  total?: number;
}

// ---------------------------------------------------
// Enterprise Features: Window Functions
// ---------------------------------------------------
export type WindowFunctionType = 'ROW_NUMBER' | 'RANK' | 'DENSE_RANK' | 'NTILE' | 'LAG' | 'LEAD' | 'FIRST_VALUE' | 'LAST_VALUE' | 'NTH_VALUE' | 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX';

export interface WindowFunctionSpec {
  fn: WindowFunctionType;
  args?: unknown[];
  partitionBy?: string[];
  orderBy?: SortSpec;
  frame?: {
    type: 'ROWS' | 'RANGE' | 'GROUPS';
    start: 'UNBOUNDED PRECEDING' | 'CURRENT ROW' | number | 'PRECEDING' | 'FOLLOWING' | 'UNBOUNDED FOLLOWING';
    end?: 'UNBOUNDED FOLLOWING' | 'CURRENT ROW' | number | 'PRECEDING' | 'FOLLOWING' | 'UNBOUNDED PRECEDING';
  };
}

export interface WindowDefinition {
  name: string;
  spec: WindowFunctionSpec;
}

// ---------------------------------------------------
// Enterprise Features: CTE (Common Table Expressions)
// ---------------------------------------------------
export interface CTEDefinition {
  name: string;
  columns?: string[];
  materialized?: 'MATERIALIZED' | 'NOT MATERIALIZED';
  recursive?: boolean;
  query: {
    type: 'select' | 'insert' | 'update' | 'delete';
    sql: string;
  };
}

// ---------------------------------------------------
// Enterprise Features: Triggers
// ---------------------------------------------------
export type TriggerTiming = 'BEFORE' | 'AFTER' | 'INSTEAD OF';
export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface TriggerDefinition {
  name: string;
  timing: TriggerTiming;
  events: TriggerEvent[];
  table: string;
  forEachRow: boolean;
  when?: string;
  body: string;
  delimiter?: string;
}

// ---------------------------------------------------
// Enterprise Features: Stored Procedures Enhanced
// ---------------------------------------------------
export interface StoredProcedureParameter {
  name: string;
  type: string;
  direction?: 'IN' | 'OUT' | 'INOUT';
  defaultValue?: unknown;
}

export interface StoredProcedureDefinition {
  name: string;
  parameters: StoredProcedureParameter[];
  body: string;
  language?: 'SQL' | 'PL/pgSQL' | 'MySQL' | 'PL/SQL';
  deterministic?: boolean;
  comment?: string;
}

// ---------------------------------------------------
// Enterprise Features: Views
// ---------------------------------------------------
export interface ViewDefinition {
  name: string;
  columns?: string[];
  sql: string;
  checkOption?: 'LOCAL' | 'CASCADE';
  securityBarrier?: boolean;
}

// ---------------------------------------------------
// Enterprise Features: Transactions Enhanced
// ---------------------------------------------------
export interface TransactionIsolation {
  level: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  readOnly?: boolean;
  deferrable?: boolean;
}

export interface SavepointDefinition {
  name: string;
}

// ---------------------------------------------------
// Enterprise Features: Batch Operations
// ---------------------------------------------------
export interface BatchOperation {
  type: 'insert' | 'update' | 'delete' | 'upsert';
  collection: string;
  documents?: Document[];
  filter?: Filter;
  update?: Update;
  onConflict?: 'ignore' | 'replace' | 'update';
}

export interface BatchOptions {
  ordered?: boolean;
  transaction?: boolean;
  chunkSize?: number;
  continueOnError?: boolean;
}

// ---------------------------------------------------
// Enterprise Features: Schema DDL
// ---------------------------------------------------
export interface ColumnDefinition {
  name: string;
  type: string;
  length?: number;
  precision?: number;
  scale?: number;
  nullable?: boolean;
  defaultValue?: unknown;
  autoIncrement?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  comment?: string;
  references?: {
    table: string;
    column: string;
    onDelete?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
    onUpdate?: 'CASCADE' | 'SET NULL' | 'SET DEFAULT' | 'RESTRICT' | 'NO ACTION';
  };
}

export interface DDLIndexDefinition {
  name: string;
  table: string;
  columns: string[];
  unique?: boolean;
  type?: 'BTREE' | 'HASH' | 'GIN' | 'GIST' | 'FULLTEXT';
  where?: string;
}

export interface AlterTableOperation {
  type: 'ADD_COLUMN' | 'DROP_COLUMN' | 'RENAME_COLUMN' | 'MODIFY_COLUMN' | 'ADD_INDEX' | 'DROP_INDEX' | 'ADD_CONSTRAINT' | 'DROP_CONSTRAINT' | 'RENAME_TABLE';
  table: string;
  column?: ColumnDefinition;
  columnName?: string;
  newName?: string;
  index?: IndexDefinition;
  constraint?: {
    name: string;
    type: 'UNIQUE' | 'CHECK' | 'FOREIGN KEY';
    columns?: string[];
    references?: {
      table: string;
      columns: string[];
    };
  };
}

// ---------------------------------------------------
// Enterprise Features: Audit Trail
// ---------------------------------------------------
export interface AuditTrailEntry {
  id: string;
  table: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  oldData?: Document;
  newData?: Document;
  changedBy?: string;
  changedAt: Date;
  ipAddress?: string;
  userAgent?: string;
  transactionId?: string;
}

// ---------------------------------------------------
// Enterprise Features: Multi-tenancy
// ---------------------------------------------------
export interface TenantContext {
  tenantId: string;
  userId?: string;
  roles?: string[];
  isolationLevel: 'shared' | 'dedicated' | 'row-level';
  schemaPrefix?: string;
}
