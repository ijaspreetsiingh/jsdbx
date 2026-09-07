// =====================================================
// JSDB - JOIN Conformance Tests
// Tests INNER JOIN, LEFT JOIN, multiple JOINs,
// JOIN with NULL, aliases, composite conditions
// MySQL/PostgreSQL use raw SQL JOINs; MongoDB uses $lookup
// =====================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

const USERS_T = 'jcon_users';
const ORDERS_T = 'jcon_orders';
const ITEMS_T = 'jcon_items';

const MYSQL_CREATE = [
  `DROP TABLE IF EXISTS \`${ITEMS_T}\``,
  `DROP TABLE IF EXISTS \`${ORDERS_T}\``,
  `DROP TABLE IF EXISTS \`${USERS_T}\``,
  `CREATE TABLE \`${USERS_T}\` (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, department VARCHAR(255))`,
  `CREATE TABLE \`${ORDERS_T}\` (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, total DECIMAL(10,2), status VARCHAR(50))`,
  `CREATE TABLE \`${ITEMS_T}\` (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT, product VARCHAR(255), quantity INT)`,
];

const PG_CREATE = [
  `DROP TABLE IF EXISTS "${ITEMS_T}"`,
  `DROP TABLE IF EXISTS "${ORDERS_T}"`,
  `DROP TABLE IF EXISTS "${USERS_T}"`,
  `CREATE TABLE "${USERS_T}" (id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL, department VARCHAR(255))`,
  `CREATE TABLE "${ORDERS_T}" (id SERIAL PRIMARY KEY, user_id INT, total DECIMAL(10,2), status VARCHAR(50))`,
  `CREATE TABLE "${ITEMS_T}" (id SERIAL PRIMARY KEY, order_id INT, product VARCHAR(255), quantity INT)`,
];

async function resetMySQL(mysql: JSDBClient) {
  for (const sql of MYSQL_CREATE) await mysql.raw(sql);
}

async function resetPG(pg: JSDBClient) {
  for (const sql of PG_CREATE) await pg.raw(sql);
}

async function seedMySQL(mysql: JSDBClient) {
  await resetMySQL(mysql);
  await mysql.collection(USERS_T).insertOne({ name: 'Alice', department: 'Engineering' });
  await mysql.collection(USERS_T).insertOne({ name: 'Bob', department: 'Marketing' });
  await mysql.collection(USERS_T).insertOne({ name: 'Charlie', department: 'Engineering' });
  await mysql.collection(USERS_T).insertOne({ name: 'Diana', department: 'Sales' });
  const users = await mysql.raw(`SELECT id, name FROM \`${USERS_T}\` ORDER BY id`) as any[];
  const uid = Object.fromEntries(users.map((u: any) => [u.name, Number(u.id)]));
  await mysql.collection(ORDERS_T).insertOne({ user_id: uid.Alice, total: 100.00, status: 'completed' });
  await mysql.collection(ORDERS_T).insertOne({ user_id: uid.Alice, total: 200.00, status: 'completed' });
  await mysql.collection(ORDERS_T).insertOne({ user_id: uid.Bob, total: 50.00, status: 'pending' });
  await mysql.collection(ORDERS_T).insertOne({ user_id: uid.Charlie, total: 150.00, status: 'completed' });
  const orders = await mysql.raw(`SELECT id FROM \`${ORDERS_T}\` ORDER BY id`) as any[];
  const oid = orders.map((o: any) => Number(o.id));
  await mysql.collection(ITEMS_T).insertOne({ order_id: oid[0], product: 'Laptop', quantity: 1 });
  await mysql.collection(ITEMS_T).insertOne({ order_id: oid[0], product: 'Mouse', quantity: 2 });
  await mysql.collection(ITEMS_T).insertOne({ order_id: oid[1], product: 'Keyboard', quantity: 1 });
  await mysql.collection(ITEMS_T).insertOne({ order_id: oid[2], product: 'Monitor', quantity: 1 });
}

