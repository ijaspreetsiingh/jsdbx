// =============================================================
// JSDB COMPATIBILITY MATRIX TEST
// =============================================================
// Tests ALL input drivers against ALL target databases.
//
// INPUT DRIVERS:
//   mysql2 proxy  — SQL with ? params
//   pg proxy      — SQL with $1 $2 params
//   sqlite-sql    — SQLite-dialect SQL (via mysql2 proxy)
//   mongodb proxy — MongoDB-native API
//   mongoose proxy— Mongoose ORM API
//
// TARGET DATABASES (all in-memory, no external services):
//   sqlite, mysql, postgres, mongodb
//   (all backed by MemoryAdapter; target label affects
//    capability registry + compiler selection on real DBs)
//
// HOW ISOLATION WORKS:
//   Each describe() group creates a fresh MemoryAdapter and
//   calls setSharedAdapter() in beforeAll, then calls
//   resetSharedAdapter() in afterAll. Groups run sequentially
//   (singleFork: true) so there is no cross-contamination.
//
// COMPATIBILITY LEVELS:
//   [EXACT]       — Driver format maps 1:1 to IR; no translation
//   [TRANSLATED]  — SQL or Mongo query parsed to Universal IR
//   [EMULATED]    — IR executed via fallback/two-step strategy
//   [PARTIAL]     — Works for simple cases; known edge-case limits
//   [UNSUPPORTED] — Cannot safely execute; throws or returns empty
// =============================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MemoryAdapter } from '../../../src/adapters/memory/adapter.js';
import { setSharedAdapter, resetSharedAdapter } from '../../../src/compat/core.js';
import type { JSDBConfig } from '../../../src/types/index.js';

// ── driver proxy imports ────────────────────────────────────────
import mysql2Compat from '../../../src/compat/mysql2.js';
import { Pool as PgPool } from '../../../src/compat/pg.js';
import { MongoClient } from '../../../src/compat/mongodb.js';
import mongooseLib from '../../../src/compat/mongoose.js';

type TargetDb = 'sqlite' | 'mysql' | 'postgres' | 'mongodb';

// ── Adapter factory ─────────────────────────────────────────────
function makeAdapter(db: TargetDb): MemoryAdapter {
  return new MemoryAdapter({ database: db === 'mysql' ? 'sqlite' : db } as JSDBConfig);
}

// ── mysql2 pool helper ──────────────────────────────────────────
type M2PromisePool = ReturnType<ReturnType<typeof mysql2Compat.createPool>['promise']>;

function makeMysql2Pool(): M2PromisePool {
  return mysql2Compat.createPool({}).promise();
}

// Shorthand: run a mysql2 query and return rows array
async function q(pool: M2PromisePool, sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  const [rows] = await pool.query(sql, params);
  return rows as Record<string, unknown>[];
}

// ── pg pool helper ──────────────────────────────────────────────
async function pgq(pool: PgPool, sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
  const result = await pool.query(sql, params);
  return result.rows;
}

// =============================================================
// SCHEMA + SEED helpers (shared across SQL driver groups)
// =============================================================
const SCHEMA_SQLS = [
  `CREATE TABLE IF NOT EXISTS vendors (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     country TEXT NOT NULL,
     rating REAL DEFAULT 0,
     is_active INTEGER DEFAULT 1,
     email TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS products (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     vendor_id INTEGER NOT NULL,
     sku TEXT NOT NULL,
     name TEXT NOT NULL,
     category TEXT NOT NULL,
     price REAL NOT NULL,
     stock INTEGER DEFAULT 0,
     is_active INTEGER DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS customers (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     email TEXT UNIQUE NOT NULL,
     country TEXT NOT NULL,
     balance REAL DEFAULT 0,
     tier TEXT DEFAULT 'standard'
   )`,
  `CREATE TABLE IF NOT EXISTS orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     customer_id INTEGER NOT NULL,
     status TEXT DEFAULT 'pending',
     total REAL DEFAULT 0,
     currency TEXT DEFAULT 'USD'
   )`,
];

async function setupSqlSchema(pool: M2PromisePool): Promise<void> {
  for (const sql of SCHEMA_SQLS) await pool.query(sql);
}

async function seedSqlData(pool: M2PromisePool): Promise<void> {
  // vendors
  await pool.query("INSERT INTO vendors (name, country, rating, is_active, email) VALUES (?, ?, ?, ?, ?)", ['Acme', 'US', 4.5, 1, 'acme@corp.com']);
  await pool.query("INSERT INTO vendors (name, country, rating, is_active, email) VALUES (?, ?, ?, ?, ?)", ['TechCo', 'DE', 4.8, 1, 'tech@co.de']);
  await pool.query("INSERT INTO vendors (name, country, rating, is_active, email) VALUES (?, ?, ?, ?, ?)", ['OldInc', 'JP', 2.0, 0, null]);
  // products
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", [1, 'P001', 'Laptop', 'Electronics', 1299.99, 50, 1]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", [1, 'P002', 'Mouse', 'Electronics', 29.99, 200, 1]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", [2, 'P003', 'Server', 'Infra', 2499.99, 10, 1]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", [2, 'P004', 'Switch', 'Infra', 399.99, 30, 1]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)", [3, 'P005', 'Widget', 'Misc', 9.99, 5, 0]);
  // customers
  await pool.query("INSERT INTO customers (name, email, country, balance, tier) VALUES (?, ?, ?, ?, ?)", ['MegaCorp', 'mc@corp.com', 'US', 0, 'enterprise']);
  await pool.query("INSERT INTO customers (name, email, country, balance, tier) VALUES (?, ?, ?, ?, ?)", ['StartupXYZ', 'hi@xyz.io', 'US', 2500, 'premium']);
  await pool.query("INSERT INTO customers (name, email, country, balance, tier) VALUES (?, ?, ?, ?, ?)", ['GlobalBank', 'gb@bank.eu', 'EU', 0, 'enterprise']);
  await pool.query("INSERT INTO customers (name, email, country, balance, tier) VALUES (?, ?, ?, ?, ?)", ['SmallShop', 'ss@shop.com', 'US', 500, 'standard']);
  // orders
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES (?, ?, ?, ?)", [1, 'completed', 2807.98, 'USD']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES (?, ?, ?, ?)", [2, 'pending', 431.99, 'USD']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES (?, ?, ?, ?)", [1, 'completed', 430.99, 'USD']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES (?, ?, ?, ?)", [3, 'processing', 5399.98, 'EUR']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES (?, ?, ?, ?)", [4, 'cancelled', 32.39, 'USD']);
}

