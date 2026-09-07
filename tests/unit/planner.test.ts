import { describe, it, expect } from 'vitest';
import { QueryPlanner } from '../../src/planner/planner.js';
import { IRBuilder } from '../../src/ir/builder.js';

describe('QueryPlanner', () => {
  const planner = new QueryPlanner({ strict: false });
  const strictPlanner = new QueryPlanner({ strict: true });

  it('plans a simple find on MySQL', () => {
    const ir = IRBuilder.find('users', { age: { $gt: 18 } });
    const plan = planner.plan(ir, 'mysql');
    expect(plan.database).toBe('mysql');
    expect(plan.warnings).toHaveLength(0);
  });

  it('adds warning for emulated operation on MySQL', () => {
    const ir = IRBuilder.find('users', {}, { projection: { name: 0 } });
    // projection exclusion is emulated on MySQL
    const plan = planner.plan(ir, 'mysql');
    expect(plan.warnings.some((w) => w.includes('EMULATED'))).toBe(true);
  });

  it('emulates $elemMatch on MySQL (non-strict) — warns but does not throw', () => {
    const ir = IRBuilder.find('orders', {
      items: { $elemMatch: { qty: { $gt: 1 } } },
    });
    const plan = planner.plan(ir, 'mysql');
    // now emulated — should have no unsupported warnings
    expect(plan.warnings.filter((w) => w.includes('WARNING'))).toHaveLength(0);
  });

  it('still warns for unsupported ops in strict mode when registry says unsupported', () => {
    const ir = IRBuilder.find('orders', {
      items: { $elemMatch: { qty: { $gt: 1 } } },
    });
    // $elemMatch is now emulated — strict planner should NOT throw
    expect(() => strictPlanner.plan(ir, 'mysql')).not.toThrow();
  });

  it('plans a find cleanly on MongoDB', () => {
    const ir = IRBuilder.find('orders', {
      items: { $elemMatch: { qty: { $gt: 1 } } },
    });
    const plan = planner.plan(ir, 'mongodb');
    expect(plan.warnings.filter((w) => w.includes('UNSUPPORTED'))).toHaveLength(0);
  });

  it('plans aggregate on MySQL', () => {
    const ir = IRBuilder.aggregate('orders', [
      { $match: { status: 'paid' } },
      { $group: { _id: '$userId', total: { $sum: '$amount' } } },
    ]);
    const plan = planner.plan(ir, 'mysql');
    expect(plan.database).toBe('mysql');
  });

  it('emulates $unwind on MySQL — warns but does not throw', () => {
    const ir = IRBuilder.aggregate('orders', [
      { $unwind: '$items' },
    ]);
    const plan = planner.plan(ir, 'mysql');
    // $unwind is now emulated via JSON_TABLE
    expect(plan.database).toBe('mysql');
  });

  it('checks portability across databases', () => {
    const ir = IRBuilder.find('users', { name: 'Alice' });
    const results = planner.checkPortability(ir);
    expect(results.size).toBe(4);
    expect(results.has('mysql')).toBe(true);
    expect(results.has('mongodb')).toBe(true);
  });
});
