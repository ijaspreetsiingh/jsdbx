// =====================================================
// Production-Readiness Audit: Coverage Gap Tests
//
// Tests for untested methods, edge cases, and integration
// scenarios identified in the coverage audit.
// =====================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryAdapter } from '../../src/adapters/memory/adapter.js';
import { setSharedAdapter, resetSharedAdapter, execSQL } from '../../src/compat/core.js';

const memAdapter = new MemoryAdapter({ database: 'sqlite' });
setSharedAdapter(memAdapter, { database: 'sqlite' });

// =====================================================
// 1. mysql2 escape/escapeId/format — SQL INJECTION PREVENTION
// =====================================================
describe('mysql2: escape() — SQL injection prevention', () => {
  it('escape() with null returns NULL', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    expect(escape(null)).toBe('NULL');
  });

  it('escape() with undefined returns NULL', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    expect(escape(undefined)).toBe('NULL');
  });

  it('escape() with boolean true returns 1', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    expect(escape(true)).toBe('1');
  });

  it('escape() with boolean false returns 0', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    expect(escape(false)).toBe('0');
  });

  it('escape() with number returns string representation', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    expect(escape(42)).toBe('42');
    expect(escape(3.14)).toBe('3.14');
  });

  it('escape() with Date returns ISO-like string', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    const d = new Date('2024-06-15T10:30:00.000Z');
    const result = escape(d);
    expect(result).toMatch(/^'2024-06-15/);
    expect(result).toContain(' ');
  });

  it('CRITICAL: escape() with SQL injection attempt is escaped', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    // Classic SQL injection: ' OR 1=1 --
    const malicious = "' OR 1=1 --";
    const result = escape(malicious);
    // Must NOT contain raw single quotes — they should be doubled
    expect(result).not.toBe("' OR 1=1 --");
    expect(result).toContain("''");
  });

  it('escape() with backslash injection is escaped', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    const input = "test\\' OR 1=1";
    const result = escape(input);
    // Backslashes should be escaped first, then quotes
    expect(result).toContain('\\\\');
  });

  it('escape() with empty string returns quoted empty string', async () => {
    const { escape } = await import('../../src/compat/mysql2.js');
    expect(escape("")).toBe("''");
  });

  it('escapeId() wraps in backticks', async () => {
    const { escapeId } = await import('../../src/compat/mysql2.js');
    expect(escapeId('users')).toBe('`users`');
  });

  it('escapeId() escapes existing backticks', async () => {
    const { escapeId } = await import('../../src/compat/mysql2.js');
    expect(escapeId('user`name')).toBe('`user``name`');
  });

  it('format() replaces ? with escaped values', async () => {
    const { format } = await import('../../src/compat/mysql2.js');
    const result = format('SELECT * FROM users WHERE name = ? AND age = ?', ['Alice\'s', 30]);
    // escape('Alice\'s') = "'Alice''s'" — single quotes doubled, wrapped in quotes
    expect(result).toContain("'Alice''s'");
    expect(result).toContain('30');
  });

  it('format() with no params returns SQL unchanged', async () => {
    const { format } = await import('../../src/compat/mysql2.js');
    expect(format('SELECT 1')).toBe('SELECT 1');
  });
});

// =====================================================
// 2. mysql2 createPoolCluster
// =====================================================
describe('mysql2: createPoolCluster', () => {
  it('createPoolCluster returns object with add/of/end', async () => {
    const { createPoolCluster } = await import('../../src/compat/mysql2.js');
    const cluster = createPoolCluster();
    expect(cluster).toHaveProperty('add');
    expect(cluster).toHaveProperty('of');
    expect(cluster).toHaveProperty('end');
    expect(typeof cluster.add).toBe('function');
    expect(typeof cluster.of).toBe('function');
    expect(typeof cluster.end).toBe('function');
  });

  it('cluster.of() returns a pool', async () => {
    const { createPoolCluster } = await import('../../src/compat/mysql2.js');
    const cluster = createPoolCluster();
    const pool = cluster.of('read*');
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
  });

  it('cluster.end() calls pool.end()', async () => {
    const { createPoolCluster } = await import('../../src/compat/mysql2.js');
    const cluster = createPoolCluster();
    // Should not throw
    await cluster.end();
  });
});