async function setupPgSchema(pool: PgPool): Promise<void> {
  for (const sql of SCHEMA_SQLS) await pool.query(sql);
}
async function seedPgData(pool: PgPool): Promise<void> {
  await pool.query("INSERT INTO vendors (name, country, rating, is_active, email) VALUES ($1,$2,$3,$4,$5)", ['Acme', 'US', 4.5, 1, 'acme@corp.com']);
  await pool.query("INSERT INTO vendors (name, country, rating, is_active, email) VALUES ($1,$2,$3,$4,$5)", ['TechCo', 'DE', 4.8, 1, 'tech@co.de']);
  await pool.query("INSERT INTO vendors (name, country, rating, is_active, email) VALUES ($1,$2,$3,$4,$5)", ['OldInc', 'JP', 2.0, 0, null]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7)", [1, 'P001', 'Laptop', 'Electronics', 1299.99, 50, 1]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7)", [1, 'P002', 'Mouse', 'Electronics', 29.99, 200, 1]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7)", [2, 'P003', 'Server', 'Infra', 2499.99, 10, 1]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7)", [2, 'P004', 'Switch', 'Infra', 399.99, 30, 1]);
  await pool.query("INSERT INTO products (vendor_id, sku, name, category, price, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7)", [3, 'P005', 'Widget', 'Misc', 9.99, 5, 0]);
  await pool.query("INSERT INTO customers (name, email, country, balance, tier) VALUES ($1,$2,$3,$4,$5)", ['MegaCorp', 'mc@corp.com', 'US', 0, 'enterprise']);
  await pool.query("INSERT INTO customers (name, email, country, balance, tier) VALUES ($1,$2,$3,$4,$5)", ['StartupXYZ', 'hi@xyz.io', 'US', 2500, 'premium']);
  await pool.query("INSERT INTO customers (name, email, country, balance, tier) VALUES ($1,$2,$3,$4,$5)", ['GlobalBank', 'gb@bank.eu', 'EU', 0, 'enterprise']);
  await pool.query("INSERT INTO customers (name, email, country, balance, tier) VALUES ($1,$2,$3,$4,$5)", ['SmallShop', 'ss@shop.com', 'US', 500, 'standard']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES ($1,$2,$3,$4)", [1, 'completed', 2807.98, 'USD']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES ($1,$2,$3,$4)", [2, 'pending', 431.99, 'USD']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES ($1,$2,$3,$4)", [1, 'completed', 430.99, 'USD']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES ($1,$2,$3,$4)", [3, 'processing', 5399.98, 'EUR']);
  await pool.query("INSERT INTO orders (customer_id, status, total, currency) VALUES ($1,$2,$3,$4)", [4, 'cancelled', 32.39, 'USD']);
}

// =============================================================
// SQL DRIVER SUITE — runs same assertions for mysql2 + pg
// =============================================================

