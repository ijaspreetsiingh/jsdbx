// =====================================================
// JSDB - Advanced Aggregation Unit Tests
// Tests for: $setWindowFields, $facet, $bucket, $graphLookup, etc.
// =====================================================
import { describe, it, expect } from 'vitest';
import { IRBuilder } from '../../src/ir/builder.js';
import {
  compileWindowFunction,
  compileFacet,
  compileBucket,
  compileDeepJoin,
  compileRecursiveCTE,
  compileStoredProcedure,
  compileStoredFunction,
  compileCursorPagination,
} from '../../src/adapters/mysql/compiler.js';

describe('Advanced Aggregation', () => {
  describe('$setWindowFields (MySQL)', () => {
    it('should compile RANK() window function', () => {
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
      expect(result.sql).toContain('ORDER BY');
    });

    it('should compile ROW_NUMBER() window function', () => {
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

    it('should compile SUM() OVER with window frame', () => {
      const pipeline = [
        {
          $setWindowFields: {
            partitionBy: '$customerId',
            sortBy: { createdAt: 1 },
            output: {
              runningTotal: {
                $function: '$sum',
                $value: '$amount',
                window: {
                  documents: ['unbounded', 'current'],
                },
              },
            },
          },
        },
      ];

      const result = compileWindowFunction('orders', pipeline);
      expect(result.sql).toContain('SUM(');
      expect(result.sql).toContain('OVER');
    });
  });

  describe('$facet (MySQL)', () => {
    it('should compile multiple facets', () => {
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

  describe('$bucket (MySQL)', () => {
    it('should compile bucket with boundaries', () => {
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

  describe('Deep Joins (MySQL)', () => {
    it('should compile multiple joins', () => {
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
      expect(result.sql).toContain('`users`');
      expect(result.sql).toContain('`products`');
    });

    it('should compile join with filter', () => {
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

  describe('Recursive CTE (MySQL)', () => {
    it('should compile recursive CTE', () => {
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

    it('should compile CTE with cycle detection', () => {
      const cte = {
        name: 'org_tree',
        startWith: { managerId: null },
        connectBy: { field: 'managerId', references: '_id' },
        cycleDetection: true,
      };

      const result = compileRecursiveCTE('employees', cte);
      expect(result.sql).toContain('CYCLE');
    });
  });

  describe('Stored Procedures (MySQL)', () => {
    it('should compile CALL statement', () => {
      const result = compileStoredProcedure('calculateReport', [2024, 1]);
      expect(result.sql).toContain('CALL');
      expect(result.params).toEqual([2024, 1]);
    });

    it('should compile function call', () => {
      const result = compileStoredFunction('getDistance', [28.6139, 77.2090]);
      expect(result.sql).toContain('SELECT');
      expect(result.sql).toContain('getDistance');
    });
  });

  describe('Cursor Pagination (MySQL)', () => {
    it('should compile cursor pagination', () => {
      const result = compileCursorPagination('orders', { status: 'completed' }, {
        after: 'abc123',
        limit: 20,
        sortField: '_id',
        sortOrder: 1,
      });
      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('ORDER BY');
      expect(result.sql).toContain('LIMIT');
    });
  });
});

describe('IR Builder - New Operations', () => {
  it('should create join IR node', () => {
    const ir = IRBuilder.join('orders', [
      {
        collection: 'users',
        as: 'user',
        on: { localField: 'userId', foreignField: '_id' },
        type: 'left',
      },
    ]);
    expect(ir.type).toBe('join');
    expect(ir.joins).toHaveLength(1);
    expect(ir.joins[0].collection).toBe('users');
  });

  it('should create recursiveCTE IR node', () => {
    const ir = IRBuilder.recursiveCTE('employees', {
      name: 'org_tree',
      startWith: { managerId: null },
      connectBy: { field: 'managerId', references: '_id' },
      maxDepth: 10,
    });
    expect(ir.type).toBe('recursiveCTE');
    expect(ir.cte.name).toBe('org_tree');
    expect(ir.cte.maxDepth).toBe(10);
  });

  it('should create storedProcedure IR node', () => {
    const ir = IRBuilder.callStoredProcedure({
      name: 'calculateReport',
      parameters: [2024, 1],
    });
    expect(ir.type).toBe('storedProcedure');
    expect(ir.procedure.name).toBe('calculateReport');
  });

  it('should create watch IR node', () => {
    const ir = IRBuilder.watch('orders');
    expect(ir.type).toBe('watch');
    expect(ir.collection).toBe('orders');
  });

  it('should create cursorPaginate IR node', () => {
    const ir = IRBuilder.cursorPaginate('orders', { status: 'completed' }, {
      after: 'abc123',
      limit: 20,
    });
    expect(ir.type).toBe('cursorPaginate');
    expect(ir.pagination.after).toBe('abc123');
  });

  it('should detect capabilities for new operations', () => {
    const joinIR = IRBuilder.join('orders', [
      {
        collection: 'users',
        as: 'user',
        on: { localField: 'userId', foreignField: '_id' },
        type: 'left',
      },
    ]);
    const caps = IRBuilder.detectRequiredCapabilities(joinIR);
    expect(caps).toContain('join');
    expect(caps).toContain('join.left');
  });

  it('should detect recursive CTE capabilities', () => {
    const ir = IRBuilder.recursiveCTE('employees', {
      name: 'org_tree',
      startWith: { managerId: null },
      connectBy: { field: 'managerId', references: '_id' },
      maxDepth: 10,
      search: 'breadth',
      cycleDetection: true,
    });
    const caps = IRBuilder.detectRequiredCapabilities(ir);
    expect(caps).toContain('recursive.cte');
    expect(caps).toContain('recursive.bfs');
    expect(caps).toContain('recursive.cycleDetection');
  });
});
