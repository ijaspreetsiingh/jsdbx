// =====================================================
// JSDB Mongoose Compatibility Shim
//
// DROP-IN REPLACEMENT for mongoose ORM.
//
// Existing code:
//   import mongoose from 'mongoose';
//   await mongoose.connect('mongodb://localhost/myapp');
//   const User = mongoose.model('User', new Schema({ name: String, age: Number }));
//   const users = await User.find({ age: { $gt: 18 } });
//   const user = new User({ name: 'Alice', age: 30 });
//   await user.save();
//
// Change only the import:
//   import mongoose from 'jsdb/mongoose';
// ─── or use jsdb/register for ZERO import changes ───
//
// Model methods: find, findOne, findById, create, save,
// updateOne, updateMany, deleteOne, deleteMany, countDocuments,
// aggregate, populate (stub), lean, exec, select, sort,
// limit, skip, where, exists
// =====================================================

import { ensureConnected, getSharedConfig, execSQL } from './core.js';
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
  type MongoFindOptions,
} from './mongo-core.js';
import { createLogger } from '../utils/logger.js';
import type { Document, AggregationStage } from '../types/index.js';

const logger = createLogger('info', 'JSDB:mongoose-proxy');

// =====================================================
// Schema — stores field definitions (we don't enforce
// schema validation server-side; just track field names
// for lean document shaping)
// =====================================================

// ---- DDL Generation from Mongoose Schema ----
function mongooseTypeToSql(type: unknown): string {
  // Handle both constructor functions (String, Number, etc.) and string names ('String', 'Number')
  if (type === String || type === 'String') return 'VARCHAR(255)';
  if (type === Number || type === 'Number') return 'DOUBLE';
  if (type === Boolean || type === 'Boolean') return 'TINYINT(1)';
  if (type === Date || type === 'Date') return 'DATETIME';
  if (type === Buffer || type === 'Buffer') return 'LONGBLOB';
  if (type === Object || type === 'Mixed' || type === 'Object') return 'JSON';
  if (type === Array || type === 'Array') return 'JSON';
  if (String(type) === 'ObjectId') return 'VARCHAR(50)';
  if (String(type) === 'Decimal128') return 'DECIMAL(65,30)';
  if (String(type) === 'Map') return 'JSON';
  return 'TEXT';
}

export function generateCreateTableDDL(
  schema: Schema,
  collectionName: string
): string {
  const columns: string[] = [];
  const topLevelFields = new Set<string>();
  const nestedParents = new Set<string>();

  // Identify top-level vs nested fields
  for (const field of schema.paths.keys()) {
    if (field === '_id' || field === 'id') continue;
    const parts = field.split('.');
    topLevelFields.add(parts[0]);
    if (parts.length > 1) {
      nestedParents.add(parts[0]);
    }
  }

  // Always add _id as primary key (JSDB convention)
  columns.push('`_id` VARCHAR(50) NOT NULL PRIMARY KEY');

  for (const field of topLevelFields) {
    // If this field has nested children, store as JSON
    if (nestedParents.has(field)) {
      columns.push(`\`${field}\` JSON`);
      continue;
    }

    const def = schema.paths.get(field);
    if (!def) continue;

    const sqlType = mongooseTypeToSql(def.type);
    const nullable = def.required ? 'NOT NULL' : 'NULL';

    // Handle default values properly for SQL
    let defaultClause = '';
    if (def.default !== undefined && def.default !== null) {
      if (def.type === Boolean || def.type === 'Boolean') {
        defaultClause = `DEFAULT ${def.default ? 1 : 0}`;
      } else if (def.type === Number || def.type === 'Number') {
        defaultClause = `DEFAULT ${def.default}`;
      } else if (typeof def.default === 'string') {
        defaultClause = `DEFAULT '${def.default}'`;
      } else if (typeof def.default === 'function') {
        // Skip function defaults (e.g., Date.now)
      } else if (Array.isArray(def.default) || typeof def.default === 'object') {
        // Skip complex defaults — they'll use DB defaults
      } else {
        defaultClause = `DEFAULT ${def.default}`;
      }
    }

    const unique = def.unique ? 'UNIQUE' : '';

    columns.push(`\`${field}\` ${sqlType} ${nullable} ${defaultClause} ${unique}`.trim());
  }

  return `CREATE TABLE IF NOT EXISTS \`${collectionName}\` (\n  ${columns.join(',\n  ')}\n)`;
}

