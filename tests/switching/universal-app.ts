// =====================================================
// JSDB - Universal Application (Database-Agnostic)
// This file contains ZERO database-specific code.
// It uses only the JSDB universal API.
// =====================================================
import { createClient, type JSDBClient } from '../../src/index.js';

// ---- Universal Business Logic ----
// This code does NOT know which database is being used.
// No `if (database === 'mysql')` or `if (database === 'mongodb')`.

export interface User {
  name: string;
  email: string;
  age: number;
  score: number;
  active: boolean;
}

export async function seedUsers(client: JSDBClient): Promise<void> {
  const coll = client.collection('switch_test_users');
  await coll.deleteMany({});

  await coll.insertMany([
    { name: 'Alice', email: 'alice@example.com', age: 30, score: 95.5, active: true },
    { name: 'Bob', email: 'bob@example.com', age: 25, score: 80.0, active: true },
    { name: 'Charlie', email: 'charlie@example.com', age: 35, score: 60.0, active: false },
    { name: 'Diana', email: 'diana@example.com', age: 28, score: 88.0, active: true },
    { name: 'Eve', email: 'eve@example.com', age: 22, score: 72.0, active: false },
  ]);
}

export async function insertOneUser(client: JSDBClient, user: User) {
  const coll = client.collection('switch_test_users');
  return coll.insertOne(user);
}

export async function findAllUsers(client: JSDBClient) {
  const coll = client.collection('switch_test_users');
  return coll.find({});
}

export async function findActiveUsers(client: JSDBClient) {
  const coll = client.collection('switch_test_users');
  return coll.find({ active: true });
}

export async function findUsersOlderThan(client: JSDBClient, minAge: number) {
  const coll = client.collection('switch_test_users');
  return coll.find({ age: { $gt: minAge } });
}

export async function findUsersByName(client: JSDBClient, name: string) {
  const coll = client.collection('switch_test_users');
  return coll.find({ name });
}

export async function updateUserScore(client: JSDBClient, name: string, newScore: number) {
  const coll = client.collection('switch_test_users');
  return coll.updateOne({ name }, { $set: { score: newScore } });
}

export async function deleteUser(client: JSDBClient, name: string) {
  const coll = client.collection('switch_test_users');
  return coll.deleteOne({ name });
}

export async function countUsers(client: JSDBClient) {
  const coll = client.collection('switch_test_users');
  return coll.count({});
}

export async function aggregateByStatus(client: JSDBClient) {
  const coll = client.collection('switch_test_users');
  return coll.aggregate([
    { $group: { _id: '$active', count: { $sum: 1 }, totalScore: { $sum: '$score' } } },
  ]);
}

export async function sortUsersByAge(client: JSDBClient, direction: 'asc' | 'desc') {
  const coll = client.collection('switch_test_users');
  return coll.find({}, { sort: { age: direction } });
}

export async function paginateUsers(client: JSDBClient, page: number, pageSize: number) {
  const coll = client.collection('switch_test_users');
  return coll.query()
    .sort('age', 'asc')
    .page(page, pageSize);
}

export async function findWithProjection(client: JSDBClient) {
  const coll = client.collection('switch_test_users');
  return coll.find({}, { projection: { name: 1, age: 1 } });
}

export async function transactionExample(client: JSDBClient) {
  return client.transaction(async (tx) => {
    const txColl = tx.collection('switch_test_users');
    await txColl.insertOne({ name: 'TxUser', email: 'tx@example.com', age: 40, score: 100, active: true });
    const count = await txColl.count({});
    return count;
  });
}

// ---- Test Runner ----

export interface TestResult {
  operation: string;
  passed: boolean;
  result?: unknown;
  error?: string;
  nativeOnBoth?: boolean;
}

export async function runAllTests(client: JSDBClient): Promise<TestResult[]> {
  const results: TestResult[] = [];

  const test = async (name: string, fn: () => Promise<unknown>) => {
    try {
      const result = await fn();
      results.push({ operation: name, passed: true, result, nativeOnBoth: true });
    } catch (err) {
      results.push({ operation: name, passed: false, error: (err as Error).message });
    }
  };

  // 1. Seed data
  await test('seedUsers', () => seedUsers(client));

  // 2. CRUD
  await test('insertOne', () => insertOneUser(client, { name: 'Frank', email: 'frank@example.com', age: 45, score: 50, active: true }));
  await test('findAll', () => findAllUsers(client));
  await test('findActive', () => findActiveUsers(client));
  await test('findOlderThan30', () => findUsersOlderThan(client, 30));
  await test('findByName', () => findUsersByName(client, 'Alice'));
  await test('updateScore', () => updateUserScore(client, 'Alice', 99.0));
  await test('deleteUser', () => deleteUser(client, 'Frank'));
  await test('count', () => countUsers(client));

  // 3. Sorting
  await test('sortAsc', () => sortUsersByAge(client, 'asc'));
  await test('sortDesc', () => sortUsersByAge(client, 'desc'));

  // 4. Pagination
  await test('paginate', () => paginateUsers(client, 1, 2));

  // 5. Projection
  await test('projection', () => findWithProjection(client));

  // 6. Aggregation
  await test('aggregate', () => aggregateByStatus(client));

  // 7. Transaction (may fail on standalone MongoDB)
  await test('transaction', () => transactionExample(client));

  return results;
}

// ---- Main (for direct execution) ----

if (import.meta.url === `file://${process.argv[1]}`) {
  const dbType = process.env.JSDB_DATABASE || 'mysql';
  console.log(`\n=== JSDB Database Switching Proof ===`);
  console.log(`Database: ${dbType}\n`);

  const config = {
    database: dbType as 'mysql' | 'mongodb',
    connection: dbType === 'mysql'
      ? { host: 'localhost', port: 3309, user: 'root', password: 'jsdbproof', database: 'jsdb_test' }
      : { uri: 'mongodb://localhost:27019', database: 'jsdb_test' },
    pool: { max: 5 },
    logging: { level: 'error' as const },
  };

  const client = createClient(config);
  await client.connect();

  const results = await runAllTests(client);

  let passed = 0;
  let failed = 0;
  for (const r of results) {
    const status = r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${status}] ${r.operation}`);
    if (r.passed) passed++;
    else {
      failed++;
      console.log(`         Error: ${r.error}`);
    }
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed out of ${results.length}`);

  await client.disconnect();
}
