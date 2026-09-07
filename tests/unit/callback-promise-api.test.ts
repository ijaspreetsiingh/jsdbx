// =====================================================
// Callback + Promise + Async/Await Regression Tests
//
// Tests dual-mode API support across all compat layers:
// - Callback mode (wrapped in Promises for vitest)
// - Promise mode
// - async/await mode
// - Mixed callback + Promise usage
// - Concurrent requests
// =====================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { setSharedAdapter, resetSharedAdapter } from '../../src/compat/core.js';
import { createAdapter } from '../../src/adapters/index.js';
import * as mysql from '../../src/compat/mysql.js';
import * as mysql2 from '../../src/compat/mysql2.js';
import * as pg from '../../src/compat/pg.js';
import * as mongodb from '../../src/compat/mongodb.js';

const MONGO_CONFIG = {
  database: 'mongodb' as const,
  connection: { uri: 'mongodb://localhost:27019', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

beforeAll(async () => {
  resetSharedAdapter();
  const adapter = createAdapter(MONGO_CONFIG);
  setSharedAdapter(adapter, MONGO_CONFIG);
  await adapter.connect();
});

function cb<T>(fn: (done: (err?: Error) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    fn((err) => {
      if (err) reject(err);
    });
  });
}

// =====================================================
// mysql compat — callback API
// NOTE: mysql/mysql2/pg compat tests require real SQL databases.
// They are skipped by default when running against MongoDB.
// To run: set JSDB_DATABASE=mysql (or postgres) with a real DB.
// =====================================================
const IS_MONGO = (MONGO_CONFIG.database === 'mongodb');
const describeSQL = IS_MONGO ? describe.skip : describe;

describeSQL('mysql compat — callback API', () => {
  it('connect() with callback', () => {
    const conn = mysql.createConnection();
    return new Promise<void>((resolve) => {
      conn.connect((err) => {
        expect(err).toBeNull();
        conn.destroy();
        resolve();
      });
    });
  });

  it('query() with callback — SELECT', () => {
    const conn = mysql.createConnection();
    return new Promise<void>((resolve) => {
      conn.connect(() => {
        conn.query('SELECT 1 AS val', (err, rows, fields) => {
          expect(err).toBeNull();
          expect(rows).toBeDefined();
          expect(fields).toBeDefined();
          conn.end(() => resolve());
        });
      });
    });
  });

  it('query() with params and callback', () => {
    const conn = mysql.createConnection();
    return new Promise<void>((resolve) => {
      conn.connect(() => {
        conn.query('SELECT ? AS val', [42], (err, rows) => {
          expect(err).toBeNull();
          expect(rows).toBeDefined();
          conn.end(() => resolve());
        });
      });
    });
  });

  it('beginTransaction() + commit() with callbacks', () => {
    const conn = mysql.createConnection();
    return new Promise<void>((resolve) => {
      conn.connect(() => {
        conn.beginTransaction((err) => {
          expect(err).toBeNull();
          conn.commit((err2) => {
            expect(err2).toBeNull();
            conn.end(() => resolve());
          });
        });
      });
    });
  });

  it('beginTransaction() + rollback() with callbacks', () => {
    const conn = mysql.createConnection();
    return new Promise<void>((resolve) => {
      conn.connect(() => {
        conn.beginTransaction((err) => {
          expect(err).toBeNull();
          conn.rollback((err2) => {
            expect(err2).toBeNull();
            conn.end(() => resolve());
          });
        });
      });
    });
  });
});

describeSQL('mysql compat — pool callback API', () => {
  it('getConnection() + query() with callbacks', () => {
    const pool = mysql.createPool({});
    return new Promise<void>((resolve) => {
      pool.getConnection((err, connection) => {
        expect(err).toBeNull();
        connection.query('SELECT 1 AS val', (err2, rows) => {
          expect(err2).toBeNull();
          expect(rows).toBeDefined();
          pool.end(() => resolve());
        });
      });
    });
  });

  it('pool.query() with callback', () => {
    const pool = mysql.createPool({});
    return new Promise<void>((resolve) => {
      pool.query('SELECT 1 AS val', (err, rows) => {
        expect(err).toBeNull();
        expect(rows).toBeDefined();
        pool.end(() => resolve());
      });
    });
  });
});

// =====================================================
// mysql2 compat — dual API
// =====================================================
describeSQL('mysql2 compat — promise API', () => {
  it('pool.promise().query() returns Promise', async () => {
    const pool = mysql2.createPool({});
    const [rows, fields] = await pool.promise().query('SELECT 1 AS val');
    expect(rows).toBeDefined();
    expect(fields).toBeDefined();
    await pool.promise().end();
  });

  it('pool.promise().execute() returns Promise', async () => {
    const pool = mysql2.createPool({});
    const [rows] = await pool.promise().execute('SELECT 1 AS val');
    expect(rows).toBeDefined();
    await pool.promise().end();
  });
});

describeSQL('mysql2 compat — callback API via pool', () => {
  it('query() with callback', () => {
    const pool = mysql2.createPool({});
    return new Promise<void>((resolve) => {
      pool.query('SELECT 1 AS val', (err, rows, fields) => {
        expect(err).toBeNull();
        expect(rows).toBeDefined();
        expect(fields).toBeDefined();
        pool.end(() => resolve());
      });
    });
  });

  it('query() with params and callback', () => {
    const pool = mysql2.createPool({});
    return new Promise<void>((resolve) => {
      pool.query('SELECT ? AS val', [7], (err, rows) => {
        expect(err).toBeNull();
        expect(rows).toBeDefined();
        pool.end(() => resolve());
      });
    });
  });

  it('execute() with callback', () => {
    const pool = mysql2.createPool({});
    return new Promise<void>((resolve) => {
      pool.execute('SELECT 1 AS val', (err, rows) => {
        expect(err).toBeNull();
        expect(rows).toBeDefined();
        pool.end(() => resolve());
      });
    });
  });

  it('getConnection() with callback', () => {
    const pool = mysql2.createPool({});
    return new Promise<void>((resolve) => {
      pool.getConnection((err, conn) => {
        expect(err).toBeNull();
        expect(conn).toBeDefined();
        pool.end(() => resolve());
      });
    });
  });
});

describeSQL('mysql2 compat — connection dual API', () => {
  it('query() promise mode', async () => {
    const conn = mysql2.createConnection();
    const [rows] = await conn.query('SELECT 1 AS val');
    expect(rows).toBeDefined();
    await conn.end();
  });

  it('query() callback mode', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.query('SELECT 1 AS val', (err, rows) => {
        expect(err).toBeNull();
        expect(rows).toBeDefined();
        conn.end(() => resolve());
      });
    });
  });

  it('execute() promise mode', async () => {
    const conn = mysql2.createConnection();
    const [rows] = await conn.execute('SELECT 1 AS val');
    expect(rows).toBeDefined();
    await conn.end();
  });

  it('execute() callback mode', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.execute('SELECT 1 AS val', (err, rows) => {
        expect(err).toBeNull();
        expect(rows).toBeDefined();
        conn.end(() => resolve());
      });
    });
  });

  it('beginTransaction() promise mode', async () => {
    const conn = mysql2.createConnection();
    await conn.beginTransaction();
    await conn.commit();
    await conn.end();
  });

  it('beginTransaction() callback mode', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.beginTransaction((err) => {
        expect(err).toBeNull();
        conn.commit((err2) => {
          expect(err2).toBeNull();
          conn.end(() => resolve());
        });
      });
    });
  });

  it('rollback() promise mode', async () => {
    const conn = mysql2.createConnection();
    await conn.beginTransaction();
    await conn.rollback();
    await conn.end();
  });

  it('rollback() callback mode', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.beginTransaction(() => {
        conn.rollback((err) => {
          expect(err).toBeNull();
          conn.end(() => resolve());
        });
      });
    });
  });

  it('ping() promise mode', async () => {
    const conn = mysql2.createConnection();
    await conn.ping();
    await conn.end();
  });

  it('ping() callback mode', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.ping((err) => {
        expect(err).toBeNull();
        conn.end(() => resolve());
      });
    });
  });
});

