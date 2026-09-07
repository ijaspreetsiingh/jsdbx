// =====================================================
// JSDB mysql2-compatible Proxy
//
// DROP-IN REPLACEMENT for mysql2/promise.
// Existing code that does:
//   import mysql from 'mysql2/promise';
//   const pool = mysql.createPool({ host, user, password, database });
//   const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [1]);
//
// Now just changes the import line to:
//   import mysql from 'jsdb/mysql2';
// ─── or uses jsdb/register for ZERO import changes ───
//
// The SQL string & params are intercepted, translated to Universal IR,
// and executed against whichever DB JSDB_DATABASE is set to.
//
// Supports BOTH Promise and callback APIs:
//   const [rows] = await pool.query('SELECT ...');              // Promise
//   pool.query('SELECT ...', (err, rows, fields) => {});       // Callback
// =====================================================

import EventEmitter from 'events';
import { execSQL, ensureConnected, getSharedConfig, resetSharedAdapter } from './core.js';
import type { AdapterTransaction } from '../adapters/base.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('info', 'JSDB:mysql2-proxy');

// ---- Callback types ----
export type Mysql2Callback<T = Record<string, unknown>[]> = (
  err: Error | null,
  rows?: T,
  fields?: { name: string }[]
) => void;

// ---- mysql2 result format ----
// mysql2 query() resolves to [rows, fields]
// mysql2 execute() resolves to [rows, fields]   (identical to query for our purposes)

function toMysql2Result(r: Awaited<ReturnType<typeof execSQL>>): [Record<string, unknown>[], { name: string }[]] {
  return [r.rows, r.fields];
}

function toMysql2OkPacket(r: Awaited<ReturnType<typeof execSQL>>): [Record<string, unknown>, { name: string }[]] {
  return [
    {
      fieldCount: 0,
      affectedRows: r.affectedRows ?? r.rowCount,
      changedRows: r.changedRows ?? 0,
      insertId: r.insertId ?? 0,
      serverStatus: 2,
      warningCount: 0,
      message: '',
      protocol41: true,
    },
    [],
  ];
}

// ---- Connection proxy ----

class JSDBMysql2Connection extends EventEmitter {
  private _tx: AdapterTransaction | null = null;
  public threadId = Math.floor(Math.random() * 100000);

  /** Detect whether result is a write operation */
  private isWrite(sql: string): boolean {
    const s = sql.trimStart().toUpperCase();
    return s.startsWith('INSERT') || s.startsWith('UPDATE') || s.startsWith('DELETE') ||
           s.startsWith('REPLACE') || s.startsWith('TRUNCATE');
  }

