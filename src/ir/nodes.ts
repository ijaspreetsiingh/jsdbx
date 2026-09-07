// =====================================================
// JSDB - Universal IR / AST Nodes
// =====================================================
import type {
  Filter,
  Update,
  SortSpec,
  ProjectionSpec,
  AggregationStage,
  Document,
  JoinClause,
  RecursiveCTEDefinition,
  StoredProcedureCall,
  StoredFunctionCall,
  WatchOptions,
  CursorPaginationOptions,
} from '../types/index.js';

export type IROperationType =
  | 'find'
  | 'findOne'
  | 'insert'
  | 'insertMany'
  | 'update'
  | 'updateMany'
  | 'delete'
  | 'deleteMany'
  | 'count'
  | 'aggregate'
  | 'transaction'
  | 'createCollection'
  | 'dropCollection'
  | 'createIndex'
  | 'dropIndex'
  | 'listCollections'
  | 'join'
  | 'recursiveCTE'
  | 'storedProcedure'
  | 'storedFunction'
  | 'watch'
  | 'cursorPaginate'
  | 'batch';

// ---- Base ----
export interface IRNodeBase {
  type: IROperationType;
  collection: string;
  metadata?: {
    requestId?: string;
    tenantId?: string;
    userId?: string;
    timestamp?: Date;
    // Internal-use fields set by the compat layer (never sent to adapters)
    [key: `_${string}`]: unknown;
  };
}

// ---- Find ----
export interface IRFindNode extends IRNodeBase {
  type: 'find';
  filter: Filter;
  projection?: ProjectionSpec;
  sort?: SortSpec;
  limit?: number;
  offset?: number;
  hint?: string | Document;
  explain?: boolean;
}

export interface IRFindOneNode extends IRNodeBase {
  type: 'findOne';
  filter: Filter;
  projection?: ProjectionSpec;
  sort?: SortSpec;
  hint?: string | Document;
}

// ---- Insert ----
export interface IRInsertNode extends IRNodeBase {
  type: 'insert';
  document: Document;
  returnDocument?: boolean;
}

export interface IRInsertManyNode extends IRNodeBase {
  type: 'insertMany';
  documents: Document[];
  ordered?: boolean;
}

// ---- Update ----
export interface IRUpdateNode extends IRNodeBase {
  type: 'update';
  filter: Filter;
  update: Update;
  upsert?: boolean;
  returnDocument?: 'before' | 'after';
}

export interface IRUpdateManyNode extends IRNodeBase {
  type: 'updateMany';
  filter: Filter;
  update: Update;
}

// ---- Delete ----
export interface IRDeleteNode extends IRNodeBase {
  type: 'delete';
  filter: Filter;
  returnDocument?: boolean;
}

export interface IRDeleteManyNode extends IRNodeBase {
  type: 'deleteMany';
  filter: Filter;
}

// ---- Count ----
export interface IRCountNode extends IRNodeBase {
  type: 'count';
  filter: Filter;
}

// ---- Aggregate ----
export interface IRAggregateNode extends IRNodeBase {
  type: 'aggregate';
  pipeline: AggregationStage[];
  allowDiskUse?: boolean;
}

// ---- Schema Operations ----
export interface IRCreateCollectionNode extends IRNodeBase {
  type: 'createCollection';
  options?: {
    ifNotExists?: boolean;
    schema?: Document;
  };
}

export interface IRDropCollectionNode extends IRNodeBase {
  type: 'dropCollection';
  options?: {
    ifExists?: boolean;
  };
}

export interface IRCreateIndexNode extends IRNodeBase {
  type: 'createIndex';
  fields: string[];
  options?: {
    unique?: boolean;
    name?: string;
    sparse?: boolean;
    ttl?: number;
    partial?: Filter;
    fulltext?: boolean;
  };
}

export interface IRDropIndexNode extends IRNodeBase {
  type: 'dropIndex';
  indexName: string;
}

export interface IRListCollectionsNode {
  type: 'listCollections';
  collection: '*';
  metadata?: IRNodeBase['metadata'];
}

// ---- Union of all IR nodes ----
export type IRNode =
  | IRFindNode
  | IRFindOneNode
  | IRInsertNode
  | IRInsertManyNode
  | IRUpdateNode
  | IRUpdateManyNode
  | IRDeleteNode
  | IRDeleteManyNode
  | IRCountNode
  | IRAggregateNode
  | IRCreateCollectionNode
  | IRDropCollectionNode
  | IRCreateIndexNode
  | IRDropIndexNode
  | IRListCollectionsNode
  | IRJoinNode
  | IRRecursiveCTENode
  | IRStoredProcedureNode
  | IRStoredFunctionNode
  | IRWatchNode
  | IRCursorPaginateNode
  | IRBatchNode;

// ---- Join ----
export interface IRJoinNode extends IRNodeBase {
  type: 'join';
  collection: string;
  joins: JoinClause[];
  filter?: Filter;
  projection?: ProjectionSpec;
  sort?: SortSpec;
  limit?: number;
  offset?: number;
}

// ---- Recursive CTE ----
export interface IRRecursiveCTENode extends IRNodeBase {
  type: 'recursiveCTE';
  collection: string;
  cte: RecursiveCTEDefinition;
  filter?: Filter;
  projection?: ProjectionSpec;
  sort?: SortSpec;
  limit?: number;
}

// ---- Stored Procedure ----
export interface IRStoredProcedureNode extends IRNodeBase {
  type: 'storedProcedure';
  collection: '*';
  procedure: StoredProcedureCall;
}

// ---- Stored Function ----
export interface IRStoredFunctionNode extends IRNodeBase {
  type: 'storedFunction';
  collection: '*';
  function: StoredFunctionCall;
}

// ---- Watch / Change Streams ----
export interface IRWatchNode extends IRNodeBase {
  type: 'watch';
  collection: string | '*';
  pipeline?: AggregationStage[];
  options?: WatchOptions;
}

// ---- Cursor Pagination ----
export interface IRCursorPaginateNode extends IRNodeBase {
  type: 'cursorPaginate';
  collection: string;
  filter: Filter;
  pagination: CursorPaginationOptions;
  projection?: ProjectionSpec;
}

// ---- Batch ----
export interface IRBatchNode extends IRNodeBase {
  type: 'batch';
  collection: '*';
  operations: IRNode[];
}

// ---- Execution Plan ----
export interface ExecutionPlan {
  ir: IRNode;
  database: string;
  steps: ExecutionStep[];
  warnings: string[];
  capabilities: CapabilityCheckResult[];
  estimatedCost?: number;
}

export interface ExecutionStep {
  type: 'native' | 'emulated' | 'sequential';
  description: string;
  data?: unknown;
}

export interface CapabilityCheckResult {
  operation: string;
  status: 'native' | 'emulated' | 'unsupported';
  message?: string;
}
