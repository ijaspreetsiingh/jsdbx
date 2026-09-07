// =====================================================
// JSDB - MongoDB Filter/Update Compiler
// Translates Universal IR filters → MongoDB query objects
// Also handles: $graphLookup, $setWindowFields, $facet, $bucket
// =====================================================
import { JSDBUnsupportedOperationError, JSDBValidationError } from '../../errors/index.js';
import type { Filter, Update, SortSpec, ProjectionSpec, Document, Scalar } from '../../types/index.js';
import { ObjectId } from 'mongodb';

/**
 * Compile Universal Filter to MongoDB query object
 * Most operators map 1:1 since the filter API is MongoDB-inspired
 */
export function compileFilter(filter: Filter): Document {
  const query: Document = {};

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and' || key === '$or' || key === '$nor') {
      query[key] = (value as Filter[]).map((f) => compileFilter(f));
    } else if (key === '$not') {
      query['$not'] = compileFilter(value as Filter);
    } else {
      if (value === null) {
        query[key] = null;
      } else if (typeof value !== 'object' || value instanceof Date) {
        query[key] = convertIdValue(key, value) as import('../../types/index.js').DocumentValue;
      } else {
        const ops = value as Record<string, unknown>;
        const compiled: Record<string, unknown> = {};
        for (const [op, opVal] of Object.entries(ops)) {
          if (op === '$like' || op === '$ilike') {
            const pattern = (opVal as string)
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replace(/%/g, '.*')
              .replace(/_/g, '.');
            compiled['$regex'] = pattern;
            if (op === '$ilike') compiled['$options'] = 'i';
          } else if (op === '$in' || op === '$nin') {
            compiled[op] = (opVal as unknown[]).map((v) => convertIdValue(key, v));
          } else {
            compiled[op] = opVal;
          }
        }
        query[key] = compiled as unknown as import('../../types/index.js').DocumentValue;
      }
    }
  }

  return query;
}