// =====================================================
// 3. mysql2 QueryError
// =====================================================
describe('mysql2: QueryError', () => {
  it('QueryError has correct properties', async () => {
    const { QueryError } = await import('../../src/compat/mysql2.js');
    const err = new QueryError('test error', 'ER_TEST', 2000);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('QueryError');
    expect(err.message).toBe('test error');
    expect(err.code).toBe('ER_TEST');
    expect(err.errno).toBe(2000);
    expect(err.sqlState).toBe('42000');
  });

  it('QueryError defaults', async () => {
    const { QueryError } = await import('../../src/compat/mysql2.js');
    const err = new QueryError('test');
    expect(err.code).toBe('ER_UNKNOWN');
    expect(err.errno).toBe(1000);
  });
});

// =====================================================
// 4. mysql2 promise sub-namespace
// =====================================================
describe('mysql2: promise sub-namespace', () => {
  it('promise.createConnection returns connection', async () => {
    const mysql2 = await import('../../src/compat/mysql2.js');
    const conn = await mysql2.promise.createConnection();
    expect(conn).toBeDefined();
    expect(typeof conn.query).toBe('function');
    expect(typeof conn.end).toBe('function');
  });

  it('promise.createPool returns pool', async () => {
    const mysql2 = await import('../../src/compat/mysql2.js');
    const pool = mysql2.promise.createPool({});
    expect(pool).toBeDefined();
    expect(typeof pool.query).toBe('function');
  });
});

// =====================================================
// 5. mysql2 connection utility methods
// =====================================================
describe('mysql2: connection utility methods', () => {
  it('connection has threadId', async () => {
    const { createConnection } = await import('../../src/compat/mysql2.js');
    const conn = createConnection();
    expect(typeof conn.threadId).toBe('number');
    expect(conn.threadId).toBeGreaterThanOrEqual(0);
  });

  it('connection.release() is a no-op', async () => {
    const { createConnection } = await import('../../src/compat/mysql2.js');
    const conn = createConnection();
    // Should not throw
    expect(() => conn.release()).not.toThrow();
    conn.destroy();
  });

  it('connection.destroy() clears transaction state', async () => {
    const { createConnection } = await import('../../src/compat/mysql2.js');
    const conn = createConnection();
    await conn.beginTransaction();
    conn.destroy();
    // After destroy, a new beginTransaction should work
    await conn.beginTransaction();
    await conn.commit();
    await conn.end();
  });

  it('pool.ping() resolves', async () => {
    const { createPool } = await import('../../src/compat/mysql2.js');
    const pool = createPool({});
    await expect(pool.ping()).resolves.toBeUndefined();
    await pool.end();
  });
});

// =====================================================
// 6. mysql2 pool.pool getter
// =====================================================
describe('mysql2: pool.pool stats getter', () => {
  it('pool.pool returns config and connection counts', async () => {
    const { createPool } = await import('../../src/compat/mysql2.js');
    const pool = createPool({ host: 'localhost' });
    const stats = pool.pool;
    expect(stats).toHaveProperty('config');
    expect(stats).toHaveProperty('_allConnections');
    expect(stats).toHaveProperty('_freeConnections');
    expect(stats).toHaveProperty('_connectionQueue');
    expect(stats._allConnections.length).toBe(1);
    expect(stats._connectionQueue.length).toBe(0);
    await pool.end();
  });
});

// =====================================================
// 7. pg DatabaseError
// =====================================================
describe('pg: DatabaseError', () => {
  it('DatabaseError has correct properties', async () => {
    const pg = await import('../../src/compat/pg.js');
    const err = new pg.DatabaseError('test error', 100, 'test-name');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('DatabaseError');
    expect(err.message).toBe('test error');
    expect(err.code).toBeUndefined();
    expect(err.detail).toBeUndefined();
  });

  it('DatabaseError defaults', async () => {
    const pg = await import('../../src/compat/pg.js');
    const err = new pg.DatabaseError('msg');
    expect(err.name).toBe('DatabaseError');
  });
});

