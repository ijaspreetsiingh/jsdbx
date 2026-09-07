// =====================================================
// JSDB - Database Adapter Base Contract
// All adapters must implement this interface
// =====================================================
import type {
  DatabaseType,
  Document,
  Filter,
  Update,
  FindOptions,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  AggregationStage,
  JSDBConfig,
} from '../types/index.js';
import type { IRNode, ExecutionPlan } from '../ir/nodes.js';
import type { CapabilityRegistry } from '../capabilities/registry.js';

export interface AdapterTransaction {
  id: string;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  isActive(): boolean;
}

export interface AdapterFindResult {
  documents: Document[];
  total?: number;
}

export interface AdapterCountResult {
  count: number;
}

export interface AdapterAggregateResult {
  documents: Document[];
}

/**
 * Core adapter contract — every database adapter must implement this
 */
export interface DatabaseAdapter {
  readonly type: DatabaseType;
  readonly capabilities: CapabilityRegistry;

  /** Establish connection / pool */
  connect(): Promise<void>;

  /** Release all connections */
  disconnect(): Promise<void>;

  /** Check if connected */
  isConnected(): boolean;

  /** Test connectivity */
  ping(): Promise<boolean>;

  /** Execute a pre-planned IR node */
  execute(plan: ExecutionPlan, tx?: AdapterTransaction): Promise<unknown>;

  /** Find documents */
  find(
    collection: string,
    filter: Filter,
    options?: FindOptions,
    tx?: AdapterTransaction
  ): Promise<AdapterFindResult>;

  /** Find one document */
  findOne(
    collection: string,
    filter: Filter,
    options?: FindOptions,
    tx?: AdapterTransaction
  ): Promise<Document | null>;

  /** Insert one document */
  insert(
    collection: string,
    document: Document,
    tx?: AdapterTransaction
  ): Promise<InsertOneResult>;

  /** Insert many documents */
  insertMany(
    collection: string,
    documents: Document[],
    options?: { ordered?: boolean },
    tx?: AdapterTransaction
  ): Promise<InsertManyResult>;

  /** Update one document */
  update(
    collection: string,
    filter: Filter,
    update: Update,
    options?: { upsert?: boolean },
    tx?: AdapterTransaction
  ): Promise<UpdateResult>;

  /** Update many documents */
  updateMany(
    collection: string,
    filter: Filter,
    update: Update,
    tx?: AdapterTransaction
  ): Promise<UpdateResult>;

  /** Delete one document */
  delete(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<DeleteResult>;

  /** Delete many documents */
  deleteMany(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<DeleteResult>;

  /** Count documents */
  count(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<AdapterCountResult>;

  /** Run aggregation pipeline */
  aggregate(
    collection: string,
    pipeline: AggregationStage[],
    tx?: AdapterTransaction
  ): Promise<AdapterAggregateResult>;

  /** Begin a transaction */
  beginTransaction(): Promise<AdapterTransaction>;

  /** Create collection / table */
  createCollection(name: string, options?: { ifNotExists?: boolean }): Promise<void>;

  /** Drop collection / table */
  dropCollection(name: string, options?: { ifExists?: boolean }): Promise<void>;

  /** Create index */
  createIndex(
    collection: string,
    fields: string[],
    options?: {
      unique?: boolean;
      name?: string;
      sparse?: boolean;
      ttl?: number;
      partial?: Filter;
      fulltext?: boolean;
    }
  ): Promise<void>;

  /** Drop index by name */
  dropIndex(collection: string, indexName: string): Promise<void>;

  /** List all collections / tables */
  listCollections(): Promise<string[]>;

  /** Get raw connection (for raw/escape-hatch queries) — marked NON_PORTABLE */
  getRawConnection(): unknown;

  /** Execute raw query — marked NON_PORTABLE */
  executeRaw(query: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Base class with shared functionality
 */
export abstract class BaseAdapter implements DatabaseAdapter {
  abstract readonly type: DatabaseType;
  abstract readonly capabilities: CapabilityRegistry;
  protected config: JSDBConfig;
  protected connected = false;

  constructor(config: JSDBConfig) {
    this.config = config;
  }

  isConnected(): boolean {
    return this.connected;
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract ping(): Promise<boolean>;
  abstract execute(plan: ExecutionPlan, tx?: AdapterTransaction): Promise<unknown>;
  abstract find(collection: string, filter: Filter, options?: FindOptions, tx?: AdapterTransaction): Promise<AdapterFindResult>;
  abstract findOne(collection: string, filter: Filter, options?: FindOptions, tx?: AdapterTransaction): Promise<Document | null>;
  abstract insert(collection: string, document: Document, tx?: AdapterTransaction): Promise<InsertOneResult>;
  abstract insertMany(collection: string, documents: Document[], options?: { ordered?: boolean }, tx?: AdapterTransaction): Promise<InsertManyResult>;
  abstract update(collection: string, filter: Filter, update: Update, options?: { upsert?: boolean }, tx?: AdapterTransaction): Promise<UpdateResult>;
  abstract updateMany(collection: string, filter: Filter, update: Update, tx?: AdapterTransaction): Promise<UpdateResult>;
  abstract delete(collection: string, filter: Filter, tx?: AdapterTransaction): Promise<DeleteResult>;
  abstract deleteMany(collection: string, filter: Filter, tx?: AdapterTransaction): Promise<DeleteResult>;
  abstract count(collection: string, filter: Filter, tx?: AdapterTransaction): Promise<AdapterCountResult>;
  abstract aggregate(collection: string, pipeline: AggregationStage[], tx?: AdapterTransaction): Promise<AdapterAggregateResult>;
  abstract beginTransaction(): Promise<AdapterTransaction>;
  abstract createCollection(name: string, options?: { ifNotExists?: boolean }): Promise<void>;
  abstract dropCollection(name: string, options?: { ifExists?: boolean }): Promise<void>;
  abstract createIndex(collection: string, fields: string[], options?: { unique?: boolean; name?: string; sparse?: boolean; ttl?: number; partial?: Filter; fulltext?: boolean }): Promise<void>;
  abstract dropIndex(collection: string, indexName: string): Promise<void>;
  abstract listCollections(): Promise<string[]>;
  abstract getRawConnection(): unknown;
  abstract executeRaw(query: string, params?: unknown[]): Promise<unknown>;
}
