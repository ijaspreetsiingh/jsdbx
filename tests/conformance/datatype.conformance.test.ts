// =====================================================
// JSDB - Data Type Conformance Tests
// Tests Boolean, Integer, Decimal, Timestamp, Text,
// NULL, empty string, unicode, large numbers
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

const T = 'datatype_test';

async function setupMySQL(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS \`${T}\` (
    id INT AUTO_INCREMENT PRIMARY KEY,
    int_val INT,
    decimal_val DECIMAL(18,6),
    bool_val BOOLEAN,
    text_val TEXT,
    ts_val TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),
    json_val JSON
  )`);
}

async function setupPG(client: JSDBClient) {
  await client.raw(`CREATE TABLE IF NOT EXISTS "${T}" (
    id SERIAL PRIMARY KEY,
    int_val INT,
    decimal_val DECIMAL(18,6),
    bool_val BOOLEAN,
    text_val TEXT,
    ts_val TIMESTAMP(6) DEFAULT NOW(),
    json_val JSONB
  )`);
}

// MySQL BOOLEAN is TINYINT(1), returns 0/1 not true/false
function toBool(val: unknown): boolean {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  if (typeof val === 'string') return val === '1' || val.toLowerCase() === 'true';
  return Boolean(val);
}

describe('Data Type Conformance', () => {
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
    try { await mysql.raw(`DELETE FROM \`${T}\``); } catch { /* cleanup */ }
    try { await pg.raw(`DELETE FROM "${T}"`); } catch { /* cleanup */ }
  });

  describe('Integer values', () => {
    it('stores and retrieves zero', async () => {
      await mysql.collection(T).insertOne({ int_val: 0 });
      await pg.collection(T).insertOne({ int_val: 0 });
      const m = await mysql.collection(T).findOne({ int_val: 0 });
      const p = await pg.collection(T).findOne({ int_val: 0 });
      expect(Number(m.int_val)).toBe(0);
      expect(Number(p.int_val)).toBe(0);
    });

    it('stores and retrieves negative numbers', async () => {
      await mysql.collection(T).insertOne({ int_val: -42 });
      await pg.collection(T).insertOne({ int_val: -42 });
      const m = await mysql.collection(T).findOne({ int_val: -42 });
      const p = await pg.collection(T).findOne({ int_val: -42 });
      expect(Number(m.int_val)).toBe(-42);
      expect(Number(p.int_val)).toBe(-42);
    });

    it('stores large integers', async () => {
      await mysql.collection(T).insertOne({ int_val: 2147483647 });
      await pg.collection(T).insertOne({ int_val: 2147483647 });
      const m = await mysql.collection(T).findOne({ int_val: 2147483647 });
      const p = await pg.collection(T).findOne({ int_val: 2147483647 });
      expect(Number(m.int_val)).toBe(2147483647);
      expect(Number(p.int_val)).toBe(2147483647);
    });
  });

  describe('Decimal values', () => {
    it('stores and retrieves precise decimals', async () => {
      await mysql.collection(T).insertOne({ decimal_val: 123456.789012 });
      await pg.collection(T).insertOne({ decimal_val: 123456.789012 });
      const m = await mysql.collection(T).findOne({ decimal_val: 123456.789012 });
      const p = await pg.collection(T).findOne({ decimal_val: 123456.789012 });
      expect(Number(m.decimal_val)).toBeCloseTo(123456.789012, 5);
      expect(Number(p.decimal_val)).toBeCloseTo(123456.789012, 5);
    });

    it('stores zero decimal', async () => {
      await mysql.collection(T).insertOne({ decimal_val: 0.0 });
      await pg.collection(T).insertOne({ decimal_val: 0.0 });
      const m = await mysql.collection(T).findOne({ decimal_val: 0.0 });
      const p = await pg.collection(T).findOne({ decimal_val: 0.0 });
      expect(Number(m.decimal_val)).toBe(0);
      expect(Number(p.decimal_val)).toBe(0);
    });

    it('stores negative decimals', async () => {
      await mysql.collection(T).insertOne({ decimal_val: -99.99 });
      await pg.collection(T).insertOne({ decimal_val: -99.99 });
      const m = await mysql.collection(T).findOne({ decimal_val: -99.99 });
      const p = await pg.collection(T).findOne({ decimal_val: -99.99 });
      expect(Number(m.decimal_val)).toBeCloseTo(-99.99, 2);
      expect(Number(p.decimal_val)).toBeCloseTo(-99.99, 2);
    });
  });

  describe('Boolean values', () => {
    it('stores and retrieves true', async () => {
      await mysql.collection(T).insertOne({ bool_val: true });
      await pg.collection(T).insertOne({ bool_val: true });
      const m = await mysql.collection(T).findOne({ bool_val: true });
      const p = await pg.collection(T).findOne({ bool_val: true });
      // MySQL BOOLEAN is TINYINT(1), may return 0/1
      expect(toBool(m.bool_val)).toBe(true);
      expect(toBool(p.bool_val)).toBe(true);
    });

    it('stores and retrieves false', async () => {
      await mysql.collection(T).insertOne({ bool_val: false });
      await pg.collection(T).insertOne({ bool_val: false });
      const m = await mysql.collection(T).findOne({ bool_val: false });
      const p = await pg.collection(T).findOne({ bool_val: false });
      expect(toBool(m.bool_val)).toBe(false);
      expect(toBool(p.bool_val)).toBe(false);
    });

    it('boolean filter works correctly', async () => {
      await mysql.collection(T).insertOne({ bool_val: true });
      await mysql.collection(T).insertOne({ bool_val: false });
      await pg.collection(T).insertOne({ bool_val: true });
      await pg.collection(T).insertOne({ bool_val: false });

      const mTrue = await mysql.collection(T).find({ bool_val: true });
      const mFalse = await mysql.collection(T).find({ bool_val: false });
      const pTrue = await pg.collection(T).find({ bool_val: true });
      const pFalse = await pg.collection(T).find({ bool_val: false });

      expect(mTrue.length).toBe(1);
      expect(mFalse.length).toBe(1);
      expect(pTrue.length).toBe(1);
      expect(pFalse.length).toBe(1);
    });
  });

  describe('Text values', () => {
    it('stores and retrieves empty string', async () => {
      await mysql.collection(T).insertOne({ text_val: '' });
      await pg.collection(T).insertOne({ text_val: '' });
      const m = await mysql.collection(T).findOne({ text_val: '' });
      const p = await pg.collection(T).findOne({ text_val: '' });
      expect(m.text_val).toBe('');
      expect(p.text_val).toBe('');
    });

    it('stores and retrieves unicode text', async () => {
      const unicode = 'Hello \u00e9\u00e8\u00ea \u00fc\u00f6\u00e4 \u4e16\u754c \ud83d\ude00';
      await mysql.collection(T).insertOne({ text_val: unicode });
      await pg.collection(T).insertOne({ text_val: unicode });
      const m = await mysql.collection(T).findOne({ text_val: unicode });
      const p = await pg.collection(T).findOne({ text_val: unicode });
      expect(m.text_val).toBe(unicode);
      expect(p.text_val).toBe(unicode);
    });

    it('stores multiline text', async () => {
      const multiline = 'Line 1\nLine 2\nLine 3';
      await mysql.collection(T).insertOne({ text_val: multiline });
      await pg.collection(T).insertOne({ text_val: multiline });
      const m = await mysql.collection(T).findOne({ text_val: multiline });
      const p = await pg.collection(T).findOne({ text_val: multiline });
      expect(m.text_val).toBe(multiline);
      expect(p.text_val).toBe(multiline);
    });
  });

  describe('JSON values', () => {
    it('stores and retrieves JSON object via raw', async () => {
      const json = { key: 'value', nested: { a: 1, b: [2, 3] } };
      // Use raw to ensure proper JSON handling
      await mysql.raw(`INSERT INTO \`${T}\` (json_val) VALUES (?)`, [JSON.stringify(json)]);
      await pg.raw(`INSERT INTO "${T}" (json_val) VALUES ($1)`, [JSON.stringify(json)]);
      const mRows = await mysql.raw(`SELECT json_val FROM \`${T}\` LIMIT 1`) as any[];
      const pRows = await pg.raw(`SELECT json_val FROM "${T}" LIMIT 1`) as any[];
      const mJson = typeof mRows[0].json_val === 'string' ? JSON.parse(mRows[0].json_val) : mRows[0].json_val;
      const pJson = typeof pRows[0].json_val === 'string' ? JSON.parse(pRows[0].json_val) : pRows[0].json_val;
      expect(mJson).toEqual(json);
      expect(pJson).toEqual(json);
    });

    it('stores JSON array via raw', async () => {
      const json = [1, 'two', { three: 3 }];
      await mysql.raw(`INSERT INTO \`${T}\` (json_val) VALUES (?)`, [JSON.stringify(json)]);
      await pg.raw(`INSERT INTO "${T}" (json_val) VALUES ($1)`, [JSON.stringify(json)]);
      const mRows = await mysql.raw(`SELECT json_val FROM \`${T}\` LIMIT 1`) as any[];
      const pRows = await pg.raw(`SELECT json_val FROM "${T}" LIMIT 1`) as any[];
      const mJson = typeof mRows[0].json_val === 'string' ? JSON.parse(mRows[0].json_val) : mRows[0].json_val;
      const pJson = typeof pRows[0].json_val === 'string' ? JSON.parse(pRows[0].json_val) : pRows[0].json_val;
      expect(mJson).toEqual(json);
      expect(pJson).toEqual(json);
    });
  });

  describe('NULL handling across types', () => {
    it('NULL int_val preserved correctly', async () => {
      await mysql.collection(T).insertOne({ text_val: 'test' });
      await pg.collection(T).insertOne({ text_val: 'test' });
      const m = await mysql.collection(T).findOne({ text_val: 'test' });
      const p = await pg.collection(T).findOne({ text_val: 'test' });
      expect(m.int_val == null).toBe(true);
      expect(p.int_val == null).toBe(true);
    });

    it('NULL filter on non-text types works', async () => {
      await mysql.collection(T).insertOne({ int_val: 1, text_val: 'has_int' });
      await mysql.collection(T).insertOne({ text_val: 'no_int' });
      await pg.collection(T).insertOne({ int_val: 1, text_val: 'has_int' });
      await pg.collection(T).insertOne({ text_val: 'no_int' });

      const mNull = await mysql.collection(T).find({ int_val: null });
      const pNull = await pg.collection(T).find({ int_val: null });
      expect(mNull.length).toBe(1);
      expect(pNull.length).toBe(1);
      expect(mNull[0].text_val).toBe('no_int');
      expect(pNull[0].text_val).toBe('no_int');
    });
  });
});
