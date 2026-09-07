// =====================================================
// JSDB - SQLite Adapter (synchronous via better-sqlite3)
// =====================================================
import { CapabilityRegistry } from '../../capabilities/registry.js';
import { sqliteCapabilities } from '../../capabilities/sqlite.js';
import { JSDBConnectionError, JSDBQueryError, JSDBTransactionError, JSDBUnsupportedOperationError, normalizeError } from '../../errors/index.js';
import { validateCollectionName, generateId } from '../../utils/id.js';
import { createLogger } from '../../utils/logger.js';
// Re-use MySQL compiler (same ? syntax)
import { compileFilter, compileProjection, compileSort, compileUpdate, compileAggregation, quoteIdentifier } from '../mysql/compiler.js';
import { BaseAdapter } from '../base.js';
import type {
  JSDBConfig, Filter, Update, FindOptions, Document,
  InsertOneResult, InsertManyResult, UpdateResult, DeleteResult,
  AggregationStage, SqliteConnectionConfig,
} from '../../types/index.js';
import type { ExecutionPlan } from '../../ir/nodes.js';
import type { AdapterTransaction, AdapterFindResult, AdapterCountResult, AdapterAggregateResult } from '../base.js';

interface BetterSQLite3DB {
  prepare(sql: string): BetterSQLite3Statement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): () => T;
  close(): void;
  pragma(pragma: string): void;
}

interface BetterSQLite3Statement {
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number };
  get(...params: unknown[]): Document | undefined;
  all(...params: unknown[]): Document[];
}

interface SQLiteTransactionImpl extends AdapterTransaction {
  db: BetterSQLite3DB;
  _active: boolean;
}

export class SQLiteAdapter extends BaseAdapter {
  readonly type = 'sqlite' as const;
  readonly capabilities: CapabilityRegistry;
  private db: BetterSQLite3DB | null = null;
  private logger = createLogger('info', 'JSDB:SQLite');

  constructor(config: JSDBConfig) {
    super(config);
    this.capabilities = new CapabilityRegistry();
    this.capabilities.registerMany(sqliteCapabilities);
  }