function runSqlSuite(
  label: string,
  targetDb: TargetDb,
  opts: {
    usePg?: boolean;
  } = {},
) {
  describe(`[${label}] → [${targetDb.toUpperCase()}]`, () => {
    let adapter: MemoryAdapter;
    let m2pool: M2PromisePool;
    let pgpool: PgPool;

    beforeAll(async () => {
      adapter = makeAdapter(targetDb);
      setSharedAdapter(adapter, { database: targetDb } as JSDBConfig);
      await adapter.connect();

      if (opts.usePg) {
        pgpool = new PgPool({});
        await setupPgSchema(pgpool);
        await seedPgData(pgpool);
      } else {
        m2pool = makeMysql2Pool();
        await setupSqlSchema(m2pool);
        await seedSqlData(m2pool);
      }
    }, 20000);

    afterAll(async () => {
      await adapter.disconnect();
      resetSharedAdapter();
    });

    const R = (pool: M2PromisePool | null, pgPool: PgPool | null, sql: string, params?: unknown[]) =>
      opts.usePg ? pgq(pgPool!, sql, params) : q(pool!, sql, params);

    // ── CRUD ─────────────────────────────────────────────────────

    it('[TRANSLATED] SELECT * WHERE is_active=1', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM vendors WHERE is_active = ?', [1]);
      expect(rows.length).toBe(2);
    });

    it('[TRANSLATED] SELECT by id', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM vendors WHERE id = ?', [1]);
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe('Acme');
    });

    it('[TRANSLATED] INSERT then SELECT', async () => {
      const insertSql = opts.usePg
        ? 'INSERT INTO vendors (name, country, rating, is_active) VALUES ($1,$2,$3,$4)'
        : 'INSERT INTO vendors (name, country, rating, is_active) VALUES (?,?,?,?)';
      await R(m2pool ?? null, pgpool ?? null, insertSql, ['NewVendor', 'AU', 3.5, 1]);
      const rows = await R(m2pool ?? null, pgpool ?? null, "SELECT * FROM vendors WHERE name = 'NewVendor'");
      expect(rows.length).toBe(1);
    });

    it('[TRANSLATED] UPDATE SET field', async () => {
      const sql = opts.usePg
        ? 'UPDATE vendors SET rating = $1 WHERE id = $2'
        : 'UPDATE vendors SET rating = ? WHERE id = ?';
      await R(m2pool ?? null, pgpool ?? null, sql, [4.9, 1]);
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT rating FROM vendors WHERE id = ?', [1]);
      expect(Number(rows[0].rating)).toBeCloseTo(4.9, 1);
    });

    it('[TRANSLATED] DELETE WHERE', async () => {
      const insertSql = opts.usePg
        ? "INSERT INTO vendors (name, country, rating, is_active) VALUES ($1,$2,$3,$4)"
        : "INSERT INTO vendors (name, country, rating, is_active) VALUES (?,?,?,?)";
      await R(m2pool ?? null, pgpool ?? null, insertSql, ['ToDelete', 'ZZ', 1.0, 0]);
      await R(m2pool ?? null, pgpool ?? null, "DELETE FROM vendors WHERE name = 'ToDelete'");
      const rows = await R(m2pool ?? null, pgpool ?? null, "SELECT * FROM vendors WHERE name = 'ToDelete'");
      expect(rows.length).toBe(0);
    });

    // ── Filtering ─────────────────────────────────────────────────

    it('[TRANSLATED] WHERE AND compound', async () => {
      const sql = opts.usePg
        ? "SELECT * FROM products WHERE category = $1 AND is_active = $2"
        : "SELECT * FROM products WHERE category = ? AND is_active = ?";
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, ['Electronics', 1]);
      expect(rows.length).toBe(2); // Laptop, Mouse
    });

    it('[TRANSLATED] WHERE price < ? (less-than)', async () => {
      const sql = opts.usePg ? 'SELECT * FROM products WHERE price < $1' : 'SELECT * FROM products WHERE price < ?';
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, [100]);
      expect(rows.every(r => Number(r.price) < 100)).toBe(true);
    });

    it('[TRANSLATED] BETWEEN operator', async () => {
      const sql = opts.usePg
        ? 'SELECT * FROM products WHERE price BETWEEN $1 AND $2 AND is_active = $3'
        : 'SELECT * FROM products WHERE price BETWEEN ? AND ? AND is_active = ?';
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, [100, 1500, 1]);
      expect(rows.every(r => Number(r.price) >= 100 && Number(r.price) <= 1500)).toBe(true);
    });

    it('[TRANSLATED] IS NULL', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM vendors WHERE email IS NULL');
      expect(rows.length).toBeGreaterThanOrEqual(1); // OldInc + any INSERTs without email
    });

    it('[TRANSLATED] IS NOT NULL', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM vendors WHERE email IS NOT NULL');
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it('[TRANSLATED] LIKE wildcard', async () => {
      const sql = opts.usePg ? "SELECT * FROM products WHERE name LIKE $1" : "SELECT * FROM products WHERE name LIKE ?";
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, ['%Lap%']);
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe('Laptop');
    });

    it('[TRANSLATED] IN list', async () => {
      const sql = opts.usePg
        ? "SELECT * FROM customers WHERE tier IN ($1, $2)"
        : "SELECT * FROM customers WHERE tier IN (?, ?)";
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, ['enterprise', 'premium']);
      expect(rows.length).toBe(3);
    });

    it('[TRANSLATED] NOT IN list', async () => {
      const sql = opts.usePg
        ? "SELECT * FROM orders WHERE status NOT IN ($1, $2)"
        : "SELECT * FROM orders WHERE status NOT IN (?, ?)";
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, ['cancelled', 'pending']);
      expect(rows.every(r => r.status !== 'cancelled' && r.status !== 'pending')).toBe(true);
    });

    it('[TRANSLATED] OR condition', async () => {
      const sql = opts.usePg
        ? "SELECT * FROM customers WHERE country = $1 OR balance > $2"
        : "SELECT * FROM customers WHERE country = ? OR balance > ?";
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, ['EU', 1000]);
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    // ── Sorting + Pagination ──────────────────────────────────────

    it('[TRANSLATED] ORDER BY ASC', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM products WHERE is_active = 1 ORDER BY price ASC', []);
      const prices = rows.map(r => Number(r.price));
      for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
    });

    it('[TRANSLATED] ORDER BY DESC', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM products WHERE is_active = 1 ORDER BY price DESC', []);
      const prices = rows.map(r => Number(r.price));
      for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeLessThanOrEqual(prices[i - 1]);
    });

    it('[TRANSLATED] LIMIT ? OFFSET ? pagination', async () => {
      const allRows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC');
      const sql = opts.usePg
        ? 'SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC LIMIT $1 OFFSET $2'
        : 'SELECT * FROM products WHERE is_active = 1 ORDER BY id ASC LIMIT ? OFFSET ?';
      const page = await R(m2pool ?? null, pgpool ?? null, sql, [2, 1]);
      expect(page.length).toBe(2);
      // Page starts at offset 1
      expect(page[0].id ?? page[0].sku).toEqual(allRows[1].id ?? allRows[1].sku);
    });

    it('[TRANSLATED] ORDER BY + LIMIT top N', async () => {
      const sql = opts.usePg
        ? 'SELECT * FROM orders ORDER BY total DESC LIMIT $1'
        : 'SELECT * FROM orders ORDER BY total DESC LIMIT ?';
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, [3]);
      expect(rows.length).toBe(3);
      const totals = rows.map(r => Number(r.total));
      for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    });

    // ── Aggregates ────────────────────────────────────────────────

    it('[TRANSLATED] COUNT(*) total', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT COUNT(*) AS cnt FROM vendors');
      expect(Number(rows[0].cnt)).toBeGreaterThanOrEqual(3);
    });

    it('[TRANSLATED] COUNT(*) GROUP BY', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT status, COUNT(*) AS cnt FROM orders GROUP BY status');
      expect(rows.length).toBeGreaterThanOrEqual(4); // completed, pending, processing, cancelled
    });

    it('[TRANSLATED] SUM GROUP BY', async () => {
      const rows = await R(
        m2pool ?? null, pgpool ?? null,
        "SELECT customer_id, SUM(total) AS revenue FROM orders WHERE status = 'completed' GROUP BY customer_id ORDER BY revenue DESC",
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(Number(rows[0].revenue)).toBeGreaterThan(0);
    });

    it('[TRANSLATED] AVG / MIN / MAX', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT AVG(total) AS avg_v, MIN(total) AS min_v, MAX(total) AS max_v FROM orders');
      const r = rows[0];
      expect(Number(r.avg_v)).toBeGreaterThan(0);
      expect(Number(r.max_v)).toBeGreaterThan(Number(r.min_v));
    });

    it('[TRANSLATED] GROUP BY category AVG price', async () => {
      const rows = await R(
        m2pool ?? null, pgpool ?? null,
        'SELECT category, COUNT(*) AS cnt, AVG(price) AS avg_price FROM products WHERE is_active = 1 GROUP BY category',
      );
      expect(rows.length).toBeGreaterThanOrEqual(2);
    });

    it('[TRANSLATED] SUM + COUNT on invoices-style query', async () => {
      const rows = await R(
        m2pool ?? null, pgpool ?? null,
        "SELECT SUM(total) AS total_unpaid, COUNT(*) AS cnt FROM orders WHERE status != 'completed'",
      );
      expect(Number(rows[0].cnt)).toBeGreaterThanOrEqual(3);
    });

    // ── Subqueries ────────────────────────────────────────────────

    it('[EMULATED] WHERE IN (SELECT ...)', async () => {
      const rows = await R(
        m2pool ?? null, pgpool ?? null,
        "SELECT * FROM customers WHERE id IN (SELECT customer_id FROM orders WHERE status = 'completed')",
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    // ── Bulk operations ───────────────────────────────────────────

    it('[TRANSLATED] Bulk INSERT via loop', async () => {
      const insertSql = opts.usePg
        ? 'INSERT INTO vendors (name, country, rating, is_active) VALUES ($1,$2,$3,$4)'
        : 'INSERT INTO vendors (name, country, rating, is_active) VALUES (?,?,?,?)';
      await R(m2pool ?? null, pgpool ?? null, insertSql, ['BulkA', 'IN', 3.0, 1]);
      await R(m2pool ?? null, pgpool ?? null, insertSql, ['BulkB', 'IN', 3.5, 1]);
      await R(m2pool ?? null, pgpool ?? null, insertSql, ['BulkC', 'IN', 4.0, 1]);
      const rows = await R(m2pool ?? null, pgpool ?? null, "SELECT * FROM vendors WHERE country = 'IN'");
      expect(rows.length).toBe(3);
    });

    it('[TRANSLATED] Bulk UPDATE via IN list', async () => {
      await R(
        m2pool ?? null, pgpool ?? null,
        opts.usePg ? 'UPDATE products SET is_active = $1 WHERE id IN ($2, $3)' : 'UPDATE products SET is_active = ? WHERE id IN (?, ?)',
        [1, 1, 2],
      );
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM products WHERE id IN (1, 2)');
      expect(rows.every(r => Number(r.is_active) === 1)).toBe(true);
    });

    it('[TRANSLATED] Bulk DELETE', async () => {
      await R(m2pool ?? null, pgpool ?? null, "DELETE FROM vendors WHERE country = 'IN'");
      const rows = await R(m2pool ?? null, pgpool ?? null, "SELECT * FROM vendors WHERE country = 'IN'");
      expect(rows.length).toBe(0);
    });

    // ── Transactions ──────────────────────────────────────────────

    it('[TRANSLATED] Transaction commit persists', async () => {
      if (opts.usePg) {
        const client = await pgpool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            'INSERT INTO orders (customer_id, status, total) VALUES ($1,$2,$3)',
            [1, 'pending', 199.99],
          );
          await client.query('COMMIT');
        } finally {
          client.release();
        }
      } else {
        const conn = await m2pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query('INSERT INTO orders (customer_id, status, total) VALUES (?,?,?)', [1, 'pending', 199.99]);
          await conn.commit();
        } finally {
          conn.release();
        }
      }
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT COUNT(*) AS cnt FROM orders');
      expect(Number(rows[0].cnt)).toBeGreaterThan(5);
    });

    it('[TRANSLATED] Transaction rollback (API does not throw)', async () => {
      if (opts.usePg) {
        const client = await pgpool.connect();
        try {
          await client.query('BEGIN');
          await client.query('INSERT INTO orders (customer_id, status, total) VALUES ($1,$2,$3)', [1, 'pending', 9999]);
          await client.query('ROLLBACK');
        } finally {
          client.release();
        }
      } else {
        const conn = await m2pool.getConnection();
        try {
          await conn.beginTransaction();
          await conn.query('INSERT INTO orders (customer_id, status, total) VALUES (?,?,?)', [1, 'pending', 9999]);
          await conn.rollback();
        } finally {
          conn.release();
        }
      }
      expect(true).toBe(true); // API must not throw
    });

    // ── NULL handling ─────────────────────────────────────────────

    it('[TRANSLATED] NULL in query result', async () => {
      const rows = await R(m2pool ?? null, pgpool ?? null, 'SELECT * FROM vendors WHERE email IS NULL');
      expect(rows.length).toBeGreaterThanOrEqual(1);
      expect(rows[0].email === null || rows[0].email === undefined).toBe(true);
    });

    // ── Concurrent queries ────────────────────────────────────────

    it('[TRANSLATED] Concurrent SELECT queries', async () => {
      const [vRows, pRows, cRows, oRows] = await Promise.all([
        R(m2pool ?? null, pgpool ?? null, 'SELECT COUNT(*) AS cnt FROM vendors'),
        R(m2pool ?? null, pgpool ?? null, 'SELECT COUNT(*) AS cnt FROM products'),
        R(m2pool ?? null, pgpool ?? null, 'SELECT COUNT(*) AS cnt FROM customers'),
        R(m2pool ?? null, pgpool ?? null, 'SELECT COUNT(*) AS cnt FROM orders'),
      ]);
      expect(Number(vRows[0].cnt)).toBeGreaterThanOrEqual(2);
      expect(Number(pRows[0].cnt)).toBeGreaterThanOrEqual(4);
      expect(Number(cRows[0].cnt)).toBeGreaterThanOrEqual(4);
      expect(Number(oRows[0].cnt)).toBeGreaterThanOrEqual(5);
    });

    // ── SQL injection safety ──────────────────────────────────────

    it('[EXACT] SQL injection parameterized — returns 0 rows', async () => {
      const sql = opts.usePg ? 'SELECT * FROM customers WHERE email = $1' : 'SELECT * FROM customers WHERE email = ?';
      const rows = await R(m2pool ?? null, pgpool ?? null, sql, ["' OR 1=1; DROP TABLE customers; --"]);
      expect(rows.length).toBe(0);
      const check = await R(m2pool ?? null, pgpool ?? null, 'SELECT COUNT(*) AS cnt FROM customers');
      expect(Number(check[0].cnt)).toBeGreaterThan(0);
    });

    // ── Error handling ────────────────────────────────────────────

    it('[EXACT] Invalid SQL throws', async () => {
      let threw = false;
      try {
        await R(m2pool ?? null, pgpool ?? null, 'THIS IS NOT SQL AT ALL ###');
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });

    // ── pg-specific: $N params ────────────────────────────────────

    if (opts.usePg) {
      it('[EXACT][pg] $1 positional params normalised to ?', async () => {
        const rows = await pgq(pgpool, 'SELECT * FROM vendors WHERE id = $1', [1]);
        expect(rows.length).toBe(1);
      });

      it('[EXACT][pg] $1 $2 $3 multi-param', async () => {
        const rows = await pgq(pgpool, 'SELECT * FROM products WHERE category = $1 AND is_active = $2 ORDER BY price LIMIT $3', ['Electronics', 1, 5]);
        expect(rows.length).toBeLessThanOrEqual(5);
      });
    }
  });
}

