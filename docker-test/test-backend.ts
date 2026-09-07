// =====================================================
// Backend Test Script
// Tests jasdbx against real MySQL, MongoDB, PostgreSQL
// =====================================================

import { createClient } from '../src/index.js';

const MYSQL_CONFIG = {
  database: 'mysql' as const,
  connection: {
    host: 'localhost',
    port: 3309,
    user: 'root',
    password: 'jsdbproof',
    database: 'jsdb_proof',
  },
  pool: { max: 5 },
  logging: { level: 'silent' as const },
};

const MONGO_CONFIG = {
  database: 'mongodb' as const,
  connection: {
    uri: 'mongodb://localhost:27019/jsdb_proof',
    database: 'jsdb_proof',
  },
  pool: { max: 5 },
  logging: { level: 'silent' as const },
};

const POSTGRES_CONFIG = {
  database: 'postgres' as const,
  connection: {
    host: 'localhost',
    port: 5435,
    user: 'root',
    password: 'jsdbproof',
    database: 'jsdb_proof',
  },
  pool: { max: 5 },
  logging: { level: 'silent' as const },
};

// DDL for SQL databases
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS test_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  age INT,
  dept VARCHAR(255)
)`;

const PG_CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS test_users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  age INT,
  dept VARCHAR(255)
)`;

async function testDatabase(label: string, config: typeof MYSQL_CONFIG, setupSQL?: string) {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Testing: ${label}`);
  console.log('='.repeat(50));

  const client = createClient(config);

  try {
    await client.connect();
    console.log('✅ Connected');

    // Create table for SQL databases
    if (setupSQL) {
      await client.raw(setupSQL);
      console.log('✅ Table created');
    }

    const coll = client.collection('test_users');

    // Clean
    await coll.deleteMany({});
    console.log('✅ Cleaned collection');

    // Insert
    await coll.insertMany([
      { name: 'Alice', age: 30, dept: 'Engineering' },
      { name: 'Bob', age: 25, dept: 'Marketing' },
      { name: 'Carol', age: 35, dept: 'Engineering' },
    ]);
    console.log('✅ Inserted 3 documents');

    // Find
    const all = await coll.find({});
    console.log(`✅ Find all: ${all.length} documents`);

    // Filter
    const eng = await coll.find({ dept: 'Engineering' });
    console.log(`✅ Filter dept=Engineering: ${eng.length} documents`);

    // Count
    const count = await coll.count({});
    console.log(`✅ Count: ${count}`);

    // Update
    await coll.updateOne({ name: 'Alice' }, { $set: { age: 31 } });
    const alice = await coll.findOne({ name: 'Alice' });
    console.log(`✅ Update Alice age: ${alice?.age}`);

    // Delete
    await coll.deleteOne({ name: 'Bob' });
    const afterDelete = await coll.count({});
    console.log(`✅ Delete Bob, count now: ${afterDelete}`);

    // Sort
    const sorted = await coll.find({}, { sort: { age: 'desc' } });
    console.log(`✅ Sort by age desc: ${sorted.map((u: any) => u.name).join(', ')}`);

    // Aggregate
    const agg = await coll.aggregate([
      { $group: { _id: '$dept', count: { $sum: 1 } } },
    ]);
    console.log(`✅ Aggregate by dept:`, agg);

    await client.disconnect();
    console.log(`✅ ${label} PASSED\n`);
    return true;
  } catch (err) {
    console.error(`❌ ${label} FAILED:`, (err as Error).message);
    try { await client.disconnect(); } catch {}
    return false;
  }
}

async function main() {
  console.log('🚀 JasDBX Backend Test Suite');
  console.log('Testing against Docker databases...\n');

  const results: { label: string; passed: boolean }[] = [];

  results.push({ label: 'MySQL', passed: await testDatabase('MySQL', MYSQL_CONFIG, CREATE_TABLE_SQL) });
  results.push({ label: 'MongoDB', passed: await testDatabase('MongoDB', MONGO_CONFIG) });
  results.push({ label: 'PostgreSQL', passed: await testDatabase('PostgreSQL', POSTGRES_CONFIG, PG_CREATE_TABLE_SQL) });

  console.log('\n' + '='.repeat(50));
  console.log('RESULTS');
  console.log('='.repeat(50));
  for (const r of results) {
    console.log(`${r.passed ? '✅' : '❌'} ${r.label}`);
  }

  const allPassed = results.every(r => r.passed);
  console.log(`\n${allPassed ? '🎉 ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  process.exit(allPassed ? 0 : 1);
}

main();
