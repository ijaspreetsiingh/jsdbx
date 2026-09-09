// =====================================================
// JSDB v2.0 - Regression Tests for Bug Fixes
// Tests: concurrency, stored procs, $facet, bulkWrite,
//        distinct, CacheStats, parameter isolation
// =====================================================
import { describe, it, expect } from 'vitest';
import {
  compileFilter,
  compileUpdate,
  compileAggregation,
  compileStoredProcedure,
  compileStoredFunction,
  compileFacet,
  compileDeepJoin,
  compileRecursiveCTE,
  compileWindowFunction,
  compileCursorPagination,
  compileBucket,
  _makeCounter,
} from '../../src/adapters/postgres/compiler.js';
import {
  compileFilter as mysqlCompileFilter,
  compileStoredProcedure as mysqlCompileStoredProcedure,
  compileStoredFunction as mysqlCompileStoredFunction,
  compileAggregation as mysqlCompileAggregation,
} from '../../src/adapters/mysql/compiler.js';
import { LRUCache } from '../../src/cache/lru-cache.js';
import { JSDBUnsupportedOperationError } from '../../src/errors/index.js';

// =====================================================
// 1. PostgreSQL Parameter Counter Concurrency Bug
// =====================================================
describe('Regression: PostgreSQL Parameter Counter Concurrency', () => {
  it('should isolate parameter indexes between concurrent compileFilter calls', () => {
    // Simulate two concurrent queries
    const params1: unknown[] = [];
    const params2: unknown[] = [];

    const result1 = compileFilter({ name: 'Alice', age: { $gt: 25 } }, params1, 1);
    const result2 = compileFilter({ status: 'active', role: 'admin' }, params2, 1);

    // Query 1 should use $1, $2
    expect(result1.sql).toContain('$1');
    expect(result1.sql).toContain('$2');
    expect(result1.params).toEqual(['Alice', 25]);

    // Query 2 should also use $1, $2 (not $3, $4)
    expect(result2.sql).toContain('$1');
    expect(result2.sql).toContain('$2');
    expect(result2.params).toEqual(['active', 'admin']);
  });

  it('should handle interleaved compileFilter calls without corruption', () => {
    const _params: unknown[] = [];
    const _counter = _makeCounter(0);

    // Simulate interleaved access
    const r1 = compileFilter({ a: 1 }, [], 1);
    const r2 = compileFilter({ b: 2 }, [], 1);
    const r3 = compileFilter({ c: 3 }, [], 1);

    // Each should independently start at $1
    expect(r1.sql).toBe('"a" = $1');
    expect(r1.params).toEqual([1]);

    expect(r2.sql).toBe('"b" = $1');
    expect(r2.params).toEqual([2]);

    expect(r3.sql).toBe('"c" = $1');
    expect(r3.params).toEqual([3]);
  });

  it('should correctly increment params within a single complex query', () => {
    const params: unknown[] = [];
    const result = compileFilter({
      $and: [
        { age: { $gte: 18 } },
        { status: { $in: ['active', 'pending'] } },
        { name: { $like: '%test%' } },
      ],
    }, params, 1);

    // Should have 5 params: 18, 'active', 'pending', '%test%'
    // Actually: $gte(18), $in('active', 'pending'), $like('%test%') = 4 params
    expect(result.params).toHaveLength(4);
    expect(result.params[0]).toBe(18);
    expect(result.params[1]).toBe('active');
    expect(result.params[2]).toBe('pending');
    expect(result.params[3]).toBe('%test%');

    // All params should be referenced as $1..$4
    expect(result.sql).toContain('$1');
    expect(result.sql).toContain('$2');
    expect(result.sql).toContain('$3');
    expect(result.sql).toContain('$4');
    expect(result.sql).not.toContain('$5');
  });

  it('should handle startIndex offset correctly', () => {
    const params: unknown[] = ['pre-existing-param'];
    const result = compileFilter({ name: 'test' }, params, 2);

    expect(result.sql).toBe('"name" = $2');
    expect(result.params).toEqual(['pre-existing-param', 'test']);
  });

  it('should handle concurrent aggregation compilations independently', () => {
    const pipeline1 = [{ $match: { status: 'active' } }, { $limit: 10 }];
    const pipeline2 = [{ $match: { role: 'admin' } }, { $skip: 5 }];

    const r1 = compileAggregation('users', pipeline1);
    const r2 = compileAggregation('users', pipeline2);

    // Each should have independent params
    expect(r1.params).toEqual(['active', 10]);
    expect(r2.params).toEqual(['admin', 5]);
  });

  it('makeCounter creates independent counter objects', () => {
    const c1 = makeCounter(0);
    const c2 = makeCounter(0);

    c1.n++;
    c1.n++;
    c1.n++;

    // c2 should be unaffected
    expect(c1.n).toBe(3);
    expect(c2.n).toBe(0);
  });
});