// =============================================================
// MONGODB DRIVER SUITE
// =============================================================

function runMongodriverSuite(label: string, targetDb: TargetDb) {
  describe(`[${label}] → [${targetDb.toUpperCase()}]`, () => {
    let adapter: MemoryAdapter;
    let mongoDb: ReturnType<InstanceType<typeof MongoClient>['db']>;

    beforeAll(async () => {
      adapter = makeAdapter(targetDb);
      setSharedAdapter(adapter, { database: targetDb } as JSDBConfig);
      await adapter.connect();

      const client = new MongoClient('mongodb://localhost/test');
      await client.connect();
      mongoDb = client.db('erp');

      // Seed
      await mongoDb.collection('mv_vendors').drop().catch(() => {});
      await mongoDb.collection('mv_products').drop().catch(() => {});
      await mongoDb.collection('mv_customers').drop().catch(() => {});
      await mongoDb.collection('mv_orders').drop().catch(() => {});

      await mongoDb.collection('mv_vendors').insertMany([
        { _id: '1', name: 'Acme', country: 'US', rating: 4.5, is_active: true, email: 'acme@corp.com' },
        { _id: '2', name: 'TechCo', country: 'DE', rating: 4.8, is_active: true, email: 'tech@co.de' },
        { _id: '3', name: 'OldInc', country: 'JP', rating: 2.0, is_active: false, email: null },
      ]);
      await mongoDb.collection('mv_products').insertMany([
        { _id: '1', vendor_id: '1', sku: 'P001', name: 'Laptop', category: 'Electronics', price: 1299.99, stock: 50, is_active: true },
        { _id: '2', vendor_id: '1', sku: 'P002', name: 'Mouse', category: 'Electronics', price: 29.99, stock: 200, is_active: true },
        { _id: '3', vendor_id: '2', sku: 'P003', name: 'Server', category: 'Infra', price: 2499.99, stock: 10, is_active: true },
        { _id: '4', vendor_id: '2', sku: 'P004', name: 'Switch', category: 'Infra', price: 399.99, stock: 30, is_active: true },
        { _id: '5', vendor_id: '3', sku: 'P005', name: 'Widget', category: 'Misc', price: 9.99, stock: 5, is_active: false },
      ]);
      await mongoDb.collection('mv_customers').insertMany([
        { _id: '1', name: 'MegaCorp', email: 'mc@corp.com', country: 'US', balance: 0, tier: 'enterprise' },
        { _id: '2', name: 'StartupXYZ', email: 'hi@xyz.io', country: 'US', balance: 2500, tier: 'premium' },
        { _id: '3', name: 'GlobalBank', email: 'gb@bank.eu', country: 'EU', balance: 0, tier: 'enterprise' },
        { _id: '4', name: 'SmallShop', email: 'ss@shop.com', country: 'US', balance: 500, tier: 'standard' },
      ]);
      await mongoDb.collection('mv_orders').insertMany([
        { _id: '1', customer_id: '1', status: 'completed', total: 2807.98, currency: 'USD' },
        { _id: '2', customer_id: '2', status: 'pending', total: 431.99, currency: 'USD' },
        { _id: '3', customer_id: '1', status: 'completed', total: 430.99, currency: 'USD' },
        { _id: '4', customer_id: '3', status: 'processing', total: 5399.98, currency: 'EUR' },
        { _id: '5', customer_id: '4', status: 'cancelled', total: 32.39, currency: 'USD' },
      ]);
    }, 20000);

    afterAll(async () => {
      await adapter.disconnect();
      resetSharedAdapter();
    });

    const vendors = () => mongoDb.collection('mv_vendors');
    const products = () => mongoDb.collection('mv_products');
    const customers = () => mongoDb.collection('mv_customers');
    const orders = () => mongoDb.collection('mv_orders');

    // ── CRUD ─────────────────────────────────────────────────────

    it('[EXACT] find({ is_active: true })', async () => {
      const docs = await vendors().find({ is_active: true }).toArray();
      expect(docs.length).toBe(2);
    });

    it('[EXACT] findOne by _id', async () => {
      const doc = await vendors().findOne({ _id: '1' });
      expect(doc).not.toBeNull();
      expect((doc as Record<string, unknown>).name).toBe('Acme');
    });

    it('[EXACT] insertOne then findOne', async () => {
      await vendors().insertOne({ _id: '99', name: 'NewVendor', country: 'AU', rating: 3.5, is_active: true });
      const doc = await vendors().findOne({ name: 'NewVendor' });
      expect(doc).not.toBeNull();
    });

    it('[EXACT] updateOne $set', async () => {
      const r = await vendors().updateOne({ _id: '1' }, { $set: { rating: 4.9 } });
      expect(r.matchedCount).toBe(1);
      const doc = await vendors().findOne({ _id: '1' });
      expect(Number((doc as Record<string, unknown>).rating)).toBeCloseTo(4.9, 1);
    });

    it('[EXACT] deleteOne', async () => {
      await vendors().insertOne({ _id: '98', name: 'ToDelete', country: 'XX', is_active: false });
      const r = await vendors().deleteOne({ _id: '98' });
      expect(r.deletedCount).toBe(1);
    });

    // ── Filtering ─────────────────────────────────────────────────

    it('[EXACT] $eq field filter', async () => {
      const docs = await products().find({ category: 'Electronics', is_active: true }).toArray();
      expect(docs.length).toBe(2);
    });

    it('[EXACT] $lt filter', async () => {
      const docs = await products().find({ price: { $lt: 100 } }).toArray();
      expect(docs.every((d) => Number(d.price) < 100)).toBe(true);
    });

    it('[EXACT] $gte $lte range', async () => {
      const docs = await products().find({ price: { $gte: 100, $lte: 1500 }, is_active: true }).toArray();
      expect(docs.every((d) => Number(d.price) >= 100 && Number(d.price) <= 1500)).toBe(true);
    });

    it('[EXACT] $in filter', async () => {
      const docs = await customers().find({ tier: { $in: ['enterprise', 'premium'] } }).toArray();
      expect(docs.length).toBe(3);
    });

    it('[EXACT] $nin filter', async () => {
      const docs = await orders().find({ status: { $nin: ['cancelled', 'pending'] } }).toArray();
      expect(docs.every((d) => d.status !== 'cancelled' && d.status !== 'pending')).toBe(true);
    });

    it('[EXACT] $gt filter', async () => {
      const docs = await customers().find({ balance: { $gt: 0 } }).toArray();
      expect(docs.every((d) => Number(d.balance) > 0)).toBe(true);
    });

    it('[EXACT] null equality', async () => {
      const docs = await vendors().find({ email: null }).toArray();
      expect(docs.length).toBeGreaterThanOrEqual(1);
    });

    it('[EXACT] $regex filter', async () => {
      const docs = await products().find({ name: { $regex: 'lap', $options: 'i' } }).toArray();
      expect(docs.length).toBe(1);
    });

    it('[EXACT] $and compound', async () => {
      const docs = await customers().find({ $and: [{ country: 'US' }, { balance: { $gt: 100 } }] }).toArray();
      expect(docs.every((d) => d.country === 'US' && Number(d.balance) > 100)).toBe(true);
    });

    it('[EXACT] $or compound', async () => {
      const docs = await customers().find({ $or: [{ country: 'EU' }, { balance: { $gt: 1000 } }] }).toArray();
      expect(docs.length).toBeGreaterThanOrEqual(2);
    });

    // ── Sorting + Pagination ──────────────────────────────────────

    it('[EXACT] sort ascending', async () => {
      const docs = await products().find({ is_active: true }).sort({ price: 1 }).toArray();
      const prices = docs.map((d) => Number(d.price));
      for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
    });

    it('[EXACT] sort descending + limit', async () => {
      const docs = await orders().find({}).sort({ total: -1 }).limit(3).toArray();
      expect(docs.length).toBe(3);
      const totals = docs.map((d) => Number(d.total));
      for (let i = 1; i < totals.length; i++) expect(totals[i]).toBeLessThanOrEqual(totals[i - 1]);
    });

    // ── Aggregates ────────────────────────────────────────────────

    it('[EXACT] $group $sum count by status', async () => {
      const docs = await orders().aggregate([
        { $group: { _id: '$status', cnt: { $sum: 1 } } },
        { $sort: { cnt: -1 } },
      ]).toArray();
      expect(docs.length).toBeGreaterThanOrEqual(4);
    });

    it('[EXACT] $match + $group $sum revenue', async () => {
      const docs = await orders().aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: '$customer_id', total_revenue: { $sum: '$total' }, cnt: { $sum: 1 } } },
        { $sort: { total_revenue: -1 } },
      ]).toArray();
      expect(docs.length).toBeGreaterThanOrEqual(1);
      expect(Number(docs[0].total_revenue ?? 0)).toBeGreaterThan(0);
    });

    it('[EXACT] $group _id=null AVG/MIN/MAX', async () => {
      const docs = await orders().aggregate([
        { $group: { _id: null, avg_v: { $avg: '$total' }, min_v: { $min: '$total' }, max_v: { $max: '$total' } } },
      ]).toArray();
      const d = docs[0];
      expect(Number(d.avg_v)).toBeGreaterThan(0);
      expect(Number(d.max_v)).toBeGreaterThan(Number(d.min_v));
    });

    it('[EXACT] $match + $group category stats', async () => {
      const docs = await products().aggregate([
        { $match: { is_active: true } },
        { $group: { _id: '$category', count: { $sum: 1 }, avg_price: { $avg: '$price' } } },
      ]).toArray();
      expect(docs.length).toBeGreaterThanOrEqual(2);
    });

    it('[EXACT] $count stage', async () => {
      const docs = await orders().aggregate([
        { $match: { status: 'completed' } },
        { $count: 'completed_count' },
      ]).toArray();
      expect(Number(docs[0].completed_count ?? 0)).toBe(2);
    });

    // ── Bulk ─────────────────────────────────────────────────────

    it('[EXACT] insertMany + countDocuments', async () => {
      await mongoDb.collection('mv_logs').insertMany([
        { action: 'create', entity: 'order' },
        { action: 'update', entity: 'product' },
        { action: 'delete', entity: 'vendor' },
      ]);
      const cnt = await mongoDb.collection('mv_logs').countDocuments({ action: 'create' });
      expect(cnt).toBe(1);
    });

    it('[EXACT] updateMany $set', async () => {
      const r = await products().updateMany({ category: 'Electronics' }, { $set: { is_active: true } });
      expect(r.modifiedCount).toBeGreaterThanOrEqual(1);
    });

    it('[EXACT] deleteMany', async () => {
      await mongoDb.collection('mv_temp').insertMany([
        { tag: 'cleanup', val: 1 },
        { tag: 'cleanup', val: 2 },
      ]);
      const r = await mongoDb.collection('mv_temp').deleteMany({ tag: 'cleanup' });
      expect(r.deletedCount).toBe(2);
    });

    // ── Concurrent ───────────────────────────────────────────────

    it('[EXACT] Concurrent countDocuments', async () => {
      const [vc, pc, cc, oc] = await Promise.all([
        vendors().countDocuments(),
        products().countDocuments(),
        customers().countDocuments(),
        orders().countDocuments(),
      ]);
      expect(vc).toBeGreaterThanOrEqual(2);
      expect(pc).toBeGreaterThanOrEqual(4);
      expect(cc).toBeGreaterThanOrEqual(4);
      expect(oc).toBeGreaterThanOrEqual(5);
    });
  });
}