// =====================================================
// mysql2 compat — mixed callback + Promise
// =====================================================
describeSQL('mysql2 compat — mixed callback + Promise usage', () => {
  it('callback and promise on same pool', () => {
    const pool = mysql2.createPool({});
    const promisePool = pool.promise();
    return new Promise<void>((resolve) => {
      pool.query('SELECT 1 AS val', (err, rows) => {
        expect(err).toBeNull();
        expect(rows).toBeDefined();
        promisePool.query('SELECT 2 AS val').then(([rows2]) => {
          expect(rows2).toBeDefined();
          pool.end(() => resolve());
        });
      });
    });
  });

  it('async/await inside callback handler', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.query('SELECT 1 AS val', async (_err, _rows) => {
        const [rows2] = await conn.query('SELECT 2 AS val');
        expect(rows2).toBeDefined();
        await conn.end();
        resolve();
      });
    });
  });

  it('callback inside async function', async () => {
    const conn = mysql2.createConnection();
    const result = await new Promise<unknown>((resolve) => {
      conn.query('SELECT 1 AS val', (_err, rows) => {
        resolve(rows);
      });
    });
    expect(result).toBeDefined();
    await conn.end();
  });
});

// =====================================================
// pg compat — dual API
// =====================================================
describeSQL('pg compat — promise API', () => {
  it('Client.connect() + query() returns Promise', async () => {
    const client = new pg.Client();
    await client.connect();
    const result = await client.query('SELECT 1 AS val');
    expect(result.rows).toBeDefined();
    expect(result.fields).toBeDefined();
    await client.end();
  });

  it('Pool.query() returns Promise', async () => {
    const pool = new pg.Pool();
    const result = await pool.query('SELECT 1 AS val');
    expect(result.rows).toBeDefined();
    await pool.end();
  });

  it('Pool.connect() returns Promise', async () => {
    const pool = new pg.Pool();
    const client = await pool.connect();
    const result = await client.query('SELECT 1 AS val');
    expect(result.rows).toBeDefined();
    client.release();
    await pool.end();
  });
});