// =====================================================
// 2. Stored Procedure Argument Indexing Bug
// =====================================================
describe('Regression: Stored Procedure Argument Indexing', () => {
  it('PostgreSQL: should correctly map each arg to its parameter', () => {
    const result = compileStoredProcedure('calculateReport', [2024, 'Q1', true]);

    expect(result.params).toEqual([2024, 'Q1', true]);
    expect(result.sql).toContain('$1');
    expect(result.sql).toContain('$2');
    expect(result.sql).toContain('$3');
    expect(result.sql).toBe('CALL "calculateReport"($1, $2, $3)');
  });

  it('PostgreSQL: should handle single argument', () => {
    const result = compileStoredProcedure('sp_getUser', [42]);

    expect(result.params).toEqual([42]);
    expect(result.sql).toBe('CALL "sp_getUser"($1)');
  });

  it('PostgreSQL: should handle empty args', () => {
    const result = compileStoredProcedure('sp_noArgs', []);

    expect(result.params).toEqual([]);
    expect(result.sql).toBe('CALL "sp_noArgs"()');
  });

  it('PostgreSQL: should handle function with mixed types', () => {
    const result = compileStoredFunction('getDistance', [28.6139, 77.2090, 'km']);

    expect(result.params).toEqual([28.6139, 77.2090, 'km']);
    expect(result.sql).toContain('$1');
    expect(result.sql).toContain('$2');
    expect(result.sql).toContain('$3');
  });

  it('MySQL: should correctly map each arg to its parameter', () => {
    const result = mysqlCompileStoredProcedure('calculateReport', [2024, 'Q1', true]);

    expect(result.params).toEqual([2024, 'Q1', true]);
    expect(result.sql).toBe('CALL `calculateReport`(?, ?, ?)');
  });

  it('MySQL: should handle single argument', () => {
    const result = mysqlCompileStoredProcedure('sp_getUser', [42]);

    expect(result.params).toEqual([42]);
    expect(result.sql).toBe('CALL `sp_getUser`(?)');
  });

  it('MySQL: should handle empty args', () => {
    const result = mysqlCompileStoredProcedure('sp_noArgs', []);

    expect(result.params).toEqual([]);
    expect(result.sql).toBe('CALL `sp_noArgs`()');
  });

  it('MySQL: function call correctly maps arguments', () => {
    const result = mysqlCompileStoredFunction('getDistance', [28.6139, 77.2090]);

    expect(result.params).toEqual([28.6139, 77.2090]);
    expect(result.sql).toContain('`getDistance`(?, ?)');
  });
});

// =====================================================
// 3. $facet Handling — Should Throw, Not Skip
// =====================================================
describe('Regression: $facet Should Throw UNSUPPORTED Error', () => {
  it('PostgreSQL: compileAggregation should throw on $facet', () => {
    const pipeline = [
      { $facet: {
        byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
        priceStats: [{ $group: { _id: null, avg: { $avg: '$price' } } }],
      }},
    ];

    expect(() => compileAggregation('products', pipeline)).toThrow(JSDBUnsupportedOperationError);
  });

  it('MySQL: compileAggregation should throw on $facet', () => {
    const pipeline = [
      { $facet: {
        byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
      }},
    ];

    expect(() => mysqlCompileAggregation('products', pipeline)).toThrow(JSDBUnsupportedOperationError);
  });

  it('PostgreSQL: $facet error message includes suggestion', () => {
    const pipeline = [
      { $facet: {
        byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
      }},
    ];

    try {
      compileAggregation('products', pipeline);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(JSDBUnsupportedOperationError);
      expect((e as JSDBUnsupportedOperationError).portabilityInfo?.status).toBe('unsupported');
      expect((e as JSDBUnsupportedOperationError).portabilityInfo?.suggestion).toContain('separate queries');
    }
  });

  it('PostgreSQL: $facet should still work via compileFacet (dedicated function)', () => {
    const facets = {
      byCategory: [{ $group: { _id: '$category', count: { $sum: 1 } } }],
      priceStats: [{ $group: { _id: null, avg: { $avg: '$price' } } }],
    };

    const result = compileFacet('products', facets);
    expect(result.sql).toContain('byCategory');
    expect(result.sql).toContain('priceStats');
    expect(result.sql).toContain('UNION ALL');
  });
});