  // Promise API
  query(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    values?: unknown[]
  ): Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]>;
  // Callback API
  query(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    callback: Mysql2Callback
  ): void;
  query(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    values: unknown[],
    callback: Mysql2Callback
  ): void;
  query(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    valuesOrCb?: unknown[] | Mysql2Callback,
    maybeCallback?: Mysql2Callback
  ): void | Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]> {
    const sql = typeof sqlOrOptions === 'string' ? sqlOrOptions : sqlOrOptions.sql;
    let params: unknown[];
    let callback: Mysql2Callback | undefined;

    if (typeof valuesOrCb === 'function') {
      params = [];
      callback = valuesOrCb;
    } else if (typeof maybeCallback === 'function') {
      params = (valuesOrCb as unknown[]) ?? [];
      callback = maybeCallback;
    } else {
      params = (valuesOrCb as unknown[]) ?? [];
      callback = undefined;
    }

    const doQuery = async (): Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]> => {
      try {
        const result = await execSQL(sql, params as unknown[], this._tx ?? undefined);
        if (this.isWrite(sql)) return toMysql2OkPacket(result);
        return toMysql2Result(result);
      } catch (err) {
        logger.error(`Query error: ${(err as Error).message}`, { sql: sql.slice(0, 60) });
        throw err;
      }
    };

    if (callback) {
      doQuery()
        .then(([rows, fields]) => callback!(null, rows as Record<string, unknown>[], fields))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doQuery();
  }

  // Promise API
  execute(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    values?: unknown[]
  ): Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]>;
  // Callback API
  execute(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    callback: Mysql2Callback
  ): void;
  execute(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    values: unknown[],
    callback: Mysql2Callback
  ): void;
  execute(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    valuesOrCb?: unknown[] | Mysql2Callback,
    maybeCallback?: Mysql2Callback
  ): void | Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]> {
    if (typeof valuesOrCb === 'function') {
      return this.query(sqlOrOptions, valuesOrCb);
    }
    if (typeof maybeCallback === 'function') {
      return this.query(sqlOrOptions, valuesOrCb as unknown[], maybeCallback);
    }
    return this.query(sqlOrOptions, valuesOrCb as unknown[]);
  }

  // Promise API
  async beginTransaction(): Promise<void>;
  // Callback API
  beginTransaction(callback: (err: Error | null) => void): void;
  beginTransaction(callback?: (err: Error | null) => void): void | Promise<void> {
    const doBegin = async () => {
      const adapter = await ensureConnected();
      this._tx = await adapter.beginTransaction();
      logger.info('Transaction started');
    };

    if (callback) {
      doBegin()
        .then(() => callback(null))
        .catch((err: Error) => callback(err));
      return;
    }
    return doBegin();
  }

  // Promise API
  async commit(): Promise<void>;
  // Callback API
  commit(callback: (err: Error | null) => void): void;
  commit(callback?: (err: Error | null) => void): void | Promise<void> {
    const doCommit = async () => {
      if (this._tx) {
        await this._tx.commit();
        this._tx = null;
        logger.info('Transaction committed');
      }
    };

    if (callback) {
      doCommit()
        .then(() => callback(null))
        .catch((err: Error) => callback(err));
      return;
    }
    return doCommit();
  }

  // Promise API
  async rollback(): Promise<void>;
  // Callback API
  rollback(callback: (err: Error | null) => void): void;
  rollback(callback?: (err: Error | null) => void): void | Promise<void> {
    const doRollback = async () => {
      if (this._tx) {
        await this._tx.rollback();
        this._tx = null;
        logger.info('Transaction rolled back');
      }
    };

    if (callback) {
      doRollback()
        .then(() => callback(null))
        .catch((err: Error) => callback(err));
      return;
    }
    return doRollback();
  }

  // Promise API
  async ping(): Promise<void>;
  // Callback API
  ping(callback: (err: Error | null) => void): void;
  ping(callback?: (err: Error | null) => void): void | Promise<void> {
    const doPing = async () => {
      const adapter = await ensureConnected();
      await adapter.ping();
    };

    if (callback) {
      doPing()
        .then(() => callback(null))
        .catch((err: Error) => callback(err));
      return;
    }
    return doPing();
  }

  /** mysql2-compat: connect() is a no-op since jasdbx manages connections internally */
  connect(callback?: (err: Error | null) => void): void {
    if (callback) {
      callback(null);
    }
  }

  release(): void {
    // No-op — connection pooling handled internally
  }

  destroy(): void {
    this._tx = null;
  }

  // Promise API
  async end(): Promise<void>;
  // Callback API
  end(callback: (err: Error | null) => void): void;
  end(callback?: (err: Error | null) => void): void | Promise<void> {
    const doEnd = async () => {
      await this.rollback();
    };

    if (callback) {
      doEnd()
        .then(() => callback(null))
        .catch((err: Error) => callback(err));
      return;
    }
    return doEnd();
  }

  /** Escape a value for use in a query string (informational only — we use parameterised queries) */
  escape(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number') return String(value);
    if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
    // Escape backslashes first, then single quotes
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  }

  escapeId(identifier: string): string {
    return '`' + identifier.replace(/`/g, '``') + '`';
  }

  format(sql: string, values: unknown[] = []): string {
    let i = 0;
    return sql.replace(/\?/g, () => this.escape(values[i++]));
  }
}

// ---- Pool proxy ----

class JSDBMysql2Pool extends EventEmitter {
  private config: Record<string, unknown>;
  private _conn: JSDBMysql2Connection | null = null;

  constructor(config: Record<string, unknown>) {
    super();
    this.config = config;
    // Eagerly start connection so first query doesn't block
    ensureConnected().catch((err) => {
      logger.warn(`JSDB pool connect warning: ${(err as Error).message}`);
    });
  }

