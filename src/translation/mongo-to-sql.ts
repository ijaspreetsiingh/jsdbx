// =====================================================
// JSDB - MongoDB → SQL Translation Pipeline
// Mongo Query → Normalized Operation → Universal IR → SQL Compiler
// =====================================================

import type { IRNode } from '../ir/nodes.js';
import type { Filter, Document, AggregationStage, SortSpec, ProjectionSpec, Update } from '../types/index.js';
import type { TranslationStatus, FeatureTranslation, TranslationReport } from './status.js';
import { worstStatus } from './status.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('info', 'JSDB:MongoToSQL');

export interface MongoToSQLOptions {
  targetDb?: 'mysql' | 'postgres' | 'sqlite';
  strictMode?: boolean;
  enableOptimizations?: boolean;
}

export interface MongoToSQLResult {
  sql: string;
  params: unknown[];
  report: TranslationReport;
  ir: IRNode;
}

/**
 * MongoDB → SQL Translation Pipeline
 * 
 * Translates MongoDB queries to SQL
 * with full capability analysis
 */
export class MongoToSQLTranslator {
  private options: MongoToSQLOptions;

  constructor(options?: MongoToSQLOptions) {
    this.options = {
      targetDb: options?.targetDb ?? 'mysql',
      strictMode: options?.strictMode ?? false,
      enableOptimizations: options?.enableOptimizations ?? true,
    };
  }

  /**
   * Translate a MongoDB find query to SQL
   */
  translateFind(
    collection: string,
    filter?: Filter,
    options?: {
      sort?: SortSpec;
      limit?: number;
      skip?: number;
      projection?: ProjectionSpec;
    }
  ): MongoToSQLResult {
    const startTime = Date.now();

    // Build IR
    const ir: IRNode = {
      type: 'find',
      collection,
      filter: filter || {},
      sort: options?.sort,
      limit: options?.limit,
      offset: options?.skip,
      projection: options?.projection,
    };

    // Analyze features
    const report = this.analyzeTranslation(ir);

    // Generate SQL
    const sql = this.generateSelectSQL(ir);

    const duration = Date.now() - startTime;
    logger.debug('MongoDB to SQL translation completed', {
      collection,
      duration,
      score: report.score,
    });

    return {
      sql: sql.sql,
      params: sql.params,
      report,
      ir,
    };
  }

  /**
   * Translate a MongoDB insertOne to SQL
   */
  translateInsertOne(collection: string, document: Document): MongoToSQLResult {
    const ir: IRNode = {
      type: 'insert',
      collection,
      document,
    };

    const report = this.analyzeTranslation(ir);
    const sql = this.generateInsertSQL(ir);

    return {
      sql: sql.sql,
      params: sql.params,
      report,
      ir,
    };
  }

  /**
   * Translate a MongoDB insertMany to SQL
   */
  translateInsertMany(collection: string, documents: Document[]): MongoToSQLResult {
    const ir: IRNode = {
      type: 'insertMany',
      collection,
      documents,
    };

    const report = this.analyzeTranslation(ir);
    const sql = this.generateInsertManySQL(ir);

    return {
      sql: sql.sql,
      params: sql.params,
      report,
      ir,
    };
  }

  /**
   * Translate a MongoDB updateOne to SQL
   */
  translateUpdateOne(
    collection: string,
    filter: Filter,
    update: Update
  ): MongoToSQLResult {
    const ir: IRNode = {
      type: 'update',
      collection,
      filter,
      update,
    };

    const report = this.analyzeTranslation(ir);
    const sql = this.generateUpdateSQL(ir);

    return {
      sql: sql.sql,
      params: sql.params,
      report,
      ir,
    };
  }

  /**
   * Translate a MongoDB updateMany to SQL
   */
  translateUpdateMany(
    collection: string,
    filter: Filter,
    update: Update
  ): MongoToSQLResult {
    const ir: IRNode = {
      type: 'updateMany',
      collection,
      filter,
      update,
    };

    const report = this.analyzeTranslation(ir);
    const sql = this.generateUpdateSQL(ir);

    return {
      sql: sql.sql,
      params: sql.params,
      report,
      ir,
    };
  }

  /**
   * Translate a MongoDB deleteOne to SQL
   */
  translateDeleteOne(collection: string, filter: Filter): MongoToSQLResult {
    const ir: IRNode = {
      type: 'delete',
      collection,
      filter,
    };

    const report = this.analyzeTranslation(ir);
    const sql = this.generateDeleteSQL(ir);

    return {
      sql: sql.sql,
      params: sql.params,
      report,
      ir,
    };
  }