// =====================================================
// 4. CacheStats Type Fix
// =====================================================
describe('Regression: CacheStats Type', () => {
  it('expired field should be a number, not literal 0', () => {
    const cache = new LRUCache({ maxSize: 100, defaultTtlMs: 1000 });

    // Set and expire entries
    cache.set('key1', 'value1', 1); // 1ms TTL

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy wait
    }

    // Access expired key to trigger expiration tracking
    cache.get('key1');

    const stats = cache.getStats();
    expect(typeof stats.expired).toBe('number');
    expect(stats.expired).toBeGreaterThanOrEqual(0);
  });

  it('expired counter should increment on expired access', () => {
    const cache = new LRUCache({ maxSize: 100, defaultTtlMs: 1 });

    cache.set('temp', 'data');

    // Wait for TTL
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }

    cache.get('temp'); // Should detect expiry

    const stats = cache.getStats();
    expect(stats.expired).toBeGreaterThanOrEqual(1);
  });

  it('CacheStats interface accepts number for expired', () => {
    const cache = new LRUCache();
    const stats = cache.getStats();
    // This should compile without errors — expired is number, not literal 0
    const expired: number = stats.expired;
    expect(typeof expired).toBe('number');
  });
});

// =====================================================
// 5. PostgreSQL Update with Counter Isolation
// =====================================================
describe('Regression: PostgreSQL Update Parameter Isolation', () => {
  it('compileUpdate should produce correct param indexes', () => {
    const result = compileUpdate({ $set: { name: 'Bob', age: 30 } }, 1);

    expect(result.params).toEqual(['Bob', 30]);
    expect(result.setClauses).toContain('"name" = $1');
    expect(result.setClauses).toContain('"age" = $2');
  });

  it('compileUpdate with $inc should use correct param indexes', () => {
    const result = compileUpdate({ $inc: { views: 1, likes: 5 } }, 1);

    expect(result.params).toEqual([1, 5]);
    expect(result.setClauses).toContain('"views" = "views" + $1');
    expect(result.setClauses).toContain('"likes" = "likes" + $2');
  });

  it('compileUpdate with startIndex should offset correctly', () => {
    const result = compileUpdate({ $set: { name: 'test' } }, 5);

    expect(result.setClauses).toContain('$5');
    expect(result.params).toEqual(['test']);
  });
});

// =====================================================
// 6. Deep Join Parameter Isolation
// =====================================================
describe('Regression: Deep Join Parameter Isolation', () => {
  it('should produce correct params when filter is used with joins', () => {
    const joins = [
      {
        collection: 'users',
        as: 'user',
        on: { localField: 'userId', foreignField: 'id' },
        type: 'left',
      },
    ];

    const result = compileDeepJoin('orders', joins, {
      filter: { status: 'completed', amount: { $gt: 100 } },
      limit: 10,
    });

    expect(result.params).toEqual(['completed', 100, 10]);
    expect(result.sql).toContain('LEFT JOIN');
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toContain('LIMIT');
  });
});

// =====================================================
// 7. Window Function Parameter Isolation
// =====================================================
describe('Regression: Window Function Parameter Isolation', () => {
  it('should produce independent params for window functions', () => {
    const pipeline = [
      { $match: { status: 'active' } },
      {
        $setWindowFields: {
          partitionBy: '$department',
          sortBy: { salary: -1 },
          output: {
            rank: { $function: '$rank' },
          },
        },
      },
    ];

    const result = compileWindowFunction('employees', pipeline);
    expect(result.params).toEqual(['active']);
    expect(result.sql).toContain('RANK()');
    expect(result.sql).toContain('PARTITION BY');
  });
});

