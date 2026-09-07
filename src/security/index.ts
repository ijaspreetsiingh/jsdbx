// =====================================================
// JSDB - Security Runtime
// Auth hooks, RBAC, field-level access, rate limiting,
// audit logging, tenant isolation
// =====================================================
import { JSDBAuthorizationError, JSDBTenantIsolationError, JSDBRateLimitError } from '../errors/index.js';
import { createLogger } from '../utils/logger.js';
import type { Document, Filter } from '../types/index.js';

// ---- Authentication Hooks ----

export type AuthHook = (context: SecurityContext) => Promise<void> | void;

// ---- Security Context ----

export interface SecurityContext {
  userId?: string;
  roles?: string[];
  tenantId?: string;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

// ---- RBAC ----

export interface RoleDefinition {
  name: string;
  permissions: string[];
  collections?: {
    [collectionName: string]: {
      read?: boolean;
      write?: boolean;
      delete?: boolean;
      fields?: {
        allowed?: string[];
        denied?: string[];
      };
    };
  };
}

export class RBACManager {
  private roles = new Map<string, RoleDefinition>();

  defineRole(role: RoleDefinition): void {
    this.roles.set(role.name, role);
  }

  hasPermission(roleName: string, permission: string): boolean {
    const role = this.roles.get(roleName);
    if (!role) return false;
    return role.permissions.includes(permission) || role.permissions.includes('*');
  }

  canAccess(
    roleName: string,
    collection: string,
    operation: 'read' | 'write' | 'delete'
  ): boolean {
    const role = this.roles.get(roleName);
    if (!role) return false;

    // Check global permissions
    if (role.permissions.includes('*') || role.permissions.includes(`${collection}:*`)) return true;
    if (role.permissions.includes(`${collection}:${operation}`)) return true;

    // Check collection-specific
    const collPerm = role.collections?.[collection];
    if (!collPerm) return false;
    return collPerm[operation] === true;
  }

  filterFields(
    roleName: string,
    collection: string,
    document: Document
  ): Document {
    const role = this.roles.get(roleName);
    if (!role) return document;

    const collPerm = role.collections?.[collection];
    if (!collPerm?.fields) return document;

    const { allowed, denied } = collPerm.fields;
    let result = { ...document };

    if (allowed && allowed.length > 0) {
      // Keep only allowed fields
      result = Object.fromEntries(
        Object.entries(result).filter(([k]) => allowed.includes(k))
      ) as Document;
    }

    if (denied && denied.length > 0) {
      // Remove denied fields
      for (const field of denied) {
        delete result[field];
      }
    }

    return result;
  }

  getRoles(): string[] {
    return Array.from(this.roles.keys());
  }
}

// ---- Field-Level Access Control ----

export interface FieldAccessPolicy {
  collection: string;
  allowed?: string[];
  denied?: string[];
  filter?: (context: SecurityContext) => string[];
}

export class FieldAccessControl {
  private policies = new Map<string, FieldAccessPolicy>();

  define(policy: FieldAccessPolicy): void {
    this.policies.set(policy.collection, policy);
  }

  filterDocument(collection: string, document: Document, context: SecurityContext): Document {
    const policy = this.policies.get(collection);
    if (!policy) return document;

    let result = { ...document };
    const dynamicDenied = policy.filter ? policy.filter(context) : [];
    const allDenied = [...(policy.denied ?? []), ...dynamicDenied];

    if (policy.allowed && policy.allowed.length > 0) {
      result = Object.fromEntries(
        Object.entries(result).filter(([k]) => (policy.allowed as string[]).includes(k))
      ) as Document;
    }

    for (const field of allDenied) {
      delete result[field];
    }

    return result;
  }

  filterDocuments(collection: string, documents: Document[], context: SecurityContext): Document[] {
    return documents.map((doc) => this.filterDocument(collection, doc, context));
  }
}

// ---- Tenant Isolation ----

export class TenantIsolation {
  private tenantField: string;
  private enabled: boolean;

  constructor(tenantField = 'tenantId', enabled = true) {
    this.tenantField = tenantField;
    this.enabled = enabled;
  }

  /**
   * Inject tenant filter into a query filter
   */
  injectFilter(filter: Filter, context: SecurityContext): Filter {
    if (!this.enabled || !context.tenantId) return filter;
    return {
      ...filter,
      [this.tenantField]: context.tenantId,
    };
  }

  /**
   * Inject tenant field into a document being inserted
   */
  injectDocument(document: Document, context: SecurityContext): Document {
    if (!this.enabled || !context.tenantId) return document;
    return {
      ...document,
      [this.tenantField]: context.tenantId,
    };
  }

