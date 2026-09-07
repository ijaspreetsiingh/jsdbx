// =====================================================
// JSDB pg-compatible Proxy
//
// DROP-IN REPLACEMENT for the `pg` (node-postgres) package.
// Existing code:
//   import { Pool } from 'pg';
//   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
//   const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [1]);
//
// Change only the import:
//   import { Pool } from 'jsdb/pg';
// ─── or use jsdb/register for ZERO import changes ───
//
// pg uses $1, $2... positional params. We convert them to ? before parsing.
//
// Supports BOTH Promise and callback APIs:
//   const { rows } = await pool.query('SELECT ...');           // Promise
//   pool.query('SELECT ...', (err, res) => { ... });           // Callback
// =====================================================

import EventEmitter from 'events';
import { execSQL, ensureConnected, getSharedConfig } from './core.js';
import type { AdapterTransaction } from '../adapters/base.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('info', 'JSDB:pg-proxy');

// ---- Callback types ----

export type PgCallback<T = Record<string, unknown>> = (err: Error | null, result?: PgResult<T>) => void;

// ---- pg result format ----
// pg resolves to { rows, fields, rowCount, command }

interface PgFieldDescription {
  name: string;
  tableID: number;
  columnID: number;
  dataTypeID: number;
  dataTypeSize: number;
  dataTypeModifier: number;
  format: string;
}

interface PgResult<T = Record<string, unknown>> {
  rows: T[];
  fields: PgFieldDescription[];
  rowCount: number | null;
  command: string;
  oid: number;
}

function toPgResult(r: Awaited<ReturnType<typeof execSQL>>, sql: string): PgResult {
  const command = sql.trimStart().split(/\s+/)[0]?.toUpperCase() ?? 'SELECT';
  return {
    rows: r.rows,
    fields: r.fields.map((f, i) => ({
      name: f.name,
      tableID: 0,
      columnID: i,
      dataTypeID: 25, // TEXT
      dataTypeSize: -1,
      dataTypeModifier: -1,
      format: 'text',
    })),
    rowCount: r.rowCount,
    command,
    oid: 0,
  };
}

// ---- Client proxy ----

export class Client extends EventEmitter {
  private _tx: AdapterTransaction | null = null;
  public connectionParameters: Record<string, unknown>;

  constructor(config: string | Record<string, unknown> = {}) {
    super();
    this.connectionParameters = typeof config === 'string' ? { connectionString: config } : config;
  }

  // Promise API
  async connect(): Promise<void>;
  // Callback API
  connect(callback: (err: Error | null) => void): void;
  connect(callback?: (err: Error | null) => void): void | Promise<void> {
    if (callback) {
      ensureConnected()
        .then(() => {
          this.emit('connect');
          callback(null);
        })
        .catch((err: Error) => {
          this.emit('error', err);
          callback(err);
        });
      return;
    }
    return ensureConnected().then(() => { this.emit('connect'); });
  }

  // Promise API
  async end(): Promise<void>;
  // Callback API
  end(callback: (err: Error | null) => void): void;
  end(callback?: (err: Error | null) => void): void | Promise<void> {
    const doEnd = async () => {
      if (this._tx) await this._tx.rollback().catch(() => {});
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
  async query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[]
  ): Promise<PgResult<T>>;
  // Callback API
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    callback: PgCallback<T>
  ): void;
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    values: unknown[],
    callback: PgCallback<T>
  ): void;
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    valuesOrCb?: unknown[] | PgCallback<T>,
    maybeCallback?: PgCallback<T>
  ): void | Promise<PgResult<T>> {
    const sql = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    let params: unknown[];
    let callback: PgCallback<T> | undefined;

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

    const doQuery = async (): Promise<PgResult<T>> => {
      try {
        const result = await execSQL(sql, params as unknown[], this._tx ?? undefined);
        return toPgResult(result, sql) as PgResult<T>;
      } catch (err) {
        logger.error(`pg Client query error: ${(err as Error).message}`, { sql: sql.slice(0, 60) });
        throw err;
      }
    };

    if (callback) {
      doQuery()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doQuery();
  }

  async release(): Promise<void> {
    // pool-managed client release
  }
}

// ---- PoolClient proxy ----

export class PoolClient extends Client {
  private _releaseCallback: (() => void) | null;

  constructor(releaseCallback?: () => void) {
    super({});
    this._releaseCallback = releaseCallback ?? null;
  }

  async release(err?: Error): Promise<void> {
    if (this._releaseCallback) this._releaseCallback();
  }

  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[]
  ): Promise<PgResult<T>>;
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    callback: PgCallback<T>
  ): void;
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    values: unknown[],
    callback: PgCallback<T>
  ): void;
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    valuesOrCb?: unknown[] | PgCallback<T>,
    maybeCallback?: PgCallback<T>
  ): void | Promise<PgResult<T>> {
    if (typeof valuesOrCb === 'function') {
      return super.query<T>(textOrConfig, valuesOrCb);
    }
    if (typeof maybeCallback === 'function') {
      return super.query<T>(textOrConfig, valuesOrCb as unknown[], maybeCallback);
    }
    return super.query<T>(textOrConfig, valuesOrCb as unknown[]);
  }
}