// =============================================================
// MONGOOSE SUITE
// =============================================================

function runMongooseSuite(label: string, targetDb: TargetDb) {
  describe(`[${label}] → [${targetDb.toUpperCase()}]`, () => {
    let adapter: MemoryAdapter;
    const mongoose = mongooseLib;
    let Vendor: ReturnType<typeof mongoose.model>;
    let Order: ReturnType<typeof mongoose.model>;

    beforeAll(async () => {
      adapter = makeAdapter(targetDb);
      setSharedAdapter(adapter, { database: targetDb } as JSDBConfig);
      await adapter.connect();
      await mongoose.connect('mongodb://localhost/test_matrix');

      const VendorSchema = new (mongooseLib.Schema as unknown as new (def: Record<string, unknown>) => InstanceType<typeof mongooseLib.Schema>)({
        name: String, country: String, rating: Number, is_active: Boolean, email: String,
      });
      const OrderSchema = new (mongooseLib.Schema as unknown as new (def: Record<string, unknown>) => InstanceType<typeof mongooseLib.Schema>)({
        customer_id: String, status: String, total: Number, currency: String,
      });

      try { Vendor = mongoose.model('mg_vendor'); } catch {
        Vendor = mongoose.model('mg_vendor', VendorSchema as Parameters<typeof mongoose.model>[1]);
      }
      try { Order = mongoose.model('mg_order'); } catch {
        Order = mongoose.model('mg_order', OrderSchema as Parameters<typeof mongoose.model>[1]);
      }

      // Seed
      await Vendor.deleteMany({});
      await Order.deleteMany({});

      await Vendor.create({ name: 'Acme', country: 'US', rating: 4.5, is_active: true, email: 'acme@corp.com' } as Record<string, unknown>);
      await Vendor.create({ name: 'TechCo', country: 'DE', rating: 4.8, is_active: true, email: 'tech@co.de' } as Record<string, unknown>);
      await Vendor.create({ name: 'OldInc', country: 'JP', rating: 2.0, is_active: false } as Record<string, unknown>);

      await Order.create({ customer_id: '1', status: 'completed', total: 2807.98, currency: 'USD' } as Record<string, unknown>);
      await Order.create({ customer_id: '2', status: 'pending', total: 431.99, currency: 'USD' } as Record<string, unknown>);
      await Order.create({ customer_id: '1', status: 'completed', total: 430.99, currency: 'USD' } as Record<string, unknown>);
      await Order.create({ customer_id: '3', status: 'processing', total: 5399.98, currency: 'EUR' } as Record<string, unknown>);
      await Order.create({ customer_id: '4', status: 'cancelled', total: 32.39, currency: 'USD' } as Record<string, unknown>);
    }, 20000);

    afterAll(async () => {
      await mongoose.disconnect();
      await adapter.disconnect();
      resetSharedAdapter();
    });

    it('[TRANSLATED] Model.find({}) all docs', async () => {
      const docs = await Vendor.find({}) as Record<string, unknown>[];
      expect(docs.length).toBe(3);
    });

    it('[TRANSLATED] Model.find({ field: value })', async () => {
      const docs = await Vendor.find({ is_active: true }) as Record<string, unknown>[];
      expect(docs.length).toBe(2);
    });

    it('[TRANSLATED] Model.find $gt', async () => {
      const docs = await Vendor.find({ rating: { $gt: 4.0 } }) as Record<string, unknown>[];
      expect(docs.every((d) => Number(d.rating) > 4.0)).toBe(true);
    });

    it('[TRANSLATED] Model.findOne()', async () => {
      const doc = await Vendor.findOne({ country: 'US' }) as Record<string, unknown> | null;
      expect(doc).not.toBeNull();
      expect(doc!.country).toBe('US');
    });

    it('[TRANSLATED] Model.countDocuments()', async () => {
      const count = await Vendor.countDocuments({});
      expect(count).toBe(3);
    });

    it('[TRANSLATED] Model.updateOne $set', async () => {
      const r = await Vendor.updateOne({ country: 'US' }, { $set: { rating: 4.95 } } as Record<string, unknown>);
      expect(r.matchedCount).toBeGreaterThanOrEqual(1);
    });

    it('[TRANSLATED] Model.deleteOne()', async () => {
      await Vendor.create({ name: 'TempVendor', country: 'ZZ', rating: 1.0, is_active: false } as Record<string, unknown>);
      const r = await Vendor.deleteOne({ country: 'ZZ' });
      expect(r.deletedCount).toBe(1);
    });

    it('[TRANSLATED] Model.aggregate $group $sum', async () => {
      const docs = await Order.aggregate([
        { $group: { _id: '$status', cnt: { $sum: 1 } } },
      ]) as unknown as Record<string, unknown>[];
      expect(Array.isArray(docs)).toBe(true);
      expect(docs.length).toBeGreaterThanOrEqual(4);
    });

    it('[TRANSLATED] Model.aggregate $match + $group revenue', async () => {
      const docs = await Order.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: '$customer_id', total: { $sum: '$total' } } },
      ]) as unknown as Record<string, unknown>[];
      expect(docs.length).toBeGreaterThanOrEqual(1);
    });

    it('[TRANSLATED] Model.insertMany()', async () => {
      const r = await Vendor.insertMany([
        { name: 'BulkV1', country: 'BR', rating: 3.0, is_active: true },
        { name: 'BulkV2', country: 'BR', rating: 3.5, is_active: true },
      ] as Record<string, unknown>[]);
      expect(r.length).toBe(2);
    });

    it('[TRANSLATED] Model.deleteMany()', async () => {
      const r = await Vendor.deleteMany({ country: 'BR' });
      expect(r.deletedCount).toBe(2);
    });

    it('[TRANSLATED] Model.find $in', async () => {
      const docs = await Order.find({ status: { $in: ['completed', 'pending'] } }) as Record<string, unknown>[];
      expect(docs.every((d) => ['completed', 'pending'].includes(d.status as string))).toBe(true);
    });

    it('[TRANSLATED] Model.find $ne', async () => {
      const docs = await Order.find({ status: { $ne: 'cancelled' } }) as Record<string, unknown>[];
      expect(docs.every((d) => d.status !== 'cancelled')).toBe(true);
    });

    it('[TRANSLATED] doc.save() updates', async () => {
      const doc = await Vendor.create({ name: 'SaveTest', country: 'IT', rating: 3.0, is_active: true } as Record<string, unknown>) as Record<string, unknown> & { rating: number; save(): Promise<void> };
      doc.rating = 5.0;
      await doc.save();
      const refetched = await Vendor.findOne({ name: 'SaveTest' }) as Record<string, unknown> | null;
      expect(Number(refetched?.rating)).toBeCloseTo(5.0, 1);
    });

    it('[TRANSLATED] Model.exists()', async () => {
      const exists = await Vendor.exists({ country: 'DE' });
      expect(exists).not.toBeNull();
    });
  });
}

