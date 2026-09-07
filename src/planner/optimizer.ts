// =====================================================
// JSDB - Query Optimizer
// Optimizes execution plans for better performance
// =====================================================
import type { AggregationStage, Filter, SortSpec, Document } from '../types/index.js';
import type { ExecutionPlan } from '../ir/nodes.js';

export interface OptimizedPlan extends ExecutionPlan {
  optimizations: string[];
  estimatedImprovement: number;
}

export interface OptimizationHint {
  type: 'index' | 'filter_pushdown' | 'projection_pushdown' | 'join_reorder' | 'subquery_to_join';
  description: string;
  impact: 'low' | 'medium' | 'high';
}

export class QueryOptimizer {
  private hints: OptimizationHint[] = [];

  /**
   * Optimize an execution plan
   */
  optimize(plan: ExecutionPlan): OptimizedPlan {
    this.hints = [];
    const optimizations: string[] = [];

    // 1. Filter pushdown — move filters earlier in pipeline
    const filterOpt = this.optimizeFilterPushdown(plan);
    if (filterOpt) {
      optimizations.push(filterOpt);
    }

    // 2. Projection pushdown — select only needed fields
    const projOpt = this.optimizeProjectionPushdown(plan);
    if (projOpt) {
      optimizations.push(projOpt);
    }

    // 3. Index suggestions
    const indexHints = this.suggestIndexes(plan);
    this.hints.push(...indexHints);

    // 4. Join reordering
    const joinOpt = this.optimizeJoinOrder(plan);
    if (joinOpt) {
      optimizations.push(joinOpt);
    }

    // 5. Subquery to JOIN conversion
    const subqueryOpt = this.optimizeSubqueryToJoin(plan);
    if (subqueryOpt) {
      optimizations.push(subqueryOpt);
    }

    return {
      ...plan,
      optimizations,
      estimatedImprovement: this.estimateImprovement(optimizations),
    };
  }

  /**
   * Get optimization hints for a plan
   */
  getHints(): OptimizationHint[] {
    return [...this.hints];
  }

  /**
   * Analyze a pipeline and suggest optimizations
   */
  analyzePipeline(pipeline: AggregationStage[]): OptimizationHint[] {
    const hints: OptimizationHint[] = [];

    for (let i = 0; i < pipeline.length; i++) {
      const stage = pipeline[i];
      const stageKey = Object.keys(stage)[0];

      // $match should be as early as possible
      if (stageKey === '$match' && i > 0) {
        const prevStage = Object.keys(pipeline[i - 1])[0];
        if (prevStage !== '$match') {
          hints.push({
            type: 'filter_pushdown',
            description: `$match at position ${i} could be moved earlier for better performance`,
            impact: 'medium',
          });
        }
      }

      // $project should come after $match
      if (stageKey === '$project' && i < pipeline.length - 1) {
        const nextStage = Object.keys(pipeline[i + 1])[0];
        if (nextStage === '$match') {
          hints.push({
            type: 'projection_pushdown',
            description: '$project before $match may cause unnecessary data transfer',
            impact: 'low',
          });
        }
      }

      // $lookup before $match is inefficient
      if (stageKey === '$lookup') {
        for (let j = i + 1; j < pipeline.length; j++) {
          const laterKey = Object.keys(pipeline[j])[0];
          if (laterKey === '$match') {
            hints.push({
              type: 'filter_pushdown',
              description: '$match after $lookup could be pushed into $lookup pipeline',
              impact: 'high',
            });
            break;
          }
        }
      }
    }

    return hints;
  }

  /**
   * Detect N+1 query patterns
   */
  detectNPlusOne(pipeline: AggregationStage[]): OptimizationHint[] {
    const hints: OptimizationHint[] = [];
    const lookupCount = pipeline.filter(s => Object.keys(s)[0] === '$lookup').length;

    if (lookupCount > 1) {
      // Check if lookups are on different collections
      const collections = new Set(
        pipeline
          .filter(s => Object.keys(s)[0] === '$lookup')
          .map(s => (s as { $lookup: { from: string } }).$lookup.from)
      );

      if (collections.size > 1) {
        hints.push({
          type: 'join_reorder',
          description: `Multiple $lookup stages on different collections detected (${lookupCount} lookups). Consider denormalizing or using batch lookups.`,
          impact: 'high',
        });
      }
    }

    return hints;
  }

