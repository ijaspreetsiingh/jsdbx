// =====================================================
// JSDB - Portability Analyzer & Dry-Run Mode
// Analyze queries for cross-database portability
// =====================================================

import { parseSQL, sqlToIR } from '../ir/sql-parser.js';
import { queryPlanner } from '../planner/planner.js';
import { globalRegistry } from '../capabilities/index.js';
import type { IRNode, ExecutionPlan } from '../ir/nodes.js';
import type { DatabaseType, Filter } from '../types/index.js';
import type { TranslationStatus, FeatureTranslation, TranslationReport } from './status.js';
import { worstStatus, describeStatus } from './status.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('info', 'JSDB:Analyzer');

export interface AnalyzeOptions {
  sourceDb?: DatabaseType;
  targetDb?: DatabaseType;
  includeSuggestions?: boolean;
}

export interface AnalyzeResult {
  portable: boolean;
  source: DatabaseType;
  target: DatabaseType;
  score: number;
  features: FeatureTranslation[];
  warnings: string[];
  report: TranslationReport;
}

export interface ExplainResult {
  source: DatabaseType;
  target: DatabaseType;
  sourceQuery: string;
  parsedAST: unknown;
  ir: IRNode;
  executionPlan: ExecutionPlan;
  capabilities: FeatureTranslation[];
  translationStrategy: string;
  generatedQuery?: string;
  generatedPipeline?: unknown[];
  warnings: string[];
  estimatedRisk: 'low' | 'medium' | 'high';
}

export interface DryRunResult {
  sourceQuery: string;
  sourceDb: DatabaseType;
  targetDb: DatabaseType;
  ir: IRNode;
  translationStatus: TranslationStatus;
  features: FeatureTranslation[];
  warnings: string[];
  errors: string[];
  wouldExecute: boolean;
  estimatedRisk: 'low' | 'medium' | 'high';
}

/**
 * Portability Analyzer
 * Analyzes queries for cross-database portability
 */
export class PortabilityAnalyzer {
  /**
   * Analyze a SQL query for portability
   */
  analyze(sql: string, options?: AnalyzeOptions): AnalyzeResult {
    const sourceDb = options?.sourceDb ?? 'mysql';
    const targetDb = options?.targetDb ?? 'mongodb';

    // Parse SQL
    const parsed = parseSQL(sql);
    const ir = sqlToIR(parsed);

    // Plan for target database
    const plan = queryPlanner.plan(ir, targetDb);

    // Analyze features
    const features = this.analyzeFeatures(ir, plan, sourceDb, targetDb);

    // Calculate score
    const score = this.calculateScore(features);

    // Check portability
    const portable = features.every(f => f.status !== 'unsupported');

    // Generate warnings
    const warnings = this.generateWarnings(features, sourceDb, targetDb);

    const report: TranslationReport = {
      sourceQuery: sql,
      sourceDb,
      targetDb,
      overallStatus: this.getOverallStatus(features),
      features,
      warnings,
      errors: [],
      portable,
      score,
    };

    return {
      portable,
      source: sourceDb,
      target: targetDb,
      score,
      features,
      warnings,
      report,
    };
  }

  /**
   * Explain a query translation
   */
  explain(sql: string, options?: AnalyzeOptions): ExplainResult {
    const sourceDb = options?.sourceDb ?? 'mysql';
    const targetDb = options?.targetDb ?? 'mongodb';

    // Parse SQL
    const parsed = parseSQL(sql);

    // Convert to IR
    const ir = sqlToIR(parsed);

    // Plan
    const plan = queryPlanner.plan(ir, targetDb);

    // Analyze features
    const features = this.analyzeFeatures(ir, plan, sourceDb, targetDb);

    // Generate translation strategy
    const strategy = this.getTranslationStrategy(ir, targetDb);

    // Generate warnings
    const warnings = this.generateWarnings(features, sourceDb, targetDb);

    // Estimate risk
    const risk = this.estimateRisk(features);

    return {
      source: sourceDb,
      target: targetDb,
      sourceQuery: sql,
      parsedAST: parsed,
      ir,
      executionPlan: plan,
      capabilities: features,
      translationStrategy: strategy,
      warnings,
      estimatedRisk: risk,
    };
  }

