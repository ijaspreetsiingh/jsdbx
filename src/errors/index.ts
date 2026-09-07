// =====================================================
// JSDB - Unified Error System
// =====================================================
import type { DatabaseType, PortabilityWarning } from '../types/index.js';

export type ErrorCode =
  | 'CONNECTION_FAILED'
  | 'CONNECTION_TIMEOUT'
  | 'QUERY_FAILED'
  | 'QUERY_TIMEOUT'
  | 'UNSUPPORTED_OPERATION'
  | 'CAPABILITY_MISMATCH'
  | 'TRANSACTION_FAILED'
  | 'TRANSACTION_NOT_SUPPORTED'
  | 'VALIDATION_ERROR'
  | 'SCHEMA_ERROR'
  | 'MIGRATION_FAILED'
  | 'CONFIGURATION_ERROR'
  | 'ADAPTER_NOT_FOUND'
  | 'UNKNOWN_ERROR'
  | 'INJECTION_DETECTED'
  | 'AUTHORIZATION_FAILED'
  | 'TENANT_ISOLATION_VIOLATION'
  | 'RATE_LIMIT_EXCEEDED'
  | 'CACHE_ERROR';

export interface PortabilityInfo {
  operation: string;
  database: DatabaseType;
  status: 'native' | 'emulated' | 'unsupported';
  suggestion?: string;
  affectedDatabases?: DatabaseType[];
}

export class JSDBError extends Error {
  public readonly code: ErrorCode;
  public readonly cause?: Error;
  public readonly portabilityInfo?: PortabilityInfo;
  public readonly database?: DatabaseType;
  public readonly collection?: string;
  public readonly query?: unknown;

  constructor(
    message: string,
    code: ErrorCode,
    options?: {
      cause?: Error;
      portabilityInfo?: PortabilityInfo;
      database?: DatabaseType;
      collection?: string;
      query?: unknown;
    }
  ) {
    super(message);
    this.name = 'JSDBError';
    this.code = code;
    this.cause = options?.cause;
    this.portabilityInfo = options?.portabilityInfo;
    this.database = options?.database;
    this.collection = options?.collection;
    this.query = options?.query;

    // Maintain proper prototype chain
    Object.setPrototypeOf(this, JSDBError.prototype);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      database: this.database,
      collection: this.collection,
      portabilityInfo: this.portabilityInfo,
      // Never expose cause chain in serialized form to avoid leaking internals
    };
  }

  toString() {
    let msg = `[JSDB ${this.code}] ${this.message}`;
    if (this.database) msg += ` (database: ${this.database})`;
    if (this.portabilityInfo) {
      msg += `\n  Operation: ${this.portabilityInfo.operation}`;
      msg += `\n  Status: ${this.portabilityInfo.status}`;
      if (this.portabilityInfo.suggestion) {
        msg += `\n  Suggestion: ${this.portabilityInfo.suggestion}`;
      }
    }
    return msg;
  }
}

export class JSDBConnectionError extends JSDBError {
  constructor(message: string, database?: DatabaseType, cause?: Error) {
    super(message, 'CONNECTION_FAILED', { cause, database });
    this.name = 'JSDBConnectionError';
    Object.setPrototypeOf(this, JSDBConnectionError.prototype);
  }
}

export class JSDBQueryError extends JSDBError {
  constructor(message: string, database?: DatabaseType, cause?: Error, collection?: string) {
    super(message, 'QUERY_FAILED', { cause, database, collection });
    this.name = 'JSDBQueryError';
    Object.setPrototypeOf(this, JSDBQueryError.prototype);
  }
}

export class JSDBUnsupportedOperationError extends JSDBError {
  constructor(
    operation: string,
    database: DatabaseType,
    suggestion?: string
  ) {
    const message = `Operation "${operation}" is not supported on ${database}.${suggestion ? ` ${suggestion}` : ''}`;
    super(message, 'UNSUPPORTED_OPERATION', {
      database,
      portabilityInfo: {
        operation,
        database,
        status: 'unsupported',
        suggestion,
      },
    });
    this.name = 'JSDBUnsupportedOperationError';
    Object.setPrototypeOf(this, JSDBUnsupportedOperationError.prototype);
  }
}

export class JSDBTransactionError extends JSDBError {
  constructor(message: string, database?: DatabaseType, cause?: Error) {
    super(message, 'TRANSACTION_FAILED', { cause, database });
    this.name = 'JSDBTransactionError';
    Object.setPrototypeOf(this, JSDBTransactionError.prototype);
  }
}

export class JSDBValidationError extends JSDBError {
  public readonly field?: string;
  constructor(message: string, field?: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'JSDBValidationError';
    this.field = field;
    Object.setPrototypeOf(this, JSDBValidationError.prototype);
  }
}

export class JSDBConfigurationError extends JSDBError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'JSDBConfigurationError';
    Object.setPrototypeOf(this, JSDBConfigurationError.prototype);
  }
}

export class JSDBSchemaError extends JSDBError {
  constructor(message: string, cause?: Error) {
    super(message, 'SCHEMA_ERROR', { cause });
    this.name = 'JSDBSchemaError';
    Object.setPrototypeOf(this, JSDBSchemaError.prototype);
  }
}

export class JSDBMigrationError extends JSDBError {
  constructor(message: string, cause?: Error) {
    super(message, 'MIGRATION_FAILED', { cause });
    this.name = 'JSDBMigrationError';
    Object.setPrototypeOf(this, JSDBMigrationError.prototype);
  }
}

export class JSDBAuthorizationError extends JSDBError {
  constructor(message: string) {
    super(message, 'AUTHORIZATION_FAILED');
    this.name = 'JSDBAuthorizationError';
    Object.setPrototypeOf(this, JSDBAuthorizationError.prototype);
  }
}

export class JSDBTenantIsolationError extends JSDBError {
  constructor(message = 'Cross-tenant access attempt detected and blocked') {
    super(message, 'TENANT_ISOLATION_VIOLATION');
    this.name = 'JSDBTenantIsolationError';
    Object.setPrototypeOf(this, JSDBTenantIsolationError.prototype);
  }
}

export class JSDBRateLimitError extends JSDBError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT_EXCEEDED');
    this.name = 'JSDBRateLimitError';
    Object.setPrototypeOf(this, JSDBRateLimitError.prototype);
  }
}

// Normalize a raw error from a database driver into JSDBError
export function normalizeError(err: unknown, database?: DatabaseType): JSDBError {
  if (err instanceof JSDBError) return err;

  const raw = err instanceof Error ? err : new Error(String(err));
  const msg = raw.message.toLowerCase();

  // Detect connection failures
  if (
    msg.includes('connect') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('timeout')
  ) {
    return new JSDBConnectionError(raw.message, database, raw);
  }

  return new JSDBQueryError(raw.message, database, raw);
}

// Helper: create portability warning
export function createPortabilityWarning(
  code: string,
  operation: string,
  message: string,
  suggestion?: string
): PortabilityWarning {
  return { code, operation, message, suggestion };
}