  async connect(): Promise<void> {
    try {
      let BetterSQLite3: new (path: string, opts?: unknown) => BetterSQLite3DB;
      try {
        const mod = await import('better-sqlite3') as unknown as { default: new (path: string, opts?: unknown) => BetterSQLite3DB };
        BetterSQLite3 = mod.default;
      } catch {
        throw new JSDBConnectionError('better-sqlite3 not installed. Run: npm install better-sqlite3', 'sqlite');
      }
      const cfg = this.config.connection as SqliteConnectionConfig | undefined;
      const filename = cfg?.filename ?? ':memory:';
      this.db = new BetterSQLite3(filename, {
        readonly: cfg?.readonly ?? false,
        fileMustExist: cfg?.fileMustExist ?? false,
      });
      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.connected = true;
      this.logger.info('SQLite connected', { file: filename });
    } catch (err) {
      if (err instanceof JSDBConnectionError) throw err;
      throw new JSDBConnectionError(`SQLite connect failed: ${(err as Error).message}`, 'sqlite', err as Error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.connected = false;
    }
  }

  async ping(): Promise<boolean> {
    this.db!.prepare('SELECT 1').get();
    return true;
  }

  private getDB(): BetterSQLite3DB {
    if (!this.db) throw new JSDBConnectionError('Not connected to SQLite', 'sqlite');
    return this.db;
  }

  // Convert ? params to ? (same as MySQL)
  private query(sql: string, params: unknown[]): Document[] {
    return this.getDB().prepare(sql).all(...params);
  }

  private run(sql: string, params: unknown[]): { lastInsertRowid: number | bigint; changes: number } {
    return this.getDB().prepare(sql).run(...params);
  }

  async execute(plan: ExecutionPlan, tx?: AdapterTransaction): Promise<unknown> {
    const ir = plan.ir;
    switch (ir.type) {
      case 'find': return this.find(ir.collection, ir.filter, { sort: ir.sort, limit: ir.limit, offset: ir.offset, projection: ir.projection });
      case 'findOne': return this.findOne(ir.collection, ir.filter, { projection: ir.projection });
      case 'insert': return this.insert(ir.collection, ir.document);
      case 'insertMany': return this.insertMany(ir.collection, ir.documents);
      case 'update': return this.update(ir.collection, ir.filter, ir.update, { upsert: ir.upsert });
      case 'updateMany': return this.updateMany(ir.collection, ir.filter, ir.update);
      case 'delete': return this.delete(ir.collection, ir.filter);
      case 'deleteMany': return this.deleteMany(ir.collection, ir.filter);
      case 'count': return this.count(ir.collection, ir.filter);
      case 'aggregate': return this.aggregate(ir.collection, ir.pipeline);
      case 'createCollection': return this.createCollection(ir.collection, ir.options);
      case 'dropCollection': return this.dropCollection(ir.collection, ir.options);
      case 'createIndex': return this.createIndex(ir.collection, ir.fields, ir.options);
      default: throw new JSDBQueryError(`Unsupported: ${(ir as { type: string }).type}`, 'sqlite');
    }
  }

  async find(collection: string, filter: Filter, options?: FindOptions, _tx?: AdapterTransaction): Promise<AdapterFindResult> {
    validateCollectionName(collection);
    const params: unknown[] = [];
    const where = compileFilter(filter, params);
    const whereClause = where.sql !== '1 = 1' ? `WHERE ${where.sql}` : '';
    const select = compileProjection(options?.projection);
    const order = compileSort(options?.sort);
    const parts = [`SELECT ${select} FROM ${quoteIdentifier(collection)}`, whereClause, order];
    if (options?.limit !== undefined) { params.push(options.limit); parts.push('LIMIT ?'); }
    const offset = options?.offset ?? options?.skip ?? 0;
    if (offset > 0) { params.push(offset); parts.push('OFFSET ?'); }
    const sql = parts.filter(Boolean).join(' ');
    try { return { documents: this.query(sql, params) }; }
    catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async findOne(collection: string, filter: Filter, options?: FindOptions, _tx?: AdapterTransaction): Promise<Document | null> {
    const res = await this.find(collection, filter, { ...options, limit: 1 });
    return res.documents[0] ?? null;
  }

  async insert(collection: string, document: Document, _tx?: AdapterTransaction): Promise<InsertOneResult> {
    validateCollectionName(collection);
    const fields = Object.keys(document);
    const cols = fields.map(quoteIdentifier).join(', ');
    const placeholders = fields.map(() => '?').join(', ');
    const params = fields.map((f) => document[f]);
    const sql = `INSERT INTO ${quoteIdentifier(collection)} (${cols}) VALUES (${placeholders})`;
    try {
      const result = this.run(sql, params);
      return { insertedId: String(result.lastInsertRowid), acknowledged: true };
    } catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async insertMany(collection: string, documents: Document[], _opts?: { ordered?: boolean }, _tx?: AdapterTransaction): Promise<InsertManyResult> {
    if (!documents.length) return { insertedIds: [], insertedCount: 0, acknowledged: true };
    const insertFn = this.getDB().transaction(() => {
      const ids: string[] = [];
      for (const doc of documents) {
        const fields = Object.keys(doc);
        const cols = fields.map(quoteIdentifier).join(', ');
        const phs = fields.map(() => '?').join(', ');
        const params = fields.map((f) => doc[f]);
        const result = this.getDB().prepare(`INSERT INTO ${quoteIdentifier(collection)} (${cols}) VALUES (${phs})`).run(...params);
        ids.push(String(result.lastInsertRowid));
      }
      return ids;
    });
    try {
      const ids = insertFn();
      return { insertedIds: ids, insertedCount: ids.length, acknowledged: true };
    } catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async update(collection: string, filter: Filter, update: Update, _opts?: { upsert?: boolean }, _tx?: AdapterTransaction): Promise<UpdateResult> {
    validateCollectionName(collection);
    const { setClauses, params: setParams } = compileUpdate(update);
    const filterParams: unknown[] = [];
    const where = compileFilter(filter, filterParams);
    const whereClause = where.sql !== '1 = 1' ? `WHERE rowid = (SELECT rowid FROM ${quoteIdentifier(collection)} ${`WHERE ${where.sql}`} LIMIT 1)` : 'WHERE rowid = (SELECT rowid FROM ' + quoteIdentifier(collection) + ' LIMIT 1)';
    const sql = `UPDATE ${quoteIdentifier(collection)} SET ${setClauses} ${whereClause}`;
    try {
      const result = this.run(sql, [...setParams, ...filterParams]);
      return { matchedCount: result.changes, modifiedCount: result.changes, acknowledged: true };
    } catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async updateMany(collection: string, filter: Filter, update: Update, _tx?: AdapterTransaction): Promise<UpdateResult> {
    validateCollectionName(collection);
    const { setClauses, params: setParams } = compileUpdate(update);
    const filterParams: unknown[] = [];
    const where = compileFilter(filter, filterParams);
    const whereClause = where.sql !== '1 = 1' ? `WHERE ${where.sql}` : '';
    const sql = `UPDATE ${quoteIdentifier(collection)} SET ${setClauses} ${whereClause}`;
    try {
      const result = this.run(sql, [...setParams, ...filterParams]);
      return { matchedCount: result.changes, modifiedCount: result.changes, acknowledged: true };
    } catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async delete(collection: string, filter: Filter, _tx?: AdapterTransaction): Promise<DeleteResult> {
    validateCollectionName(collection);
    const filterParams: unknown[] = [];
    const where = compileFilter(filter, filterParams);
    const whereClause = where.sql !== '1 = 1' ? `WHERE rowid = (SELECT rowid FROM ${quoteIdentifier(collection)} WHERE ${where.sql} LIMIT 1)` : `WHERE rowid = (SELECT rowid FROM ${quoteIdentifier(collection)} LIMIT 1)`;
    const sql = `DELETE FROM ${quoteIdentifier(collection)} ${whereClause}`;
    try {
      const result = this.run(sql, filterParams);
      return { deletedCount: result.changes, acknowledged: true };
    } catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async deleteMany(collection: string, filter: Filter, _tx?: AdapterTransaction): Promise<DeleteResult> {
    validateCollectionName(collection);
    const filterParams: unknown[] = [];
    const where = compileFilter(filter, filterParams);
    const whereClause = where.sql !== '1 = 1' ? `WHERE ${where.sql}` : '';
    const sql = `DELETE FROM ${quoteIdentifier(collection)} ${whereClause}`;
    try {
      const result = this.run(sql, filterParams);
      return { deletedCount: result.changes, acknowledged: true };
    } catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async count(collection: string, filter: Filter, _tx?: AdapterTransaction): Promise<AdapterCountResult> {
    validateCollectionName(collection);
    const filterParams: unknown[] = [];
    const where = compileFilter(filter, filterParams);
    const whereClause = where.sql !== '1 = 1' ? `WHERE ${where.sql}` : '';
    const sql = `SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(collection)} ${whereClause}`;
    try {
      const row = this.getDB().prepare(sql).get(...filterParams) as { cnt: number } | undefined;
      return { count: row?.cnt ?? 0 };
    } catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async aggregate(collection: string, pipeline: AggregationStage[], _tx?: AdapterTransaction): Promise<AdapterAggregateResult> {
    const compiled = compileAggregation(collection, pipeline);
    try {
      return { documents: this.query(compiled.sql, compiled.params) };
    } catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async beginTransaction(): Promise<AdapterTransaction> {
    this.getDB().exec('BEGIN');
    const txId = generateId();
    let active = true;
    const tx: SQLiteTransactionImpl = {
      id: txId,
      db: this.db!,
      _active: active,
      isActive: () => active,
      commit: async () => {
        this.getDB().exec('COMMIT');
        active = false;
        tx._active = false;
      },
      rollback: async () => {
        try { this.getDB().exec('ROLLBACK'); } catch {}
        active = false;
        tx._active = false;
      },
    };
    return tx;
  }

  async createCollection(name: string, opts?: { ifNotExists?: boolean }): Promise<void> {
    // SQLite: create a simple table if it doesn't exist
    const ifNot = opts?.ifNotExists !== false ? 'IF NOT EXISTS' : '';
    const sql = `CREATE TABLE ${ifNot} ${quoteIdentifier(name)} (id INTEGER PRIMARY KEY AUTOINCREMENT)`;
    try { this.getDB().exec(sql); }
    catch (err) { throw normalizeError(err, 'sqlite'); }
  }

  async dropCollection(name: string, opts?: { ifExists?: boolean }): Promise<void> {
    const ifEx = opts?.ifExists ? 'IF EXISTS' : '';
    this.getDB().exec(`DROP TABLE ${ifEx} ${quoteIdentifier(name)}`);
  }

  async createIndex(collection: string, fields: string[], opts?: { unique?: boolean; name?: string; fulltext?: boolean }): Promise<void> {
    if (opts?.fulltext) {
      // FTS5 is more complex — skip for basic impl
      this.logger.warn('SQLite FULLTEXT index requires FTS5 virtual table — skipping');
      return;
    }
    const name = opts?.name ?? `idx_${collection}_${fields.join('_')}`;
    const unique = opts?.unique ? 'UNIQUE' : '';
    const cols = fields.map(quoteIdentifier).join(', ');
    const sql = `CREATE ${unique} INDEX IF NOT EXISTS ${quoteIdentifier(name)} ON ${quoteIdentifier(collection)} (${cols})`;
    this.getDB().exec(sql);
  }

  async dropIndex(collection: string, indexName: string): Promise<void> {
    this.getDB().exec(`DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`);
  }

  async listCollections(): Promise<string[]> {
    const rows = this.query(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`, []);
    return rows.map((r) => String((r as Record<string, unknown>).name));
  }

  getRawConnection(): unknown { return this.db; }

  async executeRaw(query: string, params?: unknown[]): Promise<unknown> {
    this.logger.warn('executeRaw — NON_PORTABLE');
    try { return this.query(query, params ?? []); }
    catch (err) { throw normalizeError(err, 'sqlite'); }
  }
}
