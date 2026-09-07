// =====================================================
// JSDB - Database Switching Automated Test
// Proves the same universal API works on MySQL AND MongoDB
// without changing business logic.
// =====================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type JSDBClient } from '../../src/index.js';
import { runAllTests, seedUsers } from './universal-app.js';

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

describe('Database Switching Proof', () => {
  let mysqlClient: JSDBClient;
  let mongoClient: JSDBClient;

  beforeAll(async () => {
    mysqlClient = createClient(MYSQL_CONFIG);
    await mysqlClient.connect();
    // MySQL requires table creation — this is the ONLY database-specific code,
    // and it's in test setup, not business logic.
    await mysqlClient.raw(`
      CREATE TABLE IF NOT EXISTS switch_test_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        age INT,
        score DECIMAL(10,2),
        active BOOLEAN DEFAULT true
      )
    `);

    mongoClient = createClient(MONGO_CONFIG);
    await mongoClient.connect();
  }, 30000);

  afterAll(async () => {
    try { await mysqlClient.raw('DROP TABLE IF EXISTS switch_test_users'); } catch {}
    try { await mongoClient.collection('switch_test_users').deleteMany({}); } catch {}
    await mysqlClient.disconnect();
    await mongoClient.disconnect();
  }, 10000);

  describe('MySQL — Universal API', () => {
    it('all operations pass', async () => {
      const results = await runAllTests(mysqlClient);
      const failed = results.filter(r => !r.passed);
      if (failed.length > 0) {
        console.log('Failed operations:', failed.map(f => `${f.operation}: ${f.error}`));
      }
      expect(failed.length).toBe(0);
    });
  });

  describe('MongoDB — Universal API (identical code)', () => {
    it('all operations pass (except transactions on standalone)', async () => {
      const results = await runAllTests(mongoClient);
      const failed = results.filter(r => !r.passed);
      // Transactions require MongoDB replica set — standalone doesn't support them.
      // This is a known infrastructure limitation, not a code bug.
      const transactionFailures = failed.filter(f => f.operation === 'transaction');
      const realFailures = failed.filter(f => f.operation !== 'transaction');
      if (transactionFailures.length > 0) {
        console.log('  [INFO] Transaction skipped — standalone MongoDB (needs replica set)');
      }
      if (realFailures.length > 0) {
        console.log('Failed operations:', realFailures.map(f => `${f.operation}: ${f.error}`));
      }
      expect(realFailures.length).toBe(0);
    });
  });

  describe('Cross-Database Result Equivalence', () => {
    it('insertMany produces same count on both', async () => {
      await seedUsers(mysqlClient);
      await seedUsers(mongoClient);

      const mysqlCount = await mysqlClient.collection('switch_test_users').count({});
      const mongoCount = await mongoClient.collection('switch_test_users').count({});
      expect(mysqlCount).toBe(mongoCount);
    });

    it('find with filter returns same count on both', async () => {
      await seedUsers(mysqlClient);
      await seedUsers(mongoClient);

      const mysqlActive = await mysqlClient.collection('switch_test_users').find({ active: true });
      const mongoActive = await mongoClient.collection('switch_test_users').find({ active: true });
      expect(mysqlActive.length).toBe(mongoActive.length);
    });

    it('aggregate $group returns same structure on both', async () => {
      await seedUsers(mysqlClient);
      await seedUsers(mongoClient);

      const mysqlAgg = await mysqlClient.collection('switch_test_users').aggregate([
        { $group: { _id: '$active', count: { $sum: 1 } } },
      ]);
      const mongoAgg = await mongoClient.collection('switch_test_users').aggregate([
        { $group: { _id: '$active', count: { $sum: 1 } } },
      ]);

      // Both should have 2 groups (true and false)
      expect(mysqlAgg.length).toBe(2);
      expect(mongoAgg.length).toBe(2);
    });
  });
});