async function seedPG(pg: JSDBClient) {
  await resetPG(pg);
  await pg.collection(USERS_T).insertOne({ name: 'Alice', department: 'Engineering' });
  await pg.collection(USERS_T).insertOne({ name: 'Bob', department: 'Marketing' });
  await pg.collection(USERS_T).insertOne({ name: 'Charlie', department: 'Engineering' });
  await pg.collection(USERS_T).insertOne({ name: 'Diana', department: 'Sales' });
  const users = await pg.raw(`SELECT id, name FROM "${USERS_T}" ORDER BY id`) as any[];
  const uid = Object.fromEntries(users.map((u: any) => [u.name, Number(u.id)]));
  await pg.collection(ORDERS_T).insertOne({ user_id: uid.Alice, total: 100.00, status: 'completed' });
  await pg.collection(ORDERS_T).insertOne({ user_id: uid.Alice, total: 200.00, status: 'completed' });
  await pg.collection(ORDERS_T).insertOne({ user_id: uid.Bob, total: 50.00, status: 'pending' });
  await pg.collection(ORDERS_T).insertOne({ user_id: uid.Charlie, total: 150.00, status: 'completed' });
  const orders = await pg.raw(`SELECT id FROM "${ORDERS_T}" ORDER BY id`) as any[];
  const oid = orders.map((o: any) => Number(o.id));
  await pg.collection(ITEMS_T).insertOne({ order_id: oid[0], product: 'Laptop', quantity: 1 });
  await pg.collection(ITEMS_T).insertOne({ order_id: oid[0], product: 'Mouse', quantity: 2 });
  await pg.collection(ITEMS_T).insertOne({ order_id: oid[1], product: 'Keyboard', quantity: 1 });
  await pg.collection(ITEMS_T).insertOne({ order_id: oid[2], product: 'Monitor', quantity: 1 });
}

async function seedMongo(mongo: JSDBClient) {
  await mongo.collection(USERS_T).deleteMany({});
  await mongo.collection(ORDERS_T).deleteMany({});
  await mongo.collection(ITEMS_T).deleteMany({});
  await mongo.collection(USERS_T).insertOne({ _id: 1, name: 'Alice', department: 'Engineering' });
  await mongo.collection(USERS_T).insertOne({ _id: 2, name: 'Bob', department: 'Marketing' });
  await mongo.collection(USERS_T).insertOne({ _id: 3, name: 'Charlie', department: 'Engineering' });
  await mongo.collection(USERS_T).insertOne({ _id: 4, name: 'Diana', department: 'Sales' });
  await mongo.collection(ORDERS_T).insertOne({ _id: 1, user_id: 1, total: 100.00, status: 'completed' });
  await mongo.collection(ORDERS_T).insertOne({ _id: 2, user_id: 1, total: 200.00, status: 'completed' });
  await mongo.collection(ORDERS_T).insertOne({ _id: 3, user_id: 2, total: 50.00, status: 'pending' });
  await mongo.collection(ORDERS_T).insertOne({ _id: 4, user_id: 3, total: 150.00, status: 'completed' });
  await mongo.collection(ITEMS_T).insertOne({ _id: 1, order_id: 1, product: 'Laptop', quantity: 1 });
  await mongo.collection(ITEMS_T).insertOne({ _id: 2, order_id: 1, product: 'Mouse', quantity: 2 });
  await mongo.collection(ITEMS_T).insertOne({ _id: 3, order_id: 2, product: 'Keyboard', quantity: 1 });
  await mongo.collection(ITEMS_T).insertOne({ _id: 4, order_id: 3, product: 'Monitor', quantity: 1 });
}

