// =====================================================
// JSDB - Transaction Conformance Tests
// Tests BEGIN/COMMIT/ROLLBACK on MySQL and PostgreSQL
// MongoDB transaction tests are skipped (needs replica set)
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

const T = 'txn_test';

async function setupMySQL(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS \`${T}\` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    balance DECIMAL(12,2) DEFAULT 0.00
  )`);
}

async function setupPG(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS "${T}" (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    balance DECIMAL(12,2) DEFAULT 0.00
  )`);
}

describe('Transaction Conformance', () => {
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

  describe('COMMIT', () => {
    it('INSERT persists after COMMIT on MySQL', async () => {
      await mysql.transaction(async (ctx) => {
        await ctx.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      });
      const result = await mysql.collection(T).find({ name: 'Alice' });
      expect(result.length).toBe(1);
      expect(Number(result[0].balance)).toBe(1000);
    });

    it('INSERT persists after COMMIT on PostgreSQL', async () => {
      await pg.transaction(async (ctx) => {
        await ctx.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      });
      const result = await pg.collection(T).find({ name: 'Alice' });
      expect(result.length).toBe(1);
      expect(Number(result[0].balance)).toBe(1000);
    });

    it('UPDATE persists after COMMIT on MySQL', async () => {
      await mysql.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      await mysql.transaction(async (ctx) => {
        await ctx.collection(T).updateOne(
          { name: 'Alice' },
          { $set: { balance: 1500 } }
        );
      });
      const result = await mysql.collection(T).findOne({ name: 'Alice' });
      expect(Number(result.balance)).toBe(1500);
    });

    it('UPDATE persists after COMMIT on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      await pg.transaction(async (ctx) => {
        await ctx.collection(T).updateOne(
          { name: 'Alice' },
          { $set: { balance: 1500 } }
        );
      });
      const result = await pg.collection(T).findOne({ name: 'Alice' });
      expect(Number(result.balance)).toBe(1500);
    });

    it('DELETE persists after COMMIT on MySQL', async () => {
      await mysql.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      await mysql.transaction(async (ctx) => {
        await ctx.collection(T).deleteOne({ name: 'Alice' });
      });
      const result = await mysql.collection(T).find({ name: 'Alice' });
      expect(result.length).toBe(0);
    });

    it('DELETE persists after COMMIT on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      await pg.transaction(async (ctx) => {
        await ctx.collection(T).deleteOne({ name: 'Alice' });
      });
      const result = await pg.collection(T).find({ name: 'Alice' });
      expect(result.length).toBe(0);
    });
  });

  describe('ROLLBACK', () => {
    it('INSERT is discarded after ROLLBACK on MySQL', async () => {
      try {
        await mysql.transaction(async (ctx) => {
          await ctx.collection(T).insertOne({ name: 'Bob', balance: 2000 });
          throw new Error('abort');
        });
      } catch {}
      const result = await mysql.collection(T).find({ name: 'Bob' });
      expect(result.length).toBe(0);
    });

    it('INSERT is discarded after ROLLBACK on PostgreSQL', async () => {
      try {
        await pg.transaction(async (ctx) => {
          await ctx.collection(T).insertOne({ name: 'Bob', balance: 2000 });
          throw new Error('abort');
        });
      } catch {}
      const result = await pg.collection(T).find({ name: 'Bob' });
      expect(result.length).toBe(0);
    });

    it('UPDATE is discarded after ROLLBACK on MySQL', async () => {
      await mysql.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      try {
        await mysql.transaction(async (ctx) => {
          await ctx.collection(T).updateOne(
            { name: 'Alice' },
            { $set: { balance: 9999 } }
          );
          throw new Error('abort');
        });
      } catch {}
      const result = await mysql.collection(T).findOne({ name: 'Alice' });
      expect(Number(result.balance)).toBe(1000);
    });

    it('UPDATE is discarded after ROLLBACK on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      try {
        await pg.transaction(async (ctx) => {
          await ctx.collection(T).updateOne(
            { name: 'Alice' },
            { $set: { balance: 9999 } }
          );
          throw new Error('abort');
        });
      } catch {}
      const result = await pg.collection(T).findOne({ name: 'Alice' });
      expect(Number(result.balance)).toBe(1000);
    });

    it('DELETE is discarded after ROLLBACK on MySQL', async () => {
      await mysql.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      try {
        await mysql.transaction(async (ctx) => {
          await ctx.collection(T).deleteOne({ name: 'Alice' });
          throw new Error('abort');
        });
      } catch {}
      const result = await mysql.collection(T).find({ name: 'Alice' });
      expect(result.length).toBe(1);
    });

    it('DELETE is discarded after ROLLBACK on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      try {
        await pg.transaction(async (ctx) => {
          await ctx.collection(T).deleteOne({ name: 'Alice' });
          throw new Error('abort');
        });
      } catch {}
      const result = await pg.collection(T).find({ name: 'Alice' });
      expect(result.length).toBe(1);
    });
  });

  describe('Multi-operation transactions', () => {
    it('INSERT + UPDATE in same transaction on MySQL', async () => {
      await mysql.transaction(async (ctx) => {
        await ctx.collection(T).insertOne({ name: 'Alice', balance: 1000 });
        await ctx.collection(T).updateOne(
          { name: 'Alice' },
          { $set: { balance: 1500 } }
        );
      });
      const result = await mysql.collection(T).findOne({ name: 'Alice' });
      expect(Number(result.balance)).toBe(1500);
    });

    it('INSERT + UPDATE in same transaction on PostgreSQL', async () => {
      await pg.transaction(async (ctx) => {
        await ctx.collection(T).insertOne({ name: 'Alice', balance: 1000 });
        await ctx.collection(T).updateOne(
          { name: 'Alice' },
          { $set: { balance: 1500 } }
        );
      });
      const result = await pg.collection(T).findOne({ name: 'Alice' });
      expect(Number(result.balance)).toBe(1500);
    });

    it('INSERT + DELETE in same transaction on MySQL', async () => {
      await mysql.transaction(async (ctx) => {
        await ctx.collection(T).insertOne({ name: 'Temp', balance: 100 });
        await ctx.collection(T).deleteOne({ name: 'Temp' });
      });
      const result = await mysql.collection(T).find({ name: 'Temp' });
      expect(result.length).toBe(0);
    });

    it('INSERT + DELETE in same transaction on PostgreSQL', async () => {
      await pg.transaction(async (ctx) => {
        await ctx.collection(T).insertOne({ name: 'Temp', balance: 100 });
        await ctx.collection(T).deleteOne({ name: 'Temp' });
      });
      const result = await pg.collection(T).find({ name: 'Temp' });
      expect(result.length).toBe(0);
    });
  });

  describe('Transaction isolation', () => {
    it('uncommitted changes not visible to other connections on MySQL', async () => {
      await mysql.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      await mysql.transaction(async (ctx) => {
        await ctx.collection(T).updateOne(
          { name: 'Alice' },
          { $set: { balance: 9999 } }
        );
        // Before commit, other connection should see old value
        const outside = await mysql.collection(T).findOne({ name: 'Alice' });
        expect(Number(outside.balance)).toBe(1000);
      });
      // After commit, should see new value
      const after = await mysql.collection(T).findOne({ name: 'Alice' });
      expect(Number(after.balance)).toBe(9999);
    });

    it('uncommitted changes not visible to other connections on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ name: 'Alice', balance: 1000 });
      await pg.transaction(async (ctx) => {
        await ctx.collection(T).updateOne(
          { name: 'Alice' },
          { $set: { balance: 9999 } }
        );
        const outside = await pg.collection(T).findOne({ name: 'Alice' });
        expect(Number(outside.balance)).toBe(1000);
      });
      const after = await pg.collection(T).findOne({ name: 'Alice' });
      expect(Number(after.balance)).toBe(9999);
    });
  });
});