  private getConn(): JSDBMysql2Connection {
    if (!this._conn) this._conn = new JSDBMysql2Connection();
    return this._conn;
  }

  // Promise API
  query(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    values?: unknown[]
  ): Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]>;
  // Callback API
  query(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    callback: Mysql2Callback
  ): void;
  query(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    values: unknown[],
    callback: Mysql2Callback
  ): void;
  query(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    valuesOrCb?: unknown[] | Mysql2Callback,
    maybeCallback?: Mysql2Callback
  ): void | Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]> {
    const conn = this.getConn();
    if (typeof valuesOrCb === 'function') {
      return conn.query(sqlOrOptions, valuesOrCb);
    }
    if (typeof maybeCallback === 'function') {
      return conn.query(sqlOrOptions, valuesOrCb as unknown[], maybeCallback);
    }
    return conn.query(sqlOrOptions, valuesOrCb as unknown[]);
  }

  // Promise API
  execute(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    values?: unknown[]
  ): Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]>;
  // Callback API
  execute(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    callback: Mysql2Callback
  ): void;
  execute(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    values: unknown[],
    callback: Mysql2Callback
  ): void;
  execute(
    sqlOrOptions: string | { sql: string; values?: unknown[] },
    valuesOrCb?: unknown[] | Mysql2Callback,
    maybeCallback?: Mysql2Callback
  ): void | Promise<[Record<string, unknown>[] | Record<string, unknown>, { name: string }[]]> {
    const conn = this.getConn();
    if (typeof valuesOrCb === 'function') {
      return conn.execute(sqlOrOptions, valuesOrCb);
    }
    if (typeof maybeCallback === 'function') {
      return conn.execute(sqlOrOptions, valuesOrCb as unknown[], maybeCallback);
    }
    return conn.execute(sqlOrOptions, valuesOrCb as unknown[]);
  }

  // Promise API
  async getConnection(): Promise<JSDBMysql2Connection>;
  // Callback API
  getConnection(callback: (err: Error | null, conn?: JSDBMysql2Connection) => void): void;
  getConnection(
    callback?: (err: Error | null, conn?: JSDBMysql2Connection) => void
  ): void | Promise<JSDBMysql2Connection> {
    const doGet = async (): Promise<JSDBMysql2Connection> => {
      await ensureConnected();
      return new JSDBMysql2Connection();
    };

    if (callback) {
      doGet()
        .then((conn) => callback(null, conn))
        .catch((err: Error) => callback(err));
      return;
    }
    return doGet();
  }

  // Promise API
  async end(): Promise<void>;
  // Callback API
  end(callback: (err: Error | null) => void): void;
  end(callback?: (err: Error | null) => void): void | Promise<void> {
    const doEnd = async () => {
      if (this._conn) {
        await this._conn.end();
        this._conn = null;
      }
      // NOTE: Do NOT call adapter.disconnect() here — the adapter is a shared
      // singleton. Disconnecting it would kill ALL database operations in the process.
      // Pool.end() should only clean up the pool's own resources.
    };

    if (callback) {
      doEnd()
        .then(() => callback(null))
        .catch((err: Error) => callback(err));
      return;
    }
    return doEnd();
  }

  // Promise API
  async ping(): Promise<void>;
  // Callback API
  ping(callback: (err: Error | null) => void): void;
  ping(callback?: (err: Error | null) => void): void | Promise<void> {
    if (callback) {
      return this.getConn().ping(callback);
    }
    return this.getConn().ping();
  }

  /** Pool stats (mysql2 compatible) */
  get pool() {
    return {
      config: this.config,
      _allConnections: { length: 1 },
      _freeConnections: { length: 1 },
      _connectionQueue: { length: 0 },
    };
  }
}

// ---- Callback-style Pool (non-promise mysql2) ----

class JSDBMysql2PoolCb extends EventEmitter {
  private promisePool: JSDBMysql2Pool;

  constructor(config: Record<string, unknown>) {
    super();
    this.promisePool = new JSDBMysql2Pool(config);
  }