// ---- Pool proxy ----

export class Pool extends EventEmitter {
  public options: Record<string, unknown>;
  private _totalCount = 0;
  private _idleCount = 0;

  constructor(config: string | Record<string, unknown> = {}) {
    super();
    this.options = typeof config === 'string' ? { connectionString: config } : config;
    ensureConnected().catch((err) => {
      logger.warn(`JSDB pg pool connect warning: ${(err as Error).message}`);
    });
  }

  // Promise API
  async connect(): Promise<PoolClient>;
  // Callback API
  connect(callback: (err: Error | null, client?: PoolClient) => void): void;
  connect(callback?: (err: Error | null, client?: PoolClient) => void): void | Promise<PoolClient> {
    const doGet = async (): Promise<PoolClient> => {
      await ensureConnected();
      this._totalCount++;
      return new PoolClient(() => { this._totalCount--; });
    };
    if (callback) {
      doGet()
        .then((client) => callback(null, client))
        .catch((err: Error) => callback(err));
      return;
    }
    return doGet();
  }

  // Promise API
  async query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    values?: unknown[]
  ): Promise<PgResult<T>>;
  // Callback API
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    callback: PgCallback<T>
  ): void;
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    values: unknown[],
    callback: PgCallback<T>
  ): void;
  query<T = Record<string, unknown>>(
    textOrConfig: string | { text: string; values?: unknown[] },
    valuesOrCb?: unknown[] | PgCallback<T>,
    maybeCallback?: PgCallback<T>
  ): void | Promise<PgResult<T>> {
    const sql = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
    let params: unknown[];
    let callback: PgCallback<T> | undefined;

    // Extract values from config object if present
    if (typeof textOrConfig === 'object' && 'values' in textOrConfig) {
      params = textOrConfig.values ?? [];
    } else {
      params = [];
    }

    if (typeof valuesOrCb === 'function') {
      callback = valuesOrCb;
    } else if (typeof maybeCallback === 'function') {
      params = (valuesOrCb as unknown[]) ?? params;
      callback = maybeCallback;
    } else {
      params = (valuesOrCb as unknown[]) ?? params;
      callback = undefined;
    }

    const doQuery = async (): Promise<PgResult<T>> => {
      this._totalCount++;
      try {
        const result = await execSQL(sql, params as unknown[]);
        return toPgResult(result, sql) as PgResult<T>;
      } catch (err) {
        logger.error(`pg Pool query error: ${(err as Error).message}`, { sql: sql.slice(0, 60) });
        throw err;
      } finally {
        this._totalCount--;
      }
    };

    if (callback) {
      doQuery()
        .then((result) => callback!(null, result))
        .catch((err: Error) => callback!(err));
      return;
    }
    return doQuery();
  }

  // Promise API
  async end(): Promise<void>;
  // Callback API
  end(callback: (err: Error | null) => void): void;
  end(callback?: (err: Error | null) => void): void | Promise<void> {
    const doEnd = async () => {
      // NOTE: Do NOT call adapter.disconnect() — the adapter is a shared singleton.
      // Pool.end() should only clean up the pool's own resources.
      this._totalCount = 0;
    };
    if (callback) {
      doEnd()
        .then(() => callback(null))
        .catch((err: Error) => callback(err));
      return;
    }
    return doEnd();
  }

  get totalCount(): number { return this._totalCount; }
  get idleCount(): number { return this._idleCount; }
  get waitingCount(): number { return 0; }
}

// ---- DatabaseError (pg compatible) ----

export class DatabaseError extends Error {
  public code: string | undefined;
  public detail: string | undefined;
  public schema: string | undefined;
  public table: string | undefined;
  public column: string | undefined;
  public constraint: string | undefined;

  constructor(message: string, length = 0, name = 'error') {
    super(message);
    this.name = 'DatabaseError';
  }
}

// ---- types namespace (pg compatible) ----
export const types = {
  setTypeParser: (_oid: number, _parser: unknown) => { /* no-op */ },
  getTypeParser: (_oid: number) => (val: string) => val,
  builtins: {
    BOOL: 16,
    BYTEA: 17,
    INT8: 20,
    INT4: 23,
    TEXT: 25,
    JSON: 114,
    FLOAT8: 701,
    VARCHAR: 1043,
    DATE: 1082,
    TIMESTAMP: 1114,
    TIMESTAMPTZ: 1184,
    JSONB: 3802,
  },
};

// ---- Default export ----
const pgCompat = {
  Client,
  Pool,
  PoolClient,
  DatabaseError,
  types,
};

export default pgCompat;
