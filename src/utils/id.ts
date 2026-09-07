// =====================================================
// JSDB - ID Generation Utilities
// =====================================================
import { randomBytes } from 'crypto';

/**
 * Generate a random request/query ID (hex string)
 */
export function generateId(bytes = 8): string {
  return randomBytes(bytes).toString('hex');
}

/**
 * Generate a UUID v4
 */
export function generateUUID(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant bits
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Validate identifier (collection/field name) to prevent injection
 */
export function validateIdentifier(name: string, context = 'identifier'): void {
  if (!name || typeof name !== 'string') {
    throw new Error(`Invalid ${context}: must be a non-empty string`);
  }
  // Only allow alphanumeric, underscore, dot (for nested fields)
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(name)) {
    throw new Error(
      `Invalid ${context} "${name}": must start with letter/underscore and contain only alphanumeric, underscore, $, or dot characters`
    );
  }
  if (name.length > 128) {
    throw new Error(`Invalid ${context}: too long (max 128 chars)`);
  }
}

/**
 * Safely validate a collection name
 */
export function validateCollectionName(name: string): void {
  validateIdentifier(name, 'collection name');
}