async function ensureTableFromSchema(schema: Schema, collection: string): Promise<void> {
  const config = getSharedConfig();
  // Only auto-create tables for relational databases (mysql, postgres)
  if (config.database !== 'mysql' && config.database !== 'postgres') return;

  try {
    const ddl = generateCreateTableDDL(schema, collection);
    await execSQL(ddl);
    logger.info(`Auto-created table: ${collection}`);
  } catch (err: unknown) {
    // Table may already exist — that's fine
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('already exists') && !msg.includes('Duplicate')) {
      logger.warn(`Auto-create table ${collection}: ${msg}`);
    }
  }
}
export class Schema {
  public paths: Map<string, { type: unknown; required?: boolean; default?: unknown; unique?: boolean }>;
  public options: Record<string, unknown>;
  private _statics: Record<string, Function> = {};
  private _methods: Record<string, Function> = {};
  private _virtuals: Record<string, { get?: Function; set?: Function }> = {};
  private _indexes: Array<[Record<string, unknown>, Record<string, unknown>]> = [];
  public _hooks: { pre: Map<string, Function[]>; post: Map<string, Function[]> } = {
    pre: new Map(),
    post: new Map(),
  };

  constructor(
    definition: Record<string, unknown> = {},
    options: Record<string, unknown> = {}
  ) {
    this.paths = new Map();
    this.options = options;
    this._parseDefinition(definition);
  }

  private _parseDefinition(def: Record<string, unknown>, prefix = ''): void {
    for (const [key, val] of Object.entries(def)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      if (val && typeof val === 'object' && !Array.isArray(val) && !(val as Record<string, unknown>).type) {
        // Nested object
        this._parseDefinition(val as Record<string, unknown>, fullKey);
      } else {
        this.paths.set(fullKey, {
          type: Array.isArray(val) ? 'Array' : (val as Record<string, unknown>)?.type ?? val,
          required: (val as Record<string, unknown>)?.required as boolean,
          default: (val as Record<string, unknown>)?.default,
          unique: (val as Record<string, unknown>)?.unique as boolean,
        });
      }
    }
  }

  static(name: string, fn: Function): this {
    this._statics[name] = fn;
    return this;
  }

  method(name: string, fn: Function): this {
    this._methods[name] = fn;
    return this;
  }

  virtual(name: string): { get: (fn: Function) => { set: (fn: Function) => Schema }; set: (fn: Function) => { get: (fn: Function) => Schema } } {
    const self = this;
    if (!this._virtuals[name]) this._virtuals[name] = {};
    return {
      get: (fn: Function) => {
        self._virtuals[name].get = fn;
        return { set: (sfn: Function) => { self._virtuals[name].set = sfn; return self; } };
      },
      set: (fn: Function) => {
        self._virtuals[name].set = fn;
        return { get: (gfn: Function) => { self._virtuals[name].get = gfn; return self; } };
      },
    };
  }

  index(fields: Record<string, unknown>, options: Record<string, unknown> = {}): this {
    this._indexes.push([fields, options]);
    return this;
  }

  pre(hook: string, fn: Function): this {
    if (!this._hooks.pre.has(hook)) this._hooks.pre.set(hook, []);
    this._hooks.pre.get(hook)!.push(fn);
    return this;
  }