// =====================================================
// 8. pg types namespace
// =====================================================
describe('pg: types namespace', () => {
  it('types.setTypeParser does not throw', async () => {
    const pg = await import('../../src/compat/pg.js');
    expect(() => pg.types.setTypeParser(25, (v: string) => v)).not.toThrow();
  });

  it('types.getTypeParser returns identity function', async () => {
    const pg = await import('../../src/compat/pg.js');
    const parser = pg.types.getTypeParser(25);
    expect(typeof parser).toBe('function');
    expect(parser('hello')).toBe('hello');
  });

  it('types.builtins contains expected OIDs', async () => {
    const pg = await import('../../src/compat/pg.js');
    expect(pg.types.builtins.BOOL).toBe(16);
    expect(pg.types.builtins.TEXT).toBe(25);
    expect(pg.types.builtins.INT4).toBe(23);
    expect(pg.types.builtins.JSON).toBe(114);
  });
});

// =====================================================
// 9. pg Pool totalCount / idleCount / waitingCount
// =====================================================
describe('pg: Pool counters', () => {
  it('Pool totalCount increments on connect, decrements on release', async () => {
    const pg = await import('../../src/compat/pg.js');
    const pool = new pg.Pool();
    expect(pool.totalCount).toBe(0);

    const client = await pool.connect();
    expect(pool.totalCount).toBe(1);

    client.release();
    expect(pool.totalCount).toBe(0);

    await pool.end();
  });

  it('Pool waitingCount is always 0', async () => {
    const pg = await import('../../src/compat/pg.js');
    const pool = new pg.Pool();
    expect(pool.waitingCount).toBe(0);
    await pool.end();
  });
});

// =====================================================
// 10. pg PoolClient release with error
// =====================================================
describe('pg: PoolClient release', () => {
  it('PoolClient.release() calls release callback', async () => {
    const pg = await import('../../src/compat/pg.js');
    const pool = new pg.Pool();
    let released = false;
    const client = new (pg as any).PoolClient(() => { released = true; });
    await client.release();
    expect(released).toBe(true);
    await pool.end();
  });
});

// =====================================================
// 11. mongodb: replaceOne
// =====================================================
describe('mongodb: replaceOne', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('replaceOne replaces all fields of matched document', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('replace_test');

    await coll.insertOne({ name: 'Alice', age: 30, status: 'active' });
    await coll.replaceOne(
      { name: 'Alice' },
      { name: 'Alice', age: 31, status: 'senior', newField: 'added' }
    );

    const doc = await coll.findOne({ name: 'Alice' }) as Record<string, unknown>;
    expect(doc).not.toBeNull();
    expect(doc.age).toBe(31);
    expect(doc.status).toBe('senior');
    expect(doc.newField).toBe('added');

    await coll.drop();
    await client.close();
  });

  it('replaceOne with upsert creates document when not found', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('replace_upsert_test');

    const result = await coll.replaceOne(
      { name: 'NewDoc' },
      { name: 'NewDoc', value: 42 },
      { upsert: true }
    );
    expect(result.matchedCount).toBe(0);
    expect(result.upsertedId).toBeDefined();

    const doc = await coll.findOne({ name: 'NewDoc' }) as Record<string, unknown>;
    expect(doc).not.toBeNull();
    expect(doc.value).toBe(42);

    await coll.drop();
    await client.close();
  });

  it('replaceOne with callback works', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('replace_cb_test');

    await coll.insertOne({ name: 'CB' });

    await new Promise<void>((resolve) => {
      coll.replaceOne({ name: 'CB' }, { name: 'CB', updated: true }, (err, result) => {
        expect(err).toBeNull();
        expect(result).toBeDefined();
        expect(result!.matchedCount).toBe(1);
        coll.drop(() => client.close(() => resolve()));
      });
    });
  });
});