  /**
   * Verify a document belongs to the current tenant
   * Throws if cross-tenant access is detected
   */
  verifyDocument(document: Document, context: SecurityContext): void {
    if (!this.enabled || !context.tenantId) return;
    const docTenant = document[this.tenantField];
    if (docTenant !== undefined && docTenant !== context.tenantId) {
      throw new JSDBTenantIsolationError(
        `Cross-tenant access attempt: document belongs to tenant "${docTenant}", but current tenant is "${context.tenantId}"`
      );
    }
  }

  verifyDocuments(documents: Document[], context: SecurityContext): void {
    for (const doc of documents) {
      this.verifyDocument(doc, context);
    }
  }

  getTenantField(): string {
    return this.tenantField;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// ---- Rate Limiter ----

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests = 100, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(key: string): void {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      this.store.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }

    entry.count++;
    if (entry.count > this.maxRequests) {
      throw new JSDBRateLimitError(
        `Rate limit exceeded: ${this.maxRequests} requests per ${this.windowMs / 1000}s`
      );
    }
  }

  reset(key: string): void {
    this.store.delete(key);
  }
}

// ---- Audit Logger ----

export interface AuditEntry {
  timestamp: Date;
  userId?: string;
  tenantId?: string;
  operation: string;
  collection: string;
  database: string;
  success: boolean;
  error?: string;
  requestId?: string;
}

export type AuditHandler = (entry: AuditEntry) => void;

export class AuditLogger {
  private handlers: AuditHandler[] = [];
  private enabled: boolean;
  private logger = createLogger('info', 'JSDB:Audit');

  constructor(enabled = false) {
    this.enabled = enabled;
  }

  addHandler(handler: AuditHandler): void {
    this.handlers.push(handler);
  }

  log(entry: AuditEntry): void {
    if (!this.enabled) return;

    // Default: structured log (never log passwords/secrets)
    this.logger.info('AUDIT', {
      timestamp: entry.timestamp.toISOString(),
      userId: entry.userId,
      tenantId: entry.tenantId,
      operation: entry.operation,
      collection: entry.collection,
      database: entry.database,
      success: entry.success,
      requestId: entry.requestId,
      // error: intentionally excluded from default log to avoid leaking query details
    });

    for (const handler of this.handlers) {
      try { handler(entry); } catch {}
    }
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }
}

// ---- Security Manager ----

export class SecurityManager {
  public rbac: RBACManager;
  public fieldAccess: FieldAccessControl;
  public tenantIsolation: TenantIsolation;
  public rateLimiter: RateLimiter;
  public auditLogger: AuditLogger;
  private authHooks: AuthHook[] = [];

  constructor(options: {
    tenantField?: string;
    tenancyEnabled?: boolean;
    rateLimitRequests?: number;
    rateLimitWindowMs?: number;
    auditEnabled?: boolean;
  } = {}) {
    this.rbac = new RBACManager();
    this.fieldAccess = new FieldAccessControl();
    this.tenantIsolation = new TenantIsolation(
      options.tenantField ?? 'tenantId',
      options.tenancyEnabled ?? false
    );
    this.rateLimiter = new RateLimiter(
      options.rateLimitRequests ?? 1000,
      options.rateLimitWindowMs ?? 60_000
    );
    this.auditLogger = new AuditLogger(options.auditEnabled ?? false);
  }

  addAuthHook(hook: AuthHook): void {
    this.authHooks.push(hook);
  }

  async runAuthHooks(context: SecurityContext): Promise<void> {
    for (const hook of this.authHooks) {
      await hook(context);
    }
  }

  checkAuthorization(
    context: SecurityContext,
    collection: string,
    operation: 'read' | 'write' | 'delete'
  ): void {
    if (!context.roles || context.roles.length === 0) return; // No RBAC configured

    const hasAccess = context.roles.some((role) =>
      this.rbac.canAccess(role, collection, operation)
    );

    if (!hasAccess) {
      throw new JSDBAuthorizationError(
        `Access denied: roles [${context.roles.join(', ')}] cannot ${operation} on collection "${collection}"`
      );
    }
  }

  filterDocumentFields(
    collection: string,
    document: Document,
    context: SecurityContext
  ): Document {
    // Apply RBAC field filtering for each role
    let result = { ...document };
    if (context.roles) {
      for (const role of context.roles) {
        result = this.rbac.filterFields(role, collection, result);
      }
    }
    // Apply field-level access control policies
    result = this.fieldAccess.filterDocument(collection, result, context);
    return result;
  }
}