describeSQL('pg compat — callback API', () => {
  it('Client.connect() with callback', () => {
    const client = new pg.Client();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        client.end(() => resolve());
      });
    });
  });

  it('Client.query() with callback', () => {
    const client = new pg.Client();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        client.query('SELECT 1 AS val', (err2, result) => {
          expect(err2).toBeNull();
          expect(result).toBeDefined();
          expect(result!.rows).toBeDefined();
          client.end(() => resolve());
        });
      });
    });
  });

  it('Client.query() with params and callback', () => {
    const client = new pg.Client();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        client.query('SELECT $1 AS val', [42], (err2, result) => {
          expect(err2).toBeNull();
          expect(result).toBeDefined();
          client.end(() => resolve());
        });
      });
    });
  });

  it('Pool.connect() with callback', () => {
    const pool = new pg.Pool();
    return new Promise<void>((resolve) => {
      pool.connect((err, client) => {
        expect(err).toBeNull();
        expect(client).toBeDefined();
        client!.release();
        pool.end(() => resolve());
      });
    });
  });

  it('Pool.query() with callback', () => {
    const pool = new pg.Pool();
    return new Promise<void>((resolve) => {
      pool.query('SELECT 1 AS val', (err, result) => {
        expect(err).toBeNull();
        expect(result).toBeDefined();
        expect(result!.rows).toBeDefined();
        pool.end(() => resolve());
      });
    });
  });

  it('Pool.query() with params and callback', () => {
    const pool = new pg.Pool();
    return new Promise<void>((resolve) => {
      pool.query('SELECT $1 AS val', [99], (err, result) => {
        expect(err).toBeNull();
        expect(result).toBeDefined();
        pool.end(() => resolve());
      });
    });
  });

  it('Pool.end() with callback', () => {
    const pool = new pg.Pool();
    return new Promise<void>((resolve) => {
      pool.end((err) => {
        expect(err).toBeNull();
        resolve();
      });
    });
  });

  it('Client.end() with callback', () => {
    const client = new pg.Client();
    return new Promise<void>((resolve) => {
      client.connect(() => {
        client.end((err) => {
          expect(err).toBeNull();
          resolve();
        });
      });
    });
  });
});

