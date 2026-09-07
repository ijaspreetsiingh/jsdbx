// =====================================================
// JSDB - SQL → MongoDB Translation Proof Tests
// Validates that SQL queries translate correctly to MongoDB
// =====================================================
import { describe, it, expect } from 'vitest';
import { parseSQL, sqlToIR } from '../../src/ir/sql-parser.js';
import { queryPlanner } from '../../src/planner/planner.js';
import { SQLToMongoTranslator } from '../../src/translation/sql-to-mongo.js';
import { MongoToSQLTranslator } from '../../src/translation/mongo-to-sql.js';
import type { TranslationStatus } from '../../src/translation/status.js';

describe('SQL → MongoDB Translation', () => {
  const translator = new SQLToMongoTranslator();

  describe('SELECT translation', () => {
    it('translates simple SELECT * to pipeline', () => {
      const result = translator.translate('SELECT * FROM users WHERE age > 25');
      expect(result.report.score).toBeGreaterThan(0);
      expect(result.mongoPipeline).toBeDefined();
      expect(Array.isArray(result.mongoPipeline)).toBe(true);
    });

    it('translates SELECT with specific fields', () => {
      const result = translator.translate('SELECT name, email FROM users WHERE age > 25 ORDER BY name LIMIT 10');
      expect(result.report.score).toBeGreaterThan(0);
      expect(result.mongoPipeline.length).toBeGreaterThan(0);
    });

    it('translates SELECT COUNT(*) to aggregation', () => {
      const result = translator.translate('SELECT COUNT(*) FROM users WHERE active = 1');
      expect(result.report.score).toBeGreaterThan(0);
      expect(result.mongoPipeline).toBeDefined();
    });

    it('translates GROUP BY to $group', () => {
      const result = translator.translate('SELECT department, AVG(salary) FROM users GROUP BY department');
      expect(result.report.score).toBeGreaterThan(0);
      expect(result.mongoPipeline).toBeDefined();
    });
  });

  describe('INSERT translation', () => {
    it('translates INSERT and produces valid IR', () => {
      const result = translator.translate("INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@test.com', 30)");
      expect(result.executionPlan).toBeDefined();
      expect(result.executionPlan.ir.type).toBe('insert');
      expect(result.executionPlan.ir.collection).toBe('users');
    });
  });

  describe('UPDATE translation', () => {
    it('translates UPDATE and produces valid IR', () => {
      const result = translator.translate("UPDATE users SET age = 31 WHERE name = 'Alice'");
      expect(result.executionPlan).toBeDefined();
      expect(result.executionPlan.ir.type).toBe('updateMany');
      expect(result.executionPlan.ir.collection).toBe('users');
    });
  });

  describe('DELETE translation', () => {
    it('translates DELETE and produces valid IR', () => {
      const result = translator.translate('DELETE FROM users WHERE age < 18');
      expect(result.executionPlan).toBeDefined();
      expect(result.executionPlan.ir.type).toBe('deleteMany');
      expect(result.executionPlan.ir.collection).toBe('users');
    });
  });

  describe('IR Pipeline', () => {
    const sqlCases = [
      'SELECT * FROM users WHERE age > 25',
      'SELECT name, email FROM users WHERE age > 25 ORDER BY name LIMIT 10',
      "INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@test.com', 30)",
      "UPDATE users SET age = 31 WHERE name = 'Alice'",
      'DELETE FROM users WHERE age < 18',
      'SELECT COUNT(*) FROM users WHERE active = 1',
      'SELECT department, AVG(salary) FROM users GROUP BY department',
    ];

    for (const sql of sqlCases) {
      it(`IR parses: ${sql.substring(0, 50)}...`, () => {
        const parsed = parseSQL(sql);
        const ir = sqlToIR(parsed);
        expect(ir).toBeDefined();
        expect(ir.type).toBeDefined();
        expect(ir.collection).toBeDefined();
      });
    }
  });

  describe('MongoDB → SQL Translation', () => {
    const mongoToSql = new MongoToSQLTranslator({ targetDb: 'mysql' });

    it('translates find to SELECT', () => {
      const result = mongoToSql.translateFind('users', { age: { $gt: 25 } });
      expect(result.sql).toContain('SELECT');
      expect(result.sql).toContain('users');
      expect(result.report.score).toBeGreaterThan(0);
    });

    it('translates insertOne to INSERT', () => {
      const result = mongoToSql.translateInsertOne('users', { name: 'Alice', age: 30 });
      expect(result.sql).toContain('INSERT');
      expect(result.sql).toContain('users');
      expect(result.report.score).toBeGreaterThan(0);
    });

    it('translates updateOne to UPDATE', () => {
      const result = mongoToSql.translateUpdateOne('users', { name: 'Alice' }, { $set: { age: 31 } });
      expect(result.sql).toContain('UPDATE');
      expect(result.sql).toContain('users');
      expect(result.report.score).toBeGreaterThan(0);
    });

    it('translates deleteOne to DELETE', () => {
      const result = mongoToSql.translateDeleteOne('users', { age: { $lt: 18 } });
      expect(result.sql).toContain('DELETE');
      expect(result.sql).toContain('users');
      expect(result.report.score).toBeGreaterThan(0);
    });

    it('translates find with sort and limit', () => {
      const result = mongoToSql.translateFind('users', { active: true }, {
        sort: { age: 'asc' },
        limit: 10,
        skip: 5,
      });
      expect(result.sql).toContain('SELECT');
      expect(result.sql).toContain('ORDER BY');
      expect(result.sql).toContain('LIMIT');
    });

    it('translates $in filter', () => {
      const result = mongoToSql.translateFind('users', { name: { $in: ['Alice', 'Bob'] } });
      expect(result.sql).toContain('IN');
    });

    it('translates $or filter', () => {
      const result = mongoToSql.translateFind('users', {
        $or: [{ age: { $lt: 25 } }, { age: { $gt: 35 } }],
      });
      expect(result.sql).toContain('OR');
    });

    it('translates $and filter', () => {
      const result = mongoToSql.translateFind('users', {
        $and: [{ age: { $gt: 25 } }, { active: true }],
      });
      expect(result.sql).toContain('AND');
    });
  });

  describe('Translation Status Classification', () => {
    it('classifies simple SELECT as native', () => {
      const result = translator.translate('SELECT * FROM users WHERE age > 25');
      const statuses = result.report.features.map(f => f.status);
      expect(statuses).toContain('native');
    });

    it('classifies JOIN as emulated', () => {
      const result = translator.translate(
        'SELECT u.name, o.total FROM users u INNER JOIN orders o ON u.id = o.user_id'
      );
      const joinFeature = result.report.features.find(f => f.feature === 'join');
      expect(joinFeature).toBeDefined();
      expect(joinFeature!.status).toBe('emulated');
    });
  });
});
