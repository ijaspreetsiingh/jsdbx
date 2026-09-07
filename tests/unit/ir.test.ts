import { describe, it, expect } from 'vitest';
import { IRBuilder } from '../../src/ir/builder.js';

describe('IR Builder', () => {
  it('builds a find IR node', () => {
    const ir = IRBuilder.find('users', { age: { $gt: 18 } }, {
      sort: { name: 'asc' },
      limit: 10,
      offset: 0,
    });

    expect(ir.type).toBe('find');
    expect(ir.collection).toBe('users');
    expect(ir.filter).toEqual({ age: { $gt: 18 } });
    expect(ir.sort).toEqual({ name: 'asc' });
    expect(ir.limit).toBe(10);
  });

  it('builds a findOne IR node', () => {
    const ir = IRBuilder.findOne('users', { email: 'test@example.com' });
    expect(ir.type).toBe('findOne');
    expect(ir.collection).toBe('users');
  });

  it('builds an insert IR node', () => {
    const ir = IRBuilder.insert('users', { name: 'Alice', age: 25 });
    expect(ir.type).toBe('insert');
    expect(ir.document.name).toBe('Alice');
  });

  it('builds an insertMany IR node', () => {
    const ir = IRBuilder.insertMany('users', [{ name: 'A' }, { name: 'B' }]);
    expect(ir.type).toBe('insertMany');
    expect(ir.documents).toHaveLength(2);
  });

  it('builds an update IR node', () => {
    const ir = IRBuilder.update('users', { id: '1' }, { $set: { name: 'Bob' } });
    expect(ir.type).toBe('update');
    expect(ir.filter).toEqual({ id: '1' });
  });

  it('builds a count IR node', () => {
    const ir = IRBuilder.count('users', { active: true });
    expect(ir.type).toBe('count');
  });

  it('builds an aggregate IR node', () => {
    const ir = IRBuilder.aggregate('orders', [
      { $match: { status: 'paid' } },
      { $group: { _id: '$userId', total: { $sum: '$amount' } } },
    ]);
    expect(ir.type).toBe('aggregate');
    expect(ir.pipeline).toHaveLength(2);
  });

  it('detects required capabilities for a find with elemMatch', () => {
    const ir = IRBuilder.find('orders', {
      items: { $elemMatch: { qty: { $gt: 1 } } },
    });
    const caps = IRBuilder.detectRequiredCapabilities(ir);
    expect(caps).toContain('filter.elemMatch');
  });

  it('detects pagination capabilities', () => {
    const ir = IRBuilder.find('users', {}, { limit: 20, offset: 40 });
    const caps = IRBuilder.detectRequiredCapabilities(ir);
    expect(caps).toContain('pagination.limit');
    expect(caps).toContain('pagination.offset');
  });

  it('has metadata timestamp', () => {
    const ir = IRBuilder.find('users', {});
    expect(ir.metadata?.timestamp).toBeInstanceOf(Date);
  });
});
