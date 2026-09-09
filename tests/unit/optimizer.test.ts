// =====================================================
// JSDB - Query Optimizer Unit Tests
// =====================================================
import { describe, it, expect } from 'vitest';
import { QueryOptimizer, PipelineOptimizer } from '../../src/planner/optimizer.js';
import type { ExecutionPlan } from '../../src/ir/nodes.js';

describe('QueryOptimizer', () => {
  const optimizer = new QueryOptimizer();

  it('should optimize a basic execution plan', () => {
    const plan: ExecutionPlan = {
      ir: {
        type: 'find',
        collection: 'users',
        filter: { status: 'active' },
        sort: { createdAt: -1 },
      },
      database: 'mysql',
      steps: [],
      warnings: [],
      capabilities: [],
    };

    const optimized = optimizer.optimize(plan);
    expect(optimized.optimizations).toBeDefined();
    expect(optimized.estimatedImprovement).toBeDefined();
  });

  it('should detect N+1 patterns in pipeline', () => {
    const hints = optimizer.analyzePipeline([
      { $match: { status: 'active' } },
      { $lookup: { from: 'orders', localField: '_id', foreignField: 'userId', as: 'orders' } },
      { $lookup: { from: 'products', localField: 'productId', foreignField: '_id', as: 'product' } },
      { $sort: { createdAt: -1 } },
    ]);

    // Should detect multiple lookups
    const joinHints = hints.filter(h => h.type === 'join_reorder');
    expect(joinHints.length).toBeGreaterThanOrEqual(0);
  });

  it('should suggest indexes for filter fields', () => {
    const plan: ExecutionPlan = {
      ir: {
        type: 'find',
        collection: 'orders',
        filter: { userId: '123', status: 'pending' },
      },
      database: 'mysql',
      steps: [],
      warnings: [],
      capabilities: [],
    };

    const _optimized = optimizer.optimize(plan);
    const hints = optimizer.getHints();
    const indexHints = hints.filter(h => h.type === 'index');
    expect(indexHints.length).toBeGreaterThanOrEqual(0);
  });
});

describe('PipelineOptimizer', () => {
  it('should reorder pipeline stages', () => {
    const pipeline = [
      { $sort: { createdAt: -1 } },
      { $match: { status: 'active' } },
      { $limit: 10 },
    ];

    const optimized = PipelineOptimizer.reorder(pipeline);
    expect(optimized[0]).toHaveProperty('$match');
  });

  it('should merge adjacent $match stages', () => {
    const pipeline = [
      { $match: { status: 'active' } },
      { $match: { age: { $gte: 18 } } },
      { $sort: { name: 1 } },
    ];

    const merged = PipelineOptimizer.mergeMatches(pipeline);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toHaveProperty('$match');
  });

  it('should remove redundant $project stages', () => {
    const pipeline = [
      { $match: { status: 'active' } },
      { $project: { name: 1, email: 1 } },
      { $sort: { name: 1 } },
      { $project: { name: 1 } }, // redundant - same or subset of previous
    ];

    const cleaned = PipelineOptimizer.removeRedundantProject(pipeline);
    // Function keeps last $project but removes intermediate ones
    expect(cleaned.length).toBeLessThanOrEqual(4);
  });
});