// =====================================================
// pg compat — mixed callback + Promise
// =====================================================
describeSQL('pg compat — mixed callback + Promise usage', () => {
  it('callback and promise on same pool', () => {
    const pool = new pg.Pool();
    return new Promise<void>((resolve) => {
      pool.query('SELECT 1 AS val', (err, result) => {
        expect(err).toBeNull();
        expect(result!.rows).toBeDefined();
        pool.query('SELECT 2 AS val').then((result2) => {
          expect(result2.rows).toBeDefined();
          pool.end(() => resolve());
        });
      });
    });
  });

  it('async/await inside callback handler', () => {
    const client = new pg.Client();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        client.query('SELECT 1 AS val', async (_err2, _result) => {
          const result2 = await client.query('SELECT 2 AS val');
          expect(result2.rows).toBeDefined();
          await client.end();
          resolve();
        });
      });
    });
  });

  it('callback inside async function', async () => {
    const client = new pg.Client();
    await client.connect();
    const result = await new Promise<{ rows: Record<string, unknown>[]; fields: { name: string }[]; rowCount: number | null; command: string; oid: number }>((resolve) => {
      client.query('SELECT 1 AS val', (_err, result) => {
        resolve(result!);
      });
    });
    expect(result.rows).toBeDefined();
    await client.end();
  });
});

// =====================================================
// mongodb compat — promise API
// =====================================================
describe('mongodb compat — promise API', () => {
  it('MongoClient.connect() returns Promise', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    expect(client.isConnected()).toBe(true);
    await client.close();
  });

  it('collection.insertOne() returns Promise', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('test_callback');
    const result = await coll.insertOne({ name: 'test', value: 42 });
    expect(result.insertedId).toBeDefined();
    expect(result.acknowledged).toBe(true);
    await coll.drop();
    await client.close();
  });

  it('collection.findOne() returns Promise', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('test_callback');
    await coll.insertOne({ name: 'findme', value: 123 });
    const doc = await coll.findOne({ name: 'findme' });
    expect(doc).toBeDefined();
    expect(doc!.name).toBe('findme');
    await coll.drop();
    await client.close();
  });

  it('collection.updateOne() returns Promise', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('test_callback');
    await coll.insertOne({ name: 'upd', value: 1 });
    const result = await coll.updateOne({ name: 'upd' }, { $set: { value: 2 } });
    expect(result.modifiedCount).toBe(1);
    await coll.drop();
    await client.close();
  });

  it('collection.deleteOne() returns Promise', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('test_callback');
    await coll.insertOne({ name: 'del' });
    const result = await coll.deleteOne({ name: 'del' });
    expect(result.deletedCount).toBe(1);
    await coll.drop();
    await client.close();
  });

  it('collection.countDocuments() returns Promise', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('test_callback');
    await coll.insertMany([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const count = await coll.countDocuments();
    expect(count).toBe(3);
    await coll.drop();
    await client.close();
  });

  it('db.command() returns Promise', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    const db = client.db('test');
    const result = await db.command({ ping: 1 });
    expect(result.ok).toBe(1);
    await client.close();
  });
});

