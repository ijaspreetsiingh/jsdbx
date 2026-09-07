import { describe, it, expect, beforeAll } from 'vitest';
import { CapabilityRegistry } from '../../src/capabilities/registry.js';
import { mysqlCapabilities } from '../../src/capabilities/mysql.js';
import { mongodbCapabilities } from '../../src/capabilities/mongodb.js';
import { globalRegistry } from '../../src/capabilities/index.js';

describe('CapabilityRegistry', () => {
  let registry: CapabilityRegistry;

  beforeAll(() => {
    registry = new CapabilityRegistry();
    registry.registerMany(mysqlCapabilities);
    registry.registerMany(mongodbCapabilities);
  });

  it('returns native for MySQL CRUD', () => {
    expect(registry.getStatus('mysql', 'crud.find')).toBe('native');
    expect(registry.getStatus('mysql', 'crud.insert')).toBe('native');
    expect(registry.getStatus('mysql', 'crud.count')).toBe('native');
  });

  it('returns emulated for MySQL elemMatch (now emulated via JSON_TABLE)', () => {
    expect(registry.getStatus('mysql', 'filter.elemMatch')).toBe('emulated');
  });

  it('returns emulated for MySQL projection exclusion', () => {
    expect(registry.getStatus('mysql', 'projection.exclusion')).toBe('emulated');
  });

  it('returns native for MongoDB CRUD', () => {
    expect(registry.getStatus('mongodb', 'crud.find')).toBe('native');
    expect(registry.getStatus('mongodb', 'crud.insert')).toBe('native');
  });

  it('returns native for MongoDB elemMatch', () => {
    expect(registry.getStatus('mongodb', 'filter.elemMatch')).toBe('native');
  });

  it('returns native for MongoDB transactions', () => {
    expect(registry.getStatus('mongodb', 'transactions')).toBe('native');
  });

  it('returns native as default for unknown features', () => {
    expect(registry.getStatus('mysql', 'unknown.feature.xyz')).toBe('native');
  });

  it('returns emulated for MySQL $elemMatch (not unsupported anymore)', () => {
    expect(registry.isSupported('mysql', 'filter.elemMatch')).toBe(true);
  });

  it('isSupported returns true for native operations', () => {
    expect(registry.isSupported('mysql', 'crud.find')).toBe(true);
  });

  it('isNative returns true for native', () => {
    expect(registry.isNative('mysql', 'crud.find')).toBe(true);
  });

  it('isEmulated returns true for emulated', () => {
    expect(registry.isEmulated('mysql', 'projection.exclusion')).toBe(true);
  });

  it('calculates portability score', () => {
    const score = registry.getPortabilityScore('mysql');
    expect(score).toBeGreaterThan(50);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('global registry has all databases', () => {
    expect(globalRegistry.getAllForDatabase('mysql').length).toBeGreaterThan(0);
    expect(globalRegistry.getAllForDatabase('mongodb').length).toBeGreaterThan(0);
    expect(globalRegistry.getAllForDatabase('postgres').length).toBeGreaterThan(0);
    expect(globalRegistry.getAllForDatabase('sqlite').length).toBeGreaterThan(0);
  });
});
