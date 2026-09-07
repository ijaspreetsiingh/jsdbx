// =====================================================
// JSDB - MySQL Adapter
// Implements the full DatabaseAdapter contract for MySQL
// =====================================================
import { CapabilityRegistry } from '../../capabilities/registry.js';
import { mysqlCapabilities } from '../../capabilities/mysql.js';
import {
  JSDBConnectionError,
  JSDBQueryError,
  JSDBTransactionError,
  normalizeError,
} from '../../errors/index.js';
import { validateCollectionName } from '../../utils/id.js';
import { createLogger } from '../../utils/logger.js';
import {
  compileFilter,
  compileProjection,
  compileSort,
  compileUpdate,
  compileAggregation,
  quoteIdentifier,
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
  MysqlConnectionConfig,
} from '../../types/index.js';
import type { ExecutionPlan } from '../../ir/nodes.js';
import type { AdapterTransaction, AdapterFindResult, AdapterCountResult, AdapterAggregateResult } from '../base.js';
import { generateId, generateUUID } from '../../utils/id.js';

interface MySQLPool {
  getConnection(): Promise<MySQLConnection>;
  query(sql: string, params?: unknown[]): Promise<[unknown[], unknown[]]>;
  execute(sql: string, params?: unknown[]): Promise<[unknown[], unknown[]]>;
  end(): Promise<void>;
}

interface MySQLConnection {
  query(sql: string, params?: unknown[]): Promise<[unknown[], unknown[]]>;
  execute(sql: string, params?: unknown[]): Promise<[unknown[], unknown[]]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

interface MySQLTransactionImpl extends AdapterTransaction {
  connection: MySQLConnection;
  _active: boolean;
}

export class MySQLAdapter extends BaseAdapter {
  readonly type = 'mysql' as const;
  readonly capabilities: CapabilityRegistry;
  private pool: MySQLPool | null = null;
  private logger = createLogger('info', 'JSDB:MySQL');

  constructor(config: JSDBConfig) {
    super(config);
    this.capabilities = new CapabilityRegistry();
    this.capabilities.registerMany(mysqlCapabilities);
  }

  async connect(): Promise<void> {
    try {
      // Dynamically import mysql2/promise — it's an optional peer dep
      let mysql2: { createPool: (config: unknown) => MySQLPool };
      try {
        mysql2 = await import('mysql2/promise') as unknown as { createPool: (config: unknown) => MySQLPool };
      } catch {
        throw new JSDBConnectionError(
          'mysql2 package is not installed. Run: npm install mysql2',
          'mysql'
        );
      }

      const connCfg = this.config.connection as MysqlConnectionConfig;
      const poolCfg = this.config.pool;

      this.pool = mysql2.createPool({
        host: connCfg?.host ?? 'localhost',
        port: connCfg?.port ?? 3306,
        database: connCfg?.database,
        user: connCfg?.user,
        // Password intentionally not logged
        password: connCfg?.password,
        waitForConnections: true,
        connectionLimit: poolCfg?.max ?? 10,
        queueLimit: 0,
        connectTimeout: poolCfg?.acquireTimeoutMs ?? 10000,
        // Enable timezone support
        timezone: (connCfg as MysqlConnectionConfig & { timezone?: string })?.timezone ?? 'Z',
        charset: (connCfg as MysqlConnectionConfig & { charset?: string })?.charset ?? 'utf8mb4',
      });

      // Verify connectivity
      await this.ping();
      this.connected = true;
      this.logger.info('MySQL connection pool established', {
        host: connCfg?.host,
        database: connCfg?.database,
      });
    } catch (err) {
      if (err instanceof JSDBConnectionError) throw err;
      throw new JSDBConnectionError(
        `Failed to connect to MySQL: ${(err as Error).message}`,
        'mysql',
        err as Error
      );
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
      this.logger.info('MySQL connection pool closed');
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool!.query('SELECT 1');
      return true;
    } catch (err) {
      throw new JSDBConnectionError(
        `MySQL ping failed: ${(err as Error).message}`,
        'mysql',
        err as Error
      );
    }
  }

  private getPool(): MySQLPool {
    if (!this.pool) {
      throw new JSDBConnectionError('Not connected to MySQL. Call connect() first.', 'mysql');
    }
    return this.pool;
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
        return this.findOne(ir.collection, ir.filter, { sort: ir.sort, projection: ir.projection }, tx);
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
        throw new JSDBQueryError(`Unsupported IR type: ${(ir as { type: string }).type}`, 'mysql');
    }
  }

  private getQueryTarget(tx?: AdapterTransaction): { query: (sql: string, params?: unknown[]) => Promise<[unknown[], unknown[]]> } {
    if (tx) {
      const myTx = tx as MySQLTransactionImpl;
      return myTx.connection;
    }
    return this.getPool();
  }