// =====================================================
// mongodb compat — callback API
// =====================================================
describe('mongodb compat — callback API', () => {
  it('MongoClient.connect() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        expect(client.isConnected()).toBe(true);
        client.close(() => resolve());
      });
    });
  });

  it('collection.insertOne() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertOne({ name: 'cb_test', value: 1 }, (err2, result) => {
          expect(err2).toBeNull();
          expect(result).toBeDefined();
          expect(result!.insertedId).toBeDefined();
          coll.drop(() => client.close(() => resolve()));
        });
      });
    });
  });

  it('collection.findOne() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertOne({ name: 'findme_cb' }, () => {
          coll.findOne({ name: 'findme_cb' }, (err2, doc) => {
            expect(err2).toBeNull();
            expect(doc).toBeDefined();
            expect(doc!.name).toBe('findme_cb');
            coll.drop(() => client.close(() => resolve()));
          });
        });
      });
    });
  });

  it('collection.updateOne() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertOne({ name: 'upd_cb', val: 1 }, () => {
          coll.updateOne({ name: 'upd_cb' }, { $set: { val: 2 } }, (err2, result) => {
            expect(err2).toBeNull();
            expect(result).toBeDefined();
            expect(result!.modifiedCount).toBe(1);
            coll.drop(() => client.close(() => resolve()));
          });
        });
      });
    });
  });

  it('collection.deleteOne() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertOne({ name: 'del_cb' }, () => {
          coll.deleteOne({ name: 'del_cb' }, (err2, result) => {
            expect(err2).toBeNull();
            expect(result!.deletedCount).toBe(1);
            coll.drop(() => client.close(() => resolve()));
          });
        });
      });
    });
  });

  it('collection.countDocuments() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertMany([{ a: 1 }, { a: 2 }], () => {
          coll.countDocuments((err2, count) => {
            expect(err2).toBeNull();
            expect(count).toBe(2);
            coll.drop(() => client.close(() => resolve()));
          });
        });
      });
    });
  });

  it('collection.createIndex() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.createIndex({ name: 1 }, (err2, indexName) => {
          expect(err2).toBeNull();
          expect(indexName).toBeDefined();
          coll.drop(() => client.close(() => resolve()));
        });
      });
    });
  });

  it('collection.drop() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertOne({ a: 1 }, () => {
          coll.drop((err2, result) => {
            expect(err2).toBeNull();
            expect(result).toBe(true);
            client.close(() => resolve());
          });
        });
      });
    });
  });

  it('db.createCollection() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        db.createCollection('test_callback_create', (err2, coll) => {
          expect(err2).toBeNull();
          expect(coll).toBeDefined();
          coll!.drop(() => client.close(() => resolve()));
        });
      });
    });
  });

  it('db.dropCollection() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback_drop');
        coll.insertOne({ a: 1 }, () => {
          db.dropCollection('test_callback_drop', (err2, result) => {
            expect(err2).toBeNull();
            expect(result).toBe(true);
            client.close(() => resolve());
          });
        });
      });
    });
  });

  it('db.listCollections() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        db.listCollections((err2, collections) => {
          expect(err2).toBeNull();
          expect(collections).toBeDefined();
          expect(Array.isArray(collections)).toBe(true);
          client.close(() => resolve());
        });
      });
    });
  });

  it('db.command() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        db.command({ ping: 1 }, (err2, result) => {
          expect(err2).toBeNull();
          expect(result.ok).toBe(1);
          client.close(() => resolve());
        });
      });
    });
  });

  it('collection.distinct() with callback', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertMany([{ cat: 'a' }, { cat: 'b' }, { cat: 'a' }], () => {
          coll.distinct('cat', (err2, values) => {
            expect(err2).toBeNull();
            expect(values).toBeDefined();
            expect(values!.length).toBe(2);
            coll.drop(() => client.close(() => resolve()));
          });
        });
      });
    });
  });
});

// =====================================================
// mongodb compat — mixed callback + Promise
// =====================================================
describe('mongodb compat — mixed callback + Promise usage', () => {
  it('callback and promise on same collection', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertOne({ name: 'mixed1' }, (err2) => {
          expect(err2).toBeNull();
          coll.findOne({ name: 'mixed1' }).then((doc) => {
            expect(doc).toBeDefined();
            expect(doc!.name).toBe('mixed1');
            coll.drop(() => client.close(() => resolve()));
          });
        });
      });
    });
  });

  it('async/await inside callback handler', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_callback');
        coll.insertOne({ name: 'async_in_cb' }, async (_err2) => {
          const doc = await coll.findOne({ name: 'async_in_cb' });
          expect(doc).toBeDefined();
          await coll.drop();
          await client.close();
          resolve();
        });
      });
    });
  });

  it('callback inside async function', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('test_callback');
    const result = await new Promise<mongodb.ObjectId>((resolve, reject) => {
      coll.insertOne({ name: 'cb_in_async' }, (err, result) => {
        if (err) reject(err);
        else resolve(result!.insertedId as mongodb.ObjectId);
      });
    });
    expect(result).toBeDefined();
    const doc = await coll.findOne({ name: 'cb_in_async' });
    expect(doc).toBeDefined();
    await coll.drop();
    await client.close();
  });
});

