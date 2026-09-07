// =====================================================
// JSDB MongoDB Driver Proxy
//
// DROP-IN REPLACEMENT for the `mongodb` npm package.
//
// Existing code using MongoDB driver:
//   import { MongoClient } from 'mongodb';
//   const client = new MongoClient(uri);
//   await client.connect();
//   const db = client.db('myapp');
//   const users = db.collection('users');
//   const result = await users.find({ age: { $gt: 18 } }).toArray();
//
// Change only the import:
//   import { MongoClient } from 'jsdb/mongodb';
// ─── or use jsdb/register for ZERO import changes ───
//
// ALL MongoDB query operators ($gt, $lt, $in, $or, $and,
// $exists, $elemMatch, aggregation pipelines etc.) work
// unchanged against the configured target DB.
//
// Supports BOTH Promise and callback APIs:
//   await users.find({}).toArray();                  // Promise
//   users.findOne({ age: 18 }, (err, doc) => {});   // Callback
// =====================================================

import { ensureConnected, getSharedConfig } from './core.js';
import { queryPlanner } from '../planner/planner.js';
import {
  mongoFind,
  mongoFindOne,
  mongoInsertOne,
  mongoInsertMany,
  mongoUpdateOne,
  mongoUpdateMany,
  mongoDeleteOne,
  mongoDeleteMany,
  mongoCountDocuments,
  mongoAggregate,
  mongoCreateCollection,
  mongoDropCollection,
  mongoListCollections,
  type MongoFindOptions,
  type MongoWriteResult,
} from './mongo-core.js';
import { createLogger } from '../utils/logger.js';
import type { Document, AggregationStage } from '../types/index.js';
import type { AdapterTransaction } from '../adapters/base.js';

const logger = createLogger('info', 'JSDB:mongodb-proxy');

// ---- Callback types ----
export type MongoCallback<T> = (err: Error | null, result?: T) => void;

// =====================================================
// FindCursor — lazy cursor returned by collection.find()
// Mimics the MongoDB driver FindCursor fluent API
// =====================================================
class JSDBFindCursor {
  private _collection: string;
  private _filter: Record<string, unknown>;
  private _options: MongoFindOptions;
  private _cachedDocs: Document[] | null = null;
  private _cursorIdx = 0;

  constructor(collection: string, filter: Record<string, unknown>, options: MongoFindOptions = {}) {
    this._collection = collection;
    this._filter = filter;
    this._options = { ...options };
  }

  sort(sortSpec: Record<string, 1 | -1>): this {
    this._options.sort = { ...(this._options.sort ?? {}), ...sortSpec };
    this._cachedDocs = null; // invalidate cache
    return this;
  }

  limit(n: number): this {
    this._options.limit = n;
    this._cachedDocs = null;
    return this;
  }

  skip(n: number): this {
    this._options.skip = n;
    this._cachedDocs = null;
    return this;
  }

  project(projection: Record<string, 0 | 1>): this {
    this._options.projection = projection;
    this._cachedDocs = null;
    return this;
  }

  async toArray(): Promise<Document[]> {
    if (!this._cachedDocs) {
      this._cachedDocs = await mongoFind(this._collection, this._filter, this._options);
    }
    return this._cachedDocs;
  }

  async forEach(fn: (doc: Document) => void): Promise<void> {
    const docs = await this.toArray();
    for (const doc of docs) fn(doc);
  }

  async next(): Promise<Document | null> {
    if (!this._cachedDocs) {
      this._cachedDocs = await mongoFind(this._collection, this._filter, this._options);
    }
    if (this._cursorIdx < this._cachedDocs.length) {
      return this._cachedDocs[this._cursorIdx++] ?? null;
    }
    return null;
  }

  async hasNext(): Promise<boolean> {
    if (!this._cachedDocs) {
      this._cachedDocs = await mongoFind(this._collection, this._filter, this._options);
    }
    return this._cursorIdx < this._cachedDocs.length;
  }

  async count(): Promise<number> {
    return mongoCountDocuments(this._collection, this._filter);
  }

  // Async iterator support
  [Symbol.asyncIterator](): AsyncIterator<Document> {
    let docs: Document[] | null = null;
    let idx = 0;
    const self = this;
    return {
      async next() {
        if (!docs) docs = await self.toArray();
        if (idx < docs.length) return { value: docs[idx++], done: false };
        return { value: undefined as unknown as Document, done: true };
      },
    };
  }
}

// =====================================================
// AggregateCursor
// =====================================================
class JSDBAggregateCursor {
  private _cachedDocs: Document[] | null = null;
  private _cursorIdx = 0;

  constructor(
    private _collection: string,
    private _pipeline: AggregationStage[]
  ) {}

  async toArray(): Promise<Document[]> {
    if (!this._cachedDocs) {
      this._cachedDocs = await mongoAggregate(this._collection, this._pipeline);
    }
    return this._cachedDocs;
  }

  async forEach(fn: (doc: Document) => void): Promise<void> {
    const docs = await this.toArray();
    for (const doc of docs) fn(doc);
  }