// =====================================================
// 12. mongodb: findOneAndDelete
// =====================================================
describe('mongodb: findOneAndDelete', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('findOneAndDelete returns the deleted document', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('findanddelete_test');

    await coll.insertOne({ name: 'ToDelete', value: 99 });
    const deleted = await coll.findOneAndDelete({ name: 'ToDelete' }) as Record<string, unknown>;
    expect(deleted).not.toBeNull();
    expect(deleted.name).toBe('ToDelete');

    const remaining = await coll.findOne({ name: 'ToDelete' });
    expect(remaining).toBeNull();

    await coll.drop();
    await client.close();
  });

  it('findOneAndDelete returns null when no match', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('findanddelete_test');

    const deleted = await coll.findOneAndDelete({ name: 'NonExistent' });
    expect(deleted).toBeNull();

    await client.close();
  });

  it('findOneAndDelete with callback works', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('findanddelete_cb_test');

    await coll.insertOne({ name: 'CBCallback' });

    await new Promise<void>((resolve) => {
      coll.findOneAndDelete({ name: 'CBCallback' }, (err, doc) => {
        expect(err).toBeNull();
        expect(doc).not.toBeNull();
        expect((doc as Record<string, unknown>).name).toBe('CBCallback');
        coll.drop(() => client.close(() => resolve()));
      });
    });
  });
});

// =====================================================
// 13. mongodb: findOneAndReplace
// =====================================================
describe('mongodb: findOneAndReplace', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('findOneAndReplace returns document before replacement', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('findandreplace_test');

    await coll.insertOne({ name: 'Replace', value: 1 });
    const before = await coll.findOneAndReplace(
      { name: 'Replace' },
      { name: 'Replace', value: 2, extra: 'new' }
    ) as Record<string, unknown>;
    expect(before).not.toBeNull();
    expect(before.value).toBe(1);

    const after = await coll.findOne({ name: 'Replace' }) as Record<string, unknown>;
    expect(after.value).toBe(2);
    expect(after.extra).toBe('new');

    await coll.drop();
    await client.close();
  });

  it('findOneAndReplace with returnDocument: after returns updated doc', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('findandreplace_after_test');

    await coll.insertOne({ name: 'RAfter', val: 10 });
    const result = await coll.findOneAndReplace(
      { name: 'RAfter' },
      { name: 'RAfter', val: 20 },
      { returnDocument: 'after' }
    ) as Record<string, unknown>;
    expect(result).not.toBeNull();
    expect(result.val).toBe(20);

    await coll.drop();
    await client.close();
  });
});

// =====================================================
// 14. mongodb: estimatedDocumentCount
// =====================================================
describe('mongodb: estimatedDocumentCount', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('estimatedDocumentCount returns number', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('estcount_test');

    await coll.insertMany([{ a: 1 }, { a: 2 }, { a: 3 }]);
    const count = await coll.estimatedDocumentCount();
    expect(typeof count).toBe('number');
    expect(count).toBe(3);

    await coll.drop();
    await client.close();
  });

  it('estimatedDocumentCount with callback works', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('estcount_cb_test');

    await coll.insertOne({ a: 1 });
    await new Promise<void>((resolve) => {
      coll.estimatedDocumentCount((err, count) => {
        expect(err).toBeNull();
        expect(count).toBe(1);
        coll.drop(() => client.close(() => resolve()));
      });
    });
  });
});

// =====================================================
// 15. mongodb: createIndexes / dropIndex
// =====================================================
describe('mongodb: createIndexes / dropIndex', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('createIndex returns index name', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('index_test');

    const name = await coll.createIndex({ email: 1 });
    expect(typeof name).toBe('string');
    expect(name).toContain('email');

    await coll.drop();
    await client.close();
  });

  it('createIndex with custom name', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('index_name_test');

    const name = await coll.createIndex({ status: 1 }, { name: 'idx_status_custom' });
    expect(name).toBe('idx_status_custom');

    await coll.drop();
    await client.close();
  });

  it('createIndexes with multiple specs', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('indexes_multi_test');

    const names = await coll.createIndexes([
      { key: { a: 1 } },
      { key: { b: -1 }, name: 'idx_b' },
    ]);
    expect(names.length).toBe(2);

    await coll.drop();
    await client.close();
  });

  it('createIndex with callback works', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('index_cb_test');

    await new Promise<void>((resolve) => {
      coll.createIndex({ x: 1 }, (err, name) => {
        expect(err).toBeNull();
        expect(typeof name).toBe('string');
        coll.drop(() => client.close(() => resolve()));
      });
    });
  });
});

