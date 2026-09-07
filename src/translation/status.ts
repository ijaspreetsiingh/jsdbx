// =====================================================
// JSDB - Translation Status Classification System
// Formal classification for cross-database operations
// =====================================================

/**
 * Translation status classification
 * Every translated operation must be classified
 */
export type TranslationStatus =
  | 'native'         // Target DB directly supports
  | 'exact'          // Translation preserves semantics exactly
  | 'safe'           // Different syntax, equivalent semantics
  | 'emulated'       // Reproduced via multiple target ops
  | 'lossy'          // Some semantics cannot be preserved
  | 'unsupported';   // Cannot translate

export interface FeatureTranslation {
  feature: string;
  status: TranslationStatus;
  sourceDb: string;
  targetDb: string;
  reason?: string;
  suggestion?: string;
  cost?: 'low' | 'medium' | 'high';
}

export interface TranslationReport {
  sourceQuery: string;
  sourceDb: string;
  targetDb: string;
  overallStatus: TranslationStatus;
  features: FeatureTranslation[];
  warnings: string[];
  errors: string[];
  portable: boolean;
  score: number;
}

/**
 * Check if a translation status is safe to execute
 */
export function isSafeToExecute(status: TranslationStatus): boolean {
  return status === 'native' || status === 'exact' || status === 'safe';
}

/**
 * Check if a translation status requires user confirmation
 */
export function requiresConfirmation(status: TranslationStatus): boolean {
  return status === 'emulated' || status === 'lossy';
}

/**
 * Get human-readable description of translation status
 */
export function describeStatus(status: TranslationStatus): string {
  switch (status) {
    case 'native':
      return 'Target database directly supports this operation';
    case 'exact':
      return 'Translation preserves semantics exactly';
    case 'safe':
      return 'Different syntax but equivalent semantics for supported data types';
    case 'emulated':
      return 'Feature reproduced using multiple target database operations';
    case 'lossy':
      return 'Some semantics cannot be perfectly preserved';
    case 'unsupported':
      return 'Cannot translate to target database';
    default:
      return 'Unknown status';
  }
}

/**
 * Compare two translation statuses and return the worse one
 */
export function worstStatus(a: TranslationStatus, b: TranslationStatus): TranslationStatus {
  const order: TranslationStatus[] = ['native', 'exact', 'safe', 'emulated', 'lossy', 'unsupported'];
  const idxA = order.indexOf(a);
  const idxB = order.indexOf(b);
  return order[Math.max(idxA, idxB)]!;
}