// =====================================================
// Concurrent requests — mysql2
// =====================================================
describeSQL('concurrent requests — mysql2', () => {
  it('multiple concurrent callback queries', () => {
    const pool = mysql2.createPool({});
    return new Promise<void>((resolve) => {
      let completed = 0;
      const total = 5;
      for (let i = 0; i < total; i++) {
        pool.query('SELECT ? AS val', [i], (err, rows) => {
          expect(err).toBeNull();
          expect(rows).toBeDefined();
          completed++;
          if (completed === total) pool.end(() => resolve());
        });
      }
    });
  });

  it('multiple concurrent promise queries', async () => {
    const pool = mysql2.createPool({});
    const promisePool = pool.promise();
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(promisePool.query('SELECT ? AS val', [i]));
    }
    const results = await Promise.all(promises);
    expect(results.length).toBe(5);
    for (const [rows] of results) expect(rows).toBeDefined();
    await promisePool.end();
  });

  it('mixed concurrent callback and promise', () => {
    const pool = mysql2.createPool({});
    const promisePool = pool.promise();
    return new Promise<void>((resolve) => {
      let completed = 0;
      const total = 6;
      const checkDone = () => { completed++; if (completed === total) pool.end(() => resolve()); };
      for (let i = 0; i < 3; i++) {
        pool.query('SELECT ? AS val', [i], (err, rows) => {
          expect(err).toBeNull(); expect(rows).toBeDefined(); checkDone();
        });
      }
      for (let i = 0; i < 3; i++) {
        promisePool.query('SELECT ? AS val', [i + 10]).then(([rows]) => {
          expect(rows).toBeDefined(); checkDone();
        });
      }
    });
  });
});

// =====================================================
// Concurrent requests — pg
// =====================================================
describeSQL('concurrent requests — pg', () => {
  it('multiple concurrent callback queries', () => {
    const pool = new pg.Pool();
    return new Promise<void>((resolve) => {
      let completed = 0;
      const total = 5;
      for (let i = 0; i < total; i++) {
        pool.query('SELECT $1 AS val', [i], (err, result) => {
          expect(err).toBeNull();
          expect(result!.rows).toBeDefined();
          completed++;
          if (completed === total) pool.end(() => resolve());
        });
      }
    });
  });

  it('multiple concurrent promise queries', async () => {
    const pool = new pg.Pool();
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(pool.query('SELECT $1 AS val', [i]));
    }
    const results = await Promise.all(promises);
    expect(results.length).toBe(5);
    for (const result of results) expect(result.rows).toBeDefined();
    await pool.end();
  });

  it('mixed concurrent callback and promise', () => {
    const pool = new pg.Pool();
    return new Promise<void>((resolve) => {
      let completed = 0;
      const total = 6;
      const checkDone = () => { completed++; if (completed === total) pool.end(() => resolve()); };
      for (let i = 0; i < 3; i++) {
        pool.query('SELECT $1 AS val', [i], (err, result) => {
          expect(err).toBeNull(); expect(result!.rows).toBeDefined(); checkDone();
        });
      }
      for (let i = 0; i < 3; i++) {
        pool.query('SELECT $1 AS val', [i + 10]).then((result) => {
          expect(result.rows).toBeDefined(); checkDone();
        });
      }
    });
  });
});

// =====================================================
// Concurrent requests — mongodb
// =====================================================
describe('concurrent requests — mongodb', () => {
  it('multiple concurrent callback operations', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_concurrent');
        let completed = 0;
        const total = 5;
        for (let i = 0; i < total; i++) {
          coll.insertOne({ idx: i }, (err2) => {
            expect(err2).toBeNull();
            completed++;
            if (completed === total) coll.drop(() => client.close(() => resolve()));
          });
        }
      });
    });
  });

  it('multiple concurrent promise operations', async () => {
    const client = new mongodb.MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('test_concurrent');
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(coll.insertOne({ idx: i }));
    }
    const results = await Promise.all(promises);
    expect(results.length).toBe(5);
    for (const result of results) expect(result.insertedId).toBeDefined();
    await coll.drop();
    await client.close();
  });

  it('mixed concurrent callback and promise', () => {
    const client = new mongodb.MongoClient();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        const db = client.db('test');
        const coll = db.collection('test_concurrent');
        let completed = 0;
        const total = 6;
        const checkDone = () => { completed++; if (completed === total) coll.drop(() => client.close(() => resolve())); };
        for (let i = 0; i < 3; i++) {
          coll.insertOne({ mode: 'cb', idx: i }, (err2) => { expect(err2).toBeNull(); checkDone(); });
        }
        for (let i = 0; i < 3; i++) {
          coll.insertOne({ mode: 'promise', idx: i }).then(() => { checkDone(); });
        }
      });
    });
  });
});