  async find(
    collection: string,
    filter: Filter,
    options?: FindOptions,
    tx?: AdapterTransaction
  ): Promise<AdapterFindResult> {
    validateCollectionName(collection);
    const params: unknown[] = [];
    const whereResult = compileFilter(filter, params);
    const whereClause = whereResult.sql !== '1 = 1' ? `WHERE ${whereResult.sql}` : '';
    const selectCols = compileProjection(options?.projection);
    const orderByClause = compileSort(options?.sort);
    let limitClause = '';
    let offsetClause = '';

    if (options?.limit !== undefined) {
      params.push(options.limit);
      limitClause = 'LIMIT ?';
    }
    const offset = options?.offset ?? options?.skip ?? 0;
    if (offset > 0) {
      params.push(offset);
      offsetClause = 'OFFSET ?';
    }

    const sql = [
      `SELECT ${selectCols}`,
      `FROM ${quoteIdentifier(collection)}`,
      whereClause,
      orderByClause,
      limitClause,
      offsetClause,
    ].filter(Boolean).join(' ');

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(sql, params);
      return { documents: rows as Document[] };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async findOne(
    collection: string,
    filter: Filter,
    options?: FindOptions,
    tx?: AdapterTransaction
  ): Promise<Document | null> {
    const result = await this.find(collection, filter, { ...options, limit: 1 }, tx);
    return result.documents[0] ?? null;
  }

  async insert(
    collection: string,
    document: Document,
    tx?: AdapterTransaction
  ): Promise<InsertOneResult> {
    validateCollectionName(collection);
    const fields = Object.keys(document);
    if (fields.length === 0) {
      throw new JSDBQueryError('Insert document cannot be empty', 'mysql', undefined, collection);
    }

    const cols = fields.map((f) => quoteIdentifier(f)).join(', ');
    const placeholders = fields.map(() => '?').join(', ');
    const params = fields.map((f) => document[f]);

    const sql = `INSERT INTO ${quoteIdentifier(collection)} (${cols}) VALUES (${placeholders})`;

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(sql, params);
      const res = (rows as unknown as { insertId: number });
      return {
        insertedId: String(res.insertId),
        acknowledged: true,
      };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async insertMany(
    collection: string,
    documents: Document[],
    options?: { ordered?: boolean },
    tx?: AdapterTransaction
  ): Promise<InsertManyResult> {
    validateCollectionName(collection);
    if (documents.length === 0) {
      return { insertedIds: [], insertedCount: 0, acknowledged: true };
    }

    const fields = Object.keys(documents[0]);
    const cols = fields.map((f) => quoteIdentifier(f)).join(', ');
    const rowPlaceholders = `(${fields.map(() => '?').join(', ')})`;
    const allPlaceholders = documents.map(() => rowPlaceholders).join(', ');
    const params = documents.flatMap((doc) => fields.map((f) => doc[f]));

    const sql = `INSERT INTO ${quoteIdentifier(collection)} (${cols}) VALUES ${allPlaceholders}`;

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(sql, params);
      const res = (rows as unknown as { insertId: number; affectedRows: number });
      const insertedIds = Array.from({ length: res.affectedRows }, (_, i) =>
        String(res.insertId + i)
      );
      return {
        insertedIds,
        insertedCount: res.affectedRows,
        acknowledged: true,
      };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async update(
    collection: string,
    filter: Filter,
    update: Update,
    options?: { upsert?: boolean },
    tx?: AdapterTransaction
  ): Promise<UpdateResult> {
    validateCollectionName(collection);
    const { setClauses, params: setParams } = compileUpdate(update);
    const filterResult = compileFilter(filter, []);
    const whereClause = filterResult.sql !== '1 = 1' ? `WHERE ${filterResult.sql}` : '';
    const params = [...setParams, ...filterResult.params];

    const sql = `UPDATE ${quoteIdentifier(collection)} SET ${setClauses} ${whereClause} LIMIT 1`;

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(sql, params);
      const res = (rows as unknown as { affectedRows: number; changedRows: number });
      return {
        matchedCount: res.affectedRows,
        modifiedCount: res.changedRows,
        acknowledged: true,
      };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async updateMany(
    collection: string,
    filter: Filter,
    update: Update,
    tx?: AdapterTransaction
  ): Promise<UpdateResult> {
    validateCollectionName(collection);
    const { setClauses, params: setParams } = compileUpdate(update);
    const filterResult = compileFilter(filter, []);
    const whereClause = filterResult.sql !== '1 = 1' ? `WHERE ${filterResult.sql}` : '';
    const params = [...setParams, ...filterResult.params];

    const sql = `UPDATE ${quoteIdentifier(collection)} SET ${setClauses} ${whereClause}`;

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(sql, params);
      const res = (rows as unknown as { affectedRows: number; changedRows: number });
      return {
        matchedCount: res.affectedRows,
        modifiedCount: res.changedRows,
        acknowledged: true,
      };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async delete(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<DeleteResult> {
    validateCollectionName(collection);
    const filterResult = compileFilter(filter, []);
    const whereClause = filterResult.sql !== '1 = 1' ? `WHERE ${filterResult.sql}` : '';

    const sql = `DELETE FROM ${quoteIdentifier(collection)} ${whereClause} LIMIT 1`;

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(sql, filterResult.params);
      const res = (rows as unknown as { affectedRows: number });
      return { deletedCount: res.affectedRows, acknowledged: true };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async deleteMany(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<DeleteResult> {
    validateCollectionName(collection);
    const filterResult = compileFilter(filter, []);
    const whereClause = filterResult.sql !== '1 = 1' ? `WHERE ${filterResult.sql}` : '';

    const sql = `DELETE FROM ${quoteIdentifier(collection)} ${whereClause}`;

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(sql, filterResult.params);
      const res = (rows as unknown as { affectedRows: number });
      return { deletedCount: res.affectedRows, acknowledged: true };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async count(
    collection: string,
    filter: Filter,
    tx?: AdapterTransaction
  ): Promise<AdapterCountResult> {
    validateCollectionName(collection);
    const filterResult = compileFilter(filter, []);
    const whereClause = filterResult.sql !== '1 = 1' ? `WHERE ${filterResult.sql}` : '';

    const sql = `SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(collection)} ${whereClause}`;

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(sql, filterResult.params);
      const row = (rows as Array<{ cnt: number }>)[0];
      return { count: row?.cnt ?? 0 };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async aggregate(
    collection: string,
    pipeline: AggregationStage[],
    tx?: AdapterTransaction
  ): Promise<AdapterAggregateResult> {
    validateCollectionName(collection);
    const compiled = compileAggregation(collection, pipeline);

    try {
      const target = this.getQueryTarget(tx);
      const [rows] = await target.query(compiled.sql, compiled.params);
      // MySQL DECIMAL returns strings — cast to numbers for consistency
      const docs = (rows as Document[]).map((row) => {
        const result: Document = {};
        for (const [key, value] of Object.entries(row)) {
          if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) {
            result[key] = Number(value);
          } else {
            result[key] = value;
          }
        }
        return result;
      });
      return { documents: docs };
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async beginTransaction(): Promise<AdapterTransaction> {
    const pool = this.getPool();
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
    } catch (err) {
      conn.release();
      throw new JSDBTransactionError(
        `Failed to begin MySQL transaction: ${(err as Error).message}`,
        'mysql',
        err as Error
      );
    }

    const txId = generateId();
    let active = true;

    const tx: MySQLTransactionImpl = {
      id: txId,
      connection: conn,
      _active: active,
      isActive: () => active,
      commit: async () => {
        if (!active) throw new JSDBTransactionError('Transaction is not active', 'mysql');
        try {
          await conn.commit();
          active = false;
          tx._active = false;
          conn.release();
        } catch (err) {
          throw new JSDBTransactionError(
            `MySQL commit failed: ${(err as Error).message}`,
            'mysql',
            err as Error
          );
        }
      },
      rollback: async () => {
        if (!active) return;
        try {
          await conn.rollback();
          active = false;
          tx._active = false;
          conn.release();
        } catch (err) {
          conn.release();
          throw new JSDBTransactionError(
            `MySQL rollback failed: ${(err as Error).message}`,
            'mysql',
            err as Error
          );
        }
      },
    };

    return tx;
  }

  async createCollection(name: string, options?: { ifNotExists?: boolean }): Promise<void> {
    // MySQL doesn't create tables via this API — handled by schema engine
    // This is a no-op here; schema engine generates the DDL
    this.logger.warn(`createCollection: ${name} — use schema engine for MySQL table creation`);
  }

  async dropCollection(name: string, options?: { ifExists?: boolean }): Promise<void> {
    validateCollectionName(name);
    const ifExists = options?.ifExists ? 'IF EXISTS' : '';
    const sql = `DROP TABLE ${ifExists} ${quoteIdentifier(name)}`;
    try {
      await this.getPool().query(sql, []);
    } catch (err) {
      throw normalizeError(err, 'mysql');
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
      fulltext?: boolean;
    }
  ): Promise<void> {
    validateCollectionName(collection);
    const indexName = options?.name ?? `idx_${collection}_${fields.join('_')}`;
    const unique = options?.unique ? 'UNIQUE' : '';
    const fulltext = options?.fulltext ? 'FULLTEXT' : '';
    const indexType = fulltext || unique;
    const cols = fields.map((f) => quoteIdentifier(f)).join(', ');
    const sql = `CREATE ${indexType} INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(collection)} (${cols})`;
    try {
      await this.getPool().query(sql, []);
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async dropIndex(collection: string, indexName: string): Promise<void> {
    validateCollectionName(collection);
    const sql = `DROP INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(collection)}`;
    try {
      await this.getPool().query(sql, []);
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  async listCollections(): Promise<string[]> {
    try {
      const [rows] = await this.getPool().query('SHOW TABLES', []);
      return (rows as Record<string, string>[]).map((row) => Object.values(row)[0] as string);
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }

  getRawConnection(): unknown {
    // NON_PORTABLE — for MySQL-specific operations only
    return this.pool;
  }

  async executeRaw(query: string, params: unknown[] = []): Promise<unknown> {
    // NON_PORTABLE — marked as MySQL-specific escape hatch
    this.logger.warn('executeRaw called — this operation is NON_PORTABLE', { query: query.slice(0, 50) });
    try {
      const [rows] = await this.getPool().query(query, params);
      return rows;
    } catch (err) {
      throw normalizeError(err, 'mysql');
    }
  }
}