  post(hook: string, fn: Function): this {
    if (!this._hooks.post.has(hook)) this._hooks.post.set(hook, []);
    this._hooks.post.get(hook)!.push(fn);
    return this;
  }

  add(definition: Record<string, unknown>): this {
    this._parseDefinition(definition);
    return this;
  }

  getStatics() { return this._statics; }
  getMethods() { return this._methods; }
}

// =====================================================
// resolvePopulate — performs $lookup aggregation to
// resolve populated paths in query results
// =====================================================
async function resolvePopulate(
  docs: Document[],
  populatePaths: Array<{ path: string; model?: string; localField?: string; foreignField?: string; select?: string }>
): Promise<Document[]> {
  if (!docs.length) return docs;

  for (const pop of populatePaths) {
    const foreignModel = pop.model ?? pop.path;
    const localField = pop.localField ?? `${pop.path}Id`;
    const foreignField = pop.foreignField ?? '_id';

    // Collect all foreign key values from documents
    const foreignKeys = new Set<unknown>();
    for (const doc of docs) {
      const val = (doc as Record<string, unknown>)[localField];
      if (val !== undefined && val !== null) {
        if (Array.isArray(val)) {
          for (const v of val) foreignKeys.add(v);
        } else {
          foreignKeys.add(val);
        }
      }
    }

    if (foreignKeys.size === 0) continue;

    // Fetch referenced documents
    const pipeline: AggregationStage[] = [
      { $match: { [foreignField]: { $in: Array.from(foreignKeys) } } } as AggregationStage,
    ];

    const adapter = await ensureConnected();
    const config = getSharedConfig();
    const ir: import('../ir/nodes.js').IRNode = {
      type: 'aggregate',
      collection: foreignModel,
      pipeline,
      metadata: { timestamp: new Date() },
    };
    const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
    const result = await adapter.execute(plan) as { documents: Document[] };
    const foreignDocs = result.documents ?? [];

    // Build lookup map
    const lookupMap = new Map<unknown, Document>();
    for (const fdoc of foreignDocs) {
      const key = (fdoc as Record<string, unknown>)[foreignField];
      lookupMap.set(key, fdoc);
    }

    // Populate documents
    for (const doc of docs) {
      const val = (doc as Record<string, unknown>)[localField];
      if (Array.isArray(val)) {
        (doc as Record<string, unknown>)[pop.path] = val.map(v => lookupMap.get(v) ?? v);
      } else if (val !== undefined && val !== null) {
        (doc as Record<string, unknown>)[pop.path] = lookupMap.get(val) ?? null;
      } else {
        (doc as Record<string, unknown>)[pop.path] = null;
      }
      // NOTE: Do NOT delete the localField. Real mongoose keeps FK fields
      // alongside populated documents. Users may depend on the FK field existing.
    }
  }

  return docs;
}

// =====================================================
// Query — fluent chainable query builder returned by
// Model.find(), Model.findOne() etc.
// =====================================================
class MongooseQuery {
  private _collectionName: string;
  private _filter: Record<string, unknown>;
  private _options: MongoFindOptions & { projection?: Record<string, 0 | 1> };
  private _lean = false;
  private _single = false;
  _populatePaths?: Array<{ path: string; model?: string; localField?: string; foreignField?: string; select?: string }>;

  constructor(
    collectionName: string,
    filter: Record<string, unknown> = {},
    single = false
  ) {
    this._collectionName = collectionName;
    this._filter = filter;
    this._options = {};
    this._single = single;
  }

  where(field: string, val?: unknown): this {
    if (val !== undefined) {
      this._filter[field] = val;
    }
    return this;
  }

  sort(spec: Record<string, 1 | -1> | string): this {
    if (typeof spec === 'string') {
      const parts = spec.split(' ');
      const sort: Record<string, 1 | -1> = {};
      for (const p of parts) {
        if (p.startsWith('-')) sort[p.slice(1)] = -1;
        else if (p) sort[p] = 1;
      }
      this._options.sort = sort;
    } else {
      this._options.sort = spec;
    }
    return this;
  }