  private optimizeFilterPushdown(plan: ExecutionPlan): string | null {
    // In a real implementation, this would reorder the pipeline stages
    // For now, we just detect and suggest
    return null;
  }

  private optimizeProjectionPushdown(plan: ExecutionPlan): string | null {
    // Detect if projection can be pushed down
    return null;
  }

  private optimizeJoinOrder(plan: ExecutionPlan): string | null {
    // Suggest join reordering based on table sizes
    return null;
  }

  private optimizeSubqueryToJoin(plan: ExecutionPlan): string | null {
    // Detect subquery patterns that could be joins
    return null;
  }

  private suggestIndexes(plan: ExecutionPlan): OptimizationHint[] {
    const hints: OptimizationHint[] = [];
    const ir = plan.ir;

    if (ir.type === 'find' && ir.filter) {
      const filterFields = Object.keys(ir.filter).filter(k => !k.startsWith('$'));
      if (filterFields.length > 0) {
        hints.push({
          type: 'index',
          description: `Consider creating index on fields: ${filterFields.join(', ')}`,
          impact: 'medium',
        });
      }
    }

    if (ir.type === 'find' && ir.sort) {
      const sortFields = Object.keys(ir.sort);
      if (sortFields.length > 0) {
        hints.push({
          type: 'index',
          description: `Consider creating compound index for sort: ${sortFields.join(', ')}`,
          impact: 'medium',
        });
      }
    }

    return hints;
  }

  private estimateImprovement(optimizations: string[]): number {
    // Rough estimate based on number of optimizations
    return Math.min(optimizations.length * 5, 50);
  }
}

/**
 * Pipeline optimizer for aggregation queries
 */
export class PipelineOptimizer {
  /**
   * Reorder pipeline stages for optimal execution
   */
  static reorder(pipeline: AggregationStage[]): AggregationStage[] {
    const result = [...pipeline];
    
    // Move $match to the front
    const matchIndex = result.findIndex(s => Object.keys(s)[0] === '$match');
    if (matchIndex > 0) {
      const [match] = result.splice(matchIndex, 1);
      result.unshift(match);
    }

    // Move $project before $sort if possible
    const projectIndex = result.findIndex(s => Object.keys(s)[0] === '$project');
    const sortIndex = result.findIndex(s => Object.keys(s)[0] === '$sort');
    if (projectIndex > sortIndex && sortIndex >= 0) {
      const [project] = result.splice(projectIndex, 1);
      result.splice(sortIndex, 0, project);
    }

    return result;
  }

  /**
   * Merge adjacent $match stages
   */
  static mergeMatches(pipeline: AggregationStage[]): AggregationStage[] {
    const result: AggregationStage[] = [];
    let pendingMatch: Filter | null = null;

    for (const stage of pipeline) {
      const stageKey = Object.keys(stage)[0];
      if (stageKey === '$match') {
        const matchFilter = (stage as { $match: Filter }).$match;
        if (pendingMatch) {
          // Merge filters using $and
          pendingMatch = { $and: [pendingMatch, matchFilter] } as Filter;
        } else {
          pendingMatch = matchFilter;
        }
      } else {
        if (pendingMatch) {
          result.push({ $match: pendingMatch });
          pendingMatch = null;
        }
        result.push(stage);
      }
    }

    if (pendingMatch) {
      result.push({ $match: pendingMatch });
    }

    return result;
  }

  /**
   * Remove redundant $project stages
   */
  static removeRedundantProject(pipeline: AggregationStage[]): AggregationStage[] {
    const result: AggregationStage[] = [];
    let lastProject: Document | null = null;

    for (const stage of pipeline) {
      const stageKey = Object.keys(stage)[0];
      if (stageKey === '$project') {
        lastProject = (stage as { $project: Document }).$project;
      } else {
        if (lastProject) {
          result.push({ $project: lastProject });
          lastProject = null;
        }
        result.push(stage);
      }
    }

    // Don't forget the last project
    if (lastProject) {
      result.push({ $project: lastProject });
    }

    return result;
  }
}
