// =====================================================
// JSDB v2.0 - Query Optimizer
// Cost-based optimization, query rewriting, plan caching
// =====================================================
import { createLogger } from '../utils/logger.js';
import { LRUCache } from '../cache/lru-cache.js';
import type { IRNode, ExecutionPlan } from '../ir/nodes.js';
import type { DatabaseType } from '../types/index.js';

export interface OptimizationConfig {
  enableCostEstimation: boolean;
  enablePredicatePushdown: boolean;
  enableProjectionPushdown: boolean;
  enableJoinReordering: boolean;
  enableSubqueryUnnesting: boolean;
  enableCommonSubexpressionElimination: boolean;
  maxPlanCacheSize: number;
  costModelVersion: number;
}

export interface CostEstimate {
  cpuCost: number;
  ioCost: number;
  networkCost: number;
  memoryCost: number;
  totalCost: number;
  estimatedRows: number;
  estimatedTimeMs: number;
}

export interface OptimizationHint {
  type: 'index' | 'sort' | 'parallel' | 'cache' | 'materialize';
  description: string;
  impact: 'low' | 'medium' | 'high';
  appliesTo: string[];
}

export interface OptimizedPlan {
  plan: ExecutionPlan;
  cost: CostEstimate;
  hints: OptimizationHint[];
  optimizations: string[];
  cacheKey: string;
}

// Cost model for different operations
const BASE_COSTS: Record<string, number> = {
  seqScan: 1.0,
  indexScan: 0.1,
  filter: 0.01,
  project: 0.005,
  sort: 0.5,
  hashJoin: 2.0,
  nestedLoopJoin: 5.0,
  mergeJoin: 1.5,
  aggregation: 1.0,
  insert: 0.5,
  update: 0.3,
  delete: 0.2,
};

export class QueryOptimizer {
  private config: OptimizationConfig;
  private planCache: LRUCache<string, OptimizedPlan>;
  private logger = createLogger('info', 'JSDB:Optimizer');

  constructor(config?: Partial<OptimizationConfig>) {
    this.config = {
      enableCostEstimation: config?.enableCostEstimation ?? true,
      enablePredicatePushdown: config?.enablePredicatePushdown ?? true,
      enableProjectionPushdown: config?.enableProjectionPushdown ?? true,
      enableJoinReordering: config?.enableJoinReordering ?? true,
      enableSubqueryUnnesting: config?.enableSubqueryUnnesting ?? true,
      enableCommonSubexpressionElimination: config?.enableCommonSubexpressionElimination ?? true,
      maxPlanCacheSize: config?.maxPlanCacheSize ?? 1000,
      costModelVersion: config?.costModelVersion ?? 1,
    };

    this.planCache = new LRUCache({ maxSize: this.config.maxPlanCacheSize });
  }

  optimize(plan: ExecutionPlan, database: DatabaseType): OptimizedPlan {
    const cacheKey = this.generateCacheKey(plan, database);

    // Check cache
    const cached = this.planCache.get(cacheKey);
    if (cached) {
      this.logger.debug('Plan cache hit', { cacheKey });
      return cached;
    }

    const optimizations: string[] = [];
    const hints: OptimizationHint[] = [];
    let optimizedPlan = { ...plan };

    // Apply optimizations
    if (this.config.enablePredicatePushdown) {
      const result = this.applyPredicatePushdown(optimizedPlan);
      if (result.applied) {
        optimizations.push('Predicate pushdown');
        optimizedPlan = result.plan;
      }
    }

    if (this.config.enableProjectionPushdown) {
      const result = this.applyProjectionPushdown(optimizedPlan);
      if (result.applied) {
        optimizations.push('Projection pushdown');
        optimizedPlan = result.plan;
      }
    }

    if (this.config.enableJoinReordering) {
      const result = this.applyJoinReordering(optimizedPlan);
      if (result.applied) {
        optimizations.push('Join reordering');
        optimizedPlan = result.plan;
      }
    }

    if (this.config.enableCommonSubexpressionElimination) {
      const result = this.applyCSE(optimizedPlan);
      if (result.applied) {
        optimizations.push('Common subexpression elimination');
        optimizedPlan = result.plan;
      }
    }

    // Generate hints
    hints.push(...this.generateHints(optimizedPlan, database));

    // Estimate cost
    const cost = this.config.enableCostEstimation
      ? this.estimateCost(optimizedPlan, database)
      : { cpuCost: 0, ioCost: 0, networkCost: 0, memoryCost: 0, totalCost: 0, estimatedRows: 0, estimatedTimeMs: 0 };

    const optimized: OptimizedPlan = {
      plan: optimizedPlan,
      cost,
      hints,
      optimizations,
      cacheKey,
    };

    // Cache the plan
    this.planCache.set(cacheKey, optimized);

    return optimized;
  }

