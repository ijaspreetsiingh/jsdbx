// =====================================================
// JSDB - MongoDB Adapter
// =====================================================
import { CapabilityRegistry } from '../../capabilities/registry.js';
import { mongodbCapabilities } from '../../capabilities/mongodb.js';
import {
  JSDBConnectionError,
  JSDBQueryError,
  JSDBTransactionError,
  normalizeError,
} from '../../errors/index.js';
import { validateCollectionName, generateId } from '../../utils/id.js';
import { createLogger } from '../../utils/logger.js';
import {
  compileFilter,
  compileSort,
  compileProjection,
  compileUpdate,
  normalizeResult,
} from './compiler.js';
import { BaseAdapter } from '../base.js';
import type {
  JSDBConfig,
  Filter,
  Update,
  FindOptions,
  Document,
  InsertOneResult,
  InsertManyResult,
  UpdateResult,
  DeleteResult,
  AggregationStage,
  MongoConnectionConfig,
} from '../../types/index.js';
import type { ExecutionPlan } from '../../ir/nodes.js';
import type { AdapterTransaction, AdapterFindResult, AdapterCountResult, AdapterAggregateResult } from '../base.js';

// Minimal typing for the mongodb driver
interface MongoClientLike {
  connect(): Promise<void>;
  close(): Promise<void>;
  db(name: string): MongoDatabaseLike;
  startSession(): MongoSessionLike;
}

interface MongoDatabaseLike {
  collection(name: string): MongoCollectionLike;
  listCollections(): { toArray(): Promise<Array<{ name: string }>> };
  createCollection(name: string): Promise<void>;
  command(cmd: Document): Promise<Document>;
}

interface MongoCollectionLike {
  find(filter: Document, options?: Document): MongoCursorLike;
  findOne(filter: Document, options?: Document): Promise<Document | null>;
  insertOne(doc: Document, options?: Document): Promise<{ insertedId: unknown; acknowledged: boolean }>;
  insertMany(docs: Document[], options?: Document): Promise<{ insertedIds: Record<number, unknown>; insertedCount: number; acknowledged: boolean }>;
  updateOne(filter: Document, update: Document, options?: Document): Promise<{ matchedCount: number; modifiedCount: number; upsertedId?: unknown; acknowledged: boolean }>;
  updateMany(filter: Document, update: Document, options?: Document): Promise<{ matchedCount: number; modifiedCount: number; acknowledged: boolean }>;
  deleteOne(filter: Document, options?: Document): Promise<{ deletedCount: number; acknowledged: boolean }>;
  deleteMany(filter: Document, options?: Document): Promise<{ deletedCount: number; acknowledged: boolean }>;
  countDocuments(filter?: Document, options?: Document): Promise<number>;
  aggregate(pipeline: Document[], options?: Document): MongoCursorLike;
  createIndex(keys: Document, options?: Document): Promise<string>;
  dropIndex(nameOrSpec: string | Document): Promise<void>;
  drop(): Promise<boolean>;
}

interface MongoCursorLike {
  sort(sort: Document): MongoCursorLike;
  limit(n: number): MongoCursorLike;
  skip(n: number): MongoCursorLike;
  project(projection: Document): MongoCursorLike;
  toArray(): Promise<Document[]>;
}

interface MongoSessionLike {
  startTransaction(): void;
  commitTransaction(): Promise<void>;
  abortTransaction(): Promise<void>;
  endSession(): Promise<void>;
  id?: unknown;
}

interface MongoTransactionImpl extends AdapterTransaction {
  session: MongoSessionLike;
  _active: boolean;
}

export class MongoDBAdapter extends BaseAdapter {
  readonly type = 'mongodb' as const;
  readonly capabilities: CapabilityRegistry;
  private client: MongoClientLike | null = null;
  private database: MongoDatabaseLike | null = null;
  private dbName: string;
  private logger = createLogger('info', 'JSDB:MongoDB');

  constructor(config: JSDBConfig) {
    super(config);
    this.capabilities = new CapabilityRegistry();
    this.capabilities.registerMany(mongodbCapabilities);
    const connCfg = config.connection as MongoConnectionConfig | undefined;
    this.dbName = connCfg?.database ?? 'jsdb';
  }