  async next(): Promise<Document | null> {
    if (!this._cachedDocs) {
      this._cachedDocs = await mongoAggregate(this._collection, this._pipeline);
    }
    if (this._cursorIdx < this._cachedDocs.length) {
      return this._cachedDocs[this._cursorIdx++] ?? null;
    }
    return null;
  }

  [Symbol.asyncIterator](): AsyncIterator<Document> {
    let docs: Document[] | null = null;
    let idx = 0;
    const self = this;
    return {
      async next() {
        if (!docs) docs = await self.toArray();
        if (idx < docs.length) return { value: docs[idx++], done: false };
        return { value: undefined as unknown as Document, done: true };
      },
    };
  }
}

// =====================================================
// Collection — the main user-facing API
// =====================================================
class JSDBCollection {
  constructor(
    public readonly collectionName: string,
    private _dbName: string
  ) {}

  get namespace(): string {
    return `${this._dbName}.${this.collectionName}`;
  }

  // ---- Find ----

  find(filter: Record<string, unknown> = {}, options: MongoFindOptions = {}): JSDBFindCursor {
    return new JSDBFindCursor(this.collectionName, filter, options);
  }

  // Promise API
  async findOne(
    filter?: Record<string, unknown>,
    options?: Pick<MongoFindOptions, 'projection' | 'sort'>
  ): Promise<Document | null>;
  // Callback API
  findOne(
    filter: Record<string, unknown>,
    callback: MongoCallback<Document | null>
  ): void;
  findOne(
    filter: Record<string, unknown>,
    options: Pick<MongoFindOptions, 'projection' | 'sort'>,
    callback: MongoCallback<Document | null>
  ): void;
  findOne(
    filter?: Record<string, unknown>,
    optionsOrCb?: Pick<MongoFindOptions, 'projection' | 'sort'> | MongoCallback<Document | null>,
    maybeCallback?: MongoCallback<Document | null>
  ): void | Promise<Document | null> {
    const filterVal = filter ?? {};
    let options: Pick<MongoFindOptions, 'projection' | 'sort'> = {};
    let callback: MongoCallback<Document | null> | undefined;

    if (typeof optionsOrCb === 'function') {
      callback = optionsOrCb;
    } else {
      options = optionsOrCb ?? {};
      if (typeof maybeCallback === 'function') callback = maybeCallback;
    }

    const doFind = async (): Promise<Document | null> => {
      return mongoFindOne(this.collectionName, filterVal, options);
    };

    if (callback) {
      doFind()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doFind();
  }

  // ---- Insert ----

  // Promise API
  async insertOne(doc: Record<string, unknown>): Promise<MongoWriteResult & { insertedId: unknown }>;
  // Callback API
  insertOne(doc: Record<string, unknown>, callback: MongoCallback<MongoWriteResult & { insertedId: unknown }>): void;
  insertOne(
    doc: Record<string, unknown>,
    callback?: MongoCallback<MongoWriteResult & { insertedId: unknown }>
  ): void | Promise<MongoWriteResult & { insertedId: unknown }> {
    const doInsert = async (): Promise<MongoWriteResult & { insertedId: unknown }> => {
      const result = await mongoInsertOne(this.collectionName, doc);
      return { ...result, insertedId: result.insertedId };
    };
    if (callback) {
      doInsert()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doInsert();
  }

  // Promise API
  async insertMany(
    docs: Record<string, unknown>[],
    options?: { ordered?: boolean }
  ): Promise<MongoWriteResult & { insertedIds: Record<number, unknown>; insertedCount: number }>;
  // Callback API
  insertMany(
    docs: Record<string, unknown>[],
    callback: MongoCallback<MongoWriteResult & { insertedIds: Record<number, unknown>; insertedCount: number }>
  ): void;
  insertMany(
    docs: Record<string, unknown>[],
    optionsOrCb?: { ordered?: boolean } | MongoCallback<MongoWriteResult & { insertedIds: Record<number, unknown>; insertedCount: number }>,
    maybeCallback?: MongoCallback<MongoWriteResult & { insertedIds: Record<number, unknown>; insertedCount: number }>
  ): void | Promise<MongoWriteResult & { insertedIds: Record<number, unknown>; insertedCount: number }> {
    let options: { ordered?: boolean } = {};
    let callback: MongoCallback<MongoWriteResult & { insertedIds: Record<number, unknown>; insertedCount: number }> | undefined;

    if (typeof optionsOrCb === 'function') {
      callback = optionsOrCb;
    } else {
      options = optionsOrCb ?? {};
      if (typeof maybeCallback === 'function') callback = maybeCallback;
    }

    const doInsert = async (): Promise<MongoWriteResult & { insertedIds: Record<number, unknown>; insertedCount: number }> => {
      const result = await mongoInsertMany(this.collectionName, docs, options);
      const insertedIds: Record<number, unknown> = {};
      (result.insertedIds as unknown[])?.forEach((id, i) => { insertedIds[i] = id; });
      return { ...result, insertedIds: insertedIds as unknown as unknown[], insertedCount: result.insertedCount ?? 0 };
    };

    if (callback) {
      doInsert()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doInsert();
  }

  // ---- Update ----

  // Promise API
  async updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<MongoWriteResult>;
  // Callback API
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    callback: MongoCallback<MongoWriteResult>
  ): void;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert?: boolean },
    callback: MongoCallback<MongoWriteResult>
  ): void;
  updateOne(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    optionsOrCb?: { upsert?: boolean } | MongoCallback<MongoWriteResult>,
    maybeCallback?: MongoCallback<MongoWriteResult>
  ): void | Promise<MongoWriteResult> {
    let options: { upsert?: boolean } = {};
    let callback: MongoCallback<MongoWriteResult> | undefined;

    if (typeof optionsOrCb === 'function') {
      callback = optionsOrCb;
    } else {
      options = optionsOrCb ?? {};
      if (typeof maybeCallback === 'function') callback = maybeCallback;
    }

    const doUpdate = async (): Promise<MongoWriteResult> => {
      return mongoUpdateOne(this.collectionName, filter, update, options);
    };

    if (callback) {
      doUpdate()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doUpdate();
  }

  // Promise API
  async updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>
  ): Promise<MongoWriteResult>;
  // Callback API
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    callback: MongoCallback<MongoWriteResult>
  ): void;
  updateMany(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    optionsOrCb?: MongoCallback<MongoWriteResult>
  ): void | Promise<MongoWriteResult> {
    const callback = typeof optionsOrCb === 'function' ? optionsOrCb : undefined;

    const doUpdate = async (): Promise<MongoWriteResult> => {
      return mongoUpdateMany(this.collectionName, filter, update);
    };

    if (callback) {
      doUpdate()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doUpdate();
  }

  // Promise API
  async replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    options?: { upsert?: boolean }
  ): Promise<MongoWriteResult>;
  // Callback API
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    callback: MongoCallback<MongoWriteResult>
  ): void;
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    options: { upsert?: boolean },
    callback: MongoCallback<MongoWriteResult>
  ): void;
  replaceOne(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    optionsOrCb?: { upsert?: boolean } | MongoCallback<MongoWriteResult>,
    maybeCallback?: MongoCallback<MongoWriteResult>
  ): void | Promise<MongoWriteResult> {
    let options: { upsert?: boolean } = {};
    let callback: MongoCallback<MongoWriteResult> | undefined;

    if (typeof optionsOrCb === 'function') {
      callback = optionsOrCb;
    } else {
      options = optionsOrCb ?? {};
      if (typeof maybeCallback === 'function') callback = maybeCallback;
    }

    const doReplace = async (): Promise<MongoWriteResult> => {
      // replaceOne replaces the ENTIRE document (not just fields like $set).
      // Strategy: delete the matching doc, then insert the replacement.
      // This ensures fields not in the replacement are removed.
      const existing = await mongoFindOne(this.collectionName, filter);
      if (existing) {
        await mongoDeleteOne(this.collectionName, filter);
        // Preserve _id from original document if not in replacement
        const replacementDoc = { ...replacement };
        if (!replacementDoc._id && existing._id) {
          replacementDoc._id = existing._id;
        }
        const insertResult = await mongoInsertOne(this.collectionName, replacementDoc);
        return {
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
          upsertedId: undefined,
          upsertedCount: 0,
        };
      } else if (options.upsert) {
        const insertResult = await mongoInsertOne(this.collectionName, replacement);
        return {
          acknowledged: true,
          matchedCount: 0,
          modifiedCount: 0,
          upsertedId: insertResult.insertedId,
          upsertedCount: 1,
        };
      }
      return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
    };

    if (callback) {
      doReplace()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doReplace();
  }

  // Promise API
  async findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' }
  ): Promise<Document | null>;
  // Callback API
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    callback: MongoCallback<Document | null>
  ): void;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options: { upsert?: boolean; returnDocument?: 'before' | 'after' },
    callback: MongoCallback<Document | null>
  ): void;
  findOneAndUpdate(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    optionsOrCb?: { upsert?: boolean; returnDocument?: 'before' | 'after' } | MongoCallback<Document | null>,
    maybeCallback?: MongoCallback<Document | null>
  ): void | Promise<Document | null> {
    let options: { upsert?: boolean; returnDocument?: 'before' | 'after' } = {};
    let callback: MongoCallback<Document | null> | undefined;

    if (typeof optionsOrCb === 'function') {
      callback = optionsOrCb;
    } else {
      options = optionsOrCb ?? {};
      if (typeof maybeCallback === 'function') callback = maybeCallback;
    }

    const doFindAndUpdate = async (): Promise<Document | null> => {
      const before = options.returnDocument !== 'after'
        ? await mongoFindOne(this.collectionName, filter)
        : null;
      await mongoUpdateOne(this.collectionName, filter, update, options);
      if (options.returnDocument === 'after') {
        return mongoFindOne(this.collectionName, filter);
      }
      return before;
    };

    if (callback) {
      doFindAndUpdate()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doFindAndUpdate();
  }

  // Promise API
  async findOneAndDelete(
    filter: Record<string, unknown>
  ): Promise<Document | null>;
  // Callback API
  findOneAndDelete(
    filter: Record<string, unknown>,
    callback: MongoCallback<Document | null>
  ): void;
  findOneAndDelete(
    filter: Record<string, unknown>,
    callback?: MongoCallback<Document | null>
  ): void | Promise<Document | null> {
    const doFindAndDelete = async (): Promise<Document | null> => {
      const doc = await mongoFindOne(this.collectionName, filter);
      if (doc) await mongoDeleteOne(this.collectionName, filter);
      return doc;
    };

    if (callback) {
      doFindAndDelete()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doFindAndDelete();
  }

  // Promise API
  async findOneAndReplace(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    options?: { upsert?: boolean; returnDocument?: 'before' | 'after' }
  ): Promise<Document | null>;
  // Callback API
  findOneAndReplace(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    callback: MongoCallback<Document | null>
  ): void;
  findOneAndReplace(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    options: { upsert?: boolean; returnDocument?: 'before' | 'after' },
    callback: MongoCallback<Document | null>
  ): void;
  findOneAndReplace(
    filter: Record<string, unknown>,
    replacement: Record<string, unknown>,
    optionsOrCb?: { upsert?: boolean; returnDocument?: 'before' | 'after' } | MongoCallback<Document | null>,
    maybeCallback?: MongoCallback<Document | null>
  ): void | Promise<Document | null> {
    let options: { upsert?: boolean; returnDocument?: 'before' | 'after' } = {};
    let callback: MongoCallback<Document | null> | undefined;

    if (typeof optionsOrCb === 'function') {
      callback = optionsOrCb;
    } else {
      options = optionsOrCb ?? {};
      if (typeof maybeCallback === 'function') callback = maybeCallback;
    }

    const doReplace = async (): Promise<Document | null> => {
      return this.findOneAndUpdate(filter, { $set: replacement }, options) as Promise<Document | null>;
    };

    if (callback) {
      doReplace()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doReplace();
  }

  // ---- Delete ----

  // Promise API
  async deleteOne(filter: Record<string, unknown>): Promise<MongoWriteResult & { deletedCount: number }>;
  // Callback API
  deleteOne(filter: Record<string, unknown>, callback: MongoCallback<MongoWriteResult & { deletedCount: number }>): void;
  deleteOne(
    filter: Record<string, unknown>,
    callback?: MongoCallback<MongoWriteResult & { deletedCount: number }>
  ): void | Promise<MongoWriteResult & { deletedCount: number }> {
    const doDelete = async (): Promise<MongoWriteResult & { deletedCount: number }> => {
      const result = await mongoDeleteOne(this.collectionName, filter);
      return { ...result, deletedCount: result.deletedCount ?? 0 };
    };

    if (callback) {
      doDelete()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doDelete();
  }

  // Promise API
  async deleteMany(filter: Record<string, unknown>): Promise<MongoWriteResult & { deletedCount: number }>;
  // Callback API
  deleteMany(filter: Record<string, unknown>, callback: MongoCallback<MongoWriteResult & { deletedCount: number }>): void;
  deleteMany(
    filter: Record<string, unknown>,
    callback?: MongoCallback<MongoWriteResult & { deletedCount: number }>
  ): void | Promise<MongoWriteResult & { deletedCount: number }> {
    const doDelete = async (): Promise<MongoWriteResult & { deletedCount: number }> => {
      const result = await mongoDeleteMany(this.collectionName, filter);
      return { ...result, deletedCount: result.deletedCount ?? 0 };
    };

    if (callback) {
      doDelete()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doDelete();
  }

  // ---- Count ----

  // Promise API
  async countDocuments(filter?: Record<string, unknown>): Promise<number>;
  // Callback API
  countDocuments(filter: Record<string, unknown>, callback: MongoCallback<number>): void;
  countDocuments(
    filterOrCb?: Record<string, unknown> | MongoCallback<number>,
    maybeCallback?: MongoCallback<number>
  ): void | Promise<number> {
    let filter: Record<string, unknown> = {};
    let callback: MongoCallback<number> | undefined;

    if (typeof filterOrCb === 'function') {
      callback = filterOrCb;
    } else if (typeof maybeCallback === 'function') {
      filter = filterOrCb ?? {};
      callback = maybeCallback;
    } else if (filterOrCb) {
      filter = filterOrCb;
    }

    const doCount = async (): Promise<number> => {
      return mongoCountDocuments(this.collectionName, filter);
    };

    if (callback) {
      doCount()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doCount();
  }

  // Promise API
  async estimatedDocumentCount(): Promise<number>;
  // Callback API
  estimatedDocumentCount(callback: MongoCallback<number>): void;
  estimatedDocumentCount(callback?: MongoCallback<number>): void | Promise<number> {
    const doCount = async (): Promise<number> => {
      return mongoCountDocuments(this.collectionName, {});
    };

    if (callback) {
      doCount()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doCount();
  }

  // Promise API
  async count(filter?: Record<string, unknown>): Promise<number>;
  // Callback API
  count(filter: Record<string, unknown>, callback: MongoCallback<number>): void;
  count(
    filterOrCb?: Record<string, unknown> | MongoCallback<number>,
    maybeCallback?: MongoCallback<number>
  ): void | Promise<number> {
    return this.countDocuments(filterOrCb as Record<string, unknown>, maybeCallback as MongoCallback<number>);
  }

  // ---- Aggregate ----

  aggregate(pipeline: AggregationStage[]): JSDBAggregateCursor {
    return new JSDBAggregateCursor(this.collectionName, pipeline);
  }

  // ---- Index ----

  // Promise API
  async createIndex(
    keys: Record<string, 1 | -1 | 'text'>,
    options?: { unique?: boolean; name?: string; sparse?: boolean }
  ): Promise<string>;
  // Callback API
  createIndex(
    keys: Record<string, 1 | -1 | 'text'>,
    callback: MongoCallback<string>
  ): void;
  createIndex(
    keys: Record<string, 1 | -1 | 'text'>,
    options: { unique?: boolean; name?: string; sparse?: boolean },
    callback: MongoCallback<string>
  ): void;
  createIndex(
    keys: Record<string, 1 | -1 | 'text'>,
    optionsOrCb?: { unique?: boolean; name?: string; sparse?: boolean } | MongoCallback<string>,
    maybeCallback?: MongoCallback<string>
  ): void | Promise<string> {
    let options: { unique?: boolean; name?: string; sparse?: boolean } = {};
    let callback: MongoCallback<string> | undefined;

    if (typeof optionsOrCb === 'function') {
      callback = optionsOrCb;
    } else {
      options = optionsOrCb ?? {};
      if (typeof maybeCallback === 'function') callback = maybeCallback;
    }

    const doCreate = async (): Promise<string> => {
      const adapter = await ensureConnected();
      const fields = Object.keys(keys);
      const indexName = options.name ?? `idx_${this.collectionName}_${fields.join('_')}`;
      await adapter.createIndex(this.collectionName, fields, {
        unique: options.unique,
        name: indexName,
        sparse: options.sparse,
      });
      return indexName;
    };

    if (callback) {
      doCreate()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doCreate();
  }

  // Promise API
  async createIndexes(
    indexSpecs: Array<{ key: Record<string, 1 | -1>; name?: string; unique?: boolean }>
  ): Promise<string[]>;
  // Callback API
  createIndexes(
    indexSpecs: Array<{ key: Record<string, 1 | -1>; name?: string; unique?: boolean }>,
    callback: MongoCallback<string[]>
  ): void;
  createIndexes(
    indexSpecs: Array<{ key: Record<string, 1 | -1>; name?: string; unique?: boolean }>,
    callback?: MongoCallback<string[]>
  ): void | Promise<string[]> {
    const doCreate = async (): Promise<string[]> => {
      return Promise.all(indexSpecs.map(spec => this.createIndex(spec.key, spec)));
    };

    if (callback) {
      doCreate()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doCreate();
  }

  // Promise API
  async dropIndex(indexName: string): Promise<void>;
  // Callback API
  dropIndex(indexName: string, callback: MongoCallback<void>): void;
  dropIndex(
    indexName: string,
    callback?: MongoCallback<void>
  ): void | Promise<void> {
    const doDrop = async (): Promise<void> => {
      const adapter = await ensureConnected();
      await adapter.dropIndex(this.collectionName, indexName);
    };

    if (callback) {
      doDrop()
        .then(() => callback!(null))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doDrop();
  }

  // Promise API
  async drop(): Promise<boolean>;
  // Callback API
  drop(callback: MongoCallback<boolean>): void;
  drop(callback?: MongoCallback<boolean>): void | Promise<boolean> {
    const doDrop = async (): Promise<boolean> => {
      await mongoDropCollection(this.collectionName, { ifExists: true });
      return true;
    };

    if (callback) {
      doDrop()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doDrop();
  }

  // ---- Bulk Write ----

  async bulkWrite(
    operations: Array<{
      insertOne?: { document: Record<string, unknown> };
      updateOne?: { filter: Record<string, unknown>; update: Record<string, unknown>; upsert?: boolean };
      updateMany?: { filter: Record<string, unknown>; update: Record<string, unknown> };
      deleteOne?: { filter: Record<string, unknown> };
      deleteMany?: { filter: Record<string, unknown> };
      replaceOne?: { filter: Record<string, unknown>; replacement: Record<string, unknown>; upsert?: boolean };
    }>,
    options: { ordered?: boolean; transaction?: boolean } = {}
  ): Promise<{
    insertedCount: number;
    matchedCount: number;
    modifiedCount: number;
    deletedCount: number;
    upsertedCount: number;
    upsertedIds: Record<number, unknown>;
    insertedIds: Record<number, unknown>;
  }> {
    let insertedCount = 0;
    let matchedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    let upsertedCount = 0;
    const upsertedIds: Record<number, unknown> = {};
    const insertedIds: Record<number, unknown> = {};

    const useTransaction = options.transaction !== false;
    let adapter: Awaited<ReturnType<typeof ensureConnected>> | null = null;
    let tx: AdapterTransaction | null = null;

    if (useTransaction) {
      try {
        adapter = await ensureConnected();
        tx = await adapter.beginTransaction();
      } catch {
        // If transaction not supported, fall back to non-transactional
        tx = null;
      }
    }

    try {
      // Group consecutive operations of the same type for batching
      let i = 0;
      while (i < operations.length) {
        const op = operations[i];

        if (op.insertOne) {
          // Collect consecutive insertOne operations for batch insert
          const docs: Record<string, unknown>[] = [];
          const startIdx = i;
          while (i < operations.length && operations[i].insertOne) {
            docs.push(operations[i].insertOne!.document);
            i++;
          }
          // Batch insert
          if (docs.length === 1) {
            const r = await this.insertOne(docs[0]);
            insertedIds[insertedCount] = r.insertedId;
            insertedCount++;
          } else {
            const r = await this.insertMany(docs);
            for (let j = 0; j < docs.length; j++) {
              insertedIds[startIdx + j] = (r.insertedIds as Record<number, unknown>)[j];
            }
            insertedCount += docs.length;
          }
        } else if (op.updateOne) {
          const r = await this.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert });
          matchedCount += r.matchedCount ?? 0;
          modifiedCount += r.modifiedCount ?? 0;
          if (r.upsertedId) { upsertedIds[upsertedCount] = r.upsertedId; upsertedCount++; }
          i++;
        } else if (op.updateMany) {
          const r = await this.updateMany(op.updateMany.filter, op.updateMany.update);
          matchedCount += r.matchedCount ?? 0;
          modifiedCount += r.modifiedCount ?? 0;
          i++;
        } else if (op.deleteOne) {
          const r = await this.deleteOne(op.deleteOne.filter);
          deletedCount += r.deletedCount;
          i++;
        } else if (op.deleteMany) {
          const r = await this.deleteMany(op.deleteMany.filter);
          deletedCount += r.deletedCount;
          i++;
        } else if (op.replaceOne) {
          const r = await this.replaceOne(op.replaceOne.filter, op.replaceOne.replacement, { upsert: op.replaceOne.upsert });
          matchedCount += r.matchedCount ?? 0;
          modifiedCount += r.modifiedCount ?? 0;
          i++;
        } else {
          i++;
        }
      }

      if (tx) await tx.commit();
    } catch (err) {
      if (tx) await tx.rollback().catch(() => {});
      throw err;
    }

    return { insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount, upsertedIds, insertedIds };
  }

  // ---- Distinct ----

  // Promise API
  async distinct(field: string, filter?: Record<string, unknown>): Promise<unknown[]>;
  // Callback API
  distinct(field: string, filter: Record<string, unknown>, callback: MongoCallback<unknown[]>): void;
  distinct(field: string, callback: MongoCallback<unknown[]>): void;
  distinct(
    field: string,
    filterOrCb?: Record<string, unknown> | MongoCallback<unknown[]>,
    maybeCallback?: MongoCallback<unknown[]>
  ): void | Promise<unknown[]> {
    let filter: Record<string, unknown> = {};
    let callback: MongoCallback<unknown[]> | undefined;

    if (typeof filterOrCb === 'function') {
      callback = filterOrCb;
    } else if (typeof maybeCallback === 'function') {
      filter = filterOrCb ?? {};
      callback = maybeCallback;
    } else if (filterOrCb) {
      filter = filterOrCb;
    }

    const doDistinct = async (): Promise<unknown[]> => {
      const adapter = await ensureConnected();
      const config = getSharedConfig();

      // Build a DISTINCT aggregation pipeline
      const pipeline: AggregationStage[] = [
        { $match: filter } as AggregationStage,
        { $group: { _id: `$${field}` } } as AggregationStage,
      ];

      const ir: import('../ir/nodes.js').IRNode = {
        type: 'aggregate',
        collection: this.collectionName,
        pipeline,
        metadata: { timestamp: new Date() },
      };

      const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
      const result = await adapter.execute(plan) as { documents: Array<Record<string, unknown>> };
      const docs = result.documents ?? [];

      // Extract unique values, flattening if the field contains arrays
      const seen = new Set<unknown>();
      const uniqueValues: unknown[] = [];
      for (const doc of docs) {
        const val = doc._id;
        if (Array.isArray(val)) {
          for (const item of val) {
            if (!seen.has(item)) { seen.add(item); uniqueValues.push(item); }
          }
        } else if (val !== undefined && val !== null) {
          if (!seen.has(val)) { seen.add(val); uniqueValues.push(val); }
        }
      }
      return uniqueValues;
    };

    if (callback) {
      doDistinct()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doDistinct();
  }
}

// =====================================================
// Db — database handle
// =====================================================
class JSDBDb {
  constructor(public readonly databaseName: string) {}

  collection(name: string): JSDBCollection {
    return new JSDBCollection(name, this.databaseName);
  }

  // Promise API
  async createCollection(name: string, options?: { ifNotExists?: boolean }): Promise<JSDBCollection>;
  // Callback API
  createCollection(name: string, callback: MongoCallback<JSDBCollection>): void;
  createCollection(
    name: string,
    optionsOrCb?: { ifNotExists?: boolean } | MongoCallback<JSDBCollection>,
    maybeCallback?: MongoCallback<JSDBCollection>
  ): void | Promise<JSDBCollection> {
    let options: { ifNotExists?: boolean } = {};
    let callback: MongoCallback<JSDBCollection> | undefined;

    if (typeof optionsOrCb === 'function') {
      callback = optionsOrCb;
    } else {
      options = optionsOrCb ?? {};
      if (typeof maybeCallback === 'function') callback = maybeCallback;
    }

    const doCreate = async (): Promise<JSDBCollection> => {
      await mongoCreateCollection(name, options);
      return this.collection(name);
    };

    if (callback) {
      doCreate()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doCreate();
  }

  // Promise API
  async dropCollection(name: string): Promise<boolean>;
  // Callback API
  dropCollection(name: string, callback: MongoCallback<boolean>): void;
  dropCollection(
    name: string,
    callback?: MongoCallback<boolean>
  ): void | Promise<boolean> {
    const doDrop = async (): Promise<boolean> => {
      await mongoDropCollection(name, { ifExists: true });
      return true;
    };

    if (callback) {
      doDrop()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doDrop();
  }

  // Promise API
  async listCollections(): Promise<{ name: string }[]>;
  // Callback API
  listCollections(callback: MongoCallback<{ name: string }[]>): void;
  listCollections(
    callback?: MongoCallback<{ name: string }[]>
  ): void | Promise<{ name: string }[]> {
    const doList = async (): Promise<{ name: string }[]> => {
      const names = await mongoListCollections();
      return names.map(name => ({ name }));
    };

    if (callback) {
      doList()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doList();
  }

  // Promise API
  async command(cmd: Record<string, unknown>): Promise<Record<string, unknown>>;
  // Callback API
  command(cmd: Record<string, unknown>, callback: MongoCallback<Record<string, unknown>>): void;
  command(
    cmd: Record<string, unknown>,
    callback?: MongoCallback<Record<string, unknown>>
  ): void | Promise<Record<string, unknown>> {
    const doCommand = async (): Promise<Record<string, unknown>> => {
      // Support common MongoDB commands
      if ('ping' in cmd) {
        await ensureConnected();
        return { ok: 1 };
      }

      if ('listCollections' in cmd) {
        const collections = await mongoListCollections();
        return {
          ok: 1,
          cursor: {
            batchSize: 0,
            id: 0,
            ns: `${this.databaseName}.$cmd.listCollections`,
            firstBatch: collections.map(name => ({
              name,
              type: 'collection',
              options: {},
              info: { readOnly: false },
            })),
          },
        };
      }

      if ('dbStats' in cmd) {
        const collections = await mongoListCollections();
        return {
          ok: 1,
          db: this.databaseName,
          collections: collections.length,
          views: 0,
          objects: 0,
          avgObjSize: 0,
          dataSize: 0,
          storageSize: 0,
          indexes: 0,
          totalIndexSize: 0,
        };
      }

      if ('collStats' in cmd) {
        const collName = (cmd as { collStats: string }).collStats;
        return {
          ok: 1,
          ns: `${this.databaseName}.${collName}`,
          count: 0,
          size: 0,
          storageSize: 0,
          totalIndexSize: 0,
          indexes: 0,
        };
      }

      if ('createCollection' in cmd) {
        const collName = (cmd as { createCollection: string }).createCollection;
        await mongoCreateCollection(collName, { ifNotExists: true });
        return { ok: 1, ns: `${this.databaseName}.${collName}` };
      }

      if ('dropCollection' in cmd) {
        const collName = (cmd as { dropCollection: string }).dropCollection;
        await mongoDropCollection(collName, { ifExists: true });
        return { ok: 1, ns: `${this.databaseName}.${collName}` };
      }

      if ('dropDatabase' in cmd) {
        const collections = await mongoListCollections();
        for (const coll of collections) {
          await mongoDropCollection(coll, { ifExists: true });
        }
        return { ok: 1, dropped: this.databaseName };
      }

      logger.warn(`db.command() called with unsupported command: ${JSON.stringify(cmd).slice(0, 50)}`);
      return { ok: 1, note: 'command not fully supported in JSDB compat mode' };
    };

    if (callback) {
      doCommand()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doCommand();
  }
}

// =====================================================
// MongoClient — top-level entry point
// =====================================================
export class MongoClient {
  private _connected = false;
  private _dbName: string;

  constructor(
    public readonly uri: string = 'mongodb://localhost:27017',
    public readonly options: Record<string, unknown> = {}
  ) {
    // Extract default db name from URI if present
    const uriDbMatch = uri.match(/\/([^/?]+)(\?|$)/);
    this._dbName = (uriDbMatch?.[1]) ?? 'jsdb';
  }

  // Promise API
  async connect(): Promise<this>;
  // Callback API
  connect(callback: MongoCallback<this>): void;
  connect(callback?: MongoCallback<this>): void | Promise<this> {
    const doConnect = async (): Promise<this> => {
      await ensureConnected();
      this._connected = true;
      logger.info(`JSDB MongoClient connected → target: ${getSharedConfig().database}`);
      return this;
    };

    if (callback) {
      doConnect()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doConnect();
  }

  // Promise API
  async close(): Promise<void>;
  // Callback API
  close(callback: MongoCallback<void>): void;
  close(callback?: MongoCallback<void>): void | Promise<void> {
    const doClose = async (): Promise<void> => {
      const adapter = await ensureConnected();
      await adapter.disconnect();
      this._connected = false;
    };

    if (callback) {
      doClose()
        .then(() => callback!(null))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doClose();
  }

  db(name?: string): JSDBDb {
    return new JSDBDb(name ?? this._dbName);
  }

  isConnected(): boolean {
    return this._connected;
  }

  startSession(): {
    startTransaction: () => void;
    commitTransaction: () => Promise<void>;
    abortTransaction: () => Promise<void>;
    endSession: () => Promise<void>;
  } {
    let tx: AdapterTransaction | null = null;
    return {
      startTransaction: () => {
        ensureConnected().then(a => a.beginTransaction()).then(t => { tx = t; }).catch(() => {});
      },
      commitTransaction: async () => { await tx?.commit(); tx = null; },
      abortTransaction: async () => { await tx?.rollback(); tx = null; },
      endSession: async () => { if (tx) await tx.rollback().catch(() => {}); },
    };
  }

  /** Static connect factory */
  static async connect(uri: string, options?: Record<string, unknown>): Promise<MongoClient> {
    const client = new MongoClient(uri, options);
    await client.connect();
    return client;
  }
}

// =====================================================
// ObjectId — lightweight shim
// The real ObjectId is a 24-char hex string.
// We generate compatible IDs without native deps.
// =====================================================
export class ObjectId {
  private _id: string;

  constructor(id?: string | ObjectId) {
    if (id instanceof ObjectId) {
      this._id = id._id;
    } else if (typeof id === 'string' && id.length === 24) {
      this._id = id;
    } else if (typeof id === 'string') {
      // Pad or hash to 24 chars
      this._id = id.padEnd(24, '0').slice(0, 24);
    } else {
      // Generate new ObjectId-like string
      const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
      const random = Math.random().toString(16).slice(2, 18).padStart(16, '0');
      this._id = timestamp + random;
    }
  }

  toString(): string { return this._id; }
  toHexString(): string { return this._id; }

  equals(other: ObjectId | string): boolean {
    const otherId = other instanceof ObjectId ? other._id : other;
    return this._id === otherId;
  }

  getTimestamp(): Date {
    const timestamp = parseInt(this._id.slice(0, 8), 16);
    return new Date(timestamp * 1000);
  }

  static createFromTime(time: number): ObjectId {
    const timestamp = time.toString(16).padStart(8, '0');
    return new ObjectId(timestamp + '0000000000000000');
  }

  static isValid(id: string | ObjectId): boolean {
    if (id instanceof ObjectId) return true;
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
  }

  static generate(): string {
    return new ObjectId().toString();
  }

  toJSON(): string { return this._id; }
}

// =====================================================
// GridFSBucket — stub (not translatable to SQL DBs)
// =====================================================
export class GridFSBucket {
  constructor(_db: JSDBDb, _options?: Record<string, unknown>) {
    logger.warn('GridFSBucket is not supported across database types — use a file storage service instead');
  }
  openUploadStream(_filename: string): never {
    throw new Error('GridFSBucket is not supported in JSDB compat mode');
  }
}

// =====================================================
// Utility types and exports
// =====================================================

export type { Document } from '../types/index.js';
export type { MongoWriteResult };

// Named exports mirroring the mongodb package
export { JSDBCollection as Collection, JSDBDb as Db };

// Error classes
export class MongoError extends Error {
  public code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'MongoError';
    this.code = code;
  }
}

export class MongoServerError extends MongoError {
  constructor(message: string, code?: number) {
    super(message, code);
    this.name = 'MongoServerError';
  }
}

export class MongoNetworkError extends MongoError {
  constructor(message: string) {
    super(message);
    this.name = 'MongoNetworkError';
  }
}

// Default export
const mongodbCompat = {
  MongoClient,
  ObjectId,
  GridFSBucket,
  MongoError,
  MongoServerError,
  MongoNetworkError,
};

export default mongodbCompat;
