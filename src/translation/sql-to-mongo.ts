// =====================================================
// JSDB - SQL → MongoDB Translation Pipeline
// Parser → AST → Universal IR → Mongo Query Planner → Mongo Compiler
// =====================================================

import { parseSQL, sqlToIR } from '../ir/sql-parser.js';
import { queryPlanner } from '../planner/planner.js';
import type { IRNode, ExecutionPlan } from '../ir/nodes.js';
import type { Filter, Document, AggregationStage, SortSpec, ProjectionSpec } from '../types/index.js';
import type { TranslationStatus, FeatureTranslation, TranslationReport } from './status.js';
import { worstStatus } from './status.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('info', 'JSDB:SQLToMongo');

export interface SQLToMongoOptions {
  strictMode?: boolean;
  enableOptimizations?: boolean;
  maxPipelineStages?: number;
}

export interface SQLToMongoResult {
  mongoPipeline: AggregationStage[];
  mongoFilter?: Document;
  mongoSort?: Document;
  mongoProjection?: Document;
  limit?: number;
  skip?: number;
  report: TranslationReport;
  executionPlan: ExecutionPlan;
}

/**
 * SQL → MongoDB Translation Pipeline
 * 
 * Translates SQL queries to MongoDB aggregation pipelines
 * with full capability analysis and status classification
 */
export class SQLToMongoTranslator {
  private options: SQLToMongoOptions;

  constructor(options?: SQLToMongoOptions) {
    this.options = {
      strictMode: options?.strictMode ?? false,
      enableOptimizations: options?.enableOptimizations ?? true,
      maxPipelineStages: options?.maxPipelineStages ?? 50,
    };
  }

  /**
   * Translate a SQL query to MongoDB pipeline
   */
  translate(sql: string, sourceDb: string = 'mysql'): SQLToMongoResult {
    const startTime = Date.now();

    // Step 1: Parse SQL to AST
    const parsed = parseSQL(sql);

    // Step 2: Convert AST to Universal IR
    const ir = sqlToIR(parsed);

    // Step 3: Plan with MongoDB target
    const executionPlan = queryPlanner.plan(ir, 'mongodb');

    // Step 4: Analyze features and build report
    const report = this.analyzeTranslation(sql, ir, executionPlan, sourceDb);

    // Step 5: Convert IR to MongoDB pipeline
    const mongoResult = this.irToMongoPipeline(ir);

    // Step 6: Apply optimizations if enabled
    if (this.options.enableOptimizations) {
      this.optimizePipeline(mongoResult.pipeline);
    }

    // Step 7: Validate pipeline length
    if (mongoResult.pipeline.length > this.options.maxPipelineStages!) {
      report.warnings.push(
        `Pipeline has ${mongoResult.pipeline.length} stages (max: ${this.options.maxPipelineStages}). ` +
        'Consider breaking into smaller operations.'
      );
    }

    const duration = Date.now() - startTime;
    logger.debug('SQL to MongoDB translation completed', {
      sql: sql.slice(0, 100),
      pipelineStages: mongoResult.pipeline.length,
      duration,
      score: report.score,
    });

    return {
      mongoPipeline: mongoResult.pipeline,
      mongoFilter: mongoResult.filter,
      mongoSort: mongoResult.sort,
      mongoProjection: mongoResult.projection,
      limit: mongoResult.limit,
      skip: mongoResult.skip,
      report,
      executionPlan,
    };
  }

