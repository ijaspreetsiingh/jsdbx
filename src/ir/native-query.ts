// =====================================================
// JSDB - Native Query Translation Engine
// Translates SQL/MongoDB native queries → Universal IR
// then compiles to target database
// =====================================================
import type { DatabaseType, Filter, Document, AggregationStage, SortSpec, ProjectionSpec } from '../types/index.js';
import type { IRNode } from './nodes.js';
import { parseSQL, sqlToIR, type ParsedSQL } from './sql-parser.js';
import { JSDBUnsupportedOperationError, JSDBValidationError } from '../errors/index.js';

export type SourceDialect = 'sql' | 'mongodb' | 'jsdb';

export interface TranslationResult {
  ir: IRNode;
  sourceDialect: SourceDialect;
  warnings: string[];
}

export interface TranslationOptions {
  sourceDialect?: SourceDialect;
  targetDatabase: DatabaseType;
  strictMode?: boolean;
}

/**
 * Detect the source dialect of a query
 */
export function detectDialect(query: unknown): SourceDialect {
  if (typeof query === 'string') {
    const trimmed = query.trim().toUpperCase();
    if (trimmed.startsWith('SELECT') || trimmed.startsWith('INSERT') ||
        trimmed.startsWith('UPDATE') || trimmed.startsWith('DELETE') ||
        trimmed.startsWith('CREATE') || trimmed.startsWith('ALTER') ||
        trimmed.startsWith('DROP')) {
      return 'sql';
    }
    return 'sql'; // Default to SQL for strings
  }

  if (typeof query === 'object' && query !== null) {
    const obj = query as Document;
    // MongoDB-style pipeline stages
    if (Array.isArray(query)) {
      if (query.length > 0 && typeof query[0] === 'object') {
        const firstKey = Object.keys(query[0])[0];
        if (firstKey?.startsWith('$')) return 'mongodb';
      }
      return 'mongodb';
    }
    // MongoDB-style filter with $ operators
    const keys = Object.keys(obj);
    if (keys.some(k => k.startsWith('$'))) return 'mongodb';
    // Could be a JSDB filter
    return 'jsdb';
  }

  throw new JSDBValidationError('Cannot detect query dialect');
}

/**
 * Parse a native query into a structured AST
 */
export function parseNativeQuery(
  query: unknown,
  dialect?: SourceDialect
): { ast: ParsedSQL | Document | Document[]; dialect: SourceDialect } {
  const d = dialect ?? detectDialect(query);

  switch (d) {
    case 'sql':
      return { ast: parseSQL(query as string), dialect: 'sql' };
    case 'mongodb':
    case 'jsdb':
      return { ast: query as Document | Document[], dialect: d };
    default:
      throw new JSDBValidationError(`Unknown dialect: ${d}`);
  }
}

/**
 * Convert a native query AST into Universal IR
 */
export function nativeQueryToIR(
  query: unknown,
  options: TranslationOptions
): TranslationResult {
  const dialect = options.sourceDialect ?? detectDialect(query);
  const warnings: string[] = [];

  if (dialect === 'sql') {
    const parsed = parseSQL(query as string);
    const ir = sqlToIR(parsed);
    return { ir, sourceDialect: 'sql', warnings };
  }

  if (dialect === 'mongodb') {
    // MongoDB-style pipeline → IR
    if (Array.isArray(query)) {
      const pipeline = query as AggregationStage[];
      const collection = extractCollectionFromPipeline(pipeline);
      return {
        ir: {
          type: 'aggregate',
          collection,
          pipeline,
          metadata: { timestamp: new Date() },
        },
        sourceDialect: 'mongodb',
        warnings,
      };
    }

    // MongoDB-style find query
    const doc = query as Document;
    if (doc.filter || doc.collection) {
      // Already structured
      return {
        ir: {
          type: 'find',
          collection: doc.collection as string,
          filter: (doc.filter ?? {}) as Filter,
          sort: doc.sort as SortSpec,
          limit: doc.limit as number,
          offset: doc.offset as number,
          projection: doc.projection as ProjectionSpec,
          metadata: { timestamp: new Date() },
        },
        sourceDialect: 'mongodb',
        warnings,
      };
    }

    warnings.push('MongoDB-style filter detected — treating as JSDB filter format');
    return {
      ir: {
        type: 'find',
        collection: 'unknown',
        filter: doc as Filter,
        metadata: { timestamp: new Date() },
      },
      sourceDialect: 'mongodb',
      warnings,
    };
  }

  // JSDB universal format
  if (typeof query === 'object' && query !== null) {
    const doc = query as Document;
    return {
      ir: {
        type: 'find',
        collection: (doc.collection as string) ?? 'unknown',
        filter: (doc.filter ?? {}) as Filter,
        metadata: { timestamp: new Date() },
      },
      sourceDialect: 'jsdb',
      warnings,
    };
  }

  throw new JSDBValidationError('Unsupported query format for translation');
}

/**
 * Check portability of a translated IR across all supported databases
 */
export function checkPortability(
  ir: IRNode,
  databases: DatabaseType[] = ['mysql', 'mongodb', 'postgres', 'sqlite']
): Map<DatabaseType, { supported: boolean; warnings: string[] }> {
  const results = new Map<DatabaseType, { supported: boolean; warnings: string[] }>();

  for (const db of databases) {
    const warnings: string[] = [];
    let supported = true;

    // Check for operations that might not be supported
    if (ir.type === 'aggregate' && ir.pipeline) {
      for (const stage of ir.pipeline) {
        const key = Object.keys(stage)[0];
        if (key === '$facet' && db !== 'mongodb') {
          warnings.push(`$facet is not supported on ${db} — will be skipped`);
        }
        if (key === '$replaceRoot' && db !== 'mongodb') {
          warnings.push(`$replaceRoot is not supported on ${db}`);
        }
      }
    }

    results.set(db, { supported, warnings });
  }

  return results;
}

function extractCollectionFromPipeline(pipeline: AggregationStage[]): string {
  // Try to extract collection from $match stage
  for (const stage of pipeline) {
    if ('$match' in stage) return 'unknown'; // Can't determine from match alone
  }
  return 'unknown';
}
