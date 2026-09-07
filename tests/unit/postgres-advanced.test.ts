// =====================================================
// JSDB - PostgreSQL Advanced Compiler Unit Tests
// Tests for: Deep Joins, CTE, Window Functions, $facet, $bucket
// =====================================================
import { describe, it, expect } from 'vitest';
import {
  compileDeepJoin,
  compileRecursiveCTE,
  compileWindowFunction,
  compileFacet,
  compileBucket,
  compileStoredProcedure,
  compileStoredFunction,
  compileCursorPagination,
} from '../../src/adapters/postgres/compiler.js';

describe('PostgreSQL Advanced Compiler', () => {
  describe('Deep Joins', () => {
    it('should compile multiple joins with $1 params', () => {
      const joins = [
        {
          collection: 'users',
          as: 'user',
          on: { localField: 'userId', foreignField: '_id' },
          type: 'left',
        },
        {
          collection: 'products',
          as: 'product',
          on: { localField: 'productId', foreignField: '_id' },
          type: 'inner',
        },
      ];

      const result = compileDeepJoin('orders', joins);
      expect(result.sql).toContain('LEFT JOIN');
      expect(result.sql).toContain('INNER JOIN');
      expect(result.sql).toContain('"users"');
      expect(result.sql).toContain('"products"');
      // PostgreSQL uses $1 params
      expect(result.sql).not.toContain('?');
    });

    it('should compile join with filter and sort', () => {
      const joins = [
        {
          collection: 'users',
          as: 'user',
          on: { localField: 'userId', foreignField: '_id' },
        },
      ];

      const result = compileDeepJoin('orders', joins, {
        filter: { status: 'completed' },
        sort: { amount: -1 },
        limit: 10,
      });
      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('ORDER BY');
      expect(result.sql).toContain('LIMIT');
    });
  });

  describe('Recursive CTE', () => {
    it('should compile recursive CTE with $1 params', () => {
      const cte = {
        name: 'org_tree',
        startWith: { managerId: null },
        connectBy: { field: 'managerId', references: '_id' },
        maxDepth: 10,
      };

      const result = compileRecursiveCTE('employees', cte);
      expect(result.sql).toContain('WITH RECURSIVE');
      expect(result.sql).toContain('UNION ALL');
      expect(result.sql).toContain('_depth');
    });

    it('should compile CTE with SEARCH clause', () => {
      const cte = {
        name: 'org_tree',
        startWith: { managerId: null },
        connectBy: { field: 'managerId', references: '_id' },
        search: 'breadth',
      };

      const result = compileRecursiveCTE('employees', cte);
      expect(result.sql).toContain('SEARCH BREADTH FIRST');
    });
  });

  describe('Window Functions', () => {
    it('should compile RANK() with PARTITION BY', () => {
      const pipeline = [
        { $match: { status: 'completed' } },
        {
          $setWindowFields: {
            partitionBy: '$customerId',
            sortBy: { amount: -1 },
            output: {
              rank: { $function: '$rank' },
            },
          },
        },
      ];

      const result = compileWindowFunction('orders', pipeline);
      expect(result.sql).toContain('RANK()');
      expect(result.sql).toContain('PARTITION BY');
      expect(result.sql).toContain('OVER');
    });

    it('should compile ROW_NUMBER() without partition', () => {
      const pipeline = [
        {
          $setWindowFields: {
            output: {
              rowNum: { $function: '$rowNumber' },
            },
          },
        },
      ];

      const result = compileWindowFunction('orders', pipeline);
      expect(result.sql).toContain('ROW_NUMBER()');
    });
  });

  describe('$facet', () => {
    it('should compile multiple facets with subqueries', () => {
      const facets = {
        byCategory: [
          { $group: { _id: '$category', count: { $sum: 1 } } },
        ],
        priceStats: [
          { $group: { _id: null, avg: { $avg: '$price' } } },
        ],
      };

      const result = compileFacet('products', facets);
      expect(result.sql).toContain('byCategory');
      expect(result.sql).toContain('priceStats');
      expect(result.sql).toContain('UNION ALL');
    });
  });

  describe('$bucket', () => {
    it('should compile bucket with CASE WHEN', () => {
      const bucketDef = {
        groupBy: '$amount',
        boundaries: [0, 100, 500, 1000],
        default: '1000+',
      };

      const result = compileBucket('orders', bucketDef);
      expect(result.sql).toContain('CASE');
      expect(result.sql).toContain('WHEN');
      expect(result.sql).toContain('GROUP BY');
    });
  });

  describe('Stored Procedures', () => {
    it('should compile CALL statement', () => {
      const result = compileStoredProcedure('calculateReport', [2024, 1]);
      expect(result.sql).toContain('CALL');
      expect(result.sql).toContain('$1');
      expect(result.sql).toContain('$2');
    });

    it('should compile function call', () => {
      const result = compileStoredFunction('getDistance', [28.6139, 77.2090]);
      expect(result.sql).toContain('SELECT');
      expect(result.sql).toContain('$1');
    });
  });

  describe('Cursor Pagination', () => {
    it('should compile cursor pagination with $1 params', () => {
      const result = compileCursorPagination('orders', { status: 'completed' }, {
        after: 'abc123',
        limit: 20,
        sortField: '_id',
        sortOrder: 1,
      });
      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('ORDER BY');
      expect(result.sql).toContain('LIMIT');
      expect(result.sql).toContain('$1');
    });
  });
});
