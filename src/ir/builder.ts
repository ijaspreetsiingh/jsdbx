// =====================================================
// JSDB - IR Builder
// Converts developer API calls into Universal IR nodes
// =====================================================
import type {
  IRFindNode,
  IRFindOneNode,
  IRInsertNode,
  IRInsertManyNode,
  IRUpdateNode,
  IRUpdateManyNode,
  IRDeleteNode,
  IRDeleteManyNode,
  IRCountNode,
  IRAggregateNode,
  IRCreateIndexNode,
  IRCreateCollectionNode,
  IRDropCollectionNode,
  IRJoinNode,
  IRRecursiveCTENode,
  IRStoredProcedureNode,
  IRStoredFunctionNode,
  IRWatchNode,
  IRCursorPaginateNode,
  IRBatchNode,
  IRNode,
} from './nodes.js';
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

export interface IRBuildMeta {
  requestId?: string;
  tenantId?: string;
  userId?: string;
}

export class IRBuilder {
  static find(
    collection: string,
    filter: Filter = {},
    options?: {
      projection?: ProjectionSpec;
      sort?: SortSpec;
      limit?: number;
      offset?: number;
      hint?: string | Document;
    },
    meta?: IRBuildMeta
  ): IRFindNode {
    return {
      type: 'find',
      collection,
      filter,
      projection: options?.projection,
      sort: options?.sort,
      limit: options?.limit,
      offset: options?.offset ?? 0,
      hint: options?.hint,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static findOne(
    collection: string,
    filter: Filter = {},
    options?: {
      projection?: ProjectionSpec;
      sort?: SortSpec;
    },
    meta?: IRBuildMeta
  ): IRFindOneNode {
    return {
      type: 'findOne',
      collection,
      filter,
      projection: options?.projection,
      sort: options?.sort,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static insert(
    collection: string,
    document: Document,
    meta?: IRBuildMeta
  ): IRInsertNode {
    return {
      type: 'insert',
      collection,
      document,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static insertMany(
    collection: string,
    documents: Document[],
    ordered = true,
    meta?: IRBuildMeta
  ): IRInsertManyNode {
    return {
      type: 'insertMany',
      collection,
      documents,
      ordered,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static update(
    collection: string,
    filter: Filter,
    update: Update,
    options?: { upsert?: boolean },
    meta?: IRBuildMeta
  ): IRUpdateNode {
    return {
      type: 'update',
      collection,
      filter,
      update,
      upsert: options?.upsert ?? false,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static updateMany(
    collection: string,
    filter: Filter,
    update: Update,
    meta?: IRBuildMeta
  ): IRUpdateManyNode {
    return {
      type: 'updateMany',
      collection,
      filter,
      update,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static delete(
    collection: string,
    filter: Filter,
    meta?: IRBuildMeta
  ): IRDeleteNode {
    return {
      type: 'delete',
      collection,
      filter,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static deleteMany(
    collection: string,
    filter: Filter,
    meta?: IRBuildMeta
  ): IRDeleteManyNode {
    return {
      type: 'deleteMany',
      collection,
      filter,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static count(
    collection: string,
    filter: Filter = {},
    meta?: IRBuildMeta
  ): IRCountNode {
    return {
      type: 'count',
      collection,
      filter,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static aggregate(
    collection: string,
    pipeline: AggregationStage[],
    meta?: IRBuildMeta
  ): IRAggregateNode {
    return {
      type: 'aggregate',
      collection,
      pipeline,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static createIndex(
    collection: string,
    fields: string[],
    options?: {
      unique?: boolean;
      name?: string;
      sparse?: boolean;
      ttl?: number;
      partial?: Filter;
      fulltext?: boolean;
    },
    meta?: IRBuildMeta
  ): IRCreateIndexNode {
    return {
      type: 'createIndex',
      collection,
      fields,
      options,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static createCollection(
    collection: string,
    options?: { ifNotExists?: boolean },
    meta?: IRBuildMeta
  ): IRCreateCollectionNode {
    return {
      type: 'createCollection',
      collection,
      options,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static dropCollection(
    collection: string,
    options?: { ifExists?: boolean },
    meta?: IRBuildMeta
  ): IRDropCollectionNode {
    return {
      type: 'dropCollection',
      collection,
      options,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  // ---- Deep Joins ----

  static join(
    collection: string,
    joins: JoinClause[],
    options?: {
      filter?: Filter;
      projection?: ProjectionSpec;
      sort?: SortSpec;
      limit?: number;
      offset?: number;
    },
    meta?: IRBuildMeta
  ): IRJoinNode {
    return {
      type: 'join',
      collection,
      joins,
      filter: options?.filter,
      projection: options?.projection,
      sort: options?.sort,
      limit: options?.limit,
      offset: options?.offset,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  // ---- Recursive CTE ----

  static recursiveCTE(
    collection: string,
    cte: RecursiveCTEDefinition,
    options?: {
      filter?: Filter;
      projection?: ProjectionSpec;
      sort?: SortSpec;
      limit?: number;
    },
    meta?: IRBuildMeta
  ): IRRecursiveCTENode {
    return {
      type: 'recursiveCTE',
      collection,
      cte,
      filter: options?.filter,
      projection: options?.projection,
      sort: options?.sort,
      limit: options?.limit,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  // ---- Stored Procedures ----

  static callStoredProcedure(
    procedure: StoredProcedureCall,
    meta?: IRBuildMeta
  ): IRStoredProcedureNode {
    return {
      type: 'storedProcedure',
      collection: '*',
      procedure,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  static callStoredFunction(
    fn: StoredFunctionCall,
    meta?: IRBuildMeta
  ): IRStoredFunctionNode {
    return {
      type: 'storedFunction',
      collection: '*',
      function: fn,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  // ---- Watch / Change Streams ----

  static watch(
    collection: string | '*',
    pipeline?: AggregationStage[],
    options?: WatchOptions,
    meta?: IRBuildMeta
  ): IRWatchNode {
    return {
      type: 'watch',
      collection,
      pipeline,
      options,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  // ---- Cursor Pagination ----

  static cursorPaginate(
    collection: string,
    filter: Filter,
    pagination: CursorPaginationOptions,
    options?: {
      projection?: ProjectionSpec;
    },
    meta?: IRBuildMeta
  ): IRCursorPaginateNode {
    return {
      type: 'cursorPaginate',
      collection,
      filter,
      pagination,
      projection: options?.projection,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  // ---- Batch ----

  static batch(
    operations: IRNode[],
    meta?: IRBuildMeta
  ): IRBatchNode {
    return {
      type: 'batch',
      collection: '*',
      operations,
      metadata: meta ? { ...meta, timestamp: new Date() } : { timestamp: new Date() },
    };
  }

  /**
   * Analyze an IR node and detect which capabilities it requires
   */
  static detectRequiredCapabilities(ir: IRNode): string[] {
    const caps: string[] = [];

    if (ir.type === 'find' || ir.type === 'findOne') {
      caps.push('crud.find');
      if (ir.filter) {
        const filterCaps = analyzeFilterCapabilities(ir.filter);
        caps.push(...filterCaps);
      }
      if (ir.type === 'find' && ir.limit !== undefined) caps.push('pagination.limit');
      if (ir.type === 'find' && ir.offset !== undefined && ir.offset > 0) caps.push('pagination.offset');
      if (ir.sort) caps.push('sorting');
      if (ir.projection) {
        caps.push('projection');
        const values = Object.values(ir.projection);
        if (values.some((v) => v === 0)) {
          caps.push('projection.exclusion');
        }
      }
    }

    if (ir.type === 'insert') caps.push('crud.insert');
    if (ir.type === 'insertMany') caps.push('crud.insertMany');
    if (ir.type === 'update') caps.push('crud.update');
    if (ir.type === 'updateMany') caps.push('crud.updateMany');
    if (ir.type === 'delete') caps.push('crud.delete');
    if (ir.type === 'deleteMany') caps.push('crud.deleteMany');
    if (ir.type === 'count') caps.push('crud.count');

    if (ir.type === 'aggregate') {
      caps.push('aggregation');
      ir.pipeline.forEach((stage) => {
        const key = Object.keys(stage)[0];
        caps.push(`aggregation.${key.replace('$', '')}`);
      });
    }

    // ---- New operation capabilities ----

    if (ir.type === 'join') {
      caps.push('join');
      for (const j of ir.joins) {
        caps.push(`join.${j.type || 'left'}`);
      }
      if (ir.filter) caps.push(...analyzeFilterCapabilities(ir.filter));
      if (ir.sort) caps.push('sorting');
      if (ir.projection) caps.push('projection');
    }

    if (ir.type === 'recursiveCTE') {
      caps.push('recursive.cte');
      if (ir.cte.search === 'breadth') caps.push('recursive.bfs');
      if (ir.cte.cycleDetection) caps.push('recursive.cycleDetection');
      if (ir.cte.maxDepth !== undefined) caps.push('recursive.maxDepth');
    }

    if (ir.type === 'storedProcedure') caps.push('storedProcedure.call');
    if (ir.type === 'storedFunction') caps.push('storedFunction.call');

    if (ir.type === 'watch') {
      caps.push('realtime.watch');
      if (ir.options?.fullDocument === 'updateLookup') caps.push('realtime.fullDocument');
    }

    if (ir.type === 'cursorPaginate') {
      caps.push('pagination.cursor');
      if (ir.filter) caps.push(...analyzeFilterCapabilities(ir.filter));
    }

    if (ir.type === 'batch') {
      caps.push('batch');
      for (const op of ir.operations) {
        caps.push(...IRBuilder.detectRequiredCapabilities(op));
      }
    }

    return [...new Set(caps)];
  }
}

function analyzeFilterCapabilities(filter: Record<string, unknown>): string[] {
  const caps: string[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      caps.push(`filter.${key.replace('$', '')}`);
      if (Array.isArray(value)) {
        value.forEach((f) => caps.push(...analyzeFilterCapabilities(f as Record<string, unknown>)));
      }
    } else if (key === '$not') {
      caps.push('filter.not');
      if (value && typeof value === 'object') {
        caps.push(...analyzeFilterCapabilities(value as Record<string, unknown>));
      }
    } else if (typeof value === 'object' && value !== null) {
      const ops = value as Record<string, unknown>;
      for (const op of Object.keys(ops)) {
        if (op === '$elemMatch') caps.push('filter.elemMatch');
        else if (op === '$type') caps.push('filter.type');
        else if (op === '$regex') caps.push('filter.regex');
        else if (op === '$like' || op === '$ilike') caps.push('filter.like');
        else if (op === '$in' || op === '$nin') caps.push('filter.in');
        else if (['$gt', '$gte', '$lt', '$lte'].includes(op)) caps.push('filter.comparison');
        else if (op === '$exists') caps.push('filter.exists');
      }
    }
  }

  return caps;
}
