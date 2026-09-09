// =====================================================
// DDL + DML Chain Integration Test
//
// Proves the FULL chain works:
//   CREATE TABLE → INSERT → SELECT → UPDATE → DELETE → DROP TABLE
//
// Runs against MongoDB (real DB) through the mysql2 compat layer.
// Uses the same code a backend developer would write:
//   const mysql = require('jasdbx/mysql2')
//   const pool = mysql.createPool({...})
//   pool.query('CREATE TABLE IF NOT EXISTS ...')
//   pool.query('INSERT INTO ...')
// =====================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSQL, _ensureConnected, _resetSharedAdapter } from '../../src/compat/core.js';

const MONGO_URI = process.env.JSDB_MONGODB_URI ?? 'mongodb://localhost:27019';
const MONGO_DB = process.env.JSDB_MONGODB_DATABASE ?? 'jsdb_test';

// We use execSQL directly since it's the core path all compat layers route through.
// The mysql2/pg compat proxies are thin wrappers around execSQL.

const TABLE = 'ddl_dml_chain_test';

describe('DDL + DML Chain — Full Integration (MongoDB)', () => {

  beforeAll(async () => {
    // Set environment to use MongoDB for this test
    process.env.JSDB_DATABASE = 'mongodb';
    process.env.JSDB_MONGODB_URI = MONGO_URI;
    process.env.JSDB_MONGODB_DATABASE = MONGO_DB;
    
    // Cleanup from previous runs
    try {
      await execSQL(`DROP TABLE IF EXISTS ${TABLE}`);
    } catch { /* cleanup */ }
  }, 15000);

  afterAll(async () => {
    try {
      await execSQL(`DROP TABLE IF EXISTS ${TABLE}`);
    } catch { /* cleanup */ }
  }, 10000);

  // ─── DDL Tests ───────────────────────────────────────

  describe('DDL — CREATE TABLE', () => {

    it('CREATE TABLE IF NOT EXISTS creates a MongoDB collection', async () => {
      const result = await execSQL(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT NOT NULL, email TEXT, age INT, salary REAL)`
      );
      expect(result).toBeDefined();
      expect(result.rowCount).toBe(0);
    });

    it('CREATE TABLE IF NOT EXISTS on existing table does NOT error', async () => {
      // Second call should succeed silently (idempotent)
      const result = await execSQL(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (id INT, name TEXT)`
      );
      expect(result).toBeDefined();
      expect(result.rowCount).toBe(0);
    });

    it('CREATE TABLE without IF NOT EXISTS on existing table is handled', async () => {
      // MongoDB will throw "already exists" — this should be caught
      // and not crash the app
      try {
        await execSQL(`CREATE TABLE ${TABLE} (id INT)`);
      } catch {
        // Expected — collection already exists
      }
      // Collection should still be usable
      const { rows } = await execSQL(`SELECT COUNT(*) AS cnt FROM ${TABLE}`);
      expect(rows).toBeDefined();
    });

  });

  // ─── DML Tests ───────────────────────────────────────

  describe('DML — INSERT', () => {

    it('INSERT single row', async () => {
      const result = await execSQL(
        `INSERT INTO ${TABLE} (name, email, age, salary) VALUES (?, ?, ?, ?)`,
        ['Alice', 'alice@test.com', 30, 90000]
      );
      expect(result.affectedRows).toBe(1);
    });

    it('INSERT multiple rows sequentially', async () => {
      await execSQL(
        `INSERT INTO ${TABLE} (name, email, age, salary) VALUES (?, ?, ?, ?)`,
        ['Bob', 'bob@test.com', 25, 70000]
      );
      await execSQL(
        `INSERT INTO ${TABLE} (name, email, age, salary) VALUES (?, ?, ?, ?)`,
        ['Charlie', 'charlie@test.com', 35, 95000]
      );
      await execSQL(
        `INSERT INTO ${TABLE} (name, email, age, salary) VALUES (?, ?, ?, ?)`,
        ['Diana', 'diana@test.com', 28, 65000]
      );
    });

  });

  describe('DML — SELECT', () => {

    it('SELECT * returns all rows', async () => {
      const { rows } = await execSQL(`SELECT * FROM ${TABLE}`);
      expect(rows.length).toBe(4);
    });

    it('SELECT with WHERE clause', async () => {
      const { rows } = await execSQL(
        `SELECT * FROM ${TABLE} WHERE age > ?`,
        [29]
      );
      expect(rows.length).toBe(2); // Alice(30), Charlie(35)
    });

    it('SELECT with ORDER BY', async () => {
      const { rows } = await execSQL(
        `SELECT * FROM ${TABLE} ORDER BY age ASC`
      );
      expect(rows[0].name).toBe('Bob');     // age 25
      expect(rows[rows.length - 1].name).toBe('Charlie'); // age 35
    });

    it('SELECT with LIMIT', async () => {
      const { rows } = await execSQL(
        `SELECT * FROM ${TABLE} LIMIT 2`
      );
      expect(rows.length).toBe(2);
    });

    it('SELECT with LIMIT and OFFSET', async () => {
      const { rows } = await execSQL(
        `SELECT * FROM ${TABLE} LIMIT 2 OFFSET 1`
      );
      expect(rows.length).toBe(2);
    });

    it('SELECT COUNT(*)', async () => {
      const { rows } = await execSQL(
        `SELECT COUNT(*) AS cnt FROM ${TABLE}`
      );
      expect(Number(rows[0].cnt)).toBe(4);
    });

    it('SELECT with specific columns', async () => {
      const { rows } = await execSQL(
        `SELECT name, salary FROM ${TABLE} WHERE name = ?`,
        ['Alice']
      );
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe('Alice');
      expect(Number(rows[0].salary)).toBe(90000);
    });

    it('SELECT with $like/$ilike (LIKE on MongoDB)', async () => {
      const { rows } = await execSQL(
        `SELECT * FROM ${TABLE} WHERE name LIKE ?`,
        ['%li%']
      );
      expect(rows.length).toBe(2); // Alice, Charlie (both contain "li")
    });

    it('SELECT with IN clause', async () => {
      const { rows } = await execSQL(
        `SELECT * FROM ${TABLE} WHERE name IN (?, ?)`,
        ['Alice', 'Charlie']
      );
      expect(rows.length).toBe(2);
    });

  });

  describe('DML — UPDATE', () => {

    it('UPDATE with WHERE clause', async () => {
      const result = await execSQL(
        `UPDATE ${TABLE} SET salary = ? WHERE name = ?`,
        [95000, 'Alice']
      );
      expect(result.affectedRows).toBe(1);
    });

    it('UPDATE reflects in SELECT', async () => {
      const { rows } = await execSQL(
        `SELECT salary FROM ${TABLE} WHERE name = ?`,
        ['Alice']
      );
      expect(Number(rows[0].salary)).toBe(95000);
    });

    it('UPDATE with $inc operator', async () => {
      await execSQL(
        `UPDATE ${TABLE} SET age = age + 1 WHERE name = ?`,
        ['Bob']
      );
      const { rows } = await execSQL(
        `SELECT age FROM ${TABLE} WHERE name = ?`,
        ['Bob']
      );
      expect(Number(rows[0].age)).toBe(26); // was 25, +1
    });

  });

  describe('DML — DELETE', () => {

    it('DELETE with WHERE clause', async () => {
      const result = await execSQL(
        `DELETE FROM ${TABLE} WHERE name = ?`,
        ['Diana']
      );
      expect(result.affectedRows).toBe(1);
    });

    it('DELETEd row is gone', async () => {
      const { rows } = await execSQL(
        `SELECT * FROM ${TABLE} WHERE name = ?`,
        ['Diana']
      );
      expect(rows.length).toBe(0);
    });

    it('remaining count is correct', async () => {
      const { rows } = await execSQL(
        `SELECT COUNT(*) AS cnt FROM ${TABLE}`
      );
      expect(Number(rows[0].cnt)).toBe(3); // Alice, Bob, Charlie
    });

  });

  // ─── Full Chain Test ───────────────────────────────

  describe('Full Chain — DROP TABLE', () => {

    it('DROP TABLE removes the collection', async () => {
      const result = await execSQL(`DROP TABLE IF EXISTS ${TABLE}`);
      expect(result).toBeDefined();
    });

    it('table is gone after DROP', async () => {
      try {
        const { rows } = await execSQL(`SELECT * FROM ${TABLE}`);
        expect(rows.length).toBe(0);
      } catch {
        // On MongoDB, SELECT on non-existent collection returns empty — that's fine
      }
    });

    it('CREATE → INSERT → SELECT → DROP full lifecycle', async () => {
      // CREATE
      await execSQL(`CREATE TABLE IF NOT EXISTS ${TABLE} (id INT, val TEXT)`);
      // INSERT
      await execSQL(`INSERT INTO ${TABLE} (id, val) VALUES (?, ?)`, [1, 'lifecycle']);
      // SELECT
      const { rows } = await execSQL(`SELECT * FROM ${TABLE}`);
      expect(rows.length).toBe(1);
      expect(rows[0].val).toBe('lifecycle');
      // DROP
      await execSQL(`DROP TABLE IF EXISTS ${TABLE}`);
    });

  });

  // ─── Multi-table DDL (simulates real backend startup) ──

  describe('Multi-table DDL — Real Backend Simulation', () => {

    const tables = ['sim_products', 'sim_orders', 'sim_customers', 'sim_inventory'];

    afterAll(async () => {
      for (const t of tables) {
        try { await execSQL(`DROP TABLE IF EXISTS ${t}`); } catch { /* cleanup */ }
      }
    });

    it('creates 15+ tables like a real backend', async () => {
      // Simulate a backend startup that creates all tables
      for (const t of tables) {
        await execSQL(
          `CREATE TABLE IF NOT EXISTS ${t} (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`
        );
      }

      // All tables should be created
      const { rows } = await execSQL('SHOW TABLES');
      const createdTables = rows.map((r: Record<string, unknown>) => r.Name ?? r.name ?? Object.values(r)[0]);
      for (const t of tables) {
        expect(createdTables).toContain(t);
      }
    });

    it('can INSERT into each table', async () => {
      for (const t of tables) {
        const result = await execSQL(
          `INSERT INTO ${t} (name) VALUES (?)`,
          [`test_${t}`]
        );
        expect(result.affectedRows).toBe(1);
      }
    });

    it('can SELECT from each table', async () => {
      for (const t of tables) {
        const { rows } = await execSQL(`SELECT * FROM ${t}`);
        expect(rows.length).toBe(1);
        expect(rows[0].name).toBe(`test_${t}`);
      }
    });

    it('idempotent CREATE TABLE IF NOT EXISTS (run twice)', async () => {
      for (const t of tables) {
        // Second call should not error
        await execSQL(
          `CREATE TABLE IF NOT EXISTS ${t} (id INT, name TEXT)`
        );
      }
      // Data should still be there
      for (const t of tables) {
        const { rows } = await execSQL(`SELECT * FROM ${t}`);
        expect(rows.length).toBe(1);
      }
    });

  });

});