function convertIdValue(key: string, value: unknown): unknown {
  if ((key === '_id' || key === 'id') && typeof value === 'string') {
    try {
      return new ObjectId(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Compile sort spec to MongoDB sort object
 */
export function compileSort(sort?: SortSpec): Document | undefined {
  if (!sort) return undefined;
  const result: Document = {};
  for (const [field, dir] of Object.entries(sort)) {
    result[field] = (dir === -1 || dir === 'desc') ? -1 : 1;
  }
  return result;
}

/**
 * Compile projection to MongoDB projection
 */
export function compileProjection(projection?: ProjectionSpec): Document | undefined {
  if (!projection || Object.keys(projection).length === 0) return undefined;
  const result: Document = {};
  for (const [field, val] of Object.entries(projection)) {
    result[field] = val === 1 || val === true ? 1 : 0;
  }
  return result;
}

/**
 * Compile Update operators to MongoDB update object
 */
export function compileUpdate(update: Update): Document {
  const hasOperators = Object.keys(update).some((k) => k.startsWith('$'));
  if (hasOperators) {
    // Already MongoDB-style — cast through unknown to satisfy strict types
    return update as unknown as Document;
  }
  // Plain document → $set
  return { $set: update } as Document;
}

/**
 * Normalize document: convert _id or auto-generated id fields
 */
export function normalizeDocument(doc: Document): Document {
  // If document has 'id' but not '_id', map it
  const result = { ...doc };
  if (result.id !== undefined && result._id === undefined) {
    result._id = result.id;
  }
  return result;
}

/**
 * Normalize result document: convert _id to id for consistency
 */
export function normalizeResult(doc: Document & { _id?: unknown }): Document {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  // Put rest first, then id/_id so they are never overwritten by user fields
  return {
    ...rest,
    id: _id !== undefined ? String(_id) : undefined,
    _id: _id !== undefined ? String(_id) : undefined,
  } as Document;
}

// =====================================================
// Aggregation Pipeline Compilation
// MongoDB supports most stages natively, but we need to
// compile universal IR stages to MongoDB pipeline format
// =====================================================

export interface CompiledPipeline {
  pipeline: Document[];
}

export function compileAggregationPipeline(pipeline: unknown[]): CompiledPipeline {
  const compiled: Document[] = [];

  for (const stage of pipeline) {
    const stageObj = stage as Record<string, unknown>;
    const stageKey = Object.keys(stageObj)[0];

    if (stageKey === '$graphLookup') {
      compiled.push(compileGraphLookup(stageObj.$graphLookup as Record<string, unknown>));
    } else if (stageKey === '$setWindowFields') {
      compiled.push(compileSetWindowFields(stageObj.$setWindowFields as Record<string, unknown>));
    } else if (stageKey === '$facet') {
      compiled.push(compileFacet(stageObj.$facet as Record<string, unknown[]>));
    } else if (stageKey === '$bucket') {
      compiled.push(compileBucket(stageObj.$bucket as Record<string, unknown>));
    } else if (stageKey === '$bucketAuto') {
      compiled.push(compileBucketAuto(stageObj.$bucketAuto as Record<string, unknown>));
    } else if (stageKey === '$unionWith') {
      compiled.push(compileUnionWith(stageObj.$unionWith as Record<string, unknown>));
    } else if (stageKey === '$sortByCount') {
      compiled.push({ $sortByCount: stageObj.$sortByCount as string });
    } else if (stageKey === '$sample') {
      compiled.push({ $sample: stageObj.$sample as Document });
    } else if (stageKey === '$redact') {
      compiled.push({ $redact: stageObj.$redact as Document });
    } else {
      // Pass through — MongoDB supports it natively
      compiled.push(stageObj as Document);
    }
  }

  return { pipeline: compiled };
}

function compileGraphLookup(def: Record<string, unknown>): Document {
  const result: Document = {
    $graphLookup: {
      from: def.from as string,
      startWith: def.startWith as Document,
      connectFromField: def.connectFromField as string,
      connectToField: def.connectToField as string,
      as: def.as as string,
    } as Document,
  };

  if (def.maxDepth !== undefined) {
    (result.$graphLookup as Document).maxDepth = def.maxDepth as number;
  }
  if (def.depthField !== undefined) {
    (result.$graphLookup as Document).depthField = def.depthField as string;
  }
  if (def.restrictSearchWith) {
    (result.$graphLookup as Document).restrictSearchWith = compileFilter(def.restrictSearchWith as Filter);
  }

  return result;
}

function compileSetWindowFields(def: Record<string, unknown>): Document {
  const result: Document = { $setWindowFields: {} as Document };
  const output: Document = {};

  if (def.partitionBy) {
    (result.$setWindowFields as Document).partitionBy = def.partitionBy as string;
  }
  if (def.sortBy) {
    (result.$setWindowFields as Document).sortBy = compileSort(def.sortBy as Record<string, 1 | -1>);
  }

  const outputDef = def.output as Record<string, Record<string, unknown>>;
  for (const [fieldName, windowDef] of Object.entries(outputDef)) {
    const compiled: Document = {};
    const fnKey = Object.keys(windowDef)[0];
    compiled[fnKey] = (fnKey === '$sum' || fnKey === '$avg' || fnKey === '$min' || fnKey === '$max')
      ? (windowDef[fnKey] as Document)
      : {};

    if (windowDef.window) {
      compiled.window = windowDef.window as Document;
    }
    output[fieldName] = compiled;
  }

  (result.$setWindowFields as Document).output = output;
  return result;
}

function compileFacet(def: Record<string, unknown[]>): Document {
  const result: Document = { $facet: {} };
  for (const [fieldName, pipeline] of Object.entries(def)) {
    (result.$facet as Document)[fieldName] = compileAggregationPipeline(pipeline).pipeline;
  }
  return result;
}

function compileBucket(def: Record<string, unknown>): Document {
  return {
    $bucket: {
      groupBy: def.groupBy as string,
      boundaries: def.boundaries as unknown[],
      ...(def.default ? { default: def.default as string } : {}),
      ...(def.output ? { output: def.output as Document } : {}),
    } as Document,
  };
}

function compileBucketAuto(def: Record<string, unknown>): Document {
  return {
    $bucketAuto: {
      groupBy: def.groupBy as string,
      buckets: def.buckets as number,
      ...(def.output ? { output: def.output as Document } : {}),
    } as Document,
  };
}

function compileUnionWith(def: Record<string, unknown>): Document {
  return {
    $unionWith: {
      coll: def.coll as string,
      ...(def.pipeline ? { pipeline: compileAggregationPipeline(def.pipeline as unknown[]).pipeline } : {}),
    } as Document,
  };
}
