// =====================================================
// JSDB mysql (legacy) compatible Proxy
//
// DROP-IN REPLACEMENT for the `mysql` package (callback API).
// Existing code:
//   const mysql = require('mysql');
//   const conn = mysql.createConnection({ host, user, password, database });
//   conn.connect();
//   conn.query('SELECT * FROM users', (err, rows) => { ... });
//
// Change only the require:
//   const mysql = require('jsdb/mysql');
// ─── or use jsdb/register for ZERO require changes ───
// =====================================================

import EventEmitter from 'events';
import { execSQL, ensureConnected } from './core.js';
import type { AdapterTransaction } from '../adapters/base.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('info', 'JSDB:mysql-proxy');

type MysqlCallback = (err: Error | null, results?: unknown, fields?: unknown[]) => void;

class JSDBMysqlConnection extends EventEmitter {
  private _tx: AdapterTransaction | null = null;
  public threadId: number = Math.floor(Math.random() * 100000);
  private _connected = false;

  connect(callback?: (err: Error | null) => void): void {
    ensureConnected()
      .then(() => {
        this._connected = true;
        this.emit('connect');
        callback?.(null);
      })
      .catch((err: Error) => {
        this.emit('error', err);
        callback?.(err);
      });
  }

  query(sql: string, callback: MysqlCallback): void;
  query(sql: string, values: unknown[], callback: MysqlCallback): void;
  query(sql: string, valuesOrCb: unknown, cb?: unknown): void {
    const [values, callback] = typeof valuesOrCb === 'function'
      ? [[], valuesOrCb as MysqlCallback]
      : [valuesOrCb as unknown[], cb as MysqlCallback];

    execSQL(sql, values)
      .then((result) => {
        const isWrite = /^\s*(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE)/i.test(sql);
        if (isWrite) {
          callback(null, {
            fieldCount: 0,
            affectedRows: result.affectedRows ?? result.rowCount,
            changedRows: result.changedRows ?? 0,
            insertId: result.insertId ?? 0,
            serverStatus: 2,
            warningCount: 0,
            message: '',
          }, []);
        } else {
          callback(null, result.rows, result.fields);
        }
      })
      .catch((err: Error) => {
        logger.error(`mysql query error: ${err.message}`, { sql: sql.slice(0, 60) });
        callback(err);
      });
  }

  beginTransaction(callback?: MysqlCallback): void {
    ensureConnected()
      .then((adapter) => adapter.beginTransaction())
      .then((tx) => {
        this._tx = tx;
        callback?.(null);
      })
      .catch((err: Error) => callback?.(err));
  }

  commit(callback?: MysqlCallback): void {
    if (!this._tx) { callback?.(null); return; }
    this._tx.commit()
      .then(() => { this._tx = null; callback?.(null); })
      .catch((err: Error) => callback?.(err));
  }

  rollback(callback?: MysqlCallback): void {
    if (!this._tx) { callback?.(null); return; }
    this._tx.rollback()
      .then(() => { this._tx = null; callback?.(null); })
      .catch((err: Error) => callback?.(err));
  }

  end(callback?: (err: Error | null) => void): void {
    this.rollback(() => {
      this._connected = false;
      this.emit('end');
      callback?.(null);
    });
  }

  destroy(): void {
    this._tx = null;
    this._connected = false;
  }

  escape(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'boolean') return value ? '1' : '0';
    if (typeof value === 'number') return String(value);
    if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
    // Escape backslashes first, then single quotes
    return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  }

  escapeId(id: string): string {
    return '`' + id.replace(/`/g, '``') + '`';
  }

  format(sql: string, values: unknown[] = []): string {
    let i = 0;
    return sql.replace(/\?/g, () => this.escape(values[i++]));
  }
}

class JSDBMysqlPool extends EventEmitter {
  private config: Record<string, unknown>;

  constructor(config: Record<string, unknown>) {
    super();
    this.config = config;
  }

  getConnection(callback: (err: Error | null, conn: JSDBMysqlConnection) => void): void {
    const conn = new JSDBMysqlConnection();
    conn.connect((err) => callback(err, conn));
  }

  query(sql: string, callback: MysqlCallback): void;
  query(sql: string, values: unknown[], callback: MysqlCallback): void;
  query(sql: string, valuesOrCb: unknown, cb?: unknown): void {
    const [values, callback] = typeof valuesOrCb === 'function'
      ? [[], valuesOrCb as MysqlCallback]
      : [valuesOrCb as unknown[], cb as MysqlCallback];
    const conn = new JSDBMysqlConnection();
    conn.query(sql, values as unknown[], callback);
  }

  end(callback?: () => void): void {
    ensureConnected().then((adapter) => adapter.disconnect()).then(callback).catch(() => callback?.());
  }
}

// ---- Public API ----

export function createConnection(config: Record<string, unknown> = {}): JSDBMysqlConnection {
  return new JSDBMysqlConnection();
}

export function createPool(config: Record<string, unknown> = {}): JSDBMysqlPool {
  return new JSDBMysqlPool(config);
}

export function escape(value: unknown): string {
  return new JSDBMysqlConnection().escape(value);
}

export function escapeId(id: string): string {
  return new JSDBMysqlConnection().escapeId(id);
}

export function format(sql: string, values: unknown[] = []): string {
  return new JSDBMysqlConnection().format(sql, values);
}

const mysqlCompat = { createConnection, createPool, escape, escapeId, format };
export default mysqlCompat;