  limit(n: number): this { this._options.limit = n; return this; }
  skip(n: number): this { this._options.skip = n; return this; }

  select(fields: string | Record<string, 0 | 1>): this {
    if (typeof fields === 'string') {
      const proj: Record<string, 0 | 1> = {};
      const parts = fields.trim().split(/\s+/);
      for (const p of parts) {
        if (p.startsWith('-')) proj[p.slice(1)] = 0;
        else if (p) proj[p] = 1;
      }
      this._options.projection = proj;
    } else {
      this._options.projection = fields;
    }
    return this;
  }

  lean(val = true): this { this._lean = val; return this; }

  populate(path: string | Record<string, unknown>): this {
    // Store populate specs for execution during exec()
    if (!this._populatePaths) this._populatePaths = [];
    if (typeof path === 'string') {
      this._populatePaths.push({ path });
    } else if (path && typeof path === 'object') {
      this._populatePaths.push(path as { path: string; model?: string; localField?: string; foreignField?: string; select?: string });
    }
    return this;
  }

  async exec(): Promise<Document | Document[] | null> {
    let docs: Document[] | Document | null;
    if (this._single) {
      docs = await mongoFindOne(this._collectionName, this._filter, this._options);
      if (docs && this._populatePaths?.length) {
        docs = await resolvePopulate([docs as Document], this._populatePaths);
        return docs[0] ?? null;
      }
      return docs;
    }
    docs = await mongoFind(this._collectionName, this._filter, this._options);
    if (this._populatePaths?.length && Array.isArray(docs)) {
      docs = await resolvePopulate(docs, this._populatePaths);
    }
    return docs;
  }

  // Make query thenable (so await query works without .exec())
  then<TRes>(
    onfulfilled?: ((value: Document | Document[] | null) => TRes | PromiseLike<TRes>) | null,
    onrejected?: ((reason: unknown) => TRes | PromiseLike<TRes>) | null
  ): Promise<TRes> {
    return this.exec().then(onfulfilled, onrejected) as Promise<TRes>;
  }

  catch<TRes>(
    onrejected?: ((reason: unknown) => TRes | PromiseLike<TRes>) | null
  ): Promise<Document | Document[] | null | TRes> {
    return this.exec().catch(onrejected);
  }
}

// =====================================================
// MongooseDocument — an instance of a model with save()
// =====================================================
class MongooseDocument {
  [key: string]: unknown;
  private _collectionName: string;
  private _isNew: boolean;
  public _id: unknown;

  constructor(collectionName: string, data: Record<string, unknown>, isNew = true) {
    this._collectionName = collectionName;
    this._isNew = isNew;
    Object.assign(this, data);
    if (!this._id) this._id = generateObjectId();
  }

  async save(): Promise<this> {
    // Execute pre-save hooks if any (from schema)
    const hooks = _getHooksForCollection(this._collectionName);
    if (hooks) {
      for (const fn of hooks.preSave) {
        await fn.call(this, this);
      }
    }

    const data = this._toPlain();
    if (this._isNew) {
      await mongoInsertOne(this._collectionName, data);
      this._isNew = false;
    } else {
      await mongoUpdateOne(
        this._collectionName,
        { _id: this._id },
        { $set: data }
      );
    }

    // Execute post-save hooks if any
    if (hooks) {
      for (const fn of hooks.postSave) {
        await fn.call(this, this);
      }
    }

    return this;
  }

  async remove(): Promise<this> {
    await mongoDeleteOne(this._collectionName, { _id: this._id });
    return this;
  }

  async deleteOne(): Promise<{ deletedCount: number }> {
    const r = await mongoDeleteOne(this._collectionName, { _id: this._id });
    return { deletedCount: r.deletedCount ?? 0 };
  }