// =============================================================
// WIRE UP ALL 20 MATRIX CELLS
// =============================================================

const SQL_TARGETS: TargetDb[] = ['sqlite', 'mysql', 'postgres', 'mongodb'];
const MONGO_TARGETS: TargetDb[] = ['mongodb', 'mysql', 'postgres', 'sqlite'];

describe('JSDB Compatibility Matrix', () => {

  describe('── GROUP 1: mysql2 driver ──────────────────────────────────', () => {
    for (const target of SQL_TARGETS) {
      runSqlSuite('mysql2', target, {});
    }
  });

  describe('── GROUP 2: pg driver ($1 $2 params) ───────────────────────', () => {
    for (const target of SQL_TARGETS) {
      runSqlSuite('pg', target, { usePg: true });
    }
  });

  describe('── GROUP 3: SQLite-dialect SQL (via mysql2 proxy) ───────────', () => {
    // SQLite SQL dialect = AUTOINCREMENT, same ? params — mysql2 proxy handles it
    for (const target of SQL_TARGETS) {
      runSqlSuite('sqlite-sql', target, {});
    }
  });

  describe('── GROUP 4: MongoDB driver API ──────────────────────────────', () => {
    for (const target of MONGO_TARGETS) {
      runMongodriverSuite('mongodb-driver', target);
    }
  });

  describe('── GROUP 5: Mongoose ORM API ─────────────────────────────────', () => {
    for (const target of MONGO_TARGETS) {
      runMongooseSuite('mongoose', target);
    }
  });
});