  /**
   * Translate a MongoDB deleteMany to SQL
   */
  translateDeleteMany(collection: string, filter: Filter): MongoToSQLResult {
    const ir: IRNode = {
      type: 'deleteMany',
      collection,
      filter,
    };

    const report = this.analyzeTranslation(ir);
    const sql = this.generateDeleteSQL(ir);

    return {
      sql: sql.sql,
      params: sql.params,
      report,
      ir,
    };
  }

  /**
   * Translate a MongoDB aggregate to SQL
   */
  translateAggregate(
    collection: string,
    pipeline: AggregationStage[]
  ): MongoToSQLResult {
    const ir: IRNode = {
      type: 'aggregate',
      collection,
      pipeline,
    };

    const report = this.analyzeTranslation(ir);
    const sql = this.generateAggregateSQL(ir);

    return {
      sql: sql.sql,
      params: sql.params,
      report,
      ir,
    };
  }

  /**
   * Analyze translation features
   */
  private analyzeTranslation(ir: IRNode): TranslationReport {
    const features: FeatureTranslation[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    let overallStatus: TranslationStatus = 'exact';

    switch (ir.type) {
      case 'find':
      case 'findOne': {
        features.push({
          feature: 'select',
          status: 'exact',
          sourceDb: 'mongodb',
          targetDb: this.options.targetDb!,
          reason: 'MongoDB find() maps to SQL SELECT with equivalent semantics',
        });

        // Analyze filter
        if (ir.filter && Object.keys(ir.filter).length > 0) {
          const filterAnalysis = this.analyzeFilter(ir.filter);
          features.push(filterAnalysis);
          overallStatus = worstStatus(overallStatus, filterAnalysis.status);
        }

        // Analyze sort
        if (ir.sort && Object.keys(ir.sort).length > 0) {
          features.push({
            feature: 'sort',
            status: 'exact',
            sourceDb: 'mongodb',
            targetDb: this.options.targetDb!,
            reason: 'MongoDB sort maps to SQL ORDER BY with equivalent semantics',
          });
        }

        // Analyze projection
        if (ir.projection && Object.keys(ir.projection).length > 0) {
          features.push({
            feature: 'projection',
            status: 'native',
            sourceDb: 'mongodb',
            targetDb: this.options.targetDb!,
          });
        }
        break;
      }

      case 'aggregate': {
        // Analyze pipeline stages
        for (const stage of ir.pipeline) {
          if ('$lookup' in stage) {
            features.push({
              feature: 'lookup',
              status: 'emulated',
              sourceDb: 'mongodb',
              targetDb: this.options.targetDb!,
              reason: 'MongoDB $lookup emulated using SQL JOIN',
            });
            overallStatus = worstStatus(overallStatus, 'emulated');
          } else if ('$graphLookup' in stage) {
            features.push({
              feature: 'graphLookup',
              status: 'emulated',
              sourceDb: 'mongodb',
              targetDb: this.options.targetDb!,
              reason: 'MongoDB $graphLookup emulated using recursive CTE (MySQL 8.0+, PostgreSQL)',
            });
            overallStatus = worstStatus(overallStatus, 'emulated');
          } else if ('$unwind' in stage) {
            features.push({
              feature: 'unwind',
              status: 'emulated',
              sourceDb: 'mongodb',
              targetDb: this.options.targetDb!,
              reason: 'MongoDB $unwind emulated using lateral join or cross apply',
            });
            overallStatus = worstStatus(overallStatus, 'emulated');
          } else if ('$setWindowFields' in stage) {
            features.push({
              feature: 'windowFunction',
              status: 'native',
              sourceDb: 'mongodb',
              targetDb: this.options.targetDb!,
            });
          }
        }
        break;
      }
    }

    const score = this.calculateScore(features);

    return {
      sourceQuery: JSON.stringify(ir),
      sourceDb: 'mongodb',
      targetDb: this.options.targetDb!,
      overallStatus,
      features,
      warnings,
      errors,
      portable: overallStatus !== 'unsupported',
      score,
    };
  }

  /**
   * Analyze MongoDB filter
   */
  private analyzeFilter(filter: Filter): FeatureTranslation {
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
              worstFilterStatus = worstStatus(worstFilterStatus, 'safe');
              break;
            case '$size':
              worstFilterStatus = worstStatus(worstFilterStatus, 'emulated');
              break;
          }
        }
      }
    }

    return {
      feature: 'filter',
      status: worstFilterStatus,
      sourceDb: 'mongodb',
      targetDb: this.options.targetDb!,
    };
  }

  /**
   * Generate SELECT SQL from IR
   */
  private generateSelectSQL(ir: IRNode): { sql: string; params: unknown[] } {
    if (ir.type !== 'find' && ir.type !== 'findOne') {
      throw new Error('IR must be find or findOne type');
    }

    const params: unknown[] = [];
    let sql = 'SELECT';

    // Projection
    if (ir.projection && Object.keys(ir.projection).length > 0) {
      const fields = Object.entries(ir.projection)
        .filter(([, v]) => v === 1 || v === true)
        .map(([k]) => this.quoteIdentifier(k));
      sql += ` ${fields.join(', ')}`;
    } else {
      sql += ' *';
    }

    // FROM
    sql += ` FROM ${this.quoteIdentifier(ir.collection)}`;

    // WHERE
    if (ir.filter && Object.keys(ir.filter).length > 0) {
      const { clause, params: filterParams } = this.generateWhereClause(ir.filter);
      sql += ` WHERE ${clause}`;
      params.push(...filterParams);
    }

    // ORDER BY
    if (ir.sort && Object.keys(ir.sort).length > 0) {
      const orderParts = Object.entries(ir.sort).map(([field, dir]) => {
        const direction = dir === -1 || dir === 'desc' ? 'DESC' : 'ASC';
        return `${this.quoteIdentifier(field)} ${direction}`;
      });
      sql += ` ORDER BY ${orderParts.join(', ')}`;
    }

    // LIMIT
    if ('limit' in ir && ir.limit !== undefined) {
      sql += ` LIMIT ?`;
      params.push(ir.limit);
    }

    // OFFSET
    if ('offset' in ir && ir.offset !== undefined) {
      sql += ` OFFSET ?`;
      params.push(ir.offset);
    }

    return { sql, params };
  }

  /**
   * Generate INSERT SQL from IR
   */
  private generateInsertSQL(ir: IRNode): { sql: string; params: unknown[] } {
    if (ir.type !== 'insert') {
      throw new Error('IR must be insert type');
    }

    const doc = ir.document;
    const fields = Object.keys(doc);
    const placeholders = fields.map(() => '?');
    const values = Object.values(doc);

    const sql = `INSERT INTO ${this.quoteIdentifier(ir.collection)} (${fields.map(f => this.quoteIdentifier(f)).join(', ')}) VALUES (${placeholders.join(', ')})`;

    return { sql, params: values };
  }

  /**
   * Generate INSERT MANY SQL from IR
   */
  private generateInsertManySQL(ir: IRNode): { sql: string; params: unknown[] } {
    if (ir.type !== 'insertMany') {
      throw new Error('IR must be insertMany type');
    }

    const docs = ir.documents;
    if (docs.length === 0) {
      throw new Error('No documents to insert');
    }

    const fields = Object.keys(docs[0]!);
    const params: unknown[] = [];
    const valueSets: string[] = [];

    for (const doc of docs) {
      const placeholders = fields.map(() => '?');
      valueSets.push(`(${placeholders.join(', ')})`);
      for (const field of fields) {
        params.push((doc as any)[field]);
      }
    }

    const sql = `INSERT INTO ${this.quoteIdentifier(ir.collection)} (${fields.map(f => this.quoteIdentifier(f)).join(', ')}) VALUES ${valueSets.join(', ')}`;

    return { sql, params };
  }

  /**
   * Generate UPDATE SQL from IR
   */
  private generateUpdateSQL(ir: IRNode): { sql: string; params: unknown[] } {
    if (ir.type !== 'update' && ir.type !== 'updateMany') {
      throw new Error('IR must be update or updateMany type');
    }

    const params: unknown[] = [];

    // Generate SET clause
    const setParts: string[] = [];
    const update = ir.update;

    if (update && typeof update === 'object') {
      // Check if it's operator-based or plain document
      const hasOperators = Object.keys(update).some(k => k.startsWith('$'));

      if (hasOperators) {
        // Handle $set, $inc, etc.
        const setOp = (update as any).$set;
        if (setOp && typeof setOp === 'object') {
          for (const [field, value] of Object.entries(setOp)) {
            setParts.push(`${this.quoteIdentifier(field)} = ?`);
            params.push(value);
          }
        }

        const incOp = (update as any).$inc;
        if (incOp && typeof incOp === 'object') {
          for (const [field, value] of Object.entries(incOp)) {
            setParts.push(`${this.quoteIdentifier(field)} = ${this.quoteIdentifier(field)} + ?`);
            params.push(value);
          }
        }
      } else {
        // Plain document - all fields become SET
        for (const [field, value] of Object.entries(update)) {
          setParts.push(`${this.quoteIdentifier(field)} = ?`);
          params.push(value);
        }
      }
    }

    let sql = `UPDATE ${this.quoteIdentifier(ir.collection)} SET ${setParts.join(', ')}`;

    // WHERE
    if (ir.filter && Object.keys(ir.filter).length > 0) {
      const { clause, params: filterParams } = this.generateWhereClause(ir.filter);
      sql += ` WHERE ${clause}`;
      params.push(...filterParams);
    }

    return { sql, params };
  }

  /**
   * Generate DELETE SQL from IR
   */
  private generateDeleteSQL(ir: IRNode): { sql: string; params: unknown[] } {
    if (ir.type !== 'delete' && ir.type !== 'deleteMany') {
      throw new Error('IR must be delete or deleteMany type');
    }

    const params: unknown[] = [];
    let sql = `DELETE FROM ${this.quoteIdentifier(ir.collection)}`;

    // WHERE
    if (ir.filter && Object.keys(ir.filter).length > 0) {
      const { clause, params: filterParams } = this.generateWhereClause(ir.filter);
      sql += ` WHERE ${clause}`;
      params.push(...filterParams);
    }

    return { sql, params };
  }

  /**
   * Generate AGGREGATE SQL from IR
   */
  private generateAggregateSQL(ir: IRNode): { sql: string; params: unknown[] } {
    if (ir.type !== 'aggregate') {
      throw new Error('IR must be aggregate type');
    }

    // Simplified aggregation - in production this would be more complex
    const pipeline = ir.pipeline;
    let sql = '';
    const params: unknown[] = [];

    // Find $match stage
    const matchStage = pipeline.find(s => '$match' in s) as any;
    if (matchStage) {
      const { clause, params: filterParams } = this.generateWhereClause(matchStage.$match);
      sql = `SELECT * FROM ${this.quoteIdentifier(ir.collection)} WHERE ${clause}`;
      params.push(...filterParams);
    } else {
      sql = `SELECT * FROM ${this.quoteIdentifier(ir.collection)}`;
    }

    // Find $group stage
    const groupStage = pipeline.find(s => '$group' in s) as any;
    if (groupStage) {
      const group = groupStage.$group;
      const groupId = group._id;
      const selectParts: string[] = [];

      if (groupId && groupId !== null) {
        if (typeof groupId === 'string' && groupId.startsWith('$')) {
          selectParts.push(this.quoteIdentifier(groupId.slice(1)));
        }
      }

      for (const [key, accumulator] of Object.entries(group)) {
        if (key === '_id') continue;
        const acc = accumulator as any;
        if (acc.$sum) {
          selectParts.push(`SUM(${this.quoteIdentifier(typeof acc.$sum === 'string' ? acc.$sum.slice(1) : '1')}) AS ${this.quoteIdentifier(key)}`);
        } else if (acc.$avg) {
          selectParts.push(`AVG(${this.quoteIdentifier(typeof acc.$avg === 'string' ? acc.$avg.slice(1) : '1')}) AS ${this.quoteIdentifier(key)}`);
        } else if (acc.$min) {
          selectParts.push(`MIN(${this.quoteIdentifier(typeof acc.$min === 'string' ? acc.$min.slice(1) : '1')}) AS ${this.quoteIdentifier(key)}`);
        } else if (acc.$max) {
          selectParts.push(`MAX(${this.quoteIdentifier(typeof acc.$max === 'string' ? acc.$max.slice(1) : '1')}) AS ${this.quoteIdentifier(key)}`);
        }
      }

      if (selectParts.length > 0) {
        const fromIdx = sql.indexOf(' FROM');
        if (fromIdx > 0) {
          sql = `SELECT ${selectParts.join(', ')}${sql.slice(fromIdx)}`;
        }
      }

      // Add GROUP BY
      if (groupId && groupId !== null && typeof groupId === 'string' && groupId.startsWith('$')) {
        sql += ` GROUP BY ${this.quoteIdentifier(groupId.slice(1))}`;
      }
    }

    // Find $sort stage
    const sortStage = pipeline.find(s => '$sort' in s) as any;
    if (sortStage) {
      const sortParts = Object.entries(sortStage.$sort).map(([field, dir]) => {
        const direction = (dir === -1 || dir === 'desc') ? 'DESC' : 'ASC';
        return `${this.quoteIdentifier(field)} ${direction}`;
      });
      sql += ` ORDER BY ${sortParts.join(', ')}`;
    }

    // Find $limit stage
    const limitStage = pipeline.find(s => '$limit' in s) as any;
    if (limitStage) {
      sql += ` LIMIT ?`;
      params.push(limitStage.$limit);
    }

    return { sql, params };
  }

  /**
   * Generate WHERE clause from filter
   */
  private generateWhereClause(filter: Filter): { clause: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];

    for (const [key, value] of Object.entries(filter)) {
      if (key === '$and') {
        const andParts = (value as Filter[]).map(f => {
          const { clause, params: p } = this.generateWhereClause(f);
          params.push(...p);
          return `(${clause})`;
        });
        parts.push(andParts.join(' AND '));
      } else if (key === '$or') {
        const orParts = (value as Filter[]).map(f => {
          const { clause, params: p } = this.generateWhereClause(f);
          params.push(...p);
          return `(${clause})`;
        });
        parts.push(orParts.join(' OR '));
      } else if (key === '$nor') {
        const norParts = (value as Filter[]).map(f => {
          const { clause, params: p } = this.generateWhereClause(f);
          params.push(...p);
          return `(${clause})`;
        });
        parts.push(`NOT (${norParts.join(' OR ')})`);
      } else if (key === '$not') {
        const { clause, params: p } = this.generateWhereClause(value as Filter);
        params.push(...p);
        parts.push(`NOT (${clause})`);
      } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          switch (op) {
            case '$eq':
              parts.push(`${this.quoteIdentifier(key)} = ?`);
              params.push(opVal);
              break;
            case '$ne':
              parts.push(`${this.quoteIdentifier(key)} != ?`);
              params.push(opVal);
              break;
            case '$gt':
              parts.push(`${this.quoteIdentifier(key)} > ?`);
              params.push(opVal);
              break;
            case '$gte':
              parts.push(`${this.quoteIdentifier(key)} >= ?`);
              params.push(opVal);
              break;
            case '$lt':
              parts.push(`${this.quoteIdentifier(key)} < ?`);
              params.push(opVal);
              break;
            case '$lte':
              parts.push(`${this.quoteIdentifier(key)} <= ?`);
              params.push(opVal);
              break;
            case '$in': {
              const values = (opVal as unknown[]).map(() => '?').join(', ');
              parts.push(`${this.quoteIdentifier(key)} IN (${values})`);
              params.push(...(opVal as unknown[]));
              break;
            }
            case '$nin': {
              const values = (opVal as unknown[]).map(() => '?').join(', ');
              parts.push(`${this.quoteIdentifier(key)} NOT IN (${values})`);
              params.push(...(opVal as unknown[]));
              break;
            }
            case '$like':
              parts.push(`${this.quoteIdentifier(key)} LIKE ?`);
              params.push(opVal);
              break;
            case '$regex':
              parts.push(`${this.quoteIdentifier(key)} REGEXP ?`);
              params.push(opVal);
              break;
            case '$exists':
              if (opVal) {
                parts.push(`${this.quoteIdentifier(key)} IS NOT NULL`);
              } else {
                parts.push(`${this.quoteIdentifier(key)} IS NULL`);
              }
              break;
            default:
              // Unknown operator - use equality
              parts.push(`${this.quoteIdentifier(key)} = ?`);
              params.push(opVal);
          }
        }
      } else {
        // Simple equality
        if (value === null) {
          parts.push(`${this.quoteIdentifier(key)} IS NULL`);
        } else {
          parts.push(`${this.quoteIdentifier(key)} = ?`);
          params.push(value);
        }
      }
    }

    return {
      clause: parts.length > 0 ? parts.join(' AND ') : '1=1',
      params,
    };
  }

  /**
   * Quote identifier based on target database
   */
  private quoteIdentifier(name: string): string {
    switch (this.options.targetDb) {
      case 'mysql':
        return `\`${name}\``;
      case 'postgres':
        return `"${name}"`;
      case 'sqlite':
        return `"${name}"`;
      default:
        return `\`${name}\``;
    }
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
}
