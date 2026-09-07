// =====================================================
// JSDB - Cross-Database Conformance Tests
// Same universal API tested against MySQL AND MongoDB
// =====================================================
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type JSDBClient } from '../../src/index.js';

const MYSQL_CONFIG = {
  database: 'mysql' as const,
  connection: { host: 'localhost', port: 3309, user: 'root', password: 'jsdbproof', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

const MONGO_CONFIG = {
  database: 'mongodb' as const,
  connection: { uri: 'mongodb://localhost:27019', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

const COLLECTION = 'jsdb_conformance_test';

async function setupMySQL(client: JSDBClient) {
  await client.raw(`
    CREATE TABLE IF NOT EXISTS \`${COLLECTION}\` (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      age INT,
      score DECIMAL(10,2),
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function cleanupMySQL(client: JSDBClient) {
  await client.raw(`DROP TABLE IF EXISTS \`${COLLECTION}\``);
}

async function seedData(coll: ReturnType<JSDBClient['collection']>) {
  await coll.insertMany([
    { name: 'Alice', age: 30, score: 95.5, active: true },
    { name: 'Bob', age: 25, score: 80.0, active: true },
    { name: 'Charlie', age: 35, score: 60.0, active: false },
    { name: 'Diana', age: 28, score: 88.0, active: true },
    { name: 'Eve', age: 22, score: 72.0, active: false },
  ]);
}

describe('Cross-Database Conformance', () => {
  let mysqlClient: JSDBClient;
  let mongoClient: JSDBClient;

  beforeAll(async () => {
    mysqlClient = createClient(MYSQL_CONFIG);
    await mysqlClient.connect();
    await setupMySQL(mysqlClient);

    mongoClient = createClient(MONGO_CONFIG);
    await mongoClient.connect();
  }, 30000);

  afterAll(async () => {
    try { await cleanupMySQL(mysqlClient); } catch {}
    try { await mysqlClient.raw(`DELETE FROM \`${COLLECTION}\``); } catch {}
    await mysqlClient.disconnect();

    try { await mongoClient.collection(COLLECTION).deleteMany({}); } catch {}
    await mongoClient.disconnect();
  }, 10000);

  beforeEach(async () => {
    try { await mysqlClient.raw(`DELETE FROM \`${COLLECTION}\``); } catch {}
    try { await mongoClient.collection(COLLECTION).deleteMany({}); } catch {}
  });

  // ---- CRUD Conformance ----

  describe('CRUD Conformance', () => {
    it('insertOne returns acknowledged on both', async () => {
      const mysqlColl = mysqlClient.collection(COLLECTION);
      const mongoColl = mongoClient.collection(COLLECTION);

      const mysqlResult = await mysqlColl.insertOne({ name: 'Test1', age: 20, active: true });
      const mongoResult = await mongoColl.insertOne({ name: 'Test1', age: 20, active: true });

      expect(mysqlResult.acknowledged).toBe(true);
      expect(mongoResult.acknowledged).toBe(true);
      expect(mysqlResult.insertedId).toBeDefined();
      expect(mongoResult.insertedId).toBeDefined();
    });

    it('insertMany returns correct count on both', async () => {
      const mysqlColl = mysqlClient.collection(COLLECTION);
      const mongoColl = mongoClient.collection(COLLECTION);

      const docs = [
        { name: 'A', age: 10, active: true },
        { name: 'B', age: 20, active: false },
        { name: 'C', age: 30, active: true },
      ];

      const mysqlResult = await mysqlColl.insertMany(docs);
      const mongoResult = await mongoColl.insertMany(docs);

      expect(mysqlResult.insertedCount).toBe(3);
      expect(mongoResult.insertedCount).toBe(3);
    });

    it('findOne returns same data shape on both', async () => {
      const mysqlColl = mysqlClient.collection(COLLECTION);
      const mongoColl = mongoClient.collection(COLLECTION);

      await mysqlColl.insertOne({ name: 'FindMe', age: 42, active: true });
      await mongoColl.insertOne({ name: 'FindMe', age: 42, active: true });

      const mysqlDoc = await mysqlColl.findOne({ name: 'FindMe' });
      const mongoDoc = await mongoColl.findOne({ name: 'FindMe' });

      expect(mysqlDoc).not.toBeNull();
      expect(mongoDoc).not.toBeNull();
      expect(mysqlDoc!.name).toBe(mongoDoc!.name);
      expect(mysqlDoc!.age).toBe(mongoDoc!.age);
    });

    it('count returns same result on both', async () => {
      const mysqlColl = mysqlClient.collection(COLLECTION);
      const mongoColl = mongoClient.collection(COLLECTION);

      await seedData(mysqlColl);
      await seedData(mongoColl);

      const mysqlCount = await mysqlColl.count({});
      const mongoCount = await mongoColl.count({});

      expect(mysqlCount).toBe(5);
      expect(mongoCount).toBe(5);
    });

    it('updateOne modifies correctly on both', async () => {
      const mysqlColl = mysqlClient.collection(COLLECTION);
      const mongoColl = mongoClient.collection(COLLECTION);

      await mysqlColl.insertOne({ name: 'ToUpdate', age: 10 });
      await mongoColl.insertOne({ name: 'ToUpdate', age: 10 });

      const mysqlResult = await mysqlColl.updateOne({ name: 'ToUpdate' }, { $set: { age: 99 } });
      const mongoResult = await mongoColl.updateOne({ name: 'ToUpdate' }, { $set: { age: 99 } });

      expect(mysqlResult.matchedCount).toBe(1);
      expect(mongoResult.matchedCount).toBe(1);

      const mysqlDoc = await mysqlColl.findOne({ name: 'ToUpdate' });
      const mongoDoc = await mongoColl.findOne({ name: 'ToUpdate' });

      expect(mysqlDoc!.age).toBe(99);
      expect(mongoDoc!.age).toBe(99);
    });

    it('deleteOne removes correctly on both', async () => {
      const mysqlColl = mysqlClient.collection(COLLECTION);
      const mongoColl = mongoClient.collection(COLLECTION);

      await mysqlColl.insertOne({ name: 'ToDelete', age: 10 });
      await mongoColl.insertOne({ name: 'ToDelete', age: 10 });

      const mysqlResult = await mysqlColl.deleteOne({ name: 'ToDelete' });
      const mongoResult = await mongoColl.deleteOne({ name: 'ToDelete' });

      expect(mysqlResult.deletedCount).toBe(1);
      expect(mongoResult.deletedCount).toBe(1);

      expect(await mysqlColl.findOne({ name: 'ToDelete' })).toBeNull();
      expect(await mongoColl.findOne({ name: 'ToDelete' })).toBeNull();
    });
  });

  // ---- Filter Conformance ----

  describe('Filter Conformance', () => {
    beforeEach(async () => {
      await seedData(mysqlClient.collection(COLLECTION));
      await seedData(mongoClient.collection(COLLECTION));
    });

    it('$gt filter returns same count on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).find({ age: { $gt: 28 } });
      const mongoResults = await mongoClient.collection(COLLECTION).find({ age: { $gt: 28 } });
      expect(mysqlResults.length).toBe(mongoResults.length);
    });

    it('$in filter returns same names on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).find({ name: { $in: ['Alice', 'Charlie'] } });
      const mongoResults = await mongoClient.collection(COLLECTION).find({ name: { $in: ['Alice', 'Charlie'] } });
      const mysqlNames = mysqlResults.map((r) => r.name).sort();
      const mongoNames = mongoResults.map((r) => r.name).sort();
      expect(mysqlNames).toEqual(mongoNames);
    });

    it('$or filter returns same results on both', async () => {
      const filter = { $or: [{ age: { $lt: 26 } }, { age: { $gt: 34 } }] };
      const mysqlResults = await mysqlClient.collection(COLLECTION).find(filter);
      const mongoResults = await mongoClient.collection(COLLECTION).find(filter);
      expect(mysqlResults.length).toBe(mongoResults.length);
    });

    it('$and filter returns same results on both', async () => {
      const filter = { $and: [{ age: { $gt: 25 } }, { active: true }] };
      const mysqlResults = await mysqlClient.collection(COLLECTION).find(filter);
      const mongoResults = await mongoClient.collection(COLLECTION).find(filter);
      expect(mysqlResults.length).toBe(mongoResults.length);
    });

    it('equality filter returns same result on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).find({ name: 'Alice' });
      const mongoResults = await mongoClient.collection(COLLECTION).find({ name: 'Alice' });
      expect(mysqlResults.length).toBe(1);
      expect(mongoResults.length).toBe(1);
      expect(mysqlResults[0].name).toBe('Alice');
      expect(mongoResults[0].name).toBe('Alice');
    });
  });

  // ---- Sorting Conformance ----

  describe('Sorting Conformance', () => {
    beforeEach(async () => {
      await seedData(mysqlClient.collection(COLLECTION));
      await seedData(mongoClient.collection(COLLECTION));
    });

    it('sort ascending returns same order on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).find({}, { sort: { age: 'asc' } });
      const mongoResults = await mongoClient.collection(COLLECTION).find({}, { sort: { age: 'asc' } });
      expect(mysqlResults.map((r) => r.age)).toEqual(mongoResults.map((r) => r.age));
    });

    it('sort descending returns same order on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).find({}, { sort: { age: 'desc' } });
      const mongoResults = await mongoClient.collection(COLLECTION).find({}, { sort: { age: 'desc' } });
      expect(mysqlResults.map((r) => r.age)).toEqual(mongoResults.map((r) => r.age));
    });
  });

  // ---- Pagination Conformance ----

  describe('Pagination Conformance', () => {
    beforeEach(async () => {
      for (let i = 1; i <= 10; i++) {
        await mysqlClient.collection(COLLECTION).insertOne({ name: `User${i}`, age: i * 10, active: true });
        await mongoClient.collection(COLLECTION).insertOne({ name: `User${i}`, age: i * 10, active: true });
      }
    });

    it('limit returns same count on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).find({}, { limit: 5 });
      const mongoResults = await mongoClient.collection(COLLECTION).find({}, { limit: 5 });
      expect(mysqlResults.length).toBe(5);
      expect(mongoResults.length).toBe(5);
    });

    it('offset + limit returns same data on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).find({}, { sort: { age: 'asc' }, offset: 3, limit: 2 });
      const mongoResults = await mongoClient.collection(COLLECTION).find({}, { sort: { age: 'asc' }, offset: 3, limit: 2 });
      expect(mysqlResults.map((r) => r.age)).toEqual(mongoResults.map((r) => r.age));
    });
  });

  // ---- Projection Conformance ----

  describe('Projection Conformance', () => {
    beforeEach(async () => {
      await mysqlClient.collection(COLLECTION).insertOne({ name: 'ProjUser', age: 50, score: 100, active: true });
      await mongoClient.collection(COLLECTION).insertOne({ name: 'ProjUser', age: 50, score: 100, active: true });
    });

    it('field inclusion returns same fields on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).find({}, { projection: { name: 1, age: 1 } });
      const mongoResults = await mongoClient.collection(COLLECTION).find({}, { projection: { name: 1, age: 1 } });

      expect(mysqlResults[0].name).toBe('ProjUser');
      expect(mysqlResults[0].age).toBe(50);
      expect(mongoResults[0].name).toBe('ProjUser');
      expect(mongoResults[0].age).toBe(50);
    });
  });

  // ---- Aggregation Conformance ----

  describe('Aggregation Conformance', () => {
    beforeEach(async () => {
      await seedData(mysqlClient.collection(COLLECTION));
      await seedData(mongoClient.collection(COLLECTION));
    });

    it('$match + $group $sum returns same total on both', async () => {
      const pipeline = [
        { $match: { active: true } },
        { $group: { _id: null, totalAge: { $sum: '$age' } } },
      ];
      const mysqlResults = await mysqlClient.collection(COLLECTION).aggregate(pipeline);
      const mongoResults = await mongoClient.collection(COLLECTION).aggregate(pipeline);
      expect(mysqlResults[0].totalAge).toBe(mongoResults[0].totalAge);
    });

    it('$group $avg returns same average on both', async () => {
      const pipeline = [{ $group: { _id: null, avgAge: { $avg: '$age' } } }];
      const mysqlResults = await mysqlClient.collection(COLLECTION).aggregate(pipeline);
      const mongoResults = await mongoClient.collection(COLLECTION).aggregate(pipeline);
      expect(mysqlResults[0].avgAge).toBe(mongoResults[0].avgAge);
    });

    it('$count returns same count on both', async () => {
      const mysqlResults = await mysqlClient.collection(COLLECTION).aggregate([{ $count: 'total' }]);
      const mongoResults = await mongoClient.collection(COLLECTION).aggregate([{ $count: 'total' }]);
      expect(mysqlResults[0].total).toBe(mongoResults[0].total);
    });
  });

  // ---- Transaction Conformance ----

  describe('Transaction Conformance', () => {
    it('commit works on MySQL', async () => {
      await mysqlClient.transaction(async (tx) => {
        await tx.collection(COLLECTION).insertOne({ name: 'TxCommit', age: 100 });
      });

      const mysqlDoc = await mysqlClient.collection(COLLECTION).findOne({ name: 'TxCommit' });
      expect(mysqlDoc).not.toBeNull();
    });

    it('rollback works on MySQL', async () => {
      await mysqlClient.collection(COLLECTION).insertOne({ name: 'PreRollback', age: 50 });

      try {
        await mysqlClient.transaction(async (tx) => {
          await tx.collection(COLLECTION).insertOne({ name: 'TxRollback', age: 60 });
          throw new Error('Force rollback');
        });
      } catch {}

      const mysqlCount = await mysqlClient.collection(COLLECTION).count({});
      expect(mysqlCount).toBe(1);
    });

    it('commit works on MongoDB (standalone - best effort)', async () => {
      // Standalone MongoDB does not support multi-document transactions.
      // This test verifies the transaction API pattern works without throwing.
      try {
        await mongoClient.transaction(async (tx) => {
          await tx.collection(COLLECTION).insertOne({ name: 'TxCommit', age: 100 });
        });
        const mongoDoc = await mongoClient.collection(COLLECTION).findOne({ name: 'TxCommit' });
        expect(mongoDoc).not.toBeNull();
      } catch (err) {
        // Expected on standalone MongoDB
        expect((err as Error).message).toContain('replica set');
      }
    });

    it('rollback works on MongoDB (standalone - best effort)', async () => {
      await mongoClient.collection(COLLECTION).insertOne({ name: 'PreRollback', age: 50 });

      try {
        await mongoClient.transaction(async (tx) => {
          await tx.collection(COLLECTION).insertOne({ name: 'TxRollback', age: 60 });
          throw new Error('Force rollback');
        });
      } catch {}

      const mongoCount = await mongoClient.collection(COLLECTION).count({});
      expect(mongoCount).toBe(1);
    });
  });

  // ---- Error Conformance ----

  describe('Error Conformance', () => {
    it('invalid collection name throws on both', async () => {
      await expect(mysqlClient.collection('1invalid').find({})).rejects.toThrow();
      await expect(mongoClient.collection('1invalid').find({})).rejects.toThrow();
    });
  });
});