  toObject(): Record<string, unknown> { return this._toPlain(); }
  toJSON(): Record<string, unknown> { return this._toPlain(); }

  private _toPlain(): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    const internalKeys = new Set(['_collectionName', '_isNew']);
    for (const key of Object.keys(this)) {
      if (!internalKeys.has(key)) obj[key] = (this as Record<string, unknown>)[key];
    }
    // Ensure _id is always included
    if (!obj._id && this._id) obj._id = this._id;
    return obj;
  }

  set(key: string, val: unknown): this {
    (this as Record<string, unknown>)[key] = val;
    return this;
  }

  get(key: string): unknown {
    return (this as Record<string, unknown>)[key];
  }

  markModified(_path: string): void { /* no-op */ }
  isModified(_path?: string): boolean { return true; }
  isNew(): boolean { return this._isNew; }
}

// =====================================================
// Model factory — creates a Model class for a collection
// =====================================================
function createModel(collectionName: string, schema?: Schema): typeof MongooseDocument & {
  find: (filter?: Record<string, unknown>) => MongooseQuery;
  findOne: (filter?: Record<string, unknown>) => MongooseQuery;
  findById: (id: unknown) => MongooseQuery;
  findByIdAndUpdate: (id: unknown, update: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Document | null>;
  findByIdAndDelete: (id: unknown) => Promise<Document | null>;
  findOneAndUpdate: (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Document | null>;
  findOneAndDelete: (filter: Record<string, unknown>) => Promise<Document | null>;
  create: (...args: unknown[]) => Promise<MongooseDocument | MongooseDocument[]>;
  insertMany: (docs: Record<string, unknown>[], options?: Record<string, unknown>) => Promise<MongooseDocument[]>;
  updateOne: (filter: Record<string, unknown>, update: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ matchedCount: number; modifiedCount: number }>;
  updateMany: (filter: Record<string, unknown>, update: Record<string, unknown>) => Promise<{ matchedCount: number; modifiedCount: number }>;
  deleteOne: (filter: Record<string, unknown>) => Promise<{ deletedCount: number }>;
  deleteMany: (filter: Record<string, unknown>) => Promise<{ deletedCount: number }>;
  countDocuments: (filter?: Record<string, unknown>) => Promise<number>;
  estimatedDocumentCount: () => Promise<number>;
  aggregate: (pipeline: AggregationStage[]) => { exec: () => Promise<Document[]>; then: Function };
  exists: (filter: Record<string, unknown>) => Promise<{ _id: unknown } | null>;
  distinct: (field: string, filter?: Record<string, unknown>) => Promise<unknown[]>;
  collection: { name: string; collectionName: string };
  modelName: string;
  schema: Schema | undefined;
  new(data: Record<string, unknown>): MongooseDocument;
} {
  // Inline class with static methods
  class ModelClass extends MongooseDocument {
    constructor(data: Record<string, unknown> = {}) {
      super(collectionName, data, true);
      // Apply schema defaults
      if (schema) {
        for (const [path, def] of schema.paths.entries()) {
          if (def.default !== undefined && !(this as Record<string, unknown>)[path]) {
            (this as Record<string, unknown>)[path] = typeof def.default === 'function'
              ? def.default()
              : def.default;
          }
        }
      }
    }

    static modelName = collectionName;
    static schema = schema;
    static collection = { name: collectionName, collectionName };

    static find(filter: Record<string, unknown> = {}): MongooseQuery {
      return new MongooseQuery(collectionName, filter, false);
    }

    static findOne(filter: Record<string, unknown> = {}): MongooseQuery {
      return new MongooseQuery(collectionName, filter, true);
    }

    static findById(id: unknown): MongooseQuery {
      return new MongooseQuery(collectionName, { _id: id }, true);
    }

    static async findByIdAndUpdate(
      id: unknown,
      update: Record<string, unknown>,
      options: Record<string, unknown> = {}
    ): Promise<Document | null> {
      const before = await mongoFindOne(collectionName, { _id: id });
      await mongoUpdateOne(collectionName, { _id: id }, update, options as { upsert?: boolean });
      if (options.new || options.returnDocument === 'after') {
        return mongoFindOne(collectionName, { _id: id });
      }
      return before;
    }

    static async findByIdAndDelete(id: unknown): Promise<Document | null> {
      const doc = await mongoFindOne(collectionName, { _id: id });
      if (doc) await mongoDeleteOne(collectionName, { _id: id });
      return doc;
    }

    static async findOneAndUpdate(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: Record<string, unknown> = {}
    ): Promise<Document | null> {
      const before = await mongoFindOne(collectionName, filter);
      await mongoUpdateOne(collectionName, filter, update, options as { upsert?: boolean });
      if (options.new || options.returnDocument === 'after') {
        return mongoFindOne(collectionName, filter);
      }
      return before;
    }

    static async findOneAndDelete(filter: Record<string, unknown>): Promise<Document | null> {
      const doc = await mongoFindOne(collectionName, filter);
      if (doc) await mongoDeleteOne(collectionName, filter);
      return doc;
    }

    static async create(...args: unknown[]): Promise<MongooseDocument | MongooseDocument[]> {
      const docs = Array.isArray(args[0]) ? args[0] as Record<string, unknown>[] : [args[0] as Record<string, unknown>];
      if (docs.length === 0) return [];

      // Single doc — use save() for hooks
      if (docs.length === 1) {
        const inst = new ModelClass(docs[0]);
        await inst.save();
        return inst;
      }

      // Multiple docs — use insertMany for performance
      const result = await mongoInsertMany(collectionName, docs);
      return docs.map((d, i) => {
        const inst = new ModelClass(d);
        (inst as Record<string, unknown>)._isNew = false;
        // Assign the insertedId from result
        if (result.insertedIds && Array.isArray(result.insertedIds)) {
          inst._id = result.insertedIds[i];
        }
        return inst;
      });
    }

    static async insertMany(
      docs: Record<string, unknown>[],
      _options?: Record<string, unknown>
    ): Promise<MongooseDocument[]> {
      const result = await mongoInsertMany(collectionName, docs);
      return docs.map((d, i) => {
        const inst = new ModelClass(d);
        (inst as Record<string, unknown>)._isNew = false;
        return inst;
      });
    }

    static async updateOne(
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      _options?: Record<string, unknown>
    ): Promise<{ matchedCount: number; modifiedCount: number }> {
      const r = await mongoUpdateOne(collectionName, filter, update);
      return { matchedCount: r.matchedCount ?? 0, modifiedCount: r.modifiedCount ?? 0 };
    }

    static async updateMany(
      filter: Record<string, unknown>,
      update: Record<string, unknown>
    ): Promise<{ matchedCount: number; modifiedCount: number }> {
      const r = await mongoUpdateMany(collectionName, filter, update);
      return { matchedCount: r.matchedCount ?? 0, modifiedCount: r.modifiedCount ?? 0 };
    }

    static async deleteOne(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
      const r = await mongoDeleteOne(collectionName, filter);
      return { deletedCount: r.deletedCount ?? 0 };
    }

    static async deleteMany(filter: Record<string, unknown>): Promise<{ deletedCount: number }> {
      const r = await mongoDeleteMany(collectionName, filter);
      return { deletedCount: r.deletedCount ?? 0 };
    }

    static async countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
      return mongoCountDocuments(collectionName, filter);
    }

    static async estimatedDocumentCount(): Promise<number> {
      return mongoCountDocuments(collectionName, {});
    }

    static aggregate(pipeline: AggregationStage[]) {
      const _pipeline = pipeline;
      return {
        exec: () => mongoAggregate(collectionName, _pipeline),
        then: (resolve?: Function, reject?: Function) =>
          mongoAggregate(collectionName, _pipeline).then(resolve as any, reject as any),
      };
    }

    static async exists(filter: Record<string, unknown>): Promise<{ _id: unknown } | null> {
      const doc = await mongoFindOne(collectionName, filter);
      if (!doc) return null;
      return { _id: (doc as Record<string, unknown>)._id };
    }

    static async distinct(field: string, filter: Record<string, unknown> = {}): Promise<unknown[]> {
      const pipeline: AggregationStage[] = [
        { $match: filter } as AggregationStage,
        { $group: { _id: `$${field}` } } as AggregationStage,
      ];

      const adapter = await ensureConnected();
      const config = getSharedConfig();
      const ir: import('../ir/nodes.js').IRNode = {
        type: 'aggregate',
        collection: collectionName,
        pipeline,
        metadata: { timestamp: new Date() },
      };
      const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
      const result = await adapter.execute(plan) as { documents: Array<Record<string, unknown>> };
      const docs = result.documents ?? [];

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
    }
  }

  // Apply schema statics
  if (schema) {
    for (const [name, fn] of Object.entries(schema.getStatics())) {
      (ModelClass as unknown as Record<string, unknown>)[name] = fn.bind(ModelClass);
    }
  }

  return ModelClass as unknown as ReturnType<typeof createModel>;
}

// =====================================================
// Mongoose connection singleton
// =====================================================
let _connected = false;
const _models = new Map<string, ReturnType<typeof createModel>>();

function generateObjectId(): string {
  const timestamp = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const random = Math.random().toString(16).slice(2, 18).padStart(16, '0');
  return timestamp + random;
}

// Hook registry — maps collection name → pre/post hooks from schema
const _hookRegistry = new Map<string, { preSave: Function[]; postSave: Function[] }>();

function _getHooksForCollection(collectionName: string): { preSave: Function[]; postSave: Function[] } | null {
  return _hookRegistry.get(collectionName) ?? null;
}

function _registerHooks(collectionName: string, schema: Schema): void {
  const preSave = schema._hooks.pre.get('save') ?? [];
  const postSave = schema._hooks.post.get('save') ?? [];
  if (preSave.length || postSave.length) {
    _hookRegistry.set(collectionName, { preSave, postSave });
  }
}

// =====================================================
// Mongoose main object — default export
// =====================================================
interface MongooseInstance {
  connect(uri: string, options?: Record<string, unknown>): Promise<MongooseInstance>;
  disconnect(): Promise<void>;
  connection: Record<string, unknown>;
  Schema: typeof Schema;
  model(name: string, schema?: Schema, collectionName?: string): ReturnType<typeof createModel>;
  Types: Record<string, unknown>;
  SchemaTypes: Record<string, unknown>;
  plugin(fn: Function, opts?: unknown): void;
  set(key: string, val: unknown): void;
  readonly modelNames: string[];
  isConnected(): boolean;
  Promise: typeof globalThis.Promise;
  _plugins: Array<{ fn: Function; opts: unknown }>;
  _config: Record<string, unknown>;
}

const mongoose: MongooseInstance = {
  // ---- Connection ----
  async connect(uri: string, options: Record<string, unknown> = {}): Promise<typeof mongoose> {
    await ensureConnected();
    _connected = true;
    logger.info(`JSDB Mongoose connected → target: ${getSharedConfig().database}`);
    return mongoose;
  },

  async disconnect(): Promise<void> {
    const adapter = await ensureConnected();
    await adapter.disconnect();
    _connected = false;
  },

  get connection(): Record<string, unknown> {
    return {
      readyState: _connected ? 1 : 0,
      host: 'jsdb-compat',
      db: {
        databaseName: getSharedConfig().connection
          ? (getSharedConfig().connection as Record<string, unknown>).database ?? 'jsdb'
          : 'jsdb',
      },
      on: (_event: string, _fn: Function) => {},
      once: (_event: string, _fn: Function) => {},
      close: async () => { _connected = false; },
    };
  },

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  set connection(_val: Record<string, unknown>) { /* setter for mongoose.connection = ... compatibility */ },

  // ---- Schema & Model ----
  Schema,

  model(
    name: string,
    schema?: Schema,
    collectionName?: string
  ): ReturnType<typeof createModel> {
    const collection = collectionName ?? name.toLowerCase() + 's';

    if (!schema && _models.has(name)) {
      // Return existing model
      return _models.get(name)!;
    }

    const Model = createModel(collection, schema);
    _models.set(name, Model);

    // Register schema hooks for save() execution
    if (schema) _registerHooks(collection, schema);

    // Apply any registered plugins to the new model
    const plugins = (mongoose as unknown as Record<string, unknown>)._plugins as Array<{ fn: Function; opts: unknown }>;
    for (const plugin of plugins) {
      try {
        plugin.fn(Model, plugin.opts);
      } catch {
        // Plugin may not be applicable
      }
    }

    // Ensure collection exists in target DB
    ensureConnected()
      .then(async () => {
        // For relational DBs (MySQL/PG), auto-create table from schema DDL
        if (schema) {
          await ensureTableFromSchema(schema, collection);
        }
        // Also create MongoDB-style collection (for MongoDB targets)
        await mongoCreateCollection(collection, { ifNotExists: true });
      })
      .catch(() => { /* collection may already exist */ });

    return Model;
  },

  // ---- Types ----
  Types: {
    ObjectId: class ObjectId {
      private _id: string;
      constructor(id?: string) {
        this._id = id ?? generateObjectId();
      }
      toString() { return this._id; }
      toHexString() { return this._id; }
      equals(other: unknown) {
        return String(other) === this._id;
      }
      static isValid(id: string) { return typeof id === 'string' && id.length >= 12; }
      toJSON() { return this._id; }
    },
    String: String,
    Number: Number,
    Boolean: Boolean,
    Date: Date,
    Buffer: Buffer,
    Mixed: Object,
    Array: Array,
    Map: Map,
    Decimal128: class Decimal128 {
      constructor(public value: string) {}
      toString() { return this.value; }
    },
  },

  // ---- Schema Types (for Schema field definitions) ----
  SchemaTypes: {
    String: 'String',
    Number: 'Number',
    Boolean: 'Boolean',
    Date: 'Date',
    Buffer: 'Buffer',
    Mixed: 'Mixed',
    ObjectId: 'ObjectId',
    Array: 'Array',
    Map: 'Map',
    Decimal128: 'Decimal128',
  },

  // ---- Plugins ----
  _plugins: [] as Array<{ fn: Function; opts: unknown }>,

  plugin(fn: Function, opts?: unknown): void {
    const plugins = (mongoose as unknown as Record<string, unknown>)._plugins as Array<{ fn: Function; opts: unknown }>;
    plugins.push({ fn, opts });
    // Apply to all existing models
    for (const [, model] of _models) {
      try {
        fn(model, opts);
      } catch {
        // Plugin may not be applicable to all models
      }
    }
  },

  // ---- Set (configuration) ----
  _config: {} as Record<string, unknown>,

  set(key: string, val: unknown): void {
    const config = (mongoose as unknown as Record<string, unknown>)._config as Record<string, unknown>;
    config[key] = val;
    // Handle special mongoose settings
    if (key === 'strictQuery') {
      logger.debug(`strictQuery set to ${val}`);
    }
    if (key === 'strict') {
      logger.debug(`strict mode set to ${val}`);
    }
  },

  // ---- State ----
  get modelNames(): string[] { return [..._models.keys()]; },
  isConnected(): boolean { return _connected; },

  // ---- Promise provider ----
  Promise: globalThis.Promise,
};

export default mongoose;
export { Schema as MongooseSchema };
export type { MongooseDocument };
