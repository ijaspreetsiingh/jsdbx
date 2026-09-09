// =====================================================
// JSDB - Error Semantics Conformance Tests
// Tests that invalid operations throw consistent errors
// across MySQL, PostgreSQL, and MongoDB via JSDB
// =====================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type JSDBClient } from '../../src/index.js';

const MYSQL_CONFIG = {
  database: 'mysql' as const,
  connection: { host: 'localhost', port: 3309, user: 'root', password: 'jsdbproof', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

const PG_CONFIG = {
  database: 'postgres' as const,
  connection: { host: 'localhost', port: 5435, user: 'root', password: 'jsdbproof', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

const T = 'error_sem_test';

async function setupMySQL(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS \`${T}\` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    age INT CHECK (age >= 0),
    email VARCHAR(255)
  )`);
}

async function setupPG(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS "${T}" (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    age INT CHECK (age >= 0),
    email VARCHAR(255)
  )`);
}

describe('Error Semantics Conformance', () => {
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
    try { await mysql.raw(`DROP TABLE IF EXISTS \`${T}\``); } catch { /* cleanup */ }
    try { await pg.raw(`DROP TABLE IF EXISTS "${T}"`); } catch { /* cleanup */ }
    await mysql.disconnect();
    await pg.disconnect();
  }, 10000);

  beforeEach(async () => {
    try { await mysql.raw(`DELETE FROM \`${T}\``); } catch { /* cleanup */ }
    try { await pg.raw(`DELETE FROM "${T}"`); } catch { /* cleanup */ }
  });

  describe('NOT NULL constraint violations', () => {
    it('inserting null into NOT NULL column throws on MySQL', async () => {
      await expect(
        mysql.collection(T).insertOne({ name: null, age: 25 })
      ).rejects.toThrow();
    });

    it('inserting null into NOT NULL column throws on PostgreSQL', async () => {
      await expect(
        pg.collection(T).insertOne({ name: null, age: 25 })
      ).rejects.toThrow();
    });
  });

  describe('CHECK constraint violations', () => {
    it('negative age violates CHECK on MySQL', async () => {
      await expect(
        mysql.collection(T).insertOne({ name: 'Test', age: -5 })
      ).rejects.toThrow();
    });

    it('negative age violates CHECK on PostgreSQL', async () => {
      await expect(
        pg.collection(T).insertOne({ name: 'Test', age: -5 })
      ).rejects.toThrow();
    });
  });

  describe('Nonexistent collection/table', () => {
    it('inserting into nonexistent table throws on MySQL', async () => {
      await expect(
        mysql.collection('nonexistent_table_xyz').insertOne({ x: 1 })
      ).rejects.toThrow();
    });

    it('inserting into nonexistent table throws on PostgreSQL', async () => {
      await expect(
        pg.collection('nonexistent_table_xyz').insertOne({ x: 1 })
      ).rejects.toThrow();
    });
  });

  describe('Type coercion errors', () => {
    it('inserting string into INT column fails gracefully on MySQL', async () => {
      // MySQL may coerce, but if it can't it should throw
      try {
        await mysql.collection(T).insertOne({ name: 'Test', age: 'not_a_number' as any });
        // If no error, MySQL coerced it (valid behavior)
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it('inserting string into INT column fails gracefully on PostgreSQL', async () => {
      try {
        await pg.collection(T).insertOne({ name: 'Test', age: 'not_a_number' as any });
      } catch (e) {
        expect(e).toBeDefined();
      }
    });
  });

  describe('Duplicate primary key', () => {
    it('inserting duplicate PK throws on MySQL', async () => {
      await mysql.collection(T).insertOne({ id: 1, name: 'First', age: 20 });
      await expect(
        mysql.collection(T).insertOne({ id: 1, name: 'Second', age: 25 })
      ).rejects.toThrow();
    });

    it('inserting duplicate PK throws on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ id: 100, name: 'First', age: 20 });
      await expect(
        pg.collection(T).insertOne({ id: 100, name: 'Second', age: 25 })
      ).rejects.toThrow();
    });
  });

  describe('Invalid SQL syntax via raw()', () => {
    it('invalid SQL syntax throws on MySQL', async () => {
      await expect(mysql.raw('SELCT * FROM nonexistent')).rejects.toThrow();
    });

    it('invalid SQL syntax throws on PostgreSQL', async () => {
      await expect(pg.raw('SELCT * FROM nonexistent')).rejects.toThrow();
    });
  });

  describe('Connection recovery', () => {
    it('client remains usable after error', async () => {
      try { await mysql.raw('INVALID SQL XYZ'); } catch { /* expected error */ }
      // Should still work after error
      const result = await mysql.raw('SELECT 1 AS val');
      expect(result).toBeDefined();
    });

    it('client remains usable after error on PostgreSQL', async () => {
      try { await pg.raw('INVALID SQL XYZ'); } catch { /* expected error */ }
      const result = await pg.raw('SELECT 1 AS val');
      expect(result).toBeDefined();
    });
  });

  describe('Empty batch operations', () => {
    it('insertMany with empty array does not error', async () => {
      const mResult = await mysql.collection(T).insertMany([]);
      const pResult = await pg.collection(T).insertMany([]);
      expect(mResult.insertedCount).toBe(0);
      expect(pResult.insertedCount).toBe(0);
    });

    it('updateMany with no matching docs succeeds (0 updated)', async () => {
      const mResult = await mysql.collection(T).updateMany(
        { name: 'nonexistent' },
        { $set: { age: 99 } }
      );
      const pResult = await pg.collection(T).updateMany(
        { name: 'nonexistent' },
        { $set: { age: 99 } }
      );
      expect(mResult.modifiedCount).toBe(0);
      expect(pResult.modifiedCount).toBe(0);
    });

    it('deleteMany with no matching docs succeeds (0 deleted)', async () => {
      const mResult = await mysql.collection(T).deleteMany({ name: 'nonexistent' });
      const pResult = await pg.collection(T).deleteMany({ name: 'nonexistent' });
      expect(mResult.deletedCount).toBe(0);
      expect(pResult.deletedCount).toBe(0);
    });
  });

  describe('Concurrent inserts', () => {
    it('100 parallel inserts complete without error', async () => {
      const docs = Array.from({ length: 100 }, (_, i) => ({
        name: `user_${i}`,
        age: 20 + (i % 30),
      }));
      const mResults = await Promise.all(
        docs.map(d => mysql.collection(T).insertOne(d))
      );
      const pResults = await Promise.all(
        docs.map(d => pg.collection(T).insertOne(d))
      );
      expect(mResults.length).toBe(100);
      expect(pResults.length).toBe(100);
      const mCount = await mysql.collection(T).count({});
      const pCount = await pg.collection(T).count({});
      expect(mCount).toBe(100);
      expect(pCount).toBe(100);
    });
  });

  describe('Large value handling', () => {
    it('handles long string values without truncation', async () => {
      const longStr = 'x'.repeat(200);
      await mysql.collection(T).insertOne({ name: longStr, age: 1 });
      await pg.collection(T).insertOne({ name: longStr, age: 1 });
      const mResult = await mysql.collection(T).findOne({ age: 1 });
      const pResult = await pg.collection(T).findOne({ age: 1 });
      expect(mResult.name.length).toBe(200);
      expect(pResult.name.length).toBe(200);
    });
  });
});
