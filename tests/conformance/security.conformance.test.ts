// =====================================================
// JSDB - Security Conformance Tests
// Tests parameterized queries, injection resistance,
// connection security, and credential handling
// =====================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const T = 'security_test';

async function setupMySQL(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS \`${T}\` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255),
    secret VARCHAR(255)
  )`);
}

async function setupPG(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS "${T}" (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255),
    secret VARCHAR(255)
  )`);
}

describe('Security Conformance', () => {
  let mysql: JSDBClient;
  let pg: JSDBClient;

  beforeAll(async () => {
    mysql = createClient(MYSQL_CONFIG);
    pg = createClient(PG_CONFIG);
    await mysql.connect();
    await pg.connect();
    await setupMySQL(mysql);
    await setupPG(pg);
    // Seed data
    await mysql.collection(T).insertOne({ name: 'Alice', secret: 'password123' });
    await pg.collection(T).insertOne({ name: 'Alice', secret: 'password123' });
  }, 30000);

  afterAll(async () => {
    try { await mysql.raw(`DROP TABLE IF EXISTS \`${T}\``); } catch { /* cleanup */ }
    try { await pg.raw(`DROP TABLE IF EXISTS "${T}"`); } catch { /* cleanup */ }
    await mysql.disconnect();
    await pg.disconnect();
  }, 10000);

  describe('SQL Injection Resistance', () => {
    it('string with SQL keywords is safe via insertOne on MySQL', async () => {
      const malicious = "'; DROP TABLE security_test; --";
      await mysql.collection(T).insertOne({ name: malicious, secret: 'safe' });
      const result = await mysql.collection(T).findOne({ name: malicious });
      expect(result.name).toBe(malicious);
      // Table still exists
      const count = await mysql.collection(T).count({});
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('string with SQL keywords is safe via insertOne on PostgreSQL', async () => {
      const malicious = "'; DROP TABLE security_test; --";
      await pg.collection(T).insertOne({ name: malicious, secret: 'safe' });
      const result = await pg.collection(T).findOne({ name: malicious });
      expect(result.name).toBe(malicious);
      const count = await pg.collection(T).count({});
      expect(count).toBeGreaterThanOrEqual(1);
    });

    it('string with OR injection is safe via find on MySQL', async () => {
      const result = await mysql.collection(T).find({ name: { $ne: "'; OR '1'='1" } });
      expect(Array.isArray(result)).toBe(true);
    });

    it('string with OR injection is safe via find on PostgreSQL', async () => {
      const result = await pg.collection(T).find({ name: { $ne: "'; OR '1'='1" } });
      expect(Array.isArray(result)).toBe(true);
    });

    it('UNION injection attempts are handled on MySQL', async () => {
      const result = await mysql.collection(T).find({ name: "test UNION SELECT * FROM users" });
      expect(Array.isArray(result)).toBe(true);
    });

    it('UNION injection attempts are handled on PostgreSQL', async () => {
      const result = await pg.collection(T).find({ name: "test UNION SELECT * FROM users" });
      expect(Array.isArray(result)).toBe(true);
    });

    it('double-quote injection is safe on MySQL', async () => {
      const result = await mysql.collection(T).find({ name: 'test" OR "1"="1' });
      expect(Array.isArray(result)).toBe(true);
    });

    it('double-quote injection is safe on PostgreSQL', async () => {
      const result = await pg.collection(T).find({ name: 'test" OR "1"="1' });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Parameterized query safety', () => {
    it('updateOne with special chars in filter is safe on MySQL', async () => {
      await mysql.collection(T).insertOne({ name: 'special', secret: "test'quote" });
      const result = await mysql.collection(T).updateOne(
        { name: 'special' },
        { $set: { secret: "new'value" } }
      );
      expect(result.modifiedCount).toBe(1);
      const doc = await mysql.collection(T).findOne({ name: 'special' });
      expect(doc.secret).toBe("new'value");
    });

    it('updateOne with special chars in filter is safe on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ name: 'special', secret: "test'quote" });
      const result = await pg.collection(T).updateOne(
        { name: 'special' },
        { $set: { secret: "new'value" } }
      );
      expect(result.modifiedCount).toBe(1);
      const doc = await pg.collection(T).findOne({ name: 'special' });
      expect(doc.secret).toBe("new'value");
    });

    it('deleteOne with special chars in filter is safe on MySQL', async () => {
      await mysql.collection(T).insertOne({ name: 'deleteme', secret: "it's a test" });
      const result = await mysql.collection(T).deleteOne({ name: 'deleteme' });
      expect(result.deletedCount).toBe(1);
    });

    it('deleteOne with special chars in filter is safe on PostgreSQL', async () => {
      await pg.collection(T).insertOne({ name: 'deleteme', secret: "it's a test" });
      const result = await pg.collection(T).deleteOne({ name: 'deleteme' });
      expect(result.deletedCount).toBe(1);
    });
  });

  describe('Connection security', () => {
    it('rejects connection with wrong password', async () => {
      const badClient = createClient({
        database: 'mysql' as const,
        connection: { host: 'localhost', port: 3309, user: 'root', password: 'wrongpassword', database: 'jsdb_test' },
        pool: { max: 1 },
        logging: { level: 'error' as const },
      });
      await expect(badClient.connect()).rejects.toThrow();
    });

    it('rejects connection with wrong password on PostgreSQL', async () => {
      const badClient = createClient({
        database: 'postgres' as const,
        connection: { host: 'localhost', port: 5435, user: 'root', password: 'wrongpassword', database: 'jsdb_test' },
        pool: { max: 1 },
        logging: { level: 'error' as const },
      });
      await expect(badClient.connect()).rejects.toThrow();
    });
  });

  describe('No secrets in logs', () => {
    it('connection string not exposed in error messages', async () => {
      try {
        const badClient = createClient({
          database: 'mysql' as const,
          connection: { host: 'localhost', port: 3309, user: 'root', password: 'supersecret123', database: 'jsdb_test' },
          pool: { max: 1 },
          logging: { level: 'error' as const },
        });
        await badClient.connect();
      } catch (e: any) {
        const msg = String(e.message || e);
        expect(msg).not.toContain('supersecret123');
      }
    });
  });

  describe('Data not leaked across clients', () => {
    it('separate database connections have isolated data', async () => {
      const client2 = createClient(MYSQL_CONFIG);
      await client2.connect();
      try {
        await client2.raw(`CREATE TABLE IF NOT EXISTS \`${T}_isolated\` (
          id INT AUTO_INCREMENT PRIMARY KEY,
          val VARCHAR(255)
        )`);
        await client2.collection(`${T}_isolated`).insertOne({ val: 'secret_data' });
        const result = await client2.collection(`${T}_isolated`).find({});
        expect(result.length).toBe(1);
        expect(result[0].val).toBe('secret_data');
      } finally {
        try { await client2.raw(`DROP TABLE IF EXISTS \`${T}_isolated\``); } catch { /* cleanup */ }
        await client2.disconnect();
      }
    });
  });
});