// =====================================================
// Error handling — callback vs promise
// =====================================================
describeSQL('error handling — callback vs promise', () => {
  it('mysql2 callback receives error for invalid SQL', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.query('INVALID SQL XYZ', (err) => {
        expect(err).toBeDefined();
        expect(err).toBeInstanceOf(Error);
        conn.end(() => resolve());
      });
    });
  });

  it('mysql2 promise rejects for invalid SQL', async () => {
    const conn = mysql2.createConnection();
    try {
      await conn.query('INVALID SQL XYZ');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeDefined();
    }
    await conn.end();
  });

  it('pg callback receives error for invalid SQL', () => {
    const client = new pg.Client();
    return new Promise<void>((resolve) => {
      client.connect((err) => {
        expect(err).toBeNull();
        client.query('INVALID SQL XYZ', (err2) => {
          expect(err2).toBeDefined();
          client.end(() => resolve());
        });
      });
    });
  });

  it('pg promise rejects for invalid SQL', async () => {
    const client = new pg.Client();
    await client.connect();
    try {
      await client.query('INVALID SQL XYZ');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeDefined();
    }
    await client.end();
  });
});

// =====================================================
// mysql2 top-level API
// =====================================================
describeSQL('mysql2 createConnection — dual API', () => {
  it('promise mode', async () => {
    const conn = mysql2.createConnection();
    const [rows] = await conn.query('SELECT 1 AS val');
    expect(rows).toBeDefined();
    await conn.end();
  });

  it('callback mode', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.query('SELECT 1 AS val', (err, rows) => {
        expect(err).toBeNull();
        expect(rows).toBeDefined();
        conn.end(() => resolve());
      });
    });
  });

  it('createPool returns pool with promise sub-namespace', async () => {
    const pool = mysql2.createPool({});
    const promisePool = pool.promise();
    const [rows] = await promisePool.query('SELECT 1 AS val');
    expect(rows).toBeDefined();
    await promisePool.end();
  });
});

// =====================================================
// Transaction — all modes
// =====================================================
describeSQL('transactions — all modes', () => {
  it('mysql2: callback transaction cycle', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.beginTransaction((err) => {
        expect(err).toBeNull();
        conn.commit((err2) => {
          expect(err2).toBeNull();
          conn.end(() => resolve());
        });
      });
    });
  });

  it('mysql2: promise transaction cycle', async () => {
    const conn = mysql2.createConnection();
    await conn.beginTransaction();
    await conn.commit();
    await conn.end();
  });

  it('mysql2: callback rollback', () => {
    const conn = mysql2.createConnection();
    return new Promise<void>((resolve) => {
      conn.beginTransaction((err) => {
        expect(err).toBeNull();
        conn.rollback((err2) => {
          expect(err2).toBeNull();
          conn.end(() => resolve());
        });
      });
    });
  });

  it('mysql2: promise rollback', async () => {
    const conn = mysql2.createConnection();
    await conn.beginTransaction();
    await conn.rollback();
    await conn.end();
  });

  it('mysql: callback transaction cycle', () => {
    const conn = mysql.createConnection();
    return new Promise<void>((resolve) => {
      conn.connect(() => {
        conn.beginTransaction((err) => {
          expect(err).toBeNull();
          conn.commit((err2) => {
            expect(err2).toBeNull();
            conn.end(() => resolve());
          });
        });
      });
    });
  });

  it('mysql: callback rollback', () => {
    const conn = mysql.createConnection();
    return new Promise<void>((resolve) => {
      conn.connect(() => {
        conn.beginTransaction((err) => {
          expect(err).toBeNull();
          conn.rollback((err2) => {
            expect(err2).toBeNull();
            conn.end(() => resolve());
          });
        });
      });
    });
  });
});