describe('JOIN Conformance', () => {
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
  }, 30000);

  afterAll(async () => {
    try { await resetMySQL(mysql); } catch {}
    try { await mongo.collection(USERS_T).deleteMany({}); } catch {}
    try { await mongo.collection(ORDERS_T).deleteMany({}); } catch {}
    try { await mongo.collection(ITEMS_T).deleteMany({}); } catch {}
    try { await resetPG(pg); } catch {}
    await mysql.disconnect();
    await mongo.disconnect();
    await pg.disconnect();
  }, 10000);

  describe('INNER JOIN', () => {
    it('users JOIN orders on MySQL', async () => {
      await seedMySQL(mysql);
      const rows = await mysql.raw(
        `SELECT u.name, o.total FROM \`${USERS_T}\` u INNER JOIN \`${ORDERS_T}\` o ON u.id = o.user_id ORDER BY u.name, o.total`
      ) as any[];
      expect(rows.length).toBe(4);
      expect(rows.map((r: any) => r.name)).toEqual(['Alice', 'Alice', 'Bob', 'Charlie']);
    });

    it('users JOIN orders on PostgreSQL', async () => {
      await seedPG(pg);
      const rows = await pg.raw(
        `SELECT u.name, o.total FROM "${USERS_T}" u INNER JOIN "${ORDERS_T}" o ON u.id = o.user_id ORDER BY u.name, o.total`
      ) as any[];
      expect(rows.length).toBe(4);
      expect(rows.map((r: any) => r.name)).toEqual(['Alice', 'Alice', 'Bob', 'Charlie']);
    });

    it('users $lookup orders on MongoDB', async () => {
      await seedMongo(mongo);
      const results = await mongo.collection(USERS_T).aggregate([
        { $lookup: { from: ORDERS_T, localField: '_id', foreignField: 'user_id', as: 'orders' } },
        { $unwind: { path: '$orders', preserveNullAndEmptyArrays: false } },
        { $project: { name: 1, total: '$orders.total' } },
        { $sort: { name: 1, total: 1 } },
      ]);
      expect(results.length).toBe(4);
      expect(results.map((r: any) => r.name)).toEqual(['Alice', 'Alice', 'Bob', 'Charlie']);
    });
  });

  describe('LEFT JOIN', () => {
    it('users LEFT JOIN orders on MySQL', async () => {
      await seedMySQL(mysql);
      const rows = await mysql.raw(
        `SELECT u.name, o.total FROM \`${USERS_T}\` u LEFT JOIN \`${ORDERS_T}\` o ON u.id = o.user_id ORDER BY u.name, o.total`
      ) as any[];
      // 5 rows: Alice(100), Alice(200), Bob(50), Charlie(150), Diana(null)
      expect(rows.length).toBe(5);
      const diana = rows.find((r: any) => r.name === 'Diana');
      expect(diana!.total == null).toBe(true);
    });

    it('users LEFT JOIN orders on PostgreSQL', async () => {
      await seedPG(pg);
      const rows = await pg.raw(
        `SELECT u.name, o.total FROM "${USERS_T}" u LEFT JOIN "${ORDERS_T}" o ON u.id = o.user_id ORDER BY u.name, o.total`
      ) as any[];
      expect(rows.length).toBe(5);
      const diana = rows.find((r: any) => r.name === 'Diana');
      expect(diana!.total == null).toBe(true);
    });

    it('users $lookup orders on MongoDB', async () => {
      await seedMongo(mongo);
      const results = await mongo.collection(USERS_T).aggregate([
        { $lookup: { from: ORDERS_T, localField: '_id', foreignField: 'user_id', as: 'orders' } },
        { $unwind: { path: '$orders', preserveNullAndEmptyArrays: true } },
        { $project: { name: 1, total: '$orders.total' } },
        { $sort: { name: 1, total: 1 } },
      ]);
      expect(results.length).toBe(5);
      const diana = results.find((r: any) => r.name === 'Diana');
      expect(diana!.total == null).toBe(true);
    });
  });

  describe('Multiple JOINs', () => {
    it('users -> orders -> items chain on MySQL', async () => {
      await seedMySQL(mysql);
      const rows = await mysql.raw(
        `SELECT u.name, i.product, i.quantity FROM \`${USERS_T}\` u
         INNER JOIN \`${ORDERS_T}\` o ON u.id = o.user_id
         INNER JOIN \`${ITEMS_T}\` i ON o.id = i.order_id
         ORDER BY u.name, i.product`
      ) as any[];
      expect(rows.length).toBe(4);
      expect(rows.map((r: any) => `${r.name}:${r.product}`)).toEqual([
        'Alice:Keyboard', 'Alice:Laptop', 'Alice:Mouse', 'Bob:Monitor',
      ]);
    });

    it('users -> orders -> items chain on PostgreSQL', async () => {
      await seedPG(pg);
      const rows = await pg.raw(
        `SELECT u.name, i.product, i.quantity FROM "${USERS_T}" u
         INNER JOIN "${ORDERS_T}" o ON u.id = o.user_id
         INNER JOIN "${ITEMS_T}" i ON o.id = i.order_id
         ORDER BY u.name, i.product`
      ) as any[];
      expect(rows.length).toBe(4);
      expect(rows.map((r: any) => `${r.name}:${r.product}`)).toEqual([
        'Alice:Keyboard', 'Alice:Laptop', 'Alice:Mouse', 'Bob:Monitor',
      ]);
    });
  });

  describe('JOIN with NULL foreign key', () => {
    it('LEFT JOIN handles orphaned rows on MySQL', async () => {
      await seedMySQL(mysql);
      await mysql.collection(ORDERS_T).insertOne({ user_id: 999, total: 500.00, status: 'orphan' });
      const rows = await mysql.raw(
        `SELECT u.name, o.total FROM \`${USERS_T}\` u LEFT JOIN \`${ORDERS_T}\` o ON u.id = o.user_id ORDER BY u.name`
      ) as any[];
      // Still 5 rows (orphan order not matched to any user)
      expect(rows.length).toBe(5);
    });

    it('LEFT JOIN handles orphaned rows on PostgreSQL', async () => {
      await seedPG(pg);
      await pg.collection(ORDERS_T).insertOne({ user_id: 999, total: 500.00, status: 'orphan' });
      const rows = await pg.raw(
        `SELECT u.name, o.total FROM "${USERS_T}" u LEFT JOIN "${ORDERS_T}" o ON u.id = o.user_id ORDER BY u.name`
      ) as any[];
      expect(rows.length).toBe(5);
    });
  });

  describe('Duplicate matching rows', () => {
    it('one-to-many JOIN on MySQL', async () => {
      await seedMySQL(mysql);
      const rows = await mysql.raw(
        `SELECT COUNT(*) as total FROM \`${USERS_T}\` u INNER JOIN \`${ORDERS_T}\` o ON u.id = o.user_id WHERE u.name = 'Alice'`
      ) as any[];
      expect(Number(rows[0].total)).toBe(2);
    });

    it('one-to-many JOIN on PostgreSQL', async () => {
      await seedPG(pg);
      const rows = await pg.raw(
        `SELECT COUNT(*) as total FROM "${USERS_T}" u INNER JOIN "${ORDERS_T}" o ON u.id = o.user_id WHERE u.name = 'Alice'`
      ) as any[];
      expect(Number(rows[0].total)).toBe(2);
    });
  });

  describe('JOIN with filter', () => {
    it('JOIN + WHERE on MySQL', async () => {
      await seedMySQL(mysql);
      const rows = await mysql.raw(
        `SELECT u.name, o.total FROM \`${USERS_T}\` u
         INNER JOIN \`${ORDERS_T}\` o ON u.id = o.user_id
         WHERE o.status = 'completed'
         ORDER BY u.name, o.total`
      ) as any[];
      expect(rows.length).toBe(3);
      expect(rows.map((r: any) => r.name)).toEqual(['Alice', 'Alice', 'Charlie']);
    });

    it('JOIN + WHERE on PostgreSQL', async () => {
      await seedPG(pg);
      const rows = await pg.raw(
        `SELECT u.name, o.total FROM "${USERS_T}" u
         INNER JOIN "${ORDERS_T}" o ON u.id = o.user_id
         WHERE o.status = 'completed'
         ORDER BY u.name, o.total`
      ) as any[];
      expect(rows.length).toBe(3);
      expect(rows.map((r: any) => r.name)).toEqual(['Alice', 'Alice', 'Charlie']);
    });
  });

  describe('JOIN + GROUP BY', () => {
    it('JOIN + GROUP BY on MySQL', async () => {
      await seedMySQL(mysql);
      const rows = await mysql.raw(
        `SELECT u.name, SUM(o.total) as total_spent, COUNT(o.id) as order_count
         FROM \`${USERS_T}\` u
         INNER JOIN \`${ORDERS_T}\` o ON u.id = o.user_id
         GROUP BY u.name ORDER BY u.name`
      ) as any[];
      expect(rows.length).toBe(3);
      const alice = rows.find((r: any) => r.name === 'Alice');
      expect(Number(alice!.total_spent)).toBe(300);
      expect(Number(alice!.order_count)).toBe(2);
    });

    it('JOIN + GROUP BY on PostgreSQL', async () => {
      await seedPG(pg);
      const rows = await pg.raw(
        `SELECT u.name, SUM(o.total) as total_spent, COUNT(o.id) as order_count
         FROM "${USERS_T}" u
         INNER JOIN "${ORDERS_T}" o ON u.id = o.user_id
         GROUP BY u.name ORDER BY u.name`
      ) as any[];
      expect(rows.length).toBe(3);
      const alice = rows.find((r: any) => r.name === 'Alice');
      expect(Number(alice!.total_spent)).toBe(300);
      expect(Number(alice!.order_count)).toBe(2);
    });
  });
});
