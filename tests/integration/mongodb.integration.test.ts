// =====================================================
// JSDB - MongoDB Integration Tests
// Tests against REAL MongoDB database
// =====================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type JSDBClient } from '../../src/index.js';

const MONGO_CONFIG = {
  database: 'mongodb' as const,
  connection: {
    uri: 'mongodb://localhost:27017',
    database: 'jsdb_test',
  },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

describe('MongoDB Integration', () => {
  let client: JSDBClient;
  const TEST_COLLECTION = 'jsdb_test_users';

  beforeAll(async () => {
    client = createClient(MONGO_CONFIG);
    await client.connect();
  }, 30000);

  afterAll(async () => {
    if (client) {
      try {
        await client.collection(TEST_COLLECTION).deleteMany({});
      } catch { /* cleanup */ }
      await client.disconnect();
    }
  }, 10000);

  beforeEach(async () => {
    try {
      await client.collection(TEST_COLLECTION).deleteMany({});
    } catch { /* cleanup */ }
  });

  // ---- CRUD ----

  describe('CRUD', () => {
    it('insertOne and findOne', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.insertOne({
        name: 'Alice',
        email: 'alice@example.com',
        age: 30,
        score: 95.5,
        active: true,
      });
      expect(result.acknowledged).toBe(true);
      expect(result.insertedId).toBeDefined();

      const found = await coll.findOne({ name: 'Alice' });
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Alice');
      expect(found!.email).toBe('alice@example.com');
      expect(found!.age).toBe(30);
    });

    it('insertMany', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll.insertMany([
        { name: 'Bob', email: 'bob@example.com', age: 25, active: true },
        { name: 'Charlie', email: 'charlie@example.com', age: 35, active: false },
        { name: 'Diana', email: 'diana@example.com', age: 28, active: true },
      ]);
      expect(result.insertedCount).toBe(3);
      expect(result.insertedIds.length).toBe(3);

      const count = await coll.count({});
      expect(count).toBe(3);
    });

    it('findMany', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: true },
        { name: 'Charlie', age: 35, active: false },
      ]);

      const results = await coll.find({ active: true });
      expect(results.length).toBe(2);
      expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('findById', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const inserted = await coll.insertOne({ name: 'TestUser', age: 20 });
      const found = await coll.findById(inserted.insertedId);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('TestUser');
    });

    it('updateOne', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertOne({ name: 'Alice', age: 30 });

      const result = await coll.updateOne({ name: 'Alice' }, { $set: { age: 31 } });
      expect(result.matchedCount).toBe(1);
      expect(result.modifiedCount).toBe(1);

      const updated = await coll.findOne({ name: 'Alice' });
      expect(updated!.age).toBe(31);
    });

    it('updateMany', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: true },
      ]);

      const result = await coll.updateMany({ active: true }, { $set: { active: false } });
      expect(result.modifiedCount).toBe(2);

      const count = await coll.count({ active: false });
      expect(count).toBe(2);
    });

    it('deleteOne', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertOne({ name: 'ToDelete', age: 40 });

      const result = await coll.deleteOne({ name: 'ToDelete' });
      expect(result.deletedCount).toBe(1);

      const found = await coll.findOne({ name: 'ToDelete' });
      expect(found).toBeNull();
    });

    it('deleteMany', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'A', active: false },
        { name: 'B', active: false },
        { name: 'C', active: true },
      ]);

      const result = await coll.deleteMany({ active: false });
      expect(result.deletedCount).toBe(2);

      const count = await coll.count({});
      expect(count).toBe(1);
    });

    it('count', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'A', age: 10 },
        { name: 'B', age: 20 },
        { name: 'C', age: 30 },
      ]);

      const total = await coll.count({});
      expect(total).toBe(3);

      const filtered = await coll.count({ age: { $gt: 15 } });
      expect(filtered).toBe(2);
    });
  });

  // ---- Filters ----

  describe('Filters', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Alice', age: 30, score: 95.5, active: true, email: 'alice@test.com' },
        { name: 'Bob', age: 25, score: 80.0, active: true, email: 'bob@test.com' },
        { name: 'Charlie', age: 35, score: 60.0, active: false, email: null },
        { name: 'Diana', age: 28, score: 88.0, active: true, email: 'diana@test.com' },
      ]);
    });

    it('equality filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({ name: 'Alice' });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Alice');
    });

    it('$gt filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({ age: { $gt: 28 } });
      expect(results.length).toBe(2);
    });

    it('$gte filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({ age: { $gte: 30 } });
      expect(results.length).toBe(2);
    });

    it('$lt filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({ age: { $lt: 28 } });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Bob');
    });

    it('$lte filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({ age: { $lte: 28 } });
      expect(results.length).toBe(2);
    });

    it('$in filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({ name: { $in: ['Alice', 'Charlie'] } });
      expect(results.length).toBe(2);
    });

    it('$ne filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({ name: { $ne: 'Alice' } });
      expect(results.length).toBe(3);
    });

    it('$exists filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      // $exists checks field presence, not truthiness. All 4 docs have 'email' field.
      const withEmail = await coll.find({ email: { $exists: true } });
      expect(withEmail.length).toBe(4);

      // Charlie has email: null — field exists but is null.
      // Use $ne null to find docs with non-null email.
      const nonNullEmail = await coll.find({ email: { $ne: null } });
      expect(nonNullEmail.length).toBe(3);
    });

    it('null handling', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const nullEmail = await coll.find({ email: null });
      expect(nullEmail.length).toBe(1);
      expect(nullEmail[0].name).toBe('Charlie');
    });

    it('$and filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      // $gt: 25 means strictly greater than 25. Bob (age 25) does NOT match.
      // Alice(30) and Diana(28) match both conditions.
      const results = await coll.find({
        $and: [{ age: { $gt: 25 } }, { active: true }],
      });
      expect(results.length).toBe(2);
    });

    it('$or filter', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({
        $or: [{ age: { $lt: 26 } }, { age: { $gt: 34 } }],
      });
      expect(results.length).toBe(2);
      expect(results.map((r) => r.name).sort()).toEqual(['Bob', 'Charlie']);
    });

    it('numeric values', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const highScore = await coll.find({ score: { $gte: 88 } });
      expect(highScore.length).toBe(2);
    });

    it('boolean values', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const active = await coll.find({ active: true });
      expect(active.length).toBe(3);
    });
  });

  // ---- Sorting ----

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
      const results = await coll.find({}, { sort: { age: 'asc' } });
      expect(results.map((r) => r.age)).toEqual([25, 30, 35]);
    });

    it('sort descending', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({}, { sort: { age: 'desc' } });
      expect(results.map((r) => r.age)).toEqual([35, 30, 25]);
    });
  });

  // ---- Pagination ----

  describe('Pagination', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      for (let i = 1; i <= 10; i++) {
        await coll.insertOne({ name: `User${i}`, age: i * 10 });
      }
    });

    it('limit', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({}, { limit: 3 });
      expect(results.length).toBe(3);
    });

    it('offset', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({}, { sort: { age: 'asc' }, offset: 5, limit: 3 });
      expect(results.length).toBe(3);
      expect(results[0].age).toBe(60);
    });
  });

  // ---- Projection ----

  describe('Projection', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertOne({ name: 'Alice', email: 'alice@test.com', age: 30 });
    });

    it('field inclusion', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({}, { projection: { name: 1, age: 1 } });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Alice');
      expect(results[0].age).toBe(30);
      expect(results[0].email).toBeUndefined();
    });

    it('field exclusion', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.find({}, { projection: { email: 0 } });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Alice');
      expect(results[0].email).toBeUndefined();
    });
  });

  // ---- Aggregation ----

  describe('Aggregation', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Alice', age: 30, score: 90 },
        { name: 'Bob', age: 25, score: 80 },
        { name: 'Charlie', age: 35, score: 70 },
      ]);
    });

    it('$match + $group with $sum', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.aggregate([
        { $match: { age: { $gte: 25 } } },
        { $group: { _id: null, totalScore: { $sum: '$score' } } },
      ]);
      expect(results.length).toBe(1);
      expect(results[0].totalScore).toBe(240);
    });

    it('$group with $avg', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.aggregate([
        { $group: { _id: null, avgAge: { $avg: '$age' } } },
      ]);
      expect(results.length).toBe(1);
      expect(results[0].avgAge).toBe(30);
    });

    it('$group with $min and $max', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.aggregate([
        { $group: { _id: null, minAge: { $min: '$age' }, maxAge: { $max: '$age' } } },
      ]);
      expect(results[0].minAge).toBe(25);
      expect(results[0].maxAge).toBe(35);
    });

    it('$count', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll.aggregate([{ $count: 'total' }]);
      expect(results.length).toBe(1);
      expect(results[0].total).toBe(3);
    });
  });

  // ---- Transactions ----
  // NOTE: Standalone MongoDB does not support multi-document transactions.
  // These tests require a replica set. They are skipped on standalone.

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

  // ---- Error Handling ----

  describe('Error Handling', () => {
    it('invalid collection name throws', async () => {
      const coll = client.collection('1invalid');
      await expect(coll.find({})).rejects.toThrow();
    });
  });

  // ---- Query Chain ----

  describe('Query Chain', () => {
    beforeEach(async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertMany([
        { name: 'Alice', age: 30, active: true },
        { name: 'Bob', age: 25, active: true },
        { name: 'Charlie', age: 35, active: false },
      ]);
    });

    it('chained where + sort + limit', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const results = await coll
        .query()
        .where({ active: true })
        .sort('age', 'desc')
        .limit(1)
        .get();
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Alice');
    });

    it('chained first()', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const result = await coll
        .query()
        .where({ active: true })
        .sort('age', 'asc')
        .first();
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Bob');
    });

    it('chained count()', async () => {
      const coll = client.collection(TEST_COLLECTION);
      const count = await coll.query().where({ active: true }).count();
      expect(count).toBe(2);
    });
  });

  // ---- MongoDB-specific: nested documents ----

  describe('MongoDB Nested Documents', () => {
    it('insert and find nested document', async () => {
      const coll = client.collection(TEST_COLLECTION);
      await coll.insertOne({
        name: 'Alice',
        address: { city: 'New York', zip: '10001' },
      });

      const found = await coll.findOne({ name: 'Alice' });
      expect(found).not.toBeNull();
      expect(found!.address).toBeDefined();
    });
  });
});
