import { describe, it, expect } from 'vitest';
import {
  compileFilter,
  compileSort,
  compileProjection,
  compileUpdate,
  compileAggregation,
  quoteIdentifier,
} from '../../src/adapters/mysql/compiler.js';

describe('MySQL Compiler', () => {
  describe('quoteIdentifier', () => {
    it('wraps in backticks', () => {
      expect(quoteIdentifier('users')).toBe('`users`');
    });
    it('escapes internal backticks', () => {
      expect(quoteIdentifier('use`rs')).toBe('`use``rs`');
    });
    it('rejects invalid identifiers', () => {
      expect(() => quoteIdentifier('')).toThrow();
      expect(() => quoteIdentifier('1invalid')).toThrow();
    });
  });

  describe('compileFilter', () => {
    it('compiles equality filter', () => {
      const params: unknown[] = [];
      const result = compileFilter({ name: 'Alice' }, params);
      expect(result.sql).toBe('`name` = ?');
      expect(params).toEqual(['Alice']);
    });

    it('compiles null check', () => {
      const params: unknown[] = [];
      const result = compileFilter({ deletedAt: null }, params);
      expect(result.sql).toContain('IS NULL');
    });

    it('compiles $gt', () => {
      const params: unknown[] = [];
      const result = compileFilter({ age: { $gt: 18 } }, params);
      expect(result.sql).toBe('`age` > ?');
      expect(params[0]).toBe(18);
    });

    it('compiles $in', () => {
      const params: unknown[] = [];
      const result = compileFilter({ status: { $in: ['active', 'pending'] } }, params);
      expect(result.sql).toBe('`status` IN (?, ?)');
      expect(params).toEqual(['active', 'pending']);
    });

    it('compiles empty $in to always-false', () => {
      const params: unknown[] = [];
      const result = compileFilter({ status: { $in: [] } }, params);
      expect(result.sql).toBe('1 = 0');
    });

    it('compiles $nin', () => {
      const params: unknown[] = [];
      const result = compileFilter({ status: { $nin: ['deleted'] } }, params);
      expect(result.sql).toBe('`status` NOT IN (?)');
    });

    it('compiles $and', () => {
      const params: unknown[] = [];
      const result = compileFilter({
        $and: [{ age: { $gt: 18 } }, { active: true }],
      }, params);
      expect(result.sql).toContain('AND');
      expect(params).toHaveLength(2);
    });

    it('compiles $or', () => {
      const params: unknown[] = [];
      const result = compileFilter({
        $or: [{ role: 'admin' }, { role: 'superadmin' }],
      }, params);
      expect(result.sql).toContain('OR');
    });

    it('compiles $like', () => {
      const params: unknown[] = [];
      const result = compileFilter({ name: { $like: '%Alice%' } }, params);
      expect(result.sql).toBe('`name` LIKE ?');
      expect(params[0]).toBe('%Alice%');
    });

    it('compiles $exists: true', () => {
      const params: unknown[] = [];
      const result = compileFilter({ email: { $exists: true } }, params);
      expect(result.sql).toContain('IS NOT NULL');
    });

    it('compiles $exists: false', () => {
      const params: unknown[] = [];
      const result = compileFilter({ deletedAt: { $exists: false } }, params);
      expect(result.sql).toContain('IS NULL');
    });

    it('emulates $elemMatch via JSON_TABLE EXISTS subquery', () => {
      const params: unknown[] = [];
      const result = compileFilter({ items: { $elemMatch: { qty: { $gt: 1 } } } }, params);
      expect(result.sql).toContain('EXISTS');
      expect(result.sql).toContain('JSON_TABLE');
      expect(params).toContain(1);
    });

    it('returns "1 = 1" for empty filter', () => {
      const params: unknown[] = [];
      const result = compileFilter({}, params);
      expect(result.sql).toBe('1 = 1');
    });
  });

  describe('compileSort', () => {
    it('compiles single sort', () => {
      expect(compileSort({ name: 'asc' })).toBe('ORDER BY `name` ASC');
    });
    it('compiles descending sort', () => {
      expect(compileSort({ createdAt: -1 })).toBe('ORDER BY `createdAt` DESC');
    });
    it('compiles multi-field sort', () => {
      const result = compileSort({ age: 'desc', name: 'asc' });
      expect(result).toContain('`age` DESC');
      expect(result).toContain('`name` ASC');
    });
    it('returns empty string for no sort', () => {
      expect(compileSort(undefined)).toBe('');
      expect(compileSort({})).toBe('');
    });
  });

  describe('compileProjection', () => {
    it('returns * for empty projection', () => {
      expect(compileProjection({})).toBe('*');
      expect(compileProjection(undefined)).toBe('*');
    });
    it('compiles field inclusion', () => {
      const result = compileProjection({ name: 1, email: 1 });
      expect(result).toContain('`name`');
      expect(result).toContain('`email`');
    });
  });

  describe('compileUpdate', () => {
    it('compiles $set', () => {
      const result = compileUpdate({ $set: { name: 'Bob', age: 30 } });
      expect(result.setClauses).toContain('`name` = ?');
      expect(result.params).toContain('Bob');
    });

    it('compiles plain document as $set', () => {
      const result = compileUpdate({ name: 'Bob' });
      expect(result.setClauses).toContain('`name` = ?');
    });

    it('compiles $inc', () => {
      const result = compileUpdate({ $inc: { views: 1 } });
      expect(result.setClauses).toContain('`views` = `views` + ?');
      expect(result.params).toContain(1);
    });

    it('compiles $unset', () => {
      const result = compileUpdate({ $unset: { tempField: '' } });
      expect(result.setClauses).toContain('`tempField` = NULL');
    });

    it('throws for empty update', () => {
      expect(() => compileUpdate({})).toThrow();
    });
  });

  describe('compileAggregation', () => {
    it('compiles $match', () => {
      const result = compileAggregation('orders', [
        { $match: { status: 'paid' } },
      ]);
      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('`status` = ?');
      expect(result.params).toContain('paid');
    });

    it('compiles $group with $sum', () => {
      const result = compileAggregation('orders', [
        { $group: { _id: '$userId', total: { $sum: '$amount' } } },
      ]);
      expect(result.sql).toContain('SUM');
      expect(result.sql).toContain('GROUP BY');
    });

    it('compiles $limit and $skip', () => {
      const result = compileAggregation('orders', [
        { $limit: 10 },
        { $skip: 20 },
      ]);
      expect(result.sql).toContain('LIMIT');
      expect(result.sql).toContain('OFFSET');
    });

    it('emulates $unwind via JSON_TABLE join', () => {
      const result = compileAggregation('orders', [{ $unwind: '$items' }]);
      expect(result.sql).toContain('JSON_TABLE');
      expect(result.sql).not.toThrow;
    });

    it('compiles $lookup via LEFT JOIN', () => {
      const result = compileAggregation('orders', [
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: 'id',
            as: 'user',
          },
        },
      ]);
      expect(result.sql).toContain('LEFT JOIN');
      expect(result.sql).toContain('users');
    });
  });
});
