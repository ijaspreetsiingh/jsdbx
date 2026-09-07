import { describe, it, expect } from 'vitest';
import {
  SecurityManager,
  RBACManager,
  TenantIsolation,
  RateLimiter,
  FieldAccessControl,
} from '../../src/security/index.js';
import { JSDBTenantIsolationError, JSDBAuthorizationError, JSDBRateLimitError } from '../../src/errors/index.js';

describe('RBAC Manager', () => {
  it('defines and checks roles', () => {
    const rbac = new RBACManager();
    rbac.defineRole({
      name: 'admin',
      permissions: ['*'],
    });
    rbac.defineRole({
      name: 'viewer',
      permissions: ['users:read'],
    });

    expect(rbac.hasPermission('admin', 'users:delete')).toBe(true);
    expect(rbac.hasPermission('viewer', 'users:read')).toBe(true);
    expect(rbac.hasPermission('viewer', 'users:delete')).toBe(false);
  });

  it('checks collection access', () => {
    const rbac = new RBACManager();
    rbac.defineRole({
      name: 'editor',
      permissions: [],
      collections: {
        users: { read: true, write: true, delete: false },
      },
    });

    expect(rbac.canAccess('editor', 'users', 'read')).toBe(true);
    expect(rbac.canAccess('editor', 'users', 'write')).toBe(true);
    expect(rbac.canAccess('editor', 'users', 'delete')).toBe(false);
  });

  it('filters fields by allowed list', () => {
    const rbac = new RBACManager();
    rbac.defineRole({
      name: 'limited',
      permissions: [],
      collections: {
        users: {
          read: true,
          fields: { allowed: ['id', 'name', 'email'] },
        },
      },
    });
    const doc = { id: '1', name: 'Alice', email: 'alice@x.com', password: 'secret', internalToken: 'tok' };
    const filtered = rbac.filterFields('limited', 'users', doc);
    expect(filtered.id).toBe('1');
    expect(filtered.name).toBe('Alice');
    expect(filtered.password).toBeUndefined();
    expect(filtered.internalToken).toBeUndefined();
  });

  it('filters fields by denied list', () => {
    const rbac = new RBACManager();
    rbac.defineRole({
      name: 'safe',
      permissions: [],
      collections: {
        users: {
          read: true,
          fields: { denied: ['password', 'internalToken'] },
        },
      },
    });
    const doc = { id: '1', name: 'Alice', password: 'secret', internalToken: 'tok' };
    const filtered = rbac.filterFields('safe', 'users', doc);
    expect(filtered.id).toBe('1');
    expect(filtered.password).toBeUndefined();
    expect(filtered.internalToken).toBeUndefined();
  });
});

describe('TenantIsolation', () => {
  it('injects tenant filter', () => {
    const ti = new TenantIsolation('tenantId', true);
    const filter = ti.injectFilter({ status: 'active' }, { tenantId: 'tenant_A' });
    expect(filter.tenantId).toBe('tenant_A');
    expect(filter.status).toBe('active');
  });

  it('does not inject when disabled', () => {
    const ti = new TenantIsolation('tenantId', false);
    const filter = ti.injectFilter({ status: 'active' }, { tenantId: 'tenant_A' });
    expect(filter.tenantId).toBeUndefined();
  });

  it('injects tenant into document', () => {
    const ti = new TenantIsolation('tenantId', true);
    const doc = ti.injectDocument({ name: 'Alice' }, { tenantId: 'tenant_A' });
    expect(doc.tenantId).toBe('tenant_A');
  });

  it('throws on cross-tenant document access', () => {
    const ti = new TenantIsolation('tenantId', true);
    expect(() =>
      ti.verifyDocument({ name: 'Bob', tenantId: 'tenant_B' }, { tenantId: 'tenant_A' })
    ).toThrow(JSDBTenantIsolationError);
  });

  it('does not throw when tenantId matches', () => {
    const ti = new TenantIsolation('tenantId', true);
    expect(() =>
      ti.verifyDocument({ name: 'Alice', tenantId: 'tenant_A' }, { tenantId: 'tenant_A' })
    ).not.toThrow();
  });

  it('proves tenant A cannot access tenant B data', () => {
    const ti = new TenantIsolation('tenantId', true);
    // Simulate a document that belongs to tenant B
    const tenantBDoc = { id: '99', name: 'B Private', tenantId: 'tenant_B' };
    const tenantAContext = { tenantId: 'tenant_A' };

    // Verify access is blocked
    expect(() => ti.verifyDocument(tenantBDoc, tenantAContext)).toThrow(JSDBTenantIsolationError);

    // Verify filter injection prevents cross-tenant queries
    const injectedFilter = ti.injectFilter({ id: '99' }, tenantAContext);
    expect(injectedFilter.tenantId).toBe('tenant_A');
    // tenant B's doc has tenantId = 'tenant_B', which won't match 'tenant_A' in query
  });
});

describe('RateLimiter', () => {
  it('allows requests under limit', () => {
    const rl = new RateLimiter(5, 60000);
    expect(() => {
      for (let i = 0; i < 5; i++) rl.check('user:1');
    }).not.toThrow();
  });

  it('throws when limit exceeded', () => {
    const rl = new RateLimiter(3, 60000);
    rl.check('user:1');
    rl.check('user:1');
    rl.check('user:1');
    expect(() => rl.check('user:1')).toThrow(JSDBRateLimitError);
  });

  it('resets counter after reset()', () => {
    const rl = new RateLimiter(2, 60000);
    rl.check('user:1');
    rl.check('user:1');
    expect(() => rl.check('user:1')).toThrow();
    rl.reset('user:1');
    expect(() => rl.check('user:1')).not.toThrow();
  });
});

describe('SecurityManager', () => {
  it('checks authorization correctly', () => {
    const sm = new SecurityManager();
    sm.rbac.defineRole({ name: 'viewer', permissions: ['users:read'] });

    expect(() =>
      sm.checkAuthorization({ roles: ['viewer'] }, 'users', 'read')
    ).not.toThrow();

    // Viewer trying to delete should fail
    // (viewer has users:read, not users:delete)
    // But canAccess checks permissions array, not collection-level
    // So this should throw since viewer doesn't have delete permission
    sm.rbac.defineRole({ name: 'viewerOnly', permissions: [], collections: { users: { read: true } } });
    expect(() =>
      sm.checkAuthorization({ roles: ['viewerOnly'] }, 'users', 'delete')
    ).toThrow(JSDBAuthorizationError);
  });

  it('passes when no roles configured', () => {
    const sm = new SecurityManager();
    expect(() =>
      sm.checkAuthorization({ userId: 'u1' }, 'users', 'read')
    ).not.toThrow();
  });
});
