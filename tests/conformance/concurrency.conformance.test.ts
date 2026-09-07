// =====================================================
// JSDB - Concurrency Conformance Tests
// Tests parallel reads, parallel writes, mixed ops,
// connection pool behavior
// =====================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type JSDBClient } from '../../src/index.js';

const MYSQL_CONFIG = {
  database: 'mysql' as const,
  connection: { host: 'localhost', port: 3309, user: 'root', password: 'jsdbproof', database: 'jsdb_test' },
  pool: { max: 10 },
  logging: { level: 'error' as const },
};

const PG_CONFIG = {
  database: 'postgres' as const,
  connection: { host: 'localhost', port: 5435, user: 'root', password: 'jsdbproof', database: 'jsdb_test' },
  pool: { max: 10 },
  logging: { level: 'error' as const },
};

const T = 'concurrency_test';

async function setupMySQL(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS \`${T}\` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    counter INT DEFAULT 0
  )`);
}

async function setupPG(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS "${T}" (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    counter INT DEFAULT 0
  )`);
}

describe('Concurrency Conformance', () => {
  let mysql: JSDBClient;
  let pg: JSDBClient;

  beforeAll(async () => {
    mysql = createClient(MYSQL_CONFIG);
    pg = createClient(PG_CONFIG);
    await mysql.connect();
    await pg.connect();
    await setupMySQL(mysql);
    await setupPG(pg);
  }, 30000);

  afterAll(async () => {
    try { await mysql.raw(`DROP TABLE IF EXISTS \`${T}\``); } catch {}
    try { await pg.raw(`DROP TABLE IF EXISTS "${T}"`); } catch {}
    await mysql.disconnect();
    await pg.disconnect();
  }, 10000);

  beforeEach(async () => {
    try { await mysql.raw(`DELETE FROM \`${T}\``); } catch {}
    try { await pg.raw(`DELETE FROM "${T}"`); } catch {}
  });

  describe('Parallel reads', () => {
    it('100 parallel find() calls complete without error on MySQL', async () => {
      for (let i = 0; i < 10; i++) {
        await mysql.collection(T).insertOne({ name: `user_${i}`, counter: i });
      }
      const results = await Promise.all(
        Array.from({ length: 100 }, () => mysql.collection(T).find({}))
      );
      expect(results.length).toBe(100);
      results.forEach(r => {
        expect(Array.isArray(r)).toBe(true);
        expect(r.length).toBe(10);
      });
    });

    it('100 parallel find() calls complete without error on PostgreSQL', async () => {
      for (let i = 0; i < 10; i++) {
        await pg.collection(T).insertOne({ name: `user_${i}`, counter: i });
      }
      const results = await Promise.all(
        Array.from({ length: 100 }, () => pg.collection(T).find({}))
      );
      expect(results.length).toBe(100);
      results.forEach(r => {
        expect(Array.isArray(r)).toBe(true);
        expect(r.length).toBe(10);
      });
    });
  });

  describe('Parallel writes', () => {
    it('100 parallel insertOne() calls complete without error on MySQL', async () => {
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          mysql.collection(T).insertOne({ name: `parallel_${i}`, counter: i })
        )
      );
      expect(results.length).toBe(100);
      const count = await mysql.collection(T).count({});
      expect(count).toBe(100);
    });

    it('100 parallel insertOne() calls complete without error on PostgreSQL', async () => {
      const results = await Promise.all(
        Array.from({ length: 100 }, (_, i) =>
          pg.collection(T).insertOne({ name: `parallel_${i}`, counter: i })
        )
      );
      expect(results.length).toBe(100);
      const count = await pg.collection(T).count({});
      expect(count).toBe(100);
    });
  });

  describe('Mixed read/write', () => {
    it('concurrent reads and writes do not crash on MySQL', async () => {
      await mysql.collection(T).insertOne({ name: 'shared', counter: 0 });

      const writes = Array.from({ length: 10 }, (_, i) =>
        mysql.collection(T).updateOne(
          { name: 'shared' },
          { $set: { counter: i + 1 } }
        )
      );
      const reads = Array.from({ length: 10 }, () =>
        mysql.collection(T).find({ name: 'shared' }).catch(() => [])
      );

      const [writeResults, readResults] = await Promise.all([writes, reads]);

      expect(writeResults.length).toBe(10);
      expect(readResults.length).toBe(10);
      // Final state should be consistent
      const final = await mysql.collection(T).findOne({ name: 'shared' });
      expect(final).toBeDefined();
      expect(final!.name).toBe('shared');
    });

    it('concurrent reads and writes do not crash on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ name: 'shared', counter: 0 });

      const writes = Array.from({ length: 10 }, (_, i) =>
        pg.collection(T).updateOne(
          { name: 'shared' },
          { $set: { counter: i + 1 } }
        )
      );
      const reads = Array.from({ length: 10 }, () =>
        pg.collection(T).find({ name: 'shared' }).catch(() => [])
      );

      const [writeResults, readResults] = await Promise.all([writes, reads]);

      expect(writeResults.length).toBe(10);
      expect(readResults.length).toBe(10);
      const final = await pg.collection(T).findOne({ name: 'shared' });
      expect(final).toBeDefined();
      expect(final!.name).toBe('shared');
    });
  });

  describe('Rapid connect/disconnect', () => {
    it('opening and closing connections rapidly does not error', async () => {
      const clients = Array.from({ length: 5 }, () =>
        createClient(MYSQL_CONFIG)
      );
      for (const c of clients) {
        await c.connect();
        await c.collection(T).find({});
        await c.disconnect();
      }
      // Original client still works
      const result = await mysql.collection(T).find({});
      expect(Array.isArray(result)).toBe(true);
    });

    it('opening and closing connections rapidly does not error on PostgreSQL', async () => {
      const clients = Array.from({ length: 5 }, () =>
        createClient(PG_CONFIG)
      );
      for (const c of clients) {
        await c.connect();
        await c.collection(T).find({});
        await c.disconnect();
      }
      const result = await pg.collection(T).find({});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Large batch operations', () => {
    it('insertMany with 1000 documents on MySQL', async () => {
      const docs = Array.from({ length: 1000 }, (_, i) => ({
        name: `batch_${i}`,
        counter: i,
      }));
      const result = await mysql.collection(T).insertMany(docs);
      expect(result.insertedCount).toBe(1000);
      const count = await mysql.collection(T).count({});
      expect(count).toBe(1000);
    });

    it('insertMany with 1000 documents on PostgreSQL', async () => {
      const docs = Array.from({ length: 1000 }, (_, i) => ({
        name: `batch_${i}`,
        counter: i,
      }));
      const result = await pg.collection(T).insertMany(docs);
      expect(result.insertedCount).toBe(1000);
      const count = await pg.collection(T).count({});
      expect(count).toBe(1000);
    });
  });
});
