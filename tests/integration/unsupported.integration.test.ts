// =====================================================
// JSDB - Unsupported Operations Verification
// Verify that unsupported operations throw structured errors
// =====================================================
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

describe('Unsupported Operations', () => {
  let mysqlClient: JSDBClient;
  let mongoClient: JSDBClient;

  beforeAll(async () => {
    mysqlClient = createClient(MYSQL_CONFIG);
    await mysqlClient.connect();
    mongoClient = createClient(MONGO_CONFIG);
    await mongoClient.connect();
  }, 30000);

  afterAll(async () => {
    await mysqlClient.disconnect();
    await mongoClient.disconnect();
  }, 10000);

  describe('MySQL unsupported operations', () => {
    it('$elemMatch throws on MySQL', async () => {
      const coll = mysqlClient.collection('jsdb_unsupported_test');
      await expect(
        coll.find({ items: { $elemMatch: { qty: { $gt: 1 } } } })
      ).rejects.toThrow();
    });

    it('$unwind aggregation throws on MySQL', async () => {
      const coll = mysqlClient.collection('jsdb_unsupported_test');
      await expect(
        coll.aggregate([{ $unwind: '$items' }])
      ).rejects.toThrow();
    });
  });

  describe('Capability Registry verification', () => {
    it('MySQL adapter has correct capabilities', () => {
      const adapter = mysqlClient.getAdapter();
      const caps = adapter.capabilities;

      // Native operations
      const findCap = caps.getCapability('mysql', 'crud.find');
      expect(findCap.status).toBe('native');

      // Emulated operations (require JSON columns on MySQL 8.0+)
      const elemMatchCap = caps.getCapability('mysql', 'filter.elemMatch');
      expect(elemMatchCap.status).toBe('emulated');

      const unwindCap = caps.getCapability('mysql', 'aggregation.unwind');
      expect(unwindCap.status).toBe('emulated');

      // Emulated operations
      const exclProjCap = caps.getCapability('mysql', 'projection.exclusion');
      expect(exclProjCap.status).toBe('emulated');
    });

    it('MongoDB adapter has correct capabilities', () => {
      const adapter = mongoClient.getAdapter();
      const caps = adapter.capabilities;

      // All MVP operations should be native
      const findCap = caps.getCapability('mongodb', 'crud.find');
      expect(findCap.status).toBe('native');

      const elemMatchCap = caps.getCapability('mongodb', 'filter.elemMatch');
      expect(elemMatchCap.status).toBe('native');

      const unwindCap = caps.getCapability('mongodb', 'aggregation.unwind');
      expect(unwindCap.status).toBe('native');
    });
  });

  describe('Database type verification', () => {
    it('mysqlClient reports mysql', () => {
      expect(mysqlClient.getDatabaseType()).toBe('mysql');
    });

    it('mongoClient reports mongodb', () => {
      expect(mongoClient.getDatabaseType()).toBe('mongodb');
    });
  });
});
