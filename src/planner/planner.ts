// =====================================================
// JSDB - Query Planner
// Converts IR → Execution Plan, enforcing capability rules
// =====================================================
import type { DatabaseType } from '../types/index.js';
import { JSDBUnsupportedOperationError } from '../errors/index.js';
import { globalRegistry } from '../capabilities/index.js';
import { IRBuilder } from '../ir/builder.js';
import type {
  IRNode,
  ExecutionPlan,
  ExecutionStep,
  CapabilityCheckResult,
} from '../ir/nodes.js';

export interface PlannerOptions {
  /** If true, throw on unsupported instead of adding warning */
  strict?: boolean;
  /** If true, emit debug info */
  explain?: boolean;
}

export class QueryPlanner {
  private options: PlannerOptions;

  constructor(options: PlannerOptions = {}) {
    this.options = options;
  }

  plan(ir: IRNode, database: DatabaseType): ExecutionPlan {
    const requiredCaps = IRBuilder.detectRequiredCapabilities(ir);
    const capResults: CapabilityCheckResult[] = [];
    const warnings: string[] = [];
    const steps: ExecutionStep[] = [];

    let hasUnsupported = false;
    let unsupportedOp = '';

    for (const cap of requiredCaps) {
      const entry = globalRegistry.getCapability(database, cap);
      const result: CapabilityCheckResult = {
        operation: cap,
        status: entry.status,
        message: entry.notes,
      };
      capResults.push(result);

      if (entry.status === 'unsupported') {
        // In non-strict mode: warn but continue — compiler will attempt best-effort translation
        // In strict mode: throw immediately
        hasUnsupported = true;
        unsupportedOp = cap;
        if (this.options.strict) {
          throw new JSDBUnsupportedOperationError(
            cap,
            database,
            entry.fallback ?? entry.notes
          );
        } else {
          warnings.push(
            `WARNING: ${cap} has no registered emulation on ${database}. ` +
            `${entry.fallback ?? entry.notes ?? 'This operation may fail at runtime.'}`
          );
        }
      } else if (entry.status === 'emulated') {
        // Emulated — works but with limitations
        warnings.push(
          `EMULATED: ${cap} is emulated on ${database}. ${entry.notes ?? ''}` +
          (entry.limitations?.length ? ` Limitations: ${entry.limitations.join('; ')}` : '')
        );
      }
    }

    // Build execution step
    const primaryStatus = capResults.every((r) => r.status === 'native')
      ? 'native'
      : capResults.some((r) => r.status === 'unsupported')
        ? 'sequential'
        : 'emulated';

    steps.push({
      type: primaryStatus === 'sequential' ? 'sequential' : primaryStatus,
      description: `Execute ${ir.type} on ${database}`,
      data: ir,
    });

    return {
      ir,
      database,
      steps,
      warnings,
      capabilities: capResults,
    };
  }

  /**
   * Check whether an IR node is fully portable across all supported databases
   */
  checkPortability(
    ir: IRNode,
    databases: DatabaseType[] = ['mysql', 'mongodb', 'postgres', 'sqlite']
  ): Map<DatabaseType, ExecutionPlan> {
    const results = new Map<DatabaseType, ExecutionPlan>();
    for (const db of databases) {
      results.set(db, this.plan(ir, db));
    }
    return results;
  }
}

// Singleton planner (strict mode off by default)
export const queryPlanner = new QueryPlanner({ strict: false });

// Strict planner — throws on unsupported operations
export const strictPlanner = new QueryPlanner({ strict: true });