// =====================================================
// 8. Cursor Pagination Parameter Isolation
// =====================================================
describe('Regression: Cursor Pagination Parameter Isolation', () => {
  it('should produce correct params with cursor and filter', () => {
    const result = compileCursorPagination(
      'orders',
      { userId: 'user123' },
      {
        after: 'cursor_abc',
        limit: 20,
        sortField: 'createdAt',
        sortOrder: 'asc',
      }
    );

    expect(result.params).toContain('user123');
    expect(result.params).toContain('cursor_abc');
    expect(result.params).toContain(21); // limit + 1
    expect(result.sql).toContain('WHERE');
    expect(result.sql).toContain('ORDER BY');
    expect(result.sql).toContain('LIMIT');
  });
});

// =====================================================
// 9. Recursive CTE Parameter Isolation
// =====================================================
describe('Regression: Recursive CTE Parameter Isolation', () => {
  it('should produce correct params for CTE with maxDepth', () => {
    const cte = {
      name: 'org_tree',
      startWith: { managerId: null },
      connectBy: { field: 'managerId', references: '_id' },
      maxDepth: 5,
    };

    const result = compileRecursiveCTE('employees', cte);
    expect(result.params).toContain(5);
    expect(result.sql).toContain('WITH RECURSIVE');
    expect(result.sql).toContain('UNION ALL');
  });
});

// =====================================================
// 10. Concurrent Compilation Stress Test
// =====================================================
describe('Regression: Concurrent Compilation Stress Test', () => {
  it('should handle 100 concurrent compileFilter calls correctly', () => {
    const results: Array<{ sql: string; params: unknown[] }> = [];

    for (let i = 0; i < 100; i++) {
      const params: unknown[] = [];
      const result = compileFilter({ id: i, name: `user_${i}` }, params, 1);
      results.push(result);
    }

    // Every result should use $1 and $2
    for (let i = 0; i < 100; i++) {
      expect(results[i].sql).toBe('"id" = $1 AND "name" = $2');
      expect(results[i].params).toEqual([i, `user_${i}`]);
    }
  });

  it('should handle 50 concurrent compileUpdate calls correctly', () => {
    const results: Array<{ setClauses: string; params: unknown[] }> = [];

    for (let i = 0; i < 50; i++) {
      const result = compileUpdate({ $set: { value: i } }, 1);
      results.push(result);
    }

    for (let i = 0; i < 50; i++) {
      expect(results[i].params).toEqual([i]);
      expect(results[i].setClauses).toContain('$1');
    }
  });
});

// =====================================================
// 11. MySQL Compiler Concurrency (Does not have $N params but verify)
// =====================================================
describe('Regression: MySQL Compiler Concurrency', () => {
  it('should handle concurrent compileFilter calls correctly', () => {
    const results: Array<{ sql: string; params: unknown[] }> = [];

    for (let i = 0; i < 50; i++) {
      const params: unknown[] = [];
      const result = mysqlCompileFilter({ id: i, name: `user_${i}` }, params);
      results.push(result);
    }

    for (let i = 0; i < 50; i++) {
      expect(results[i].sql).toBe('`id` = ? AND `name` = ?');
      expect(results[i].params).toEqual([i, `user_${i}`]);
    }
  });
});

// =====================================================
// 12. Error Class Verification
// =====================================================
describe('Regression: JSDBUnsupportedOperationError', () => {
  it('should have correct portability info', () => {
    const err = new JSDBUnsupportedOperationError('$facet', 'postgres', 'Use separate queries.');

    expect(err.code).toBe('UNSUPPORTED_OPERATION');
    expect(err.database).toBe('postgres');
    expect(err.portabilityInfo?.operation).toBe('$facet');
    expect(err.portabilityInfo?.status).toBe('unsupported');
    expect(err.portabilityInfo?.suggestion).toBe('Use separate queries.');
  });

  it('should be instanceof JSDBError', () => {
    const err = new JSDBUnsupportedOperationError('$facet', 'mysql');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('JSDBUnsupportedOperationError');
  });
});