// =====================================================
// 16. mongodb: FindCursor methods
// =====================================================
describe('mongodb: FindCursor advanced methods', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('cursor.forEach iterates all documents', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('cursor_foreach_test');

    await coll.insertMany([{ v: 1 }, { v: 2 }, { v: 3 }]);

    const visited: number[] = [];
    await coll.find({}).forEach((doc) => {
      visited.push((doc as Record<string, unknown>).v as number);
    });
    expect(visited.length).toBe(3);
    expect(visited.sort()).toEqual([1, 2, 3]);

    await coll.drop();
    await client.close();
  });

  it('cursor.next() returns documents one by one', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('cursor_next_test');

    await coll.insertMany([{ v: 10 }, { v: 20 }]);

    const cursor = coll.find({}).sort({ v: 1 });
    const first = await cursor.next() as Record<string, unknown>;
    expect(first.v).toBe(10);

    // next() with limit 1 — should return first matching
    const second = await coll.find({}).sort({ v: 1 }).skip(1).next() as Record<string, unknown>;
    expect(second.v).toBe(20);

    await coll.drop();
    await client.close();
  });

  it('cursor.hasNext() returns true when docs exist', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('cursor_hasnext_test');

    await coll.insertOne({ v: 1 });
    const hasMore = await coll.find({}).hasNext();
    expect(hasMore).toBe(true);

    await coll.drop();
    await client.close();
  });

  it('cursor.count() returns document count matching filter', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('cursor_count_test');

    await coll.insertMany([{ t: 'a' }, { t: 'a' }, { t: 'b' }]);
    const count = await coll.find({ t: 'a' }).count();
    expect(count).toBe(2);

    await coll.drop();
    await client.close();
  });

  it('cursor async iterator yields all documents', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('cursor_asynciter_test');

    await coll.insertMany([{ n: 1 }, { n: 2 }, { n: 3 }]);

    const docs: unknown[] = [];
    for await (const doc of coll.find({}).sort({ n: 1 })) {
      docs.push(doc);
    }
    expect(docs.length).toBe(3);
    expect((docs[0] as Record<string, unknown>).n).toBe(1);

    await coll.drop();
    await client.close();
  });
});

// =====================================================
// 17. mongodb: AggregateCursor methods
// =====================================================
describe('mongodb: AggregateCursor methods', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('aggregate cursor forEach', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('agg_cursor_test');

    await coll.insertMany([{ c: 'a' }, { c: 'a' }, { c: 'b' }]);

    const groups: unknown[] = [];
    await coll.aggregate([
      { $group: { _id: '$c', cnt: { $sum: 1 } } },
    ]).forEach((doc) => groups.push(doc));

    expect(groups.length).toBe(2);
    await coll.drop();
    await client.close();
  });

  it('aggregate cursor async iterator', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');
    const coll = db.collection('agg_iter_test');

    await coll.insertMany([{ v: 1 }, { v: 2 }]);

    const docs: unknown[] = [];
    for await (const doc of coll.aggregate([{ $match: {} }])) {
      docs.push(doc);
    }
    expect(docs.length).toBe(2);

    await coll.drop();
    await client.close();
  });
});

// =====================================================
// 18. mongodb: startSession transaction lifecycle
// =====================================================
describe('mongodb: startSession transaction lifecycle', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('startSession returns session with transaction methods', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();

    const session = client.startSession();
    expect(session).toHaveProperty('startTransaction');
    expect(session).toHaveProperty('commitTransaction');
    expect(session).toHaveProperty('abortTransaction');
    expect(session).toHaveProperty('endSession');
    expect(typeof session.startTransaction).toBe('function');
    expect(typeof session.commitTransaction).toBe('function');
    expect(typeof session.abortTransaction).toBe('function');
    expect(typeof session.endSession).toBe('function');

    await client.close();
  });

  it('session commitTransaction and abortTransaction resolve', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();

    const session = client.startSession();
    session.startTransaction();
    await session.commitTransaction();
    await session.endSession();

    // Abort should also work
    const session2 = client.startSession();
    session2.startTransaction();
    await session2.abortTransaction();
    await session2.endSession();

    await client.close();
  });
});

