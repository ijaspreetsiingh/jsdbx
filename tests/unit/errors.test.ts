import { describe, it, expect } from 'vitest';
import {
  JSDBError,
  JSDBConnectionError,
  JSDBQueryError,
  JSDBUnsupportedOperationError,
  JSDBTransactionError,
  JSDBValidationError,
  JSDBConfigurationError,
  JSDBTenantIsolationError,
  JSDBRateLimitError,
  normalizeError,
} from '../../src/errors/index.js';

describe('JSDB Error System', () => {
  it('creates a base JSDBError', () => {
    const err = new JSDBError('test error', 'QUERY_FAILED');
    expect(err.message).toBe('test error');
    expect(err.code).toBe('QUERY_FAILED');
    expect(err.name).toBe('JSDBError');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JSDBError);
  });

  it('creates a connection error', () => {
    const err = new JSDBConnectionError('Connection refused', 'mysql');
    expect(err.code).toBe('CONNECTION_FAILED');
    expect(err.database).toBe('mysql');
    expect(err).toBeInstanceOf(JSDBConnectionError);
    expect(err).toBeInstanceOf(JSDBError);
  });

  it('creates an unsupported operation error', () => {
    const err = new JSDBUnsupportedOperationError('filter.elemMatch', 'mysql', 'Restructure query');
    expect(err.code).toBe('UNSUPPORTED_OPERATION');
    expect(err.portabilityInfo?.status).toBe('unsupported');
    expect(err.message).toContain('filter.elemMatch');
    expect(err.message).toContain('mysql');
  });

  it('creates a tenant isolation error', () => {
    const err = new JSDBTenantIsolationError();
    expect(err.code).toBe('TENANT_ISOLATION_VIOLATION');
  });

  it('creates a rate limit error', () => {
    const err = new JSDBRateLimitError();
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('serializes to JSON without sensitive data', () => {
    const err = new JSDBQueryError('test', 'mysql');
    const json = err.toJSON();
    expect(json.code).toBe('QUERY_FAILED');
    expect(json.message).toBe('test');
    // Should not include cause (could leak internals)
    expect('cause' in json).toBe(false);
  });

  it('normalizeError converts raw Error to JSDBError', () => {
    const raw = new Error('ECONNREFUSED connection refused');
    const normalized = normalizeError(raw, 'mysql');
    expect(normalized).toBeInstanceOf(JSDBConnectionError);
    expect(normalized.database).toBe('mysql');
  });

  it('normalizeError returns JSDBError unchanged', () => {
    const original = new JSDBQueryError('already wrapped', 'mysql');
    const result = normalizeError(original, 'mysql');
    expect(result).toBe(original);
  });

  it('normalizeError handles non-Error objects', () => {
    const result = normalizeError('string error', 'mongodb');
    expect(result).toBeInstanceOf(JSDBError);
  });

  it('toString includes code and message', () => {
    const err = new JSDBUnsupportedOperationError('aggregation.unwind', 'mysql');
    const str = err.toString();
    expect(str).toContain('UNSUPPORTED_OPERATION');
    expect(str).toContain('aggregation.unwind');
    expect(str).toContain('mysql');
  });
});
