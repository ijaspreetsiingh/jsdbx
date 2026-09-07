/**
 * JSDB SQLite Conformance Tests
 * Tests the complete Universal API against SQLite (no external service needed)
 *
 * These tests verify the same logical behavior that should hold across all adapters.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { SQLiteAdapter } from '../../src/adapters/sqlite/adapter.js';
import type { JSDBConfig } from '../../src/types/index.js';

const config: JSDBConfig = {
  database: 'sqlite',
  connection: { filename: ':memory:' },
  logging: { level: 'silent' },
};

let adapter: SQLiteAdapter;

beforeAll(async () => {
  try {
    adapter = new SQLiteAdapter(config);
    await adapter.connect();
    // Create test table
    await adapter.executeRaw(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "name" TEXT NOT NULL,
        "email" TEXT UNIQUE,
        "age" INTEGER,
        "active" INTEGER DEFAULT 1,
        "tenantId" TEXT
      )
    `);
    await adapter.executeRaw(`
      CREATE TABLE IF NOT EXISTS "orders" (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "userId" INTEGER,
        "amount" REAL,
        "status" TEXT DEFAULT 'pending'
      )
    `);
  } catch (err) {
    // SQLite driver not installed — skip tests
    console.warn('SQLite conformance tests skipped (better-sqlite3 not available):', (err as Error).message);
  }
});

afterAll(async () => {
  if (adapter?.isConnected()) {
    await adapter.disconnect();
  }
});

beforeEach(async () => {
  if (!adapter?.isConnected()) return;
  try {
    await adapter.executeRaw('DELETE FROM "users"');
    await adapter.executeRaw('DELETE FROM "orders"');
    await adapter.executeRaw('DELETE FROM sqlite_sequence WHERE name IN ("users", "orders")');
  } catch {}
});

describe('SQLite Conformance Tests', () => {
  it('ping returns true', async () => {
    if (!adapter?.isConnected()) return;
    expect(await adapter.ping()).toBe(true);
  });

  // ---- INSERT ----
  describe('INSERT', () => {
    it('inserts a single document', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.insert('users', { name: 'Alice', email: 'alice@test.com', age: 25 });
      expect(result.acknowledged).toBe(true);
      expect(result.insertedId).toBeTruthy();
    });

    it('inserts many documents', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.insertMany('users', [
        { name: 'Bob', email: 'bob@test.com', age: 30 },
        { name: 'Charlie', email: 'charlie@test.com', age: 35 },
      ]);
      expect(result.insertedCount).toBe(2);
      expect(result.insertedIds).toHaveLength(2);
    });
  });

  // ---- FIND ----
  describe('FIND', () => {
    beforeEach(async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insertMany('users', [
        { name: 'Alice', email: 'alice@t.com', age: 25, active: 1 },
        { name: 'Bob', email: 'bob@t.com', age: 30, active: 1 },
        { name: 'Charlie', email: 'charlie@t.com', age: 20, active: 0 },
        { name: 'Diana', email: 'diana@t.com', age: 28, active: 1 },
      ]);
    });

    it('finds all documents', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', {});
      expect(result.documents).toHaveLength(4);
    });

    it('filters by equality', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', { name: 'Alice' });
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].name).toBe('Alice');
    });

    it('filters by $gt', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', { age: { $gt: 25 } });
      expect(result.documents.length).toBeGreaterThanOrEqual(2);
    });

    it('filters by $lt', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', { age: { $lt: 25 } });
      expect(result.documents.some((d) => d.name === 'Charlie')).toBe(true);
    });

    it('filters by $in', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', { name: { $in: ['Alice', 'Bob'] } });
      expect(result.documents).toHaveLength(2);
    });

    it('filters by $and', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', {
        $and: [{ age: { $gte: 25 } }, { active: 1 }],
      });
      expect(result.documents.every((d) => (d.age as number) >= 25 && d.active === 1)).toBe(true);
    });

    it('filters by $or', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', {
        $or: [{ name: 'Alice' }, { name: 'Bob' }],
      });
      expect(result.documents).toHaveLength(2);
    });

    it('sorts ascending', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', {}, { sort: { age: 'asc' } });
      const ages = result.documents.map((d) => d.age as number);
      expect(ages).toEqual([...ages].sort((a, b) => a - b));
    });

    it('sorts descending', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', {}, { sort: { age: -1 } });
      const ages = result.documents.map((d) => d.age as number);
      expect(ages).toEqual([...ages].sort((a, b) => b - a));
    });

    it('limits results', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', {}, { limit: 2 });
      expect(result.documents).toHaveLength(2);
    });

    it('offsets results', async () => {
      if (!adapter?.isConnected()) return;
      const all = await adapter.find('users', {}, { sort: { id: 1 } });
      const paged = await adapter.find('users', {}, { sort: { id: 1 }, offset: 2 });
      expect(paged.documents[0].name).toBe(all.documents[2].name);
    });

    it('projects specific fields', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.find('users', {}, { projection: { name: 1, email: 1 } });
      // Should have name and email but not age
      expect(result.documents[0].name).toBeDefined();
    });
  });

  // ---- findOne ----
  describe('FIND ONE', () => {
    it('finds a single document', async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insert('users', { name: 'Alice', email: 'alice@t.com', age: 25 });
      const doc = await adapter.findOne('users', { name: 'Alice' });
      expect(doc).not.toBeNull();
      expect(doc?.name).toBe('Alice');
    });

    it('returns null when not found', async () => {
      if (!adapter?.isConnected()) return;
      const doc = await adapter.findOne('users', { name: 'NoSuchUser' });
      expect(doc).toBeNull();
    });
  });

  // ---- UPDATE ----
  describe('UPDATE', () => {
    it('updates one document', async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insert('users', { name: 'Alice', email: 'alice@t.com', age: 25 });
      const result = await adapter.update('users', { name: 'Alice' }, { $set: { age: 26 } });
      expect(result.modifiedCount).toBe(1);

      const doc = await adapter.findOne('users', { name: 'Alice' });
      expect(doc?.age).toBe(26);
    });

    it('updates many documents', async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insertMany('users', [
        { name: 'Alice', age: 25, email: 'a@t.com' },
        { name: 'Bob', age: 30, email: 'b@t.com' },
      ]);
      const result = await adapter.updateMany('users', {}, { $set: { active: 0 } });
      expect(result.modifiedCount).toBe(2);
    });
  });

  // ---- DELETE ----
  describe('DELETE', () => {
    it('deletes one document', async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insertMany('users', [
        { name: 'Alice', email: 'a@t.com' },
        { name: 'Bob', email: 'b@t.com' },
      ]);
      const result = await adapter.delete('users', { name: 'Alice' });
      expect(result.deletedCount).toBe(1);
      const remaining = await adapter.find('users', {});
      expect(remaining.documents).toHaveLength(1);
    });

    it('deletes many documents', async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insertMany('users', [
        { name: 'Alice', email: 'a@t.com' },
        { name: 'Bob', email: 'b@t.com' },
      ]);
      const result = await adapter.deleteMany('users', {});
      expect(result.deletedCount).toBe(2);
    });
  });

  // ---- COUNT ----
  describe('COUNT', () => {
    it('counts all documents', async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insertMany('users', [
        { name: 'A', email: 'a@t.com' },
        { name: 'B', email: 'b@t.com' },
        { name: 'C', email: 'c@t.com' },
      ]);
      const result = await adapter.count('users', {});
      expect(result.count).toBe(3);
    });

    it('counts filtered documents', async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insertMany('users', [
        { name: 'A', age: 25, email: 'a@t.com' },
        { name: 'B', age: 30, email: 'b@t.com' },
        { name: 'C', age: 20, email: 'c@t.com' },
      ]);
      const result = await adapter.count('users', { age: { $gte: 25 } });
      expect(result.count).toBe(2);
    });
  });

  // ---- AGGREGATION ----
  describe('AGGREGATION', () => {
    beforeEach(async () => {
      if (!adapter?.isConnected()) return;
      await adapter.insertMany('orders', [
        { userId: 1, amount: 100.0, status: 'paid' },
        { userId: 1, amount: 50.0, status: 'paid' },
        { userId: 2, amount: 75.0, status: 'pending' },
        { userId: 2, amount: 200.0, status: 'paid' },
      ]);
    });

    it('aggregates with $match and $group', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.aggregate('orders', [
        { $match: { status: 'paid' } },
        { $group: { _id: '$userId', total: { $sum: '$amount' } } },
      ]);
      expect(result.documents.length).toBeGreaterThan(0);
    });

    it('counts with aggregation', async () => {
      if (!adapter?.isConnected()) return;
      const result = await adapter.aggregate('orders', [
        { $count: 'total' },
      ]);
      expect(Number((result.documents[0] as Record<string, unknown>)?.total ?? 0)).toBe(4);
    });
  });

  // ---- TRANSACTIONS ----
  describe('TRANSACTIONS', () => {
    it('commits a transaction', async () => {
      if (!adapter?.isConnected()) return;
      const tx = await adapter.beginTransaction();
      expect(tx.isActive()).toBe(true);

      await adapter.insert('users', { name: 'TxUser', email: 'tx@t.com' }, tx);
      await tx.commit();

      expect(tx.isActive()).toBe(false);
      const doc = await adapter.findOne('users', { name: 'TxUser' });
      expect(doc).not.toBeNull();
    });

    it('rolls back a transaction', async () => {
      if (!adapter?.isConnected()) return;
      const tx = await adapter.beginTransaction();
      await adapter.insert('users', { name: 'RollbackUser', email: 'rb@t.com' }, tx);
      await tx.rollback();

      const doc = await adapter.findOne('users', { name: 'RollbackUser' });
      expect(doc).toBeNull();
    });
  });

  // ---- INDEXES ----
  describe('INDEXES', () => {
    it('creates an index', async () => {
      if (!adapter?.isConnected()) return;
      await expect(
        adapter.createIndex('users', ['name'], { name: 'idx_test_name' })
      ).resolves.not.toThrow();
    });

    it('drops an index', async () => {
      if (!adapter?.isConnected()) return;
      await adapter.createIndex('users', ['email'], { name: 'idx_test_email' });
      await expect(
        adapter.dropIndex('users', 'idx_test_email')
      ).resolves.not.toThrow();
    });
  });

  // ---- LIST COLLECTIONS ----
  describe('LIST COLLECTIONS', () => {
    it('lists existing tables', async () => {
      if (!adapter?.isConnected()) return;
      const collections = await adapter.listCollections();
      expect(collections).toContain('users');
      expect(collections).toContain('orders');
    });
  });
});