  private applyPredicatePushdown(plan: ExecutionPlan): { plan: ExecutionPlan; applied: boolean } {
    // Simplified predicate pushdown
    // In production, this would analyze the IR tree and push filters closer to data source
    return { plan, applied: false };
  }

  private applyProjectionPushdown(plan: ExecutionPlan): { plan: ExecutionPlan; applied: boolean } {
    // Simplified projection pushdown
    return { plan, applied: false };
  }

  private applyJoinReordering(plan: ExecutionPlan): { plan: ExecutionPlan; applied: boolean } {
    // Simplified join reordering based on estimated cardinality
    return { plan, applied: false };
  }

  private applyCSE(plan: ExecutionPlan): { plan: ExecutionPlan; applied: boolean } {
    // Common subexpression elimination
    return { plan, applied: false };
  }

  private generateHints(plan: ExecutionPlan, database: DatabaseType): OptimizationHint[] {
    const hints: OptimizationHint[] = [];

    // Check if query could benefit from indexing
    if (plan.warnings.length > 0) {
      hints.push({
        type: 'index',
        description: 'Consider adding indexes for better performance',
        impact: 'high',
        appliesTo: [],
      });
    }

    // Check for sorting operations
    if (plan.ir.type === 'find') {
      hints.push({
        type: 'cache',
        description: 'Result set is cacheable',
        impact: 'medium',
        appliesTo: [],
      });
    }

    return hints;
  }

  estimateCost(plan: ExecutionPlan, database: DatabaseType): CostEstimate {
    let cpuCost = 0;
    let ioCost = 0;
    let networkCost = 0;
    let memoryCost = 0;
    let estimatedRows = 1000; // Default estimate

    switch (plan.ir.type) {
      case 'find':
      case 'findOne':
        cpuCost = BASE_COSTS.seqScan! + (plan.steps.length * BASE_COSTS.filter!);
        ioCost = estimatedRows * 0.001; // Assume 1KB per row
        memoryCost = estimatedRows * 0.001;
        break;
      case 'insert':
      case 'insertMany':
        cpuCost = BASE_COSTS.insert!;
        ioCost = 0.001;
        break;
      case 'update':
      case 'updateMany':
        cpuCost = BASE_COSTS.update!;
        ioCost = 0.001;
        break;
      case 'delete':
      case 'deleteMany':
        cpuCost = BASE_COSTS.delete!;
        ioCost = 0.001;
        break;
      case 'aggregate':
        cpuCost = BASE_COSTS.aggregation!;
        memoryCost = estimatedRows * 0.001;
        break;
      default:
        cpuCost = 1.0;
    }

    const totalCost = cpuCost + ioCost + networkCost + memoryCost;
    const estimatedTimeMs = totalCost * 10; // Rough estimate

    return {
      cpuCost,
      ioCost,
      networkCost,
      memoryCost,
      totalCost,
      estimatedRows,
      estimatedTimeMs,
    };
  }

  private generateCacheKey(plan: ExecutionPlan, database: DatabaseType): string {
    return `${database}:${plan.ir.type}:${JSON.stringify(plan.ir)}`;
  }

  clearCache(): void {
    this.planCache.clear();
  }

  getCacheStats() {
    return this.planCache.getStats();
  }
}

// Query Rewriter for common patterns
export class QueryRewriter {
  private rules: RewriteRule[] = [];

  constructor() {
    // Register default rewrite rules
    this.addRule({
      name: 'flattenNestedFilters',
      description: 'Flatten nested $and/$or with single conditions',
      apply: (ir) => {
        // Simplified implementation
        return ir;
      },
    });

    this.addRule({
      name: 'removeRedundantProjections',
      description: 'Remove projection if all fields are selected',
      apply: (ir) => {
        return ir;
      },
    });

    this.addRule({
      name: 'optimizePagination',
      description: 'Convert offset-based to cursor-based pagination for large offsets',
      apply: (ir) => {
        return ir;
      },
    });
  }

  addRule(rule: RewriteRule): void {
    this.rules.push(rule);
  }

  rewrite(ir: IRNode): IRNode {
    let rewritten = ir;
    for (const rule of this.rules) {
      rewritten = rule.apply(rewritten);
    }
    return rewritten;
  }
}

interface RewriteRule {
  name: string;
  description: string;
  apply: (ir: IRNode) => IRNode;
}
