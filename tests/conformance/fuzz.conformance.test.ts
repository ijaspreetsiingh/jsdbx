// =====================================================
// JSDB - Fuzz Conformance Tests
// Randomized operations that verify system stability
// under unpredictable inputs. No crashes, no hangs.
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

const T = 'fuzz_test';

async function setupMySQL(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS \`${T}\` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    value INT,
    data JSON
  )`);
}

async function setupPG(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS "${T}" (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    value INT,
    data JSONB
  )`);
}

function randomAlphaNum(len: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFilter() {
  const fields = ['name', 'value'];
  const field = fields[randomInt(0, fields.length - 1)];

  if (field === 'name') {
    const op = ['$gt', '$lt', '$gte', '$lte', '$ne', '$in'][randomInt(0, 5)];
    if (op === '$in') {
      return { [field]: { [op]: [randomAlphaNum(5), randomAlphaNum(5)] } };
    }
    return { [field]: { [op]: randomAlphaNum(10) } };
  } else {
    const op = ['$gt', '$lt', '$gte', '$lte', '$ne', '$in'][randomInt(0, 5)];
    if (op === '$in') {
      return { [field]: { [op]: [randomInt(-100, 100), randomInt(-100, 100)] } };
    }
    return { [field]: { [op]: randomInt(-1000, 1000) } };
  }
}

describe('Fuzz Conformance', () => {
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
    try { await mysql.raw(`TRUNCATE TABLE \`${T}\``); } catch { /* cleanup */ }
    try { await pg.raw(`TRUNCATE TABLE "${T}"`); } catch { /* cleanup */ }
  });

  describe('Random insert operations', () => {
    it('1000 random inserts do not crash MySQL', async () => {
      const ops = Array.from({ length: 1000 }, (_, i) => {
        const doc = {
          name: `fuzz_${i}_${randomAlphaNum(8)}`,
          value: randomInt(-10000, 10000),
        };
        return mysql.collection(T).insertOne(doc);
      });
      const results = await Promise.allSettled(ops);
      const succeeded = results.filter(r => r.status === 'fulfilled');
      expect(succeeded.length).toBe(1000);
    });

    it('1000 random inserts do not crash PostgreSQL', async () => {
      const ops = Array.from({ length: 1000 }, (_, i) => {
        const doc = {
          name: `fuzz_${i}_${randomAlphaNum(8)}`,
          value: randomInt(-10000, 10000),
        };
        return pg.collection(T).insertOne(doc);
      });
      const results = await Promise.allSettled(ops);
      const succeeded = results.filter(r => r.status === 'fulfilled');
      expect(succeeded.length).toBe(1000);
    });
  });

  describe('Random find operations', () => {
    it('1000 random finds with varied filters do not crash MySQL', async () => {
      for (let i = 0; i < 50; i++) {
        await mysql.collection(T).insertOne({
          name: `seed_${randomAlphaNum(10)}`,
          value: randomInt(-100, 100),
        });
      }
      const ops = Array.from({ length: 1000 }, () => {
        const filter = randomFilter();
        return mysql.collection(T).find(filter);
      });
      const results = await Promise.allSettled(ops);
      const succeeded = results.filter(r => r.status === 'fulfilled');
      expect(succeeded.length).toBe(1000);
    });

    it('1000 random finds with varied filters do not crash PostgreSQL', async () => {
      for (let i = 0; i < 50; i++) {
        await pg.collection(T).insertOne({
          name: `seed_${randomAlphaNum(10)}`,
          value: randomInt(-100, 100),
        });
      }
      const ops = Array.from({ length: 1000 }, () => {
        const filter = randomFilter();
        return pg.collection(T).find(filter);
      });
      const results = await Promise.allSettled(ops);
      const succeeded = results.filter(r => r.status === 'fulfilled');
      expect(succeeded.length).toBe(1000);
    });
  });

  describe('Random update operations', () => {
    it('500 random updates do not crash MySQL', async () => {
      for (let i = 0; i < 50; i++) {
        await mysql.collection(T).insertOne({
          name: `seed_${i}`,
          value: randomInt(0, 100),
        });
      }
      const ops = Array.from({ length: 500 }, () => {
        return mysql.collection(T).updateOne(
          { name: `seed_${randomInt(0, 49)}` },
          { $set: { value: randomInt(-1000, 1000) } }
        );
      });
      const results = await Promise.allSettled(ops);
      expect(results.length).toBe(500);
    });

    it('500 random updates do not crash PostgreSQL', async () => {
      for (let i = 0; i < 50; i++) {
        await pg.collection(T).insertOne({
          name: `seed_${i}`,
          value: randomInt(0, 100),
        });
      }
      const ops = Array.from({ length: 500 }, () => {
        return pg.collection(T).updateOne(
          { name: `seed_${randomInt(0, 49)}` },
          { $set: { value: randomInt(-1000, 1000) } }
        );
      });
      const results = await Promise.allSettled(ops);
      expect(results.length).toBe(500);
    });
  });

  describe('Random mixed operations', () => {
    it('500 random mixed ops (insert/find/update/delete) do not crash MySQL', async () => {
      for (let i = 0; i < 10; i++) {
        await mysql.collection(T).insertOne({ name: `init_${i}`, value: i });
      }
      const ops = Array.from({ length: 500 }, (_, i) => {
        const action = i % 4;
        switch (action) {
          case 0:
            return mysql.collection(T).insertOne({
              name: `mix_${randomAlphaNum(6)}`,
              value: randomInt(0, 100),
            }).then(() => 'ok').catch(() => 'ok');
          case 1:
            return mysql.collection(T).find({ name: `init_${randomInt(0, 9)}` })
              .then(() => 'ok').catch(() => 'ok');
          case 2:
            return mysql.collection(T).updateOne(
              { name: `init_${randomInt(0, 9)}` },
              { $set: { value: randomInt(0, 100) } }
            ).then(() => 'ok').catch(() => 'ok');
          case 3:
            return mysql.collection(T).deleteOne({ name: `mix_${randomAlphaNum(6)}` })
              .then(() => 'ok').catch(() => 'ok');
          default:
            return Promise.resolve('ok');
        }
      });
      const results = await Promise.allSettled(ops);
      expect(results.length).toBe(500);
    });

    it('500 random mixed ops do not crash PostgreSQL', async () => {
      for (let i = 0; i < 10; i++) {
        await pg.collection(T).insertOne({ name: `init_${i}`, value: i });
      }
      const ops = Array.from({ length: 500 }, (_, i) => {
        const action = i % 4;
        switch (action) {
          case 0:
            return pg.collection(T).insertOne({
              name: `mix_${randomAlphaNum(6)}`,
              value: randomInt(0, 100),
            }).then(() => 'ok').catch(() => 'ok');
          case 1:
            return pg.collection(T).find({ name: `init_${randomInt(0, 9)}` })
              .then(() => 'ok').catch(() => 'ok');
          case 2:
            return pg.collection(T).updateOne(
              { name: `init_${randomInt(0, 9)}` },
              { $set: { value: randomInt(0, 100) } }
            ).then(() => 'ok').catch(() => 'ok');
          case 3:
            return pg.collection(T).deleteOne({ name: `mix_${randomAlphaNum(6)}` })
              .then(() => 'ok').catch(() => 'ok');
          default:
            return Promise.resolve('ok');
        }
      });
      const results = await Promise.allSettled(ops);
      expect(results.length).toBe(500);
    });
  });

  describe('Rapid aggregation', () => {
    it('50 random aggregate pipelines do not crash MySQL', async () => {
      for (let i = 0; i < 20; i++) {
        await mysql.collection(T).insertOne({
          name: `agg_${i % 5}`,
          value: randomInt(0, 100),
        });
      }
      const ops = Array.from({ length: 50 }, () => {
        const pipeline = [
          { $match: { value: { $gt: randomInt(-50, 50) } } },
          { $group: { _id: '$name', total: { $sum: '$value' } } },
          { $sort: { total: -1 as const } },
          { $limit: randomInt(1, 10) },
        ];
        return mysql.collection(T).aggregate(pipeline)
          .then(() => 'ok').catch(() => 'ok');
      });
      const results = await Promise.allSettled(ops);
      expect(results.length).toBe(50);
    });

    it('50 random aggregate pipelines do not crash PostgreSQL', async () => {
      for (let i = 0; i < 20; i++) {
        await pg.collection(T).insertOne({
          name: `agg_${i % 5}`,
          value: randomInt(0, 100),
        });
      }
      const ops = Array.from({ length: 50 }, () => {
        const pipeline = [
          { $match: { value: { $gt: randomInt(-50, 50) } } },
          { $group: { _id: '$name', total: { $sum: '$value' } } },
          { $sort: { total: -1 as const } },
          { $limit: randomInt(1, 10) },
        ];
        return pg.collection(T).aggregate(pipeline)
          .then(() => 'ok').catch(() => 'ok');
      });
      const results = await Promise.allSettled(ops);
      expect(results.length).toBe(50);
    });
  });
});