  async connect(): Promise<void> {
    try {
      let mongodb: { MongoClient: new (uri: string, options?: unknown) => MongoClientLike };
      try {
        mongodb = await import('mongodb') as unknown as { MongoClient: new (uri: string, options?: unknown) => MongoClientLike };
      } catch {
        throw new JSDBConnectionError(
          'mongodb package is not installed. Run: npm install mongodb',
          'mongodb'
        );
      }

      const connCfg = this.config.connection as MongoConnectionConfig | undefined;
      const uri = connCfg?.uri ?? 'mongodb://localhost:27017';
      const poolSize = this.config.pool?.max ?? 10;

      this.client = new mongodb.MongoClient(uri, {
        maxPoolSize: poolSize,
        serverSelectionTimeoutMS: this.config.pool?.acquireTimeoutMs ?? 10000,
        connectTimeoutMS: this.config.pool?.acquireTimeoutMs ?? 10000,
      });

      await this.client.connect();
      this.database = this.client.db(this.dbName);
      this.connected = true;
      this.logger.info('MongoDB connected', { database: this.dbName });
    } catch (err) {
      if (err instanceof JSDBConnectionError) throw err;
      throw new JSDBConnectionError(
        `Failed to connect to MongoDB: ${(err as Error).message}`,
        'mongodb',
        err as Error
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.database = null;
      this.connected = false;
      this.logger.info('MongoDB disconnected');
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.getDb().command({ ping: 1 });
      return true;
    } catch (err) {
      throw new JSDBConnectionError(
        `MongoDB ping failed: ${(err as Error).message}`,
        'mongodb',
        err as Error
      );
    }
  }

  private getDb(): MongoDatabaseLike {
    if (!this.database) {
      throw new JSDBConnectionError('Not connected to MongoDB. Call connect() first.', 'mongodb');
    }
    return this.database;
  }

  private getCollection(name: string): MongoCollectionLike {
    validateCollectionName(name);
    return this.getDb().collection(name);
  }

  private getSessionOptions(tx?: AdapterTransaction): Document | undefined {
    if (!tx) return undefined;
    const mongoTx = tx as MongoTransactionImpl;
    return { session: mongoTx.session } as unknown as Document;
  }

  async execute(plan: ExecutionPlan, tx?: AdapterTransaction): Promise<unknown> {
    const ir = plan.ir;
    switch (ir.type) {
      case 'find':
        return this.find(ir.collection, ir.filter, {
          sort: ir.sort,
          limit: ir.limit,
          offset: ir.offset,
          projection: ir.projection,
        }, tx);
      case 'findOne':
        return this.findOne(ir.collection, ir.filter, { projection: ir.projection }, tx);
      case 'insert':
        return this.insert(ir.collection, ir.document, tx);
      case 'insertMany':
        return this.insertMany(ir.collection, ir.documents, { ordered: ir.ordered }, tx);
      case 'update':
        return this.update(ir.collection, ir.filter, ir.update, { upsert: ir.upsert }, tx);
      case 'updateMany':
        return this.updateMany(ir.collection, ir.filter, ir.update, tx);
      case 'delete':
        return this.delete(ir.collection, ir.filter, tx);
      case 'deleteMany':
        return this.deleteMany(ir.collection, ir.filter, tx);
      case 'count':
        return this.count(ir.collection, ir.filter, tx);
      case 'aggregate':
        return this.aggregate(ir.collection, ir.pipeline, tx);
      case 'createCollection':
        return this.createCollection(ir.collection, ir.options);
      case 'dropCollection':
        return this.dropCollection(ir.collection, ir.options);
      case 'createIndex':
        return this.createIndex(ir.collection, ir.fields, ir.options);
      default:
        throw new JSDBQueryError(`Unsupported IR type: ${(ir as { type: string }).type}`, 'mongodb');
    }
  }

  async find(
    collection: string,
    filter: Filter,
    options?: FindOptions,
    tx?: AdapterTransaction
  ): Promise<AdapterFindResult> {
    const coll = this.getCollection(collection);
    const mongoFilter = compileFilter(filter);
    const sessionOpts = this.getSessionOptions(tx);

    let cursor = coll.find(mongoFilter, sessionOpts);

    if (options?.sort) {
      const sortObj = compileSort(options.sort);
      if (sortObj) cursor = cursor.sort(sortObj as Document);
    }
    if (options?.projection) {
      const proj = compileProjection(options.projection);
      if (proj) cursor = cursor.project(proj as Document);
    }
    if (options?.limit !== undefined) {
      cursor = cursor.limit(options.limit);
    }
    const offset = options?.offset ?? options?.skip ?? 0;
    if (offset > 0) {
      cursor = cursor.skip(offset);
    }

    try {
      const docs = await cursor.toArray();
      return { documents: docs.map(normalizeResult) };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async findOne(
    collection: string,
    filter: Filter,
    options?: FindOptions,
    tx?: AdapterTransaction
  ): Promise<Document | null> {
    const coll = this.getCollection(collection);
    const mongoFilter = compileFilter(filter);
    const opts: Document = {};
    if (options?.projection) {
      const proj = compileProjection(options.projection);
      if (proj) opts['projection'] = proj;
    }
    if (options?.sort) {
      const sortObj = compileSort(options.sort);
      if (sortObj) opts['sort'] = sortObj;
    }
    const sessionOpts = this.getSessionOptions(tx);
    if (sessionOpts) Object.assign(opts, sessionOpts);

    try {
      const doc = await coll.findOne(mongoFilter, opts);
      return doc ? normalizeResult(doc) : null;
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async insert(
    collection: string,
    document: Document,
    tx?: AdapterTransaction
  ): Promise<InsertOneResult> {
    const coll = this.getCollection(collection);
    const opts = this.getSessionOptions(tx) ?? {};
    try {
      const result = await coll.insertOne({ ...document }, opts);
      return {
        insertedId: String(result.insertedId),
        acknowledged: result.acknowledged,
      };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async insertMany(
    collection: string,
    documents: Document[],
    options?: { ordered?: boolean },
    tx?: AdapterTransaction
  ): Promise<InsertManyResult> {
    if (!documents.length) {
      return { insertedIds: [], insertedCount: 0, acknowledged: true };
    }
    const coll = this.getCollection(collection);
    const opts: Document = { ordered: options?.ordered ?? true };
    const sessionOpts = this.getSessionOptions(tx);
    if (sessionOpts) Object.assign(opts, sessionOpts);
    try {
      const result = await coll.insertMany(documents.map((d) => ({ ...d })), opts);
      const insertedIds = Object.values(result.insertedIds).map((id) => String(id));
      return {
        insertedIds,
        insertedCount: result.insertedCount,
        acknowledged: result.acknowledged,
      };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async update(
    collection: string,
    filter: Filter,
    update: Update,
    options?: { upsert?: boolean },
    tx?: AdapterTransaction
  ): Promise<UpdateResult> {
    const coll = this.getCollection(collection);
    const mongoFilter = compileFilter(filter);
    const mongoUpdate = compileUpdate(update);
    const opts: Document = { upsert: options?.upsert ?? false };
    const sessionOpts = this.getSessionOptions(tx);
    if (sessionOpts) Object.assign(opts, sessionOpts);
    try {
      const result = await coll.updateOne(mongoFilter, mongoUpdate, opts);
      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId: result.upsertedId ? String(result.upsertedId) : undefined,
        acknowledged: result.acknowledged,
      };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async updateMany(
    collection: string,
    filter: Filter,
    update: Update,
    tx?: AdapterTransaction
  ): Promise<UpdateResult> {
    const coll = this.getCollection(collection);
    const mongoFilter = compileFilter(filter);
    const mongoUpdate = compileUpdate(update);
    const opts = this.getSessionOptions(tx) ?? {};
    try {
      const result = await coll.updateMany(mongoFilter, mongoUpdate, opts);
      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        acknowledged: result.acknowledged,
      };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async delete(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<DeleteResult> {
    const coll = this.getCollection(collection);
    const mongoFilter = compileFilter(filter);
    const opts = this.getSessionOptions(tx) ?? {};
    try {
      const result = await coll.deleteOne(mongoFilter, opts);
      return { deletedCount: result.deletedCount, acknowledged: result.acknowledged };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async deleteMany(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<DeleteResult> {
    const coll = this.getCollection(collection);
    const mongoFilter = compileFilter(filter);
    const opts = this.getSessionOptions(tx) ?? {};
    try {
      const result = await coll.deleteMany(mongoFilter, opts);
      return { deletedCount: result.deletedCount, acknowledged: result.acknowledged };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async count(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<AdapterCountResult> {
    const coll = this.getCollection(collection);
    const mongoFilter = compileFilter(filter);
    const opts = this.getSessionOptions(tx) ?? {};
    try {
      const count = await coll.countDocuments(mongoFilter, opts);
      return { count };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async aggregate(
    collection: string,
    pipeline: AggregationStage[],
    tx?: AdapterTransaction
  ): Promise<AdapterAggregateResult> {
    const coll = this.getCollection(collection);
    const opts = this.getSessionOptions(tx) ?? {};
    try {
      const cursor = coll.aggregate(pipeline as Document[], opts);
      const docs = await cursor.toArray();
      return { documents: docs.map(normalizeResult) };
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async beginTransaction(): Promise<AdapterTransaction> {
    if (!this.client) {
      throw new JSDBConnectionError('Not connected to MongoDB', 'mongodb');
    }
    const session = this.client.startSession();
    session.startTransaction();
    const txId = generateId();
    let active = true;

    const tx: MongoTransactionImpl = {
      id: txId,
      session,
      _active: active,
      isActive: () => active,
      commit: async () => {
        if (!active) throw new JSDBTransactionError('Transaction not active', 'mongodb');
        try {
          await session.commitTransaction();
          active = false;
          tx._active = false;
          await session.endSession();
        } catch (err) {
          throw new JSDBTransactionError(
            `MongoDB commit failed: ${(err as Error).message}`,
            'mongodb',
            err as Error
          );
        }
      },
      rollback: async () => {
        if (!active) return;
        try {
          await session.abortTransaction();
          active = false;
          tx._active = false;
          await session.endSession();
        } catch (err) {
          await session.endSession().catch(() => {});
          throw new JSDBTransactionError(
            `MongoDB rollback failed: ${(err as Error).message}`,
            'mongodb',
            err as Error
          );
        }
      },
    };

    return tx;
  }

  async createCollection(name: string, options?: { ifNotExists?: boolean }): Promise<void> {
    validateCollectionName(name);
    try {
      await this.getDb().createCollection(name);
    } catch (err) {
      const msg = (err as Error).message;
      if (options?.ifNotExists && msg.includes('already exists')) return;
      throw normalizeError(err, 'mongodb');
    }
  }

  async dropCollection(name: string, options?: { ifExists?: boolean }): Promise<void> {
    validateCollectionName(name);
    try {
      await this.getCollection(name).drop();
    } catch (err) {
      const msg = (err as Error).message;
      if (options?.ifExists && (msg.includes('not found') || msg.includes('ns not found'))) return;
      throw normalizeError(err, 'mongodb');
    }
  }

  async createIndex(
    collection: string,
    fields: string[],
    options?: {
      unique?: boolean;
      name?: string;
      sparse?: boolean;
      ttl?: number;
      partial?: Filter;
    }
  ): Promise<void> {
    const coll = this.getCollection(collection);
    const keys: Document = {};
    for (const f of fields) keys[f] = 1;
    const indexOptions: Document = {};
    if (options?.unique) indexOptions['unique'] = true;
    if (options?.name) indexOptions['name'] = options.name;
    if (options?.sparse) indexOptions['sparse'] = true;
    if (options?.ttl !== undefined) indexOptions['expireAfterSeconds'] = options.ttl;
    if (options?.partial) indexOptions['partialFilterExpression'] = compileFilter(options.partial);
    try {
      await coll.createIndex(keys, indexOptions);
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async dropIndex(collection: string, indexName: string): Promise<void> {
    const coll = this.getCollection(collection);
    try {
      await coll.dropIndex(indexName);
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  async listCollections(): Promise<string[]> {
    try {
      const collections = await this.getDb().listCollections().toArray();
      return collections.map((c) => c.name);
    } catch (err) {
      throw normalizeError(err, 'mongodb');
    }
  }

  getRawConnection(): unknown {
    // NON_PORTABLE
    return this.client;
  }

  async executeRaw(query: string, params?: unknown[]): Promise<unknown> {
    // NON_PORTABLE
    this.logger.warn('executeRaw called on MongoDB — this operation is NON_PORTABLE');
    throw new JSDBQueryError(
      'MongoDB does not support raw SQL queries. Use db.mongodb() or the aggregation API.',
      'mongodb'
    );
  }
}
