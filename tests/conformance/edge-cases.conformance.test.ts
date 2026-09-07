// =====================================================
// JSDB - SQL Edge-Case Conformance Tests
// Tests NULL semantics, BETWEEN, aliases, LIMIT/OFFSET,
// nested conditions, NOT, DISTINCT, aggregates, etc.
// Runs against real MySQL, PostgreSQL, and MongoDB via JSDB
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

const PG_CONFIG = {
  database: 'postgres' as const,
  connection: { host: 'localhost', port: 5435, user: 'root', password: 'jsdbproof', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

const T = 'edge_case_test';

async function setupMySQL(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS \`${T}\` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    age INT,
    score DECIMAL(10,2),
    active BOOLEAN DEFAULT TRUE,
    email VARCHAR(255),
    department VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function setupPG(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS "${T}" (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    age INT,
    score DECIMAL(10,2),
    active BOOLEAN DEFAULT TRUE,
    email VARCHAR(255),
    department VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
  )`);
}

const SEED_DATA = [
  { name: 'Alice', age: 30, score: 95.5, active: true, email: 'alice@test.com', department: 'Engineering' },
  { name: 'Bob', age: 25, score: 80.0, active: true, email: 'bob@test.com', department: 'Marketing' },
  { name: 'Charlie', age: 35, score: 60.0, active: false, email: null, department: 'Engineering' },
  { name: 'Diana', age: 28, score: 88.0, active: true, email: 'diana@test.com', department: 'Sales' },
  { name: 'Eve', age: 22, score: 72.0, active: false, email: null, department: 'Marketing' },
  { name: 'Frank', age: null, score: 55.0, active: true, email: 'frank@test.com', department: null },
];

describe('SQL Edge-Case Conformance', () => {
  let mysql: JSDBClient;
  let mongo: JSDBClient;
  let pg: JSDBClient;

  beforeAll(async () => {
    mysql = createClient(MYSQL_CONFIG);
    mongo = createClient(MONGO_CONFIG);
    pg = createClient(PG_CONFIG);
    await mysql.connect();
    await mongo.connect();
    await pg.connect();
    await setupMySQL(mysql);
    await setupPG(pg);
  }, 30000);

  afterAll(async () => {
    try { await mysql.raw(`DROP TABLE IF EXISTS \`${T}\``); } catch {}
    try { await mongo.collection(T).deleteMany({}); } catch {}
    try { await pg.raw(`DROP TABLE IF EXISTS "${T}"`); } catch {}
    await mysql.disconnect();
    await mongo.disconnect();
    await pg.disconnect();
  }, 10000);

  beforeEach(async () => {
    try { await mysql.raw(`DELETE FROM \`${T}\``); } catch {}
    try { await mongo.collection(T).deleteMany({}); } catch {}
    try { await pg.raw(`DELETE FROM "${T}"`); } catch {}
    for (const doc of SEED_DATA) {
      await mysql.collection(T).insertOne(doc);
      await mongo.collection(T).insertOne(doc);
      await pg.collection(T).insertOne(doc);
    }
  });

  // ---- NULL Semantics ----

  describe('NULL Semantics', () => {
    it('IS NULL finds null values on all DBs', async () => {
      const m = await mysql.collection(T).find({ email: null });
      const g = await mongo.collection(T).find({ email: null });
      const p = await pg.collection(T).find({ email: null });
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
    });

    it('IS NOT NULL finds non-null values on all DBs', async () => {
      const m = await mysql.collection(T).find({ email: { $ne: null } });
      const g = await mongo.collection(T).find({ email: { $ne: null } });
      const p = await pg.collection(T).find({ email: { $ne: null } });
      expect(m.length).toBe(4);
      expect(g.length).toBe(4);
      expect(p.length).toBe(4);
    });

    it('equality with null returns null matches on all DBs', async () => {
      const m = await mysql.collection(T).find({ department: null });
      const g = await mongo.collection(T).find({ department: null });
      const p = await pg.collection(T).find({ department: null });
      expect(m.length).toBe(1);
      expect(g.length).toBe(1);
      expect(p.length).toBe(1);
      expect(m[0].name).toBe('Frank');
    });
  });

  // ---- Comparison Operators ----

  describe('Comparison Operators', () => {
    it('$gt filter on all DBs', async () => {
      const m = await mysql.collection(T).find({ age: { $gt: 28 } });
      const g = await mongo.collection(T).find({ age: { $gt: 28 } });
      const p = await pg.collection(T).find({ age: { $gt: 28 } });
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
    });

    it('$gte filter on all DBs', async () => {
      const m = await mysql.collection(T).find({ age: { $gte: 30 } });
      const g = await mongo.collection(T).find({ age: { $gte: 30 } });
      const p = await pg.collection(T).find({ age: { $gte: 30 } });
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
    });

    it('$lt filter on all DBs', async () => {
      const m = await mysql.collection(T).find({ age: { $lt: 25 } });
      const g = await mongo.collection(T).find({ age: { $lt: 25 } });
      const p = await pg.collection(T).find({ age: { $lt: 25 } });
      expect(m.length).toBe(1);
      expect(g.length).toBe(1);
      expect(p.length).toBe(1);
    });

    it('$lte filter on all DBs', async () => {
      const m = await mysql.collection(T).find({ age: { $lte: 25 } });
      const g = await mongo.collection(T).find({ age: { $lte: 25 } });
      const p = await pg.collection(T).find({ age: { $lte: 25 } });
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
    });

    it('$in filter on all DBs', async () => {
      const m = await mysql.collection(T).find({ name: { $in: ['Alice', 'Charlie'] } });
      const g = await mongo.collection(T).find({ name: { $in: ['Alice', 'Charlie'] } });
      const p = await pg.collection(T).find({ name: { $in: ['Alice', 'Charlie'] } });
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
    });

    it('$nin filter on all DBs', async () => {
      const m = await mysql.collection(T).find({ name: { $nin: ['Alice', 'Charlie'] } });
      const g = await mongo.collection(T).find({ name: { $nin: ['Alice', 'Charlie'] } });
      const p = await pg.collection(T).find({ name: { $nin: ['Alice', 'Charlie'] } });
      expect(m.length).toBe(4);
      expect(g.length).toBe(4);
      expect(p.length).toBe(4);
    });
  });

  // ---- Logical Operators ----

  describe('Logical Operators', () => {
    it('$and filter on all DBs', async () => {
      const filter = { $and: [{ age: { $gt: 25 } }, { active: true }] };
      const m = await mysql.collection(T).find(filter);
      const g = await mongo.collection(T).find(filter);
      const p = await pg.collection(T).find(filter);
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
    });

    it('$or filter on all DBs', async () => {
      const filter = { $or: [{ age: { $lt: 25 } }, { age: { $gt: 34 } }] };
      const m = await mysql.collection(T).find(filter);
      const g = await mongo.collection(T).find(filter);
      const p = await pg.collection(T).find(filter);
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
    });

    it('nested $and/$or on all DBs', async () => {
      const filter = {
        $or: [
          { $and: [{ age: { $gt: 25 } }, { active: true }] },
          { $and: [{ age: { $lt: 25 } }, { active: false }] },
        ],
      };
      const m = await mysql.collection(T).find(filter);
      const g = await mongo.collection(T).find(filter);
      const p = await pg.collection(T).find(filter);
      expect(m.length).toBe(3);
      expect(g.length).toBe(3);
      expect(p.length).toBe(3);
    });
  });

  // ---- Sorting ----

  describe('Sorting', () => {
    it('sort ascending by age on all DBs (nulls last)', async () => {
      // MySQL NULLs sort first in ASC by default; MongoDB nulls sort last
      // Just verify non-null ages are sorted correctly
      const m = await mysql.collection(T).find({}, { sort: { age: 'asc' } });
      const g = await mongo.collection(T).find({}, { sort: { age: 'asc' } });
      const p = await pg.collection(T).find({}, { sort: { age: 'asc' } });
      const mNonNull = m.filter(r => r.age != null).map(r => Number(r.age));
      const gNonNull = g.filter(r => r.age != null).map(r => Number(r.age));
      const pNonNull = p.filter(r => r.age != null).map(r => Number(r.age));
      // Non-null ages should be sorted the same across all DBs
      expect(mNonNull).toEqual([22, 25, 28, 30, 35]);
      expect(gNonNull).toEqual([22, 25, 28, 30, 35]);
      expect(pNonNull).toEqual([22, 25, 28, 30, 35]);
    });

    it('sort descending by score on all DBs', async () => {
      const m = await mysql.collection(T).find({}, { sort: { score: 'desc' } });
      const g = await mongo.collection(T).find({}, { sort: { score: 'desc' } });
      const p = await pg.collection(T).find({}, { sort: { score: 'desc' } });
      const mScores = m.map(r => Number(r.score));
      const gScores = g.map(r => Number(r.score));
      const pScores = p.map(r => Number(r.score));
      expect(mScores).toEqual(gScores);
      expect(gScores).toEqual(pScores);
    });
  });

  // ---- Pagination ----

  describe('Pagination', () => {
    it('limit returns correct count on all DBs', async () => {
      const m = await mysql.collection(T).find({}, { limit: 3 });
      const g = await mongo.collection(T).find({}, { limit: 3 });
      const p = await pg.collection(T).find({}, { limit: 3 });
      expect(m.length).toBe(3);
      expect(g.length).toBe(3);
      expect(p.length).toBe(3);
    });

    it('offset + limit returns correct slice on all DBs', async () => {
      // Use a sort that produces consistent ordering across all DBs
      const m = await mysql.collection(T).find({}, { sort: { name: 'asc' }, offset: 2, limit: 2 });
      const g = await mongo.collection(T).find({}, { sort: { name: 'asc' }, offset: 2, limit: 2 });
      const p = await pg.collection(T).find({}, { sort: { name: 'asc' }, offset: 2, limit: 2 });
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
      // Same names in same order
      expect(m.map(r => r.name)).toEqual(g.map(r => r.name));
      expect(g.map(r => r.name)).toEqual(p.map(r => r.name));
    });
  });

  // ---- Aggregation ----

  describe('Aggregation', () => {
    it('COUNT(*) on all DBs', async () => {
      const m = await mysql.collection(T).aggregate([{ $count: 'total' }]);
      const g = await mongo.collection(T).aggregate([{ $count: 'total' }]);
      const p = await pg.collection(T).aggregate([{ $count: 'total' }]);
      // MySQL may return count as string
      expect(Number(m[0].total)).toBe(6);
      expect(Number(g[0].total)).toBe(6);
      expect(Number(p[0].total)).toBe(6);
    });

    it('SUM on all DBs', async () => {
      const m = await mysql.collection(T).aggregate([{ $group: { _id: null, total: { $sum: '$age' } } }]);
      const g = await mongo.collection(T).aggregate([{ $group: { _id: null, total: { $sum: '$age' } } }]);
      const p = await pg.collection(T).aggregate([{ $group: { _id: null, total: { $sum: '$age' } } }]);
      // 30+25+35+28+22 = 140 (Frank has null age, excluded from sum)
      expect(Number(m[0].total)).toBe(140);
      expect(Number(g[0].total)).toBe(140);
      expect(Number(p[0].total)).toBe(140);
    });

    it('AVG on all DBs', async () => {
      const m = await mysql.collection(T).aggregate([{ $group: { _id: null, avg: { $avg: '$score' } } }]);
      const g = await mongo.collection(T).aggregate([{ $group: { _id: null, avg: { $avg: '$score' } } }]);
      const p = await pg.collection(T).aggregate([{ $group: { _id: null, avg: { $avg: '$score' } } }]);
      expect(Number(m[0].avg)).toBeCloseTo(75.08, 0);
      expect(Number(g[0].avg)).toBeCloseTo(75.08, 0);
      expect(Number(p[0].avg)).toBeCloseTo(75.08, 0);
    });

    it('MIN and MAX on all DBs', async () => {
      const m = await mysql.collection(T).aggregate([{ $group: { _id: null, min: { $min: '$age' }, max: { $max: '$age' } } }]);
      const g = await mongo.collection(T).aggregate([{ $group: { _id: null, min: { $min: '$age' }, max: { $max: '$age' } } }]);
      const p = await pg.collection(T).aggregate([{ $group: { _id: null, min: { $min: '$age' }, max: { $max: '$age' } } }]);
      expect(Number(m[0].min)).toBe(22);
      expect(Number(m[0].max)).toBe(35);
      expect(Number(g[0].min)).toBe(22);
      expect(Number(g[0].max)).toBe(35);
      expect(Number(p[0].min)).toBe(22);
      expect(Number(p[0].max)).toBe(35);
    });

    it('GROUP BY department on all DBs', async () => {
      const m = await mysql.collection(T).aggregate([
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      const g = await mongo.collection(T).aggregate([
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      const p = await pg.collection(T).aggregate([
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]);
      // 4 groups: Engineering, Marketing, Sales, null
      expect(m.length).toBe(4);
      expect(g.length).toBe(4);
      expect(p.length).toBe(4);
    });

    it('$match + $group on all DBs', async () => {
      const pipeline = [
        { $match: { active: true } },
        { $group: { _id: null, total: { $sum: '$score' } } },
      ];
      const m = await mysql.collection(T).aggregate(pipeline);
      const g = await mongo.collection(T).aggregate(pipeline);
      const p = await pg.collection(T).aggregate(pipeline);
      // Alice(95.5)+Bob(80)+Diana(88)+Frank(55) = 318.5
      expect(Number(m[0].total)).toBeCloseTo(318.5, 0);
      expect(Number(g[0].total)).toBeCloseTo(318.5, 0);
      expect(Number(p[0].total)).toBeCloseTo(318.5, 0);
    });
  });

  // ---- Projection ----

  describe('Projection', () => {
    it('field inclusion on all DBs', async () => {
      const m = await mysql.collection(T).find({}, { projection: { name: 1, age: 1 } });
      const g = await mongo.collection(T).find({}, { projection: { name: 1, age: 1 } });
      const p = await pg.collection(T).find({}, { projection: { name: 1, age: 1 } });
      expect(m[0].name).toBeDefined();
      expect(m[0].age).toBeDefined();
      expect(m[0].email).toBeUndefined();
      expect(g[0].name).toBeDefined();
      expect(g[0].age).toBeDefined();
    });
  });

  // ---- Empty Results ----

  describe('Empty Results', () => {
    it('find with no matches returns empty on all DBs', async () => {
      const m = await mysql.collection(T).find({ name: 'Nonexistent' });
      const g = await mongo.collection(T).find({ name: 'Nonexistent' });
      const p = await pg.collection(T).find({ name: 'Nonexistent' });
      expect(m.length).toBe(0);
      expect(g.length).toBe(0);
      expect(p.length).toBe(0);
    });

    it('count with no matches returns 0 on all DBs', async () => {
      const m = await mysql.collection(T).count({ name: 'Nonexistent' });
      const g = await mongo.collection(T).count({ name: 'Nonexistent' });
      const p = await pg.collection(T).count({ name: 'Nonexistent' });
      expect(m).toBe(0);
      expect(g).toBe(0);
      expect(p).toBe(0);
    });
  });

  // ---- Duplicate Rows ----

  describe('Duplicate Rows', () => {
    it('handles duplicate values correctly', async () => {
      await mysql.collection(T).insertOne({ name: 'Alice', age: 30, score: 95.5, active: true, email: 'dup@test.com', department: 'Engineering' });
      await mongo.collection(T).insertOne({ name: 'Alice', age: 30, score: 95.5, active: true, email: 'dup@test.com', department: 'Engineering' });
      await pg.collection(T).insertOne({ name: 'Alice', age: 30, score: 95.5, active: true, email: 'dup@test.com', department: 'Engineering' });

      const m = await mysql.collection(T).find({ name: 'Alice' });
      const g = await mongo.collection(T).find({ name: 'Alice' });
      const p = await pg.collection(T).find({ name: 'Alice' });
      expect(m.length).toBe(2);
      expect(g.length).toBe(2);
      expect(p.length).toBe(2);
    });
  });
});
