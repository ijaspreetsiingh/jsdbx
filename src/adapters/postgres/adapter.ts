// =====================================================
// JSDB - PostgreSQL Adapter
// =====================================================
import { CapabilityRegistry } from '../../capabilities/registry.js';
import { postgresCapabilities } from '../../capabilities/postgres.js';
import { JSDBConnectionError, JSDBQueryError, JSDBTransactionError, normalizeError } from '../../errors/index.js';
import { validateCollectionName, generateId } from '../../utils/id.js';
import { createLogger } from '../../utils/logger.js';
import {
  compileFilter,
  compileSort,
  compileProjection,
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
  PostgresConnectionConfig,
} from '../../types/index.js';
import type { ExecutionPlan } from '../../ir/nodes.js';
import type { AdapterTransaction, AdapterFindResult, AdapterCountResult, AdapterAggregateResult } from '../base.js';

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Document[]; rowCount: number | null }>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}

interface PgClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: Document[]; rowCount: number | null }>;
  release(): void;
}

interface PgTransactionImpl extends AdapterTransaction {
  client: PgClient;
  _active: boolean;
}

export class PostgreSQLAdapter extends BaseAdapter {
  readonly type = 'postgres' as const;
  readonly capabilities: CapabilityRegistry;
  private pool: PgPool | null = null;
  private logger = createLogger('info', 'JSDB:Postgres');

  constructor(config: JSDBConfig) {
    super(config);
    this.capabilities = new CapabilityRegistry();
    this.capabilities.registerMany(postgresCapabilities);
  }

  async connect(): Promise<void> {
    try {
      let pg: { Pool: new (cfg: unknown) => PgPool };
      try {
        pg = await import('pg') as unknown as { Pool: new (cfg: unknown) => PgPool };
      } catch {
        throw new JSDBConnectionError('pg package not installed. Run: npm install pg', 'postgres');
      }

      const cfg = this.config.connection as PostgresConnectionConfig | undefined;
      const poolCfg = this.config.pool;

      const connConfig: Record<string, unknown> = {};
      if (cfg?.connectionString) {
        connConfig['connectionString'] = cfg.connectionString;
      } else {
        connConfig['host'] = cfg?.host ?? 'localhost';
        connConfig['port'] = cfg?.port ?? 5432;
        connConfig['database'] = cfg?.database;
        connConfig['user'] = cfg?.user;
        connConfig['password'] = cfg?.password;
      }
      connConfig['max'] = poolCfg?.max ?? 10;
      connConfig['idleTimeoutMillis'] = poolCfg?.idleTimeoutMs ?? 30000;
      connConfig['connectionTimeoutMillis'] = poolCfg?.acquireTimeoutMs ?? 10000;

      this.pool = new pg.Pool(connConfig);
      
      // Try to get a client to verify connection and credentials
      try {
        const client = await this.pool.connect();
        client.release();
      } catch (connErr) {
        // Connection failed - this includes authentication errors
        await this.pool.end();
        this.pool = null;
        throw new JSDBConnectionError(
          `Failed to connect to PostgreSQL: ${(connErr as Error).message}`,
          'postgres',
          connErr as Error
        );
      }
      
      this.connected = true;
      this.logger.info('PostgreSQL connection pool established');
    } catch (err) {
      if (err instanceof JSDBConnectionError) throw err;
      throw new JSDBConnectionError(`Failed to connect to PostgreSQL: ${(err as Error).message}`, 'postgres', err as Error);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.connected = false;
    }
  }