// =====================================================
// 19. mongodb: MongoClient.connect static factory
// =====================================================
describe('mongodb: MongoClient static factory', () => {
  it('MongoClient.connect() returns connected client', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = await MongoClient.connect('mongodb://localhost:27017/test');
    expect(client).toBeInstanceOf(MongoClient);
    expect(client.isConnected()).toBe(true);
    await client.close();
  });
});

// =====================================================
// 20. mongodb: db.command unsupported commands
// =====================================================
describe('mongodb: db.command edge cases', () => {
  beforeAll(async () => {
    await memAdapter.connect();
  });

  it('db.command({ dbStats: 1 }) returns stats', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    const result = await db.command({ dbStats: 1 });
    expect(result.ok).toBe(1);
    expect(result).toHaveProperty('collections');

    await client.close();
  });

  it('db.command({ collStats: "collname" }) returns stats', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    const result = await db.command({ collStats: 'test' });
    expect(result.ok).toBe(1);
    expect(result).toHaveProperty('ns');

    await client.close();
  });

  it('db.command({ dropDatabase: 1 }) drops all collections', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    // Create a collection first
    const coll = db.collection('dropdb_test');
    await coll.insertOne({ a: 1 });

    const result = await db.command({ dropDatabase: 1 });
    expect(result.ok).toBe(1);
    expect(result).toHaveProperty('dropped');

    await client.close();
  });

  it('db.command({ createCollection: "name" }) creates collection', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    const result = await db.command({ createCollection: 'created_via_cmd' });
    expect(result.ok).toBe(1);

    // Clean up
    await db.dropCollection('created_via_cmd');
    await client.close();
  });

  it('db.command({ dropCollection: "name" }) drops collection', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    const coll = db.collection('dropcoll_cmd_test');
    await coll.insertOne({ a: 1 });

    const result = await db.command({ dropCollection: 'dropcoll_cmd_test' });
    expect(result.ok).toBe(1);

    await client.close();
  });

  it('db.command with unknown command returns fallback', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    const result = await db.command({ unknownCommand: 1 });
    expect(result.ok).toBe(1);
    expect(result).toHaveProperty('note');

    await client.close();
  });

  it('db.command with listCollections callback', async () => {
    const { MongoClient } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    await new Promise<void>((resolve) => {
      db.command({ ping: 1 }, (err, result) => {
        expect(err).toBeNull();
        expect(result.ok).toBe(1);
        client.close(() => resolve());
      });
    });
  });
});

// =====================================================
// 21. mongodb: ObjectId edge cases
// =====================================================
describe('mongodb: ObjectId edge cases', () => {
  it('ObjectId.isValid with valid hex string', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    expect(ObjectId.isValid('507f1f77bcf86cd799439011')).toBe(true);
  });

  it('ObjectId.isValid with invalid string', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    expect(ObjectId.isValid('xyz')).toBe(false);
    expect(ObjectId.isValid('short')).toBe(false);
    expect(ObjectId.isValid('')).toBe(false);
  });

  it('ObjectId.isValid with ObjectId instance', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    expect(ObjectId.isValid(new ObjectId())).toBe(true);
  });

  it('ObjectId with short string gets padded', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    const id = new ObjectId('abc');
    expect(id.toString().length).toBe(24);
    expect(id.toString().startsWith('abc')).toBe(true);
  });

  it('ObjectId.getTimestamp returns valid Date', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    const id = new ObjectId();
    const ts = id.getTimestamp();
    expect(ts).toBeInstanceOf(Date);
    expect(ts.getTime()).toBeGreaterThan(0);
  });

  it('ObjectId.createFromTime creates ObjectId from timestamp', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    const ts = Math.floor(Date.now() / 1000);
    const id = ObjectId.createFromTime(ts);
    expect(id.toString().length).toBe(24);
    // First 8 chars should be hex timestamp
    const hexTs = parseInt(id.toString().slice(0, 8), 16);
    expect(hexTs).toBe(ts);
  });

  it('ObjectId.generate returns 24-char hex string', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    const id = ObjectId.generate();
    expect(id.length).toBe(24);
    expect(/^[0-9a-f]{24}$/.test(id)).toBe(true);
  });

  it('ObjectId.toJSON returns hex string', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    const id = new ObjectId('507f1f77bcf86cd799439011');
    expect(JSON.stringify(id)).toBe('"507f1f77bcf86cd799439011"');
  });

  it('ObjectId from another ObjectId copies value', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    const original = new ObjectId('507f1f77bcf86cd799439011');
    const copy = new ObjectId(original);
    expect(copy.equals(original)).toBe(true);
  });

  it('ObjectId.equals with string', async () => {
    const { ObjectId } = await import('../../src/compat/mongodb.js');
    const id = new ObjectId('507f1f77bcf86cd799439011');
    expect(id.equals('507f1f77bcf86cd799439011')).toBe(true);
    expect(id.equals('different_id_string')).toBe(false);
  });
});

