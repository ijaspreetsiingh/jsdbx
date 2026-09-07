// =====================================================
// JSDB - Capability Registry
// Central classification of database features
// =====================================================
import type { DatabaseType, CapabilityStatus } from '../types/index.js';

export type { CapabilityStatus } from '../types/index.js';

export interface CapabilityEntry {
  database: DatabaseType;
  feature: string;
  status: CapabilityStatus;
  notes?: string;
  fallback?: string;
  limitations?: string[];
  semanticDifferences?: string[];
}

export type CapabilityMap = Record<string, CapabilityStatus>;

export class CapabilityRegistry {
  private registry = new Map<string, CapabilityEntry>();

  register(entry: CapabilityEntry): void {
    const key = `${entry.database}:${entry.feature}`;
    this.registry.set(key, entry);
  }

  registerMany(entries: CapabilityEntry[]): void {
    entries.forEach((e) => this.register(e));
  }

  getCapability(database: DatabaseType, feature: string): CapabilityEntry {
    const key = `${database}:${feature}`;
    const entry = this.registry.get(key);
    if (entry) return entry;
    // Default to native for unknown features
    return { database, feature, status: 'native' };
  }

  getStatus(database: DatabaseType, feature: string): CapabilityStatus {
    return this.getCapability(database, feature).status;
  }

  isSupported(database: DatabaseType, feature: string): boolean {
    return this.getStatus(database, feature) !== 'unsupported';
  }

  isNative(database: DatabaseType, feature: string): boolean {
    return this.getStatus(database, feature) === 'native';
  }

  isEmulated(database: DatabaseType, feature: string): boolean {
    return this.getStatus(database, feature) === 'emulated';
  }

  getAllForDatabase(database: DatabaseType): CapabilityEntry[] {
    return Array.from(this.registry.values()).filter((e) => e.database === database);
  }

  getPortabilityScore(database: DatabaseType): number {
    const entries = this.getAllForDatabase(database);
    if (entries.length === 0) return 100;
    const native = entries.filter((e) => e.status === 'native').length;
    const emulated = entries.filter((e) => e.status === 'emulated').length;
    // native=1pt, emulated=0.7pt, unsupported=0pt
    const score = ((native + emulated * 0.7) / entries.length) * 100;
    return Math.round(score);
  }
}

// Singleton global registry
export const globalRegistry = new CapabilityRegistry();