  async ping(): Promise<boolean> {
    try {
      if (!this.pool) return false;
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  private getPool(): PgPool {
    if (!this.pool) throw new JSDBConnectionError('Not connected to PostgreSQL', 'postgres');
    return this.pool;
  }

  private getTarget(tx?: AdapterTransaction): PgPool | PgClient {
    if (tx) return (tx as PgTransactionImpl).client;
    return this.getPool();
  }

  async execute(plan: ExecutionPlan, tx?: AdapterTransaction): Promise<unknown> {
    const ir = plan.ir;
    switch (ir.type) {
      case 'find': return this.find(ir.collection, ir.filter, { sort: ir.sort, limit: ir.limit, offset: ir.offset, projection: ir.projection }, tx);
      case 'findOne': return this.findOne(ir.collection, ir.filter, { projection: ir.projection }, tx);
      case 'insert': return this.insert(ir.collection, ir.document, tx);
      case 'insertMany': return this.insertMany(ir.collection, ir.documents, { ordered: ir.ordered }, tx);
      case 'update': return this.update(ir.collection, ir.filter, ir.update, { upsert: ir.upsert }, tx);
      case 'updateMany': return this.updateMany(ir.collection, ir.filter, ir.update, tx);
      case 'delete': return this.delete(ir.collection, ir.filter, tx);
      case 'deleteMany': return this.deleteMany(ir.collection, ir.filter, tx);
      case 'count': return this.count(ir.collection, ir.filter, tx);
      case 'aggregate': return this.aggregate(ir.collection, ir.pipeline, tx);
      default: throw new JSDBQueryError(`Unsupported: ${(ir as { type: string }).type}`, 'postgres');
    }
  }

  async find(collection: string, filter: Filter, options?: FindOptions, tx?: AdapterTransaction): Promise<AdapterFindResult> {
    validateCollectionName(collection);
    const params: unknown[] = [];
    const where = compileFilter(filter, params);
    const whereClause = where.sql !== 'TRUE' ? `WHERE ${where.sql}` : '';
    const select = compileProjection(options?.projection);
    const order = compileSort(options?.sort);
    const parts = [`SELECT ${select} FROM ${quoteIdentifier(collection)}`, whereClause, order];
    if (options?.limit !== undefined) { params.push(options.limit); parts.push(`LIMIT $${params.length}`); }
    const offset = options?.offset ?? options?.skip ?? 0;
    if (offset > 0) { params.push(offset); parts.push(`OFFSET $${params.length}`); }
    const sql = parts.filter(Boolean).join(' ');
    try {
      const result = await this.getTarget(tx).query(sql, params);
      return { documents: result.rows };
    } catch (err) { throw normalizeError(err, 'postgres'); }
  }

  async findOne(collection: string, filter: Filter, options?: FindOptions, tx?: AdapterTransaction): Promise<Document | null> {
    const res = await this.find(collection, filter, { ...options, limit: 1 }, tx);
    return res.documents[0] ?? null;
  }

  async insert(collection: string, document: Document, tx?: AdapterTransaction): Promise<InsertOneResult> {
    validateCollectionName(collection);
    const fields = Object.keys(document);
    const params = fields.map((f) => document[f]);
    const cols = fields.map(quoteIdentifier).join(', ');
    const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${quoteIdentifier(collection)} (${cols}) VALUES (${placeholders}) RETURNING *`;
    try {
      const result = await this.getTarget(tx).query(sql, params);
      const row = result.rows[0] as Record<string, unknown>;
      // Try common primary key names: id, _id, or first column
      const idValue = row?.id ?? row?._id ?? row?.[fields[0]] ?? '';
      return { insertedId: String(idValue), acknowledged: true };
    } catch (err) { throw normalizeError(err, 'postgres'); }
  }

  async insertMany(collection: string, documents: Document[], _opts?: { ordered?: boolean }, tx?: AdapterTransaction): Promise<InsertManyResult> {
    if (!documents.length) return { insertedIds: [], insertedCount: 0, acknowledged: true };
    const fields = Object.keys(documents[0]);
    const cols = fields.map(quoteIdentifier).join(', ');
    const rows = documents.map((doc, i) =>
      `(${fields.map((_, j) => `$${i * fields.length + j + 1}`).join(', ')})`
    );
    const params = documents.flatMap((doc) => fields.map((f) => doc[f]));
    const sql = `INSERT INTO ${quoteIdentifier(collection)} (${cols}) VALUES ${rows.join(', ')} RETURNING *`;
    try {
      const result = await this.getTarget(tx).query(sql, params);
      return {
        insertedIds: result.rows.map((r) => {
          const row = r as Record<string, unknown>;
          return String(row?.id ?? row?._id ?? '');
        }),
        insertedCount: result.rows.length,
        acknowledged: true,
      };
    } catch (err) { throw normalizeError(err, 'postgres'); }
  }

  async update(collection: string, filter: Filter, update: Update, _opts?: { upsert?: boolean }, tx?: AdapterTransaction): Promise<UpdateResult> {
    validateCollectionName(collection);
    const { setClauses, params: setParams } = compileUpdate(update, 1);
    const filterParams: unknown[] = [];
    const where = compileFilter(filter, filterParams, setParams.length + 1);
    const whereClause = where.sql !== 'TRUE' ? `WHERE ${where.sql}` : '';
    const sql = `UPDATE ${quoteIdentifier(collection)} SET ${setClauses} ${whereClause} RETURNING *`;
    const allParams = [...setParams, ...filterParams];
    try {
      const result = await this.getTarget(tx).query(sql, allParams);
      return { matchedCount: result.rowCount ?? 0, modifiedCount: result.rowCount ?? 0, acknowledged: true };
    } catch (err) { throw normalizeError(err, 'postgres'); }
  }

  async updateMany(collection: string, filter: Filter, update: Update, tx?: AdapterTransaction): Promise<UpdateResult> {
    return this.update(collection, filter, update, {}, tx);
  }

  async delete(collection: string, filter: Filter, tx?: AdapterTransaction): Promise<DeleteResult> {
    validateCollectionName(collection);
    const params: unknown[] = [];
    const where = compileFilter(filter, params);
    const whereClause = where.sql !== 'TRUE' ? `WHERE ${where.sql}` : '';
    const sql = `DELETE FROM ${quoteIdentifier(collection)} ${whereClause} RETURNING *`;
    try {
      const result = await this.getTarget(tx).query(sql, params);
      return { deletedCount: result.rowCount ?? 0, acknowledged: true };
    } catch (err) { throw normalizeError(err, 'postgres'); }
  }

  async deleteMany(collection: string, filter: Filter, tx?: AdapterTransaction): Promise<DeleteResult> {
    return this.delete(collection, filter, tx);
  }

  async count(collection: string, filter: Filter, tx?: AdapterTransaction): Promise<AdapterCountResult> {
    validateCollectionName(collection);
    const params: unknown[] = [];
    const where = compileFilter(filter, params);
    const whereClause = where.sql !== 'TRUE' ? `WHERE ${where.sql}` : '';
    const sql = `SELECT COUNT(*) AS cnt FROM ${quoteIdentifier(collection)} ${whereClause}`;
    try {
      const result = await this.getTarget(tx).query(sql, params);
      return { count: parseInt(String((result.rows[0] as Record<string, unknown>)?.cnt ?? 0), 10) };
    } catch (err) { throw normalizeError(err, 'postgres'); }
  }

  async aggregate(collection: string, pipeline: AggregationStage[], tx?: AdapterTransaction): Promise<AdapterAggregateResult> {
    validateCollectionName(collection);
    // Use the full compileAggregation from the PostgreSQL compiler which handles
    // $match, $group, $project, $sort, $limit, $skip, $count, $lookup, $unwind, $addFields
    const compiled = compileAggregation(collection, pipeline);
    try {
      const result = await this.getTarget(tx).query(compiled.sql, compiled.params);
      return { documents: result.rows };
    } catch (err) { throw normalizeError(err, 'postgres'); }
  }

  async beginTransaction(): Promise<AdapterTransaction> {
    const client = await this.getPool().connect();
    await client.query('BEGIN');
    const txId = generateId();
    let active = true;
    const tx: PgTransactionImpl = {
      id: txId,
      client,
      _active: active,
      isActive: () => active,
      commit: async () => {
        await client.query('COMMIT');
        active = false;
        tx._active = false;
        client.release();
      },
      rollback: async () => {
        try { await client.query('ROLLBACK'); } finally {
          active = false;
          tx._active = false;
          client.release();
        }
      },
    };
    return tx;
  }

  async createCollection(name: string, opts?: { ifNotExists?: boolean }): Promise<void> {
    this.logger.warn(`createCollection: ${name} — use schema engine for PostgreSQL`);
  }

  async dropCollection(name: string, opts?: { ifExists?: boolean }): Promise<void> {
    const ifExists = opts?.ifExists ? 'IF EXISTS' : '';
    await this.getPool().query(`DROP TABLE ${ifExists} ${quoteIdentifier(name)} CASCADE`);
  }

  async createIndex(collection: string, fields: string[], opts?: { unique?: boolean; name?: string; fulltext?: boolean }): Promise<void> {
    const name = opts?.name ?? `idx_${collection}_${fields.join('_')}`;
    const unique = opts?.unique ? 'UNIQUE' : '';
    const cols = fields.map(quoteIdentifier).join(', ');
    const method = opts?.fulltext ? 'USING gin' : '';
    const sql = `CREATE ${unique} INDEX IF NOT EXISTS ${quoteIdentifier(name)} ON ${quoteIdentifier(collection)} ${method} (${cols})`;
    await this.getPool().query(sql);
  }

  async dropIndex(collection: string, indexName: string): Promise<void> {
    await this.getPool().query(`DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`);
  }

  async listCollections(): Promise<string[]> {
    const result = await this.getPool().query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    return result.rows.map((r) => String((r as Record<string, unknown>).table_name));
  }

  getRawConnection(): unknown { return this.pool; }
  async executeRaw(query: string, params?: unknown[]): Promise<unknown> {
    this.logger.warn('executeRaw called — NON_PORTABLE');
    try { return (await this.getPool().query(query, params)).rows; }
    catch (err) { throw normalizeError(err, 'postgres'); }
  }
}