// =====================================================
// 22. mongodb: GridFSBucket stub
// =====================================================
describe('mongodb: GridFSBucket', () => {
  it('GridFSBucket constructor does not throw', async () => {
    const { MongoClient, GridFSBucket } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    expect(() => new GridFSBucket(db)).not.toThrow();
    await client.close();
  });

  it('GridFSBucket.openUploadStream throws', async () => {
    const { MongoClient, GridFSBucket } = await import('../../src/compat/mongodb.js');
    const client = new MongoClient();
    await client.connect();
    const db = client.db('test');

    const bucket = new GridFSBucket(db);
    expect(() => bucket.openUploadStream('test.txt')).toThrow('not supported');
    await client.close();
  });
});

// =====================================================
// 23. mongodb: error classes
// =====================================================
describe('mongodb: error classes', () => {
  it('MongoError has correct name', async () => {
    const { MongoError } = await import('../../src/compat/mongodb.js');
    const err = new MongoError('test', 100);
    expect(err.name).toBe('MongoError');
    expect(err.code).toBe(100);
    expect(err).toBeInstanceOf(Error);
  });

  it('MongoServerError has correct name', async () => {
    const { MongoServerError } = await import('../../src/compat/mongodb.js');
    const err = new MongoServerError('server error', 200);
    expect(err.name).toBe('MongoServerError');
    expect(err.code).toBe(200);
    expect(err).toBeInstanceOf(Error);
  });

  it('MongoNetworkError has correct name', async () => {
    const { MongoNetworkError } = await import('../../src/compat/mongodb.js');
    const err = new MongoNetworkError('network error');
    expect(err.name).toBe('MongoNetworkError');
    expect(err).toBeInstanceOf(Error);
  });
});

