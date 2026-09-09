// =====================================================
// JSDB - Performance Baseline
// Basic benchmarks for find/insert/update/aggregation
// =====================================================
import { describe, it, _beforeAll, afterAll } from 'vitest';
import { createClient, type JSDBClient } from '../../src/index.js';

const MYSQL_CONFIG = {
  database: 'mysql' as const,
  connection: { host: 'localhost', port: 3307, user: 'root', password: '1234', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

const MONGO_CONFIG = {
  database: 'mongodb' as const,
  connection: { uri: 'mongodb://localhost:27017', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

const PG_CONFIG = {
  database: 'postgres' as const,
  connection: { host: 'localhost', port: 5433, user: 'root', password: '1234', database: 'jsdb_test' },
  pool: { max: 5 },
  logging: { level: 'error' as const },
};

const BENCH_COLLECTION = 'jsdb_perf_bench';

interface BenchResult {
  operation: string;
  database: string;
  iterations: number;
  totalTimeMs: number;
  avgPerOpMs: number;
  opsPerSec: number;
}

function report(results: BenchResult[]) {
  console.log('\n=== JSDB Performance Baseline ===');
  console.log('Operation'.padEnd(30) + 'Database'.padEnd(12) + 'Ops'.padEnd(8) + 'Avg(ms)'.padEnd(10) + 'Ops/sec');
  console.log('-'.repeat(70));
  for (const r of results) {
    console.log(
      r.operation.padEnd(30) +
      r.database.padEnd(12) +
      String(r.iterations).padEnd(8) +
      r.avgPerOpMs.toFixed(3).padEnd(10) +
      r.opsPerSec.toFixed(0)
    );
  }
}

async function benchInsert(client: JSDBClient, db: string, count: number): Promise<BenchResult> {
  const coll = client.collection(BENCH_COLLECTION);
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await coll.insertOne({ name: `user_${i}`, age: 20 + (i % 50), score: Math.random() * 100 });
  }
  const elapsed = performance.now() - start;
  return { operation: 'insertOne', database: db, iterations: count, totalTimeMs: elapsed, avgPerOpMs: elapsed / count, opsPerSec: count / (elapsed / 1000) };
}

async function benchFind(client: JSDBClient, db: string, count: number): Promise<BenchResult> {
  const coll = client.collection(BENCH_COLLECTION);
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await coll.find({ age: { $gt: 25 } });
  }
  const elapsed = performance.now() - start;
  return { operation: 'find(filter)', database: db, iterations: count, totalTimeMs: elapsed, avgPerOpMs: elapsed / count, opsPerSec: count / (elapsed / 1000) };
}

async function benchUpdate(client: JSDBClient, db: string, count: number): Promise<BenchResult> {
  const coll = client.collection(BENCH_COLLECTION);
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await coll.updateMany({ age: { $gt: 30 } }, { $set: { score: 99.9 } });
  }
  const elapsed = performance.now() - start;
  return { operation: 'updateMany', database: db, iterations: count, totalTimeMs: elapsed, avgPerOpMs: elapsed / count, opsPerSec: count / (elapsed / 1000) };
}

async function benchAggregate(client: JSDBClient, db: string, count: number): Promise<BenchResult> {
  const coll = client.collection(BENCH_COLLECTION);
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await coll.aggregate([
      { $match: { age: { $gt: 20 } } },
      { $group: { _id: null, avgScore: { $avg: '$score' }, totalAge: { $sum: '$age' } } },
    ]);
  }
  const elapsed = performance.now() - start;
  return { operation: 'aggregate($match+$group)', database: db, iterations: count, totalTimeMs: elapsed, avgPerOpMs: elapsed / count, opsPerSec: count / (elapsed / 1000) };
}

async function benchCount(client: JSDBClient, db: string, count: number): Promise<BenchResult> {
  const coll = client.collection(BENCH_COLLECTION);
  const start = performance.now();
  for (let i = 0; i < count; i++) {
    await coll.count({});
  }
  const elapsed = performance.now() - start;
  return { operation: 'count({})', database: db, iterations: count, totalTimeMs: elapsed, avgPerOpMs: elapsed / count, opsPerSec: count / (elapsed / 1000) };
}

async function runBenchmarksForDb(label: string, config: typeof MYSQL_CONFIG): Promise<BenchResult[]> {
  const client = createClient(config);
  await client.connect();
  const coll = client.collection(BENCH_COLLECTION);

  // Create table if needed
  try {
    if (label === 'MySQL') {
      await client.raw(`CREATE TABLE IF NOT EXISTS \`${BENCH_COLLECTION}\` (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255), age INT, score DECIMAL(10,2))`);
    } else if (label === 'PostgreSQL') {
      await client.raw(`CREATE TABLE IF NOT EXISTS "${BENCH_COLLECTION}" (id SERIAL PRIMARY KEY, name TEXT, age INT, score DECIMAL(10,2))`);
    }
  } catch { /* ignore */ }

  // Clean slate
  try { await client.raw(`DELETE FROM \`${BENCH_COLLECTION}\``); } catch { /* ignore */ }
  try { await client.raw(`DELETE FROM "${BENCH_COLLECTION}"`); } catch { /* ignore */ }
  try { await coll.deleteMany({}); } catch { /* ignore */ }

  const N = 100;
  const results: BenchResult[] = [];

  results.push(await benchInsert(client, label, N));
  results.push(await benchFind(client, label, N));
  results.push(await benchUpdate(client, label, N));
  results.push(await benchAggregate(client, label, N));
  results.push(await benchCount(client, label, N));

  // Cleanup
  try { await client.raw(`DROP TABLE IF EXISTS \`${BENCH_COLLECTION}\``); } catch { /* cleanup */ }
  try { await coll.deleteMany({}); } catch { /* cleanup */ }

  await client.disconnect();
  return results;
}

describe('Performance Baseline', () => {
  const allResults: BenchResult[] = [];

  afterAll(() => {
    report(allResults);
  });

  it('MySQL benchmarks', async () => {
    const results = await runBenchmarksForDb('MySQL', MYSQL_CONFIG);
    allResults.push(...results);
    expect(results.length).toBe(5);
    for (const r of results) {
      expect(r.avgPerOpMs).toBeGreaterThan(0);
    }
  }, 120000);

  it('MongoDB benchmarks', async () => {
    const results = await runBenchmarksForDb('MongoDB', MONGO_CONFIG);
    allResults.push(...results);
    expect(results.length).toBe(5);
    for (const r of results) {
      expect(r.avgPerOpMs).toBeGreaterThan(0);
    }
  }, 120000);

  it('PostgreSQL benchmarks', async () => {
    const results = await runBenchmarksForDb('PostgreSQL', PG_CONFIG);
    allResults.push(...results);
    expect(results.length).toBe(5);
    for (const r of results) {
      expect(r.avgPerOpMs).toBeGreaterThan(0);
    }
  }, 120000);
});
