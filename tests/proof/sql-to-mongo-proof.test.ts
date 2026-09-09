// =====================================================
// PROOF: Existing SQL code → MongoDB (zero change)
// =====================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setSharedAdapter, resetSharedAdapter, execSQL } from '../../src/compat/core.js';
import { createClient } from '../../src/index.js';

const MONGO_CONFIG = {
  database: 'mongodb' as const,
  connection: {
    uri: process.env.PROOF_MONGO_URI ?? 'mongodb://localhost:27019/jsdb_proof',
    database: process.env.PROOF_MONGO_DB ?? 'jsdb_proof',
  },
  pool: { max: 5 },
  logging: { level: 'silent' as const },
};

describe('PROOF: SQL → MongoDB Zero-Code Switch', () => {
  let client: ReturnType<typeof createClient>;

  beforeAll(async () => {
    client = createClient(MONGO_CONFIG);
    await client.connect();
    const adapter = (client as any).adapter;
    setSharedAdapter(adapter, MONGO_CONFIG);
  });

  afterAll(async () => {
    try {
      const coll = client.collection('sql_test_users');
      await coll.deleteMany({});
    } catch { /* cleanup */ }
    await client.disconnect();
    resetSharedAdapter();
  });

  it('CREATE TABLE → MongoDB createCollection', async () => {
    const result = await execSQL('CREATE TABLE IF NOT EXISTS sql_test_users (id INT AUTO_INCREMENT PRIMARY KEY, name TEXT, email TEXT, age INT)');
    expect(result.rowCount).toBe(0);
  });

  it('INSERT → MongoDB insertOne', async () => {
    const result = await execSQL('INSERT INTO sql_test_users (name, email, age) VALUES (?, ?, ?)', ['Alice', 'alice@test.com', 30]);
    expect(result.affectedRows).toBe(1);
    const coll = client.collection('sql_test_users');
    const user = await coll.findOne({ name: 'Alice' });
    expect(user).not.toBeNull();
    expect(user!.email).toBe('alice@test.com');
    expect(user!.age).toBe(30);
  });

  it('INSERT many → MongoDB insertMany', async () => {
    await execSQL('INSERT INTO sql_test_users (name, email, age) VALUES (?, ?, ?)', ['Bob', 'bob@test.com', 25]);
    await execSQL('INSERT INTO sql_test_users (name, email, age) VALUES (?, ?, ?)', ['Carol', 'carol@test.com', 35]);
    const coll = client.collection('sql_test_users');
    const count = await coll.count({});
    expect(count).toBe(3);
  });

  it('SELECT * → MongoDB find()', async () => {
    const { rows } = await execSQL('SELECT * FROM sql_test_users');
    expect(rows.length).toBe(3);
  });

  it('SELECT WHERE → MongoDB find with filter', async () => {
    const { rows } = await execSQL('SELECT * FROM sql_test_users WHERE age > ?', [28]);
    expect(rows.length).toBe(2); // Alice(30), Carol(35)
  });

  it('SELECT with ORDER BY → MongoDB sort', async () => {
    const { rows } = await execSQL('SELECT * FROM sql_test_users ORDER BY age DESC');
    expect(rows[0].name).toBe('Carol'); // age 35
    expect(rows[2].name).toBe('Bob');   // age 25
  });

  it('SELECT with LIMIT → MongoDB limit', async () => {
    const { rows } = await execSQL('SELECT * FROM sql_test_users LIMIT 2');
    expect(rows.length).toBe(2);
  });

  it('SELECT COUNT(*) → MongoDB countDocuments', async () => {
    const { rows } = await execSQL('SELECT COUNT(*) AS cnt FROM sql_test_users');
    expect(Number(rows[0].cnt)).toBe(3);
  });

  it('UPDATE → MongoDB updateOne', async () => {
    await execSQL('UPDATE sql_test_users SET age = ? WHERE name = ?', [31, 'Alice']);
    const coll = client.collection('sql_test_users');
    const alice = await coll.findOne({ name: 'Alice' });
    expect(alice!.age).toBe(31);
  });

  it('DELETE → MongoDB deleteOne', async () => {
    await execSQL('DELETE FROM sql_test_users WHERE name = ?', ['Bob']);
    const coll = client.collection('sql_test_users');
    const count = await coll.count({});
    expect(count).toBe(2); // Alice, Carol
  });

  it('DROP TABLE → MongoDB dropCollection', async () => {
    const result = await execSQL('DROP TABLE IF EXISTS sql_test_users');
    expect(result.rowCount).toBe(0);
  });
});
