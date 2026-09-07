import { describe, it, expect } from 'vitest';
import { SchemaEngine } from '../../src/schema/engine.js';
import type { CollectionSchema } from '../../src/types/index.js';

const userSchema: CollectionSchema = {
  name: 'users',
  fields: {
    id: { type: 'integer', primaryKey: true, autoIncrement: true },
    name: { type: 'string', required: true, maxLength: 100 },
    email: { type: 'string', required: true, unique: true },
    age: { type: 'integer', nullable: true },
    active: { type: 'boolean', default: true },
    createdAt: { type: 'date' },
  },
  indexes: [
    { fields: ['email'], unique: true, name: 'idx_users_email' },
    { fields: ['name'] },
  ],
  timestamps: false,
};

describe('SchemaEngine', () => {
  describe('MySQL DDL', () => {
    it('generates CREATE TABLE', () => {
      const stmts = SchemaEngine.generateMySQLDDL(userSchema);
      const create = stmts.find((s) => s.type === 'CREATE_TABLE');
      expect(create).toBeDefined();
      expect(create!.sql).toContain('CREATE TABLE IF NOT EXISTS');
      expect(create!.sql).toContain('`users`');
      expect(create!.sql).toContain('`id`');
      expect(create!.sql).toContain('AUTO_INCREMENT');
    });

    it('generates index statements', () => {
      const stmts = SchemaEngine.generateMySQLDDL(userSchema);
      const indexes = stmts.filter((s) => s.type === 'CREATE_INDEX');
      expect(indexes.length).toBeGreaterThan(0);
      expect(indexes.some((i) => i.sql.includes('UNIQUE'))).toBe(true);
    });

    it('marks all statements as mysql', () => {
      const stmts = SchemaEngine.generateMySQLDDL(userSchema);
      expect(stmts.every((s) => s.database === 'mysql')).toBe(true);
    });
  });

  describe('PostgreSQL DDL', () => {
    it('generates CREATE TABLE', () => {
      const stmts = SchemaEngine.generatePostgresDDL(userSchema);
      const create = stmts.find((s) => s.type === 'CREATE_TABLE');
      expect(create).toBeDefined();
      expect(create!.sql).toContain('"users"');
    });

    it('uses SERIAL for auto-increment', () => {
      const stmts = SchemaEngine.generatePostgresDDL(userSchema);
      const create = stmts.find((s) => s.type === 'CREATE_TABLE');
      expect(create!.sql).toContain('SERIAL');
    });
  });

  describe('SQLite DDL', () => {
    it('generates CREATE TABLE', () => {
      const stmts = SchemaEngine.generateSQLiteDDL(userSchema);
      const create = stmts.find((s) => s.type === 'CREATE_TABLE');
      expect(create).toBeDefined();
      expect(create!.sql).toContain('AUTOINCREMENT');
    });
  });

  describe('MongoDB indexes', () => {
    it('generates index commands', () => {
      const cmds = SchemaEngine.generateMongoDBIndexCommands(userSchema);
      expect(cmds.length).toBeGreaterThan(0);
      expect(cmds.some((c) => (c.options as Record<string, unknown>).unique === true)).toBe(true);
    });
  });

  describe('generateAll', () => {
    it('generates for all 4 databases', () => {
      const all = SchemaEngine.generateAll(userSchema);
      expect(all.mysql.length).toBeGreaterThan(0);
      expect(all.postgres.length).toBeGreaterThan(0);
      expect(all.sqlite.length).toBeGreaterThan(0);
      expect(all.mongodb).toHaveLength(0); // Schema-less
    });
  });

  describe('validate', () => {
    it('validates a correct schema', () => {
      const errors = SchemaEngine.validate(userSchema);
      expect(errors).toHaveLength(0);
    });

    it('reports missing name', () => {
      const bad = { ...userSchema, name: '' };
      const errors = SchemaEngine.validate(bad);
      expect(errors.some((e) => e.includes('name'))).toBe(true);
    });

    it('reports empty fields', () => {
      const bad = { ...userSchema, fields: {} };
      const errors = SchemaEngine.validate(bad);
      expect(errors.some((e) => e.includes('field'))).toBe(true);
    });
  });
});