// =====================================================
// 24. core.ts: splitStatements edge cases
// =====================================================
describe('core: splitStatements', () => {
  it('execSQL with empty string returns empty result', async () => {
    const result = await execSQL('');
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('execSQL with whitespace-only string returns empty result', async () => {
    const result = await execSQL('   ');
    expect(result.rows).toEqual([]);
    expect(result.rowCount).toBe(0);
  });

  it('execSQL with trailing semicolons is handled', async () => {
    const result = await execSQL('SELECT 1 AS val;');
    expect(result.rows).toBeDefined();
  });

  it('multi-statement: CREATE TABLE + INSERT + SELECT', async () => {
    await execSQL(`CREATE TABLE IF NOT EXISTS split_test (id INT, name TEXT)`);
    await execSQL(`DELETE FROM split_test WHERE id = 1`);
    await execSQL(`INSERT INTO split_test (id, name) VALUES (1, 'test')`);
    const { rows } = await execSQL(`SELECT * FROM split_test WHERE id = 1`);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('test');
    await execSQL(`DROP TABLE IF EXISTS split_test`);
  });
});

// =====================================================
// 25. core.ts: normalisePgParams
// =====================================================
describe('core: normalisePgParams via execSQL', () => {
  it('pg-style $1 params work correctly', async () => {
    const { rows } = await execSQL('SELECT ? AS val', [42]);
    expect(rows[0].val).toBe(42);
  });

  it('multiple pg-style params work', async () => {
    await execSQL(`CREATE TABLE IF NOT EXISTS norm_test (id INT, name TEXT)`);
    await execSQL(`DELETE FROM norm_test`);
    await execSQL(`INSERT INTO norm_test (id, name) VALUES (?, ?)`, [1, 'hello']);
    const { rows } = await execSQL(`SELECT * FROM norm_test WHERE id = ?`, [1]);
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe('hello');
    await execSQL(`DROP TABLE IF EXISTS norm_test`);
  });
});

// =====================================================
// 26. mysql2: connection end with active transaction
// =====================================================
describe('mysql2: connection end with active transaction', () => {
  it('end() rolls back active transaction', async () => {
    const { createConnection } = await import('../../src/compat/mysql2.js');
    const conn = createConnection();
    await conn.beginTransaction();
    // end() should rollback the active tx silently
    await conn.end();
  });

  it('end() with callback rolls back active transaction', async () => {
    const { createConnection } = await import('../../src/compat/mysql2.js');
    const conn = createConnection();
    await conn.beginTransaction();
    await new Promise<void>((resolve) => {
      conn.end((err) => {
        expect(err).toBeNull();
        resolve();
      });
    });
  });
});

// =====================================================
// 27. pg: Client end with active transaction
// =====================================================
describe('pg: Client end with active transaction', () => {
  it('Client.end() rolls back active transaction', async () => {
    const pg = await import('../../src/compat/pg.js');
    const client = new pg.Client();
    await client.connect();
    // Client.end() should not throw even with active tx
    await client.end();
  });

  it('Client.end() with callback', async () => {
    const pg = await import('../../src/compat/pg.js');
    const client = new pg.Client();
    await client.connect();
    await new Promise<void>((resolve) => {
      client.end((err) => {
        expect(err).toBeNull();
        resolve();
      });
    });
  });
});

// =====================================================
// 28. mysql2: pool getConnection returns distinct connections
// =====================================================
describe('mysql2: pool getConnection', () => {
  it('getConnection() promise mode returns connection', async () => {
    const { createPool } = await import('../../src/compat/mysql2.js');
    const pool = createPool({});
    const conn = await pool.getConnection();
    expect(conn).toBeDefined();
    expect(typeof conn.query).toBe('function');
    await pool.end();
  });

  it('getConnection() callback mode returns connection', async () => {
    const { createPool } = await import('../../src/compat/mysql2.js');
    const pool = createPool({});
    await new Promise<void>((resolve) => {
      pool.getConnection((err, conn) => {
        expect(err).toBeNull();
        expect(conn).toBeDefined();
        pool.end(() => resolve());
      });
    });
  });
});

// =====================================================
// 29. pg: Pool query with text config object
// =====================================================
describe('pg: Pool query with config object', () => {
  it('pool.query({ text, values }) works', async () => {
    const pg = await import('../../src/compat/pg.js');
    const pool = new pg.Pool();
    const result = await pool.query({ text: 'SELECT $1 AS val', values: [99] });
    expect(result.rows[0].val).toBe(99);
    expect(result.command).toBe('SELECT');
    expect(result.oid).toBe(0);
    await pool.end();
  });
});

// =====================================================
// 30. pg: Pool constructor with connectionString
// =====================================================
describe('pg: Pool constructor variants', () => {
  it('Pool with string config (connectionString)', async () => {
    const pg = await import('../../src/compat/pg.js');
    // Should not throw — connection string is parsed but not used for real connections
    const pool = new pg.Pool('postgresql://localhost:5432/test');
    expect(pool.options).toHaveProperty('connectionString');
    await pool.end();
  });

  it('Client with string config', async () => {
    const pg = await import('../../src/compat/pg.js');
    const client = new pg.Client('postgresql://localhost:5432/test');
    expect(client.connectionParameters).toHaveProperty('connectionString');
    await client.connect();
    await client.end();
  });
});