  /**
   * Analyze translation features and build report
   */
  private analyzeTranslation(
    sql: string,
    ir: IRNode,
    plan: ExecutionPlan,
    sourceDb: string
  ): TranslationReport {
    const features: FeatureTranslation[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let overallStatus: TranslationStatus = 'exact';

    // Analyze based on IR type
    switch (ir.type) {
      case 'find':
      case 'findOne': {
        features.push({
          feature: 'select',
          status: 'exact',
          sourceDb,
          targetDb: 'mongodb',
          reason: 'SQL SELECT maps to MongoDB find() with equivalent semantics',
        });

        // Check filter complexity
        if ('filter' in ir && ir.filter) {
          const filterStatus = this.analyzeFilter(ir.filter, sourceDb);
          features.push(filterStatus);
          overallStatus = worstStatus(overallStatus, filterStatus.status);
        }

        // Check projection
        if ('projection' in ir && ir.projection) {
          features.push({
            feature: 'projection',
            status: 'safe',
            sourceDb,
            targetDb: 'mongodb',
            reason: 'SQL column list maps to MongoDB $project; equivalent for supported types',
          });
        }

        // Check sort
        if ('sort' in ir && ir.sort) {
          features.push({
            feature: 'sort',
            status: 'exact',
            sourceDb,
            targetDb: 'mongodb',
            reason: 'SQL ORDER BY maps to MongoDB $sort with equivalent semantics',
          });
        }

        // Check pagination
        if ('limit' in ir || 'offset' in ir) {
          features.push({
            feature: 'pagination',
            status: 'safe',
            sourceDb,
            targetDb: 'mongodb',
            reason: 'SQL LIMIT/OFFSET maps to MongoDB skip/limit; equivalent but skip() has performance caveats at large offsets',
          });
        }
        break;
      }

      case 'insert':
      case 'insertMany': {
        features.push({
          feature: 'insert',
          status: 'exact',
          sourceDb,
          targetDb: 'mongodb',
          reason: 'SQL INSERT maps to MongoDB insertOne/insertMany with equivalent semantics',
        });
        break;
      }

      case 'update':
      case 'updateMany': {
        features.push({
          feature: 'update',
          status: 'exact',
          sourceDb,
          targetDb: 'mongodb',
          reason: 'SQL UPDATE maps to MongoDB updateOne/updateMany with equivalent semantics',
        });
        break;
      }

      case 'delete':
      case 'deleteMany': {
        features.push({
          feature: 'delete',
          status: 'exact',
          sourceDb,
          targetDb: 'mongodb',
          reason: 'SQL DELETE maps to MongoDB deleteOne/deleteMany with equivalent semantics',
        });
        break;
      }

      case 'aggregate': {
        features.push({
          feature: 'aggregation',
          status: 'emulated',
          sourceDb,
          targetDb: 'mongodb',
          reason: 'SQL GROUP BY + HAVING maps to MongoDB aggregation pipeline; different paradigm, equivalent results',
        });

        // Check if the aggregate pipeline contains $lookup (emulated JOIN)
        if ('pipeline' in ir && Array.isArray(ir.pipeline)) {
          const hasLookup = ir.pipeline.some(
            (stage: AggregationStage) => '$lookup' in stage
          );
          if (hasLookup) {
            features.push({
              feature: 'join',
              status: 'emulated',
              sourceDb,
              targetDb: 'mongodb',
              reason: 'SQL JOIN emulated using MongoDB $lookup aggregation',
              suggestion: 'For better performance, consider denormalizing data or using embedded documents',
              cost: 'high',
            });
            overallStatus = worstStatus(overallStatus, 'emulated');
            warnings.push('JOIN is emulated using $lookup - may be slower than native SQL JOIN');
          }
        }
        break;
      }

      case 'join': {
        // JOINs are emulated via $lookup
        features.push({
          feature: 'join',
          status: 'emulated',
          sourceDb,
          targetDb: 'mongodb',
          reason: 'SQL JOIN emulated using MongoDB $lookup aggregation',
          suggestion: 'For better performance, consider denormalizing data or using embedded documents',
          cost: 'high',
        });
        overallStatus = worstStatus(overallStatus, 'emulated');
        warnings.push('JOIN is emulated using $lookup - may be slower than native SQL JOIN');
        break;
      }

      case 'recursiveCTE': {
        features.push({
          feature: 'recursiveCTE',
          status: 'emulated',
          sourceDb,
          targetDb: 'mongodb',
          reason: 'SQL recursive CTE emulated using MongoDB $graphLookup',
          suggestion: 'Consider using materialized paths or nested sets for hierarchical data',
          cost: 'high',
        });
        overallStatus = worstStatus(overallStatus, 'emulated');
        break;
      }

      case 'storedProcedure':
      case 'storedFunction': {
        features.push({
          feature: ir.type,
          status: 'unsupported',
          sourceDb,
          targetDb: 'mongodb',
          reason: 'MongoDB does not support stored procedures/functions',
          suggestion: 'Move logic to application code or use MongoDB aggregation pipeline',
        });
        overallStatus = worstStatus(overallStatus, 'unsupported');
        errors.push(`Feature '${ir.type}' is not supported on MongoDB`);
        break;
      }
    }

    // Analyze plan warnings
    for (const warning of plan.warnings) {
      warnings.push(warning);
    }

    // Calculate portability score
    const score = this.calculateScore(features);

    return {
      sourceQuery: sql,
      sourceDb,
      targetDb: 'mongodb',
      overallStatus,
      features,
      warnings,
      errors,
      portable: overallStatus !== 'unsupported',
      score,
    };
  }

  /**
   * Analyze filter complexity
   */
  private analyzeFilter(filter: Filter, sourceDb: string): FeatureTranslation {
    let worstFilterStatus: TranslationStatus = 'native';

    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) {
        // Logical operators - native in MongoDB
        continue;
      }

      if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        const ops = value as Record<string, unknown>;
        for (const op of Object.keys(ops)) {
          switch (op) {
            case '$like':
            case '$ilike':
              worstFilterStatus = worstStatus(worstFilterStatus, 'emulated');
              break;
            case '$regex':
              worstFilterStatus = worstStatus(worstFilterStatus, 'native');
              break;
            case '$elemMatch':
              worstFilterStatus = worstStatus(worstFilterStatus, 'native');
              break;
          }
        }
      }
    }

    return {
      feature: 'filter',
      status: worstFilterStatus,
      sourceDb,
      targetDb: 'mongodb',
      reason: worstFilterStatus === 'emulated' ? 'LIKE/ILIKE emulated via $regex' : undefined,
    };
  }

  /**
   * Convert IR to MongoDB pipeline
   */
  private irToMongoPipeline(ir: IRNode): {
    pipeline: AggregationStage[];
    filter?: Document;
    sort?: Document;
    projection?: Document;
    limit?: number;
    skip?: number;
  } {
    const pipeline: AggregationStage[] = [];
    let filter: Document | undefined;
    let sort: Document | undefined;
    let projection: Document | undefined;
    let limit: number | undefined;
    let skip: number | undefined;

    switch (ir.type) {
      case 'find': {
        // Convert filter
        if (ir.filter && Object.keys(ir.filter).length > 0) {
          filter = this.convertFilterToMongo(ir.filter);
          pipeline.push({ $match: filter });
        }

        // Convert sort
        if (ir.sort && Object.keys(ir.sort).length > 0) {
          sort = this.convertSortToMongo(ir.sort);
          pipeline.push({ $sort: sort });
        }

        // Pagination
        if (ir.offset) {
          skip = ir.offset;
          pipeline.push({ $skip: skip });
        }
        if (ir.limit) {
          limit = ir.limit;
          pipeline.push({ $limit: limit });
        }

        // Projection
        if (ir.projection && Object.keys(ir.projection).length > 0) {
          projection = this.convertProjectionToMongo(ir.projection);
          pipeline.push({ $project: projection });
        }
        break;
      }

      case 'findOne': {
        if (ir.filter && Object.keys(ir.filter).length > 0) {
          filter = this.convertFilterToMongo(ir.filter);
          pipeline.push({ $match: filter });
        }
        pipeline.push({ $limit: 1 });
        break;
      }

      case 'aggregate': {
        // Pipeline already in MongoDB format
        return {
          pipeline: ir.pipeline,
          limit: undefined,
          skip: undefined,
        };
      }

      case 'join': {
        // Convert JOIN to $lookup pipeline
        pipeline.push(...this.convertJoinToLookup(ir));
        break;
      }

      case 'recursiveCTE': {
        // Convert recursive CTE to $graphLookup
        pipeline.push(...this.convertCTEToGraphLookup(ir));
        break;
      }

      default: {
        // For insert/update/delete, pipeline is not needed
        // These are handled directly by the adapter
        break;
      }
    }

    return { pipeline, filter, sort, projection, limit, skip };
  }

  /**
   * Convert JSDB filter to MongoDB filter
   */
  private convertFilterToMongo(filter: Filter): Document {
    const result: Document = {};

    for (const [key, value] of Object.entries(filter)) {
      if (key === '$and' || key === '$or' || key === '$nor') {
        result[key] = (value as Filter[]).map((f) => this.convertFilterToMongo(f));
      } else if (key === '$not') {
        result['$not'] = this.convertFilterToMongo(value as Filter);
      } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        const ops = value as Record<string, unknown>;
        const compiled: Record<string, unknown> = {};

        for (const [op, opVal] of Object.entries(ops)) {
          switch (op) {
            case '$like': {
              // Convert SQL LIKE to MongoDB $regex
              const pattern = (opVal as string)
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/%/g, '.*')
                .replace(/_/g, '.');
              compiled['$regex'] = pattern;
              break;
            }
            case '$ilike': {
              const pattern = (opVal as string)
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/%/g, '.*')
                .replace(/_/g, '.');
              compiled['$regex'] = pattern;
              compiled['$options'] = 'i';
              break;
            }
            case '$in':
            case '$nin': {
              compiled[op] = (opVal as unknown[]).map((v) => this.convertIdValue(key, v));
              break;
            }
            default:
              compiled[op] = opVal;
          }
        }

        result[key] = compiled as any;
      } else {
        result[key] = this.convertIdValue(key, value) as any;
      }
    }

    return result;
  }

  /**
   * Convert ID values (string _id to ObjectId where needed)
   */
  private convertIdValue(key: string, value: unknown): unknown {
    if ((key === '_id' || key === 'id') && typeof value === 'string') {
      try {
        // Try to convert to ObjectId if it looks like one
        if (/^[0-9a-f]{24}$/i.test(value)) {
          return { $oid: value };
        }
      } catch {
        // Keep as string
      }
    }
    return value;
  }

  /**
   * Convert JSDB sort to MongoDB sort
   */
  private convertSortToMongo(sort: SortSpec): Document {
    const result: Document = {};
    for (const [field, dir] of Object.entries(sort)) {
      result[field] = dir === -1 || dir === 'desc' ? -1 : 1;
    }
    return result;
  }

  /**
   * Convert JSDB projection to MongoDB projection
   */
  private convertProjectionToMongo(projection: ProjectionSpec): Document {
    const result: Document = {};
    for (const [field, val] of Object.entries(projection)) {
      result[field] = val === 1 || val === true ? 1 : 0;
    }
    return result;
  }

  /**
   * Convert JOIN to $lookup pipeline
   */
  private convertJoinToLookup(ir: any): AggregationStage[] {
    const pipeline: AggregationStage[] = [];
    const joins = ir.joins || [];

    for (const join of joins) {
      // Add $lookup stage
      pipeline.push({
        $lookup: {
          from: join.collection,
          localField: join.on?.localField || 'id',
          foreignField: join.on?.foreignField || '_id',
          as: join.as || join.collection,
        },
      });

      // Unwind unless it's a LEFT JOIN with null preservation
      if (join.type !== 'left') {
        pipeline.push({
          $unwind: `$${join.as || join.collection}`,
        });
      } else {
        pipeline.push({
          $unwind: {
            path: `$${join.as || join.collection}`,
            preserveNullAndEmptyArrays: true,
          },
        });
      }
    }

    // Add filter if present
    if (ir.filter && Object.keys(ir.filter).length > 0) {
      pipeline.push({ $match: this.convertFilterToMongo(ir.filter) });
    }

    // Add sort if present
    if (ir.sort && Object.keys(ir.sort).length > 0) {
      pipeline.push({ $sort: this.convertSortToMongo(ir.sort) });
    }

    // Add pagination
    if (ir.offset) {
      pipeline.push({ $skip: ir.offset });
    }
    if (ir.limit) {
      pipeline.push({ $limit: ir.limit });
    }

    // Add projection if present
    if (ir.projection && Object.keys(ir.projection).length > 0) {
      pipeline.push({ $project: this.convertProjectionToMongo(ir.projection) });
    }

    return pipeline;
  }

  /**
   * Convert recursive CTE to $graphLookup
   */
  private convertCTEToGraphLookup(ir: any): AggregationStage[] {
    const pipeline: AggregationStage[] = [];
    const cte = ir.cte;

    if (cte) {
      pipeline.push({
        $graphLookup: {
          from: ir.collection,
          startWith: cte.startWith ? this.convertFilterToMongo(cte.startWith) : '$id',
          connectFromField: cte.connectBy?.field || 'id',
          connectToField: cte.connectBy?.references || 'parentId',
          as: cte.name || 'hierarchy',
          maxDepth: cte.maxDepth || 10,
          depthField: 'depth',
        },
      });
    }

    return pipeline;
  }

  /**
   * Optimize pipeline by removing redundant stages
   */
  private optimizePipeline(pipeline: AggregationStage[]): void {
    // Remove consecutive $match stages
    // Remove $match after $limit
    // Move $match before $lookup where possible
    // This is a simplified optimization - production would be more complex

    for (let i = pipeline.length - 2; i >= 0; i--) {
      const current = pipeline[i];
      const next = pipeline[i + 1];

      // Remove $match after $limit
      if (current && '$limit' in current && next && '$match' in next) {
        pipeline.splice(i + 1, 1);
      }
    }
  }

  /**
   * Calculate portability score based on features
   */
  private calculateScore(features: FeatureTranslation[]): number {
    if (features.length === 0) return 100;

    let totalScore = 0;
    for (const feature of features) {
      switch (feature.status) {
        case 'native':
          totalScore += 100;
          break;
        case 'exact':
          totalScore += 95;
          break;
        case 'safe':
          totalScore += 85;
          break;
        case 'emulated':
          totalScore += 60;
          break;
        case 'lossy':
          totalScore += 30;
          break;
        case 'unsupported':
          totalScore += 0;
          break;
      }
    }

    return Math.round(totalScore / features.length);
  }
}