  /**
   * Dry-run a translation without executing
   */
  dryRun(sql: string, options?: AnalyzeOptions): DryRunResult {
    const sourceDb = options?.sourceDb ?? 'mysql';
    const targetDb = options?.targetDb ?? 'mongodb';

    // Parse SQL
    const parsed = parseSQL(sql);

    // Convert to IR
    const ir = sqlToIR(parsed);

    // Plan
    const plan = queryPlanner.plan(ir, targetDb);

    // Analyze features
    const features = this.analyzeFeatures(ir, plan, sourceDb, targetDb);

    // Check if any feature is unsupported
    const hasUnsupported = features.some(f => f.status === 'unsupported');

    // Generate warnings
    const warnings = this.generateWarnings(features, sourceDb, targetDb);

    // Generate errors
    const errors = features
      .filter(f => f.status === 'unsupported')
      .map(f => `Feature '${f.feature}' is not supported: ${f.reason}`);

    // Estimate risk
    const risk = this.estimateRisk(features);

    // Get overall status
    const overallStatus = this.getOverallStatus(features);

    return {
      sourceQuery: sql,
      sourceDb,
      targetDb,
      ir,
      translationStatus: overallStatus,
      features,
      warnings,
      errors,
      wouldExecute: !hasUnsupported,
      estimatedRisk: risk,
    };
  }