  query(
    sql: string,
    values: unknown[],
    callback: Mysql2Callback
  ): void;
  query(
    sql: string,
    callback: Mysql2Callback
  ): void;
  query(sql: string, valuesOrCb: unknown, cb?: unknown): void {
    const [values, callback] = typeof valuesOrCb === 'function'
      ? [[], valuesOrCb as Mysql2Callback]
      : [valuesOrCb as unknown[], cb as Mysql2Callback];

    this.promisePool.query(sql, values as unknown[])
      .then(([rows, fields]) => callback(null, rows as Record<string, unknown>[], fields))
      .catch((err: Error) => callback(err, undefined, undefined));
  }

  execute(sql: string, values: unknown[], cb: Mysql2Callback): void {
    this.query(sql, values, cb);
  }

  getConnection(cb: (err: Error | null, conn?: JSDBMysql2Connection) => void): void;
  getConnection(): Promise<JSDBMysql2Connection>;
  getConnection(cb?: (err: Error | null, conn?: JSDBMysql2Connection) => void): void | Promise<JSDBMysql2Connection> {
    const doGet = async (): Promise<JSDBMysql2Connection> => {
      await ensureConnected();
      return new JSDBMysql2Connection();
    };

    if (cb) {
      doGet()
        .then((conn) => cb(null, conn))
        .catch((err) => cb(err as Error));
      return;
    }
    return doGet();
  }

  ping(cb?: (err: Error | null) => void): void {
    if (cb) {
      this.promisePool.ping()
        .then(() => cb(null))
        .catch((err: Error) => cb(err));
      return;
    }
    return this.promisePool.ping() as unknown as void;
  }

  end(cb?: (err: Error | null) => void): void {
    this.promisePool.end()
      .then(() => cb?.(null))
      .catch((err: Error) => cb?.(err));
  }

  promise(): JSDBMysql2Pool {
    return this.promisePool;
  }

  /** Pool stats — mysql2 compatible */
  get pool() {
    return this.promisePool.pool;
  }
}

// ---- Public API — mirrors mysql2 top-level exports ----

export function createConnection(config: Record<string, unknown> = {}): JSDBMysql2Connection {
  ensureConnected().catch(() => {});
  return new JSDBMysql2Connection();
}

export function createPool(config: Record<string, unknown> = {}): JSDBMysql2PoolCb {
  return new JSDBMysql2PoolCb(config);
}

export function createPoolCluster(): {
  add: (id: string, config: unknown) => void;
  of: (pattern: string) => JSDBMysql2PoolCb;
  end: () => void;
} {
  const defaultPool = new JSDBMysql2PoolCb({});
  return {
    add: (_id, _config) => { /* no-op */ },
    of: (_pattern) => defaultPool,
    end: () => defaultPool.end(),
  };
}

/** Escape a value (static helper) */
export function escape(value: unknown): string {
  return new JSDBMysql2Connection().escape(value);
}

export function escapeId(id: string): string {
  return new JSDBMysql2Connection().escapeId(id);
}

export function format(sql: string, values: unknown[] = []): string {
  return new JSDBMysql2Connection().format(sql, values);
}

/** Raw error types re-exported for downstream instanceof checks */
export class QueryError extends Error {
  public code: string;
  public errno: number;
  public sqlState: string;
  constructor(msg: string, code = 'ER_UNKNOWN', errno = 1000) {
    super(msg);
    this.name = 'QueryError';
    this.code = code;
    this.errno = errno;
    this.sqlState = '42000';
  }
}

// promise sub-namespace — `mysql2/promise` exports
export const promise = {
  createConnection: (config: Record<string, unknown> = {}) => {
    const conn = new JSDBMysql2Connection();
    ensureConnected().catch(() => {});
    return Promise.resolve(conn);
  },
  createPool: (config: Record<string, unknown> = {}) => new JSDBMysql2Pool(config),
};

// Default export mimics `import mysql from 'mysql2'`
const mysql2Compat = {
  createConnection,
  createPool,
  createPoolCluster,
  escape,
  escapeId,
  format,
  QueryError,
  promise,
  // mysql2/promise compat: createPool returns a Pool with .query/.execute/.getConnection
  createPoolPromise: (config: Record<string, unknown> = {}) => new JSDBMysql2Pool(config),
};

export default mysql2Compat;
