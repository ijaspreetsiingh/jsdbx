// =====================================================
// JSDB - SQLite Integration Tests
// Tests against REAL SQLite database (better-sqlite3)
// =====================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type JSDBClient } from '../../src/index.js';

const SQLITE_CONFIG = {
  database: 'sqlite' as const,
  connection: {
    filename: ':memory:',
  },
  logging: { level: 'error' as const },
};

describe('SQLite Integration', () => {
  let client: JSDBClient;
  const TEST_COLLECTION = 'jsdb_test_users';

  beforeAll(async () => {
    client = createClient(SQLITE_CONFIG);
    await client.connect();

    await client.raw(`
      CREATE TABLE IF NOT EXISTS "${TEST_COLLECTION}" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT,
        age INTEGER,
        score REAL,
        active INTEGER DEFAULT 1,
        tags TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }, 30000);

  afterAll(async () => {
    if (client) {
      await client.raw(`DROP TABLE IF EXISTS "${TEST_COLLECTION}"`);
      await client.disconnect();
    }
  }, 10000);

  beforeEach(async () => {
    await client.raw(`DELETE FROM "${TEST_COLLECTION}"`);
  });

  describe('CRUD', () => {
    it('insertOne and findOne', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.insertOne({
        name: 'Alice',
        email: 'alice@test.com',
        age: 30,
        score: 95.5,
        active: 1,
      });
      expect(result.acknowledged).toBe(true);
      expect(result.insertedId).toBeDefined();

      const found = await coll.findOne({ name: 'Alice' });
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
      expect(found!.email).toBe('alice@test.com');
      expect(found!.age).toBe(30);
      expect(Number(found!.score)).toBeCloseTo(95.5);
      expect(found!.active).toBe(1);
    });

    it('insertMany', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.insertMany([
        { name: 'Bob', age: 25, active: 1 },
        { name: 'Charlie', age: 35, active: 0 },
        { name: 'Diana', age: 28, active: 1 },
      ]);
      expect(result.acknowledged).toBe(true);
      expect(result.insertedCount).toBe(3);
      expect(result.insertedIds.length).toBe(3);

      const count = await coll.count({});
      expect(count).toBe(3);
    });

    it('updateOne', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertOne({ name: 'Eve', age: 40, active: 1 });

      const result = await coll.updateOne({ name: 'Eve' }, { $set: { age: 41 } });
      expect(result.modifiedCount).toBe(1);

      const updated = await coll.findOne({ name: 'Eve' });
      expect(updated!.age).toBe(41);
    });

    it('updateMany', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'User1', active: 1 },
        { name: 'User2', active: 1 },
        { name: 'User3', active: 0 },
      ]);

      const result = await coll.updateMany({ active: 1 }, { $set: { active: 0 } });
      expect(result.modifiedCount).toBe(2);

      const count = await coll.count({ active: 1 });
      expect(count).toBe(0);
    });

    it('deleteOne', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertOne({ name: 'ToDelete', age: 50 });

      const result = await coll.deleteOne({ name: 'ToDelete' });
      expect(result.deletedCount).toBe(1);

      const found = await coll.findOne({ name: 'ToDelete' });
      expect(found).toBeNull();
    });

    it('deleteMany', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Del1', active: 1 },
        { name: 'Del2', active: 1 },
        { name: 'Del3', active: 0 },
      ]);

      const result = await coll.deleteMany({ active: 1 });
      expect(result.deletedCount).toBe(2);

      const count = await coll.count({});
      expect(count).toBe(1);
    });

    it('count', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'A', age: 20 },
        { name: 'B', age: 30 },
        { name: 'C', age: 40 },
      ]);

      const total = await coll.count({});
      expect(total).toBe(3);

      const filtered = await coll.count({ age: { $gt: 25 } });
      expect(filtered).toBe(2);
    });
  });

  describe('Filters', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Alice', age: 30, score: 90.5, active: 1 },
        { name: 'Bob', age: 25, score: 85.0, active: 1 },
        { name: 'Charlie', age: 35, score: 95.0, active: 0 },
        { name: 'Diana', age: 28, score: 88.5, active: 1 },
        { name: 'Eve', age: 40, score: 92.0, active: 0 },
      ]);
    });

    it('equality filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ name: 'Alice' });
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Alice');
    });

    it('$gt filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ age: { $gt: 30 } });
      expect(result.length).toBe(2);
    });

    it('$gte filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ age: { $gte: 30 } });
      expect(result.length).toBe(3);
    });

    it('$lt filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ age: { $lt: 28 } });
      expect(result.length).toBe(1);
    });

    it('$lte filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ age: { $lte: 28 } });
      expect(result.length).toBe(2);
    });

    it('$in filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ name: { $in: ['Alice', 'Charlie'] } });
      expect(result.length).toBe(2);
    });

    it('$ne filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ name: { $ne: 'Alice' } });
      expect(result.length).toBe(4);
    });

    it('$and filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ $and: [{ age: { $gt: 25 } }, { age: { $lt: 35 } }] });
      expect(result.length).toBe(2);
    });

    it('$or filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ $or: [{ name: 'Alice' }, { name: 'Bob' }] });
      expect(result.length).toBe(2);
    });

    it('numeric values', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ score: { $gt: 90 } });
      expect(result.length).toBe(3);
    });

    it('boolean/integer values', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({ active: 1 });
      expect(result.length).toBe(3);
    });
  });

  describe('Sorting', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Charlie', age: 35 },
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
      ]);
    });

    it('sort ascending', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({}, { sort: { name: 1 } });
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Bob');
      expect(result[2].name).toBe('Charlie');
    });

    it('sort descending', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({}, { sort: { age: -1 } });
      expect(result[0].age).toBe(35);
      expect(result[1].age).toBe(30);
      expect(result[2].age).toBe(25);
    });
  });

  describe('Pagination', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'User1', age: 20 },
        { name: 'User2', age: 21 },
        { name: 'User3', age: 22 },
        { name: 'User4', age: 23 },
        { name: 'User5', age: 24 },
      ]);
    });

    it('limit', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({}, { limit: 3 });
      expect(result.length).toBe(3);
    });

    it('offset', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.find({}, { skip: 2 });
      expect(result.length).toBe(3);
    });

    it('pagination via query options', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const page1 = await coll.find({}, { sort: { name: 1 }, skip: 0, limit: 2 });
      const page2 = await coll.find({}, { sort: { name: 1 }, skip: 2, limit: 2 });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(2);
      expect(page1[0].name).not.toBe(page2[0].name);
    });
  });

  describe('Aggregation', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Alice', age: 30, score: 90.5 },
        { name: 'Bob', age: 25, score: 85.0 },
        { name: 'Charlie', age: 35, score: 95.0 },
        { name: 'Diana', age: 28, score: 88.5 },
      ]);
    });

    it('$match + $group with $sum', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.aggregate([
        { $match: { age: { $gt: 25 } } },
        { $group: { _id: null, totalScore: { $sum: '$score' } } },
      ]);
      expect(result.length).toBe(1);
      expect(Number(result[0].totalScore)).toBeCloseTo(274.0);
    });

    it('$group with $avg', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.aggregate([
        { $group: { _id: null, avgAge: { $avg: '$age' } } },
      ]);
      expect(result.length).toBe(1);
      expect(Number(result[0].avgAge)).toBeCloseTo(29.5);
    });

    it('$group with $min and $max', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.aggregate([
        { $group: { _id: null, minAge: { $min: '$age' }, maxAge: { $max: '$age' } } },
      ]);
      expect(result.length).toBe(1);
      expect(Number(result[0].minAge)).toBe(25);
      expect(Number(result[0].maxAge)).toBe(35);
    });

    it('$count', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.aggregate([{ $count: 'total' }]);
      expect(result.length).toBe(1);
      expect(Number(result[0].total)).toBe(4);
    });
  });

  describe('Transactions', () => {
    it('commit transaction', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await client.transaction(async (tx) => {
        const txColl = tx.collection(TEST_COLLECTION);
        await txColl.insertOne({ name: 'TxUser1', age: 40 });
        await txColl.insertOne({ name: 'TxUser2', age: 41 });
      });

      const count = await coll.count({});
      expect(count).toBe(2);
    });

    it('rollback transaction', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertOne({ name: 'Existing', age: 50 });

      try {
        await client.transaction(async (tx) => {
          const txColl = tx.collection(TEST_COLLECTION);
          await txColl.insertOne({ name: 'RollbackUser', age: 60 });
          throw new Error('Force rollback');
        });
      } catch {
        // Expected
      }

      const count = await coll.count({});
      expect(count).toBe(1);
    });
  });

  describe('Error Handling', () => {
    it('invalid collection name throws', async () => {
      await expect(client.collection('1invalid').find({})).rejects.toThrow();
    });

    it('insert empty document throws', async () => {
      await expect(client.collection(TEST_COLLECTION).insertOne({} as any)).rejects.toThrow();
    });
  });

  describe('Query Chain', () => {
    it('chained where + sort + limit', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Charlie', age: 35 },
      ]);

      const result = await coll
        .query()
        .where({ age: { $gte: 25 } })
        .sort('name', 'asc')
        .limit(2)
        .get();
      expect(result.length).toBe(2);
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Bob');
    });

    it('chained first()', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertOne({ name: 'First', age: 20 });

      const result = await coll
        .query()
        .sort('name', 'asc')
        .first();
      expect(result).not.toBeNull();
      expect(result!.name).toBe('First');
    });

    it('chained count()', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'A', age: 20 },
        { name: 'B', age: 30 },
      ]);

      const count = await coll.query().where({ age: { $gte: 25 } }).count();
      expect(count).toBe(1);
    });
  });

  describe('Raw Query', () => {
    it('executeRaw works', async () => {
      const result = await client.raw(`SELECT 1 AS test`);
      expect(result).toBeDefined();
    });

    it('executeRaw with params', async () => {
      await client.collection(TEST_COLLECTION).insertOne({ name: 'RawTest', age: 99 });
      const result = await client.raw(`SELECT * FROM "${TEST_COLLECTION}" WHERE name = ?`, ['RawTest']);
      expect(Array.isArray(result)).toBe(true);
      expect((result as any[]).length).toBe(1);
      expect((result as any[])[0].name).toBe('RawTest');
    });
  });
});