  /**
   * Analyze MongoDB query for SQL portability
   */
  analyzeMongoQuery(
    collection: string,
    operation: string,
    filter?: Filter,
    options?: AnalyzeOptions
  ): AnalyzeResult {
    const sourceDb = options?.sourceDb ?? 'mongodb';
    const targetDb = options?.targetDb ?? 'mysql';

    const features: FeatureTranslation[] = [];
    const warnings: string[] = [];

    // Analyze based on operation
    switch (operation) {
      case 'find':
      case 'findOne':
        features.push({
          feature: 'select',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'insert':
      case 'insertMany':
        features.push({
          feature: 'insert',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'update':
      case 'updateMany':
        features.push({
          feature: 'update',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'delete':
      case 'deleteMany':
        features.push({
          feature: 'delete',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'aggregate':
        features.push({
          feature: 'aggregation',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
    }

    // Analyze filter if present
    if (filter) {
      const filterAnalysis = this.analyzeMongoFilter(filter, sourceDb, targetDb);
      features.push(filterAnalysis);
    }

    // Calculate score
    const score = this.calculateScore(features);

    // Check portability
    const portable = features.every(f => f.status !== 'unsupported');

    const report: TranslationReport = {
      sourceQuery: JSON.stringify({ collection, operation, filter }),
      sourceDb,
      targetDb,
      overallStatus: this.getOverallStatus(features),
      features,
      warnings,
      errors: [],
      portable,
      score,
    };

    return {
      portable,
      source: sourceDb,
      target: targetDb,
      score,
      features,
      warnings,
      report,
    };
  }

  /**
   * Analyze MongoDB filter
   */
  private analyzeMongoFilter(
    filter: Filter,
    sourceDb: DatabaseType,
    targetDb: DatabaseType
  ): FeatureTranslation {
    let worstFilterStatus: TranslationStatus = 'native';

    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) continue;

      if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        const ops = value as Record<string, unknown>;
        for (const op of Object.keys(ops)) {
          switch (op) {
            case '$elemMatch':
              worstFilterStatus = worstStatus(worstFilterStatus, 'emulated');
              break;
            case '$regex':
              worstFilterStatus = worstStatus(worstFilterStatus, 'native');
              break;
            case '$size':
              worstFilterStatus = worstStatus(worstFilterStatus, 'emulated');
              break;
            case '$all':
              worstFilterStatus = worstStatus(worstFilterStatus, 'emulated');
              break;
          }
        }
      }
    }

    return {
      feature: 'filter',
      status: worstFilterStatus,
      sourceDb,
      targetDb,
    };
  }

  /**
   * Analyze features from IR and plan
   */
  private analyzeFeatures(
    ir: IRNode,
    plan: ExecutionPlan,
    sourceDb: DatabaseType,
    targetDb: DatabaseType
  ): FeatureTranslation[] {
    const features: FeatureTranslation[] = [];

    // Check capabilities from plan
    for (const cap of plan.capabilities) {
      features.push({
        feature: cap.operation,
        status: cap.status as TranslationStatus,
        sourceDb,
        targetDb,
        reason: cap.message,
      });
    }

    // Add operation-specific features
    switch (ir.type) {
      case 'find':
      case 'findOne':
        features.push({
          feature: 'select',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'insert':
      case 'insertMany':
        features.push({
          feature: 'insert',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'update':
      case 'updateMany':
        features.push({
          feature: 'update',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'delete':
      case 'deleteMany':
        features.push({
          feature: 'delete',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'aggregate':
        features.push({
          feature: 'aggregation',
          status: 'native',
          sourceDb,
          targetDb,
        });
        break;
      case 'join':
        features.push({
          feature: 'join',
          status: 'emulated',
          sourceDb,
          targetDb,
          reason: 'JOIN emulated using $lookup',
        });
        break;
    }

    return features;
  }

  /**
   * Calculate portability score
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

  /**
   * Get overall status from features
   */
  private getOverallStatus(features: FeatureTranslation[]): TranslationStatus {
    let status: TranslationStatus = 'native';
    for (const feature of features) {
      status = worstStatus(status, feature.status);
    }
    return status;
  }

  /**
   * Generate warnings
   */
  private generateWarnings(
    features: FeatureTranslation[],
    sourceDb: DatabaseType,
    targetDb: DatabaseType
  ): string[] {
    const warnings: string[] = [];

    for (const feature of features) {
      if (feature.status === 'emulated') {
        warnings.push(`${feature.feature} is emulated: ${feature.reason || 'may have performance implications'}`);
      } else if (feature.status === 'lossy') {
        warnings.push(`${feature.feature} may lose some semantics during translation`);
      } else if (feature.status === 'unsupported') {
        warnings.push(`${feature.feature} is not supported: ${feature.reason}`);
      }
    }

    return warnings;
  }

  /**
   * Get translation strategy description
   */
  private getTranslationStrategy(ir: IRNode, targetDb: DatabaseType): string {
    switch (ir.type) {
      case 'find':
      case 'findOne':
        return `SQL SELECT → IR find → ${targetDb} find/query`;
      case 'insert':
      case 'insertMany':
        return `SQL INSERT → IR insert → ${targetDb} insertOne/insertMany`;
      case 'update':
      case 'updateMany':
        return `SQL UPDATE → IR update → ${targetDb} updateOne/updateMany`;
      case 'delete':
      case 'deleteMany':
        return `SQL DELETE → IR delete → ${targetDb} deleteOne/deleteMany`;
      case 'aggregate':
        return `SQL aggregation → IR aggregate → ${targetDb} aggregate pipeline`;
      case 'join':
        return `SQL JOIN → IR join → ${targetDb} $lookup aggregation`;
      case 'recursiveCTE':
        return `SQL recursive CTE → IR recursiveCTE → ${targetDb} $graphLookup`;
      default:
        return `SQL ${ir.type} → IR ${ir.type} → ${targetDb}`;
    }
  }

  /**
   * Estimate risk level
   */
  private estimateRisk(features: FeatureTranslation[]): 'low' | 'medium' | 'high' {
    const hasUnsupported = features.some(f => f.status === 'unsupported');
    const hasEmulated = features.some(f => f.status === 'emulated');
    const hasLossy = features.some(f => f.status === 'lossy');

    if (hasUnsupported) return 'high';
    if (hasLossy) return 'high';
    if (hasEmulated) return 'medium';
    return 'low';
  }
}

// Singleton
export const portabilityAnalyzer = new PortabilityAnalyzer();
