// =====================================================
// JSDB - PostgreSQL IR Compiler
// PostgreSQL uses $1, $2... positional params (not ?)
//
// TRANSLATION STRATEGY:
//   $elemMatch  → jsonb_array_elements() EXISTS subquery
//   $type       → jsonb_typeof()
//   $lookup     → LEFT JOIN
//   $unwind     → jsonb_array_elements() lateral join
//   nested keys → col->'key'->>'subkey' (JSONB operators)
//   $all        → JSONB @> operator
//   $size       → jsonb_array_length()
// =====================================================
import { JSDBUnsupportedOperationError, JSDBValidationError } from '../../errors/index.js';
import { validateIdentifier } from '../../utils/id.js';
import type {
  Filter,
  Update,
  SortSpec,
  ProjectionSpec,
  AggregationStage,
  Document,
  Scalar,
} from '../../types/index.js';

export interface PgCompiledSQL {
  sql: string;
  params: unknown[];
}

/** Per-query counter object — concurrent queries each get their own. */
export function makeCounter(start = 0): { n: number } {
  return { n: start };
}

/** Use an explicit counter object; every param gets a unique $N. */
function nextParam(params: unknown[], value: unknown, counter: { n: number }): string {
  params.push(value);
  counter.n++;
  return `$${counter.n}`;
}

export function quoteIdentifier(name: string): string {
  validateIdentifier(name, 'identifier');
  return '"' + name.replace(/"/g, '""') + '"';
}

/**
 * Dotted path → PostgreSQL JSONB operator chain
 * "address.city" → "address"->'city'
 * Top-level field → "field"
 */
function compileFieldRef(fieldPath: string, counter: { n: number }, textCast = false): string {
  if (!fieldPath.includes('.')) {
    return quoteIdentifier(fieldPath);
  }
  const parts = fieldPath.split('.');
  const col = quoteIdentifier(parts[0]);
  let expr = col;
  for (let i = 1; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    expr += isLast && textCast ? `->>'${parts[i]}'` : `->'${parts[i]}'`;
  }
  return expr;
}

// MongoDB $type name → jsonb_typeof() string
const MONGO_TYPE_TO_JSONB: Record<string, string> = {
  double: 'number',
  string: 'string',
  object: 'object',
  array: 'array',
  bool: 'boolean',
  boolean: 'boolean',
  'null': 'null',
  int: 'number',
  long: 'number',
  decimal: 'number',
  number: 'number',
};

// ---- Filter ----

export function compileFilter(
  filter: Filter,
  params: unknown[],
  startIndex = 1
): { sql: string; params: unknown[] } {
  const counter = makeCounter(startIndex - 1);
  const sql = compileFilterNode(filter, params, counter);
  return { sql, params };
}

function compileFilterNode(filter: Filter, params: unknown[], counter: { n: number }): string {
  const clauses: string[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and') {
      const parts = (value as Filter[]).map((f) => `(${compileFilterNode(f, params, counter)})`);
      if (parts.length) clauses.push(`(${parts.join(' AND ')})`);
    } else if (key === '$or') {
      const parts = (value as Filter[]).map((f) => `(${compileFilterNode(f, params, counter)})`);
      if (parts.length) clauses.push(`(${parts.join(' OR ')})`);
    } else if (key === '$nor') {
      const parts = (value as Filter[]).map((f) => `(${compileFilterNode(f, params, counter)})`);
      if (parts.length) clauses.push(`NOT (${parts.join(' OR ')})`);
    } else if (key === '$not') {
      clauses.push(`NOT (${compileFilterNode(value as Filter, params, counter)})`);
    } else {
      // Field-level — support dotted JSONB paths
      const col = compileFieldRef(key, counter);
      const colText = key.includes('.') ? compileFieldRef(key, counter, true) : col;

      if (value === null) {
        clauses.push(`${col} IS NULL`);
      } else if (typeof value !== 'object' || value instanceof Date) {
        clauses.push(`${colText} = ${nextParam(params, value, counter)}`);
      } else {
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          switch (op) {
            case '$eq':
              if (opVal === null) clauses.push(`${col} IS NULL`);
              else clauses.push(`${colText} = ${nextParam(params, opVal, counter)}`);
              break;
            case '$ne':
              if (opVal === null) clauses.push(`${col} IS NOT NULL`);
              else clauses.push(`${colText} != ${nextParam(params, opVal, counter)}`);
              break;
            case '$gt': clauses.push(`${colText} > ${nextParam(params, opVal, counter)}`); break;
            case '$gte': clauses.push(`${colText} >= ${nextParam(params, opVal, counter)}`); break;
            case '$lt': clauses.push(`${colText} < ${nextParam(params, opVal, counter)}`); break;
            case '$lte': clauses.push(`${colText} <= ${nextParam(params, opVal, counter)}`); break;
            case '$in': {
              const arr = opVal as Scalar[];
              if (!arr.length) { clauses.push('FALSE'); break; }
              const phs = arr.map((v) => nextParam(params, v, counter)).join(', ');
              clauses.push(`${colText} IN (${phs})`);
              break;
            }
            case '$nin': {
              const arr = opVal as Scalar[];
              if (!arr.length) { clauses.push('TRUE'); break; }
              const phs = arr.map((v) => nextParam(params, v, counter)).join(', ');
              clauses.push(`${colText} NOT IN (${phs})`);
              break;
            }
            case '$like': clauses.push(`${col} LIKE ${nextParam(params, opVal, counter)}`); break;
            case '$ilike': clauses.push(`${col} ILIKE ${nextParam(params, opVal, counter)}`); break;
            case '$regex': clauses.push(`${col} ~ ${nextParam(params, opVal, counter)}`); break;
            case '$exists':
              clauses.push(opVal ? `${col} IS NOT NULL` : `${col} IS NULL`);
              break;

            // ---- $elemMatch → jsonb_array_elements() EXISTS ----
            case '$elemMatch': {
              const matchObj = opVal as Record<string, unknown>;
              const subClauses: string[] = [];
              const topCol = key.includes('.')
                ? `(${compileFieldRef(key, counter)})`
                : quoteIdentifier(key);

              for (const [subField, subVal] of Object.entries(matchObj)) {
                const elemRef = `elem->>'${subField}'`;
                const elemNumRef = `(elem->>'${subField}')::numeric`;

                if (subVal === null) {
                  subClauses.push(`${elemRef} IS NULL`);
                } else if (typeof subVal !== 'object' || subVal instanceof Date) {
                  subClauses.push(`${elemRef} = ${nextParam(params, String(subVal), counter)}`);
                } else {
                  const subOps = subVal as Record<string, unknown>;
                  for (const [subOp, subOpVal] of Object.entries(subOps)) {
                    switch (subOp) {
                      case '$eq': subClauses.push(`${elemRef} = ${nextParam(params, String(subOpVal), counter)}`); break;
                      case '$ne': subClauses.push(`${elemRef} != ${nextParam(params, String(subOpVal), counter)}`); break;
                      case '$gt': subClauses.push(`${elemNumRef} > ${nextParam(params, subOpVal, counter)}`); break;
                      case '$gte': subClauses.push(`${elemNumRef} >= ${nextParam(params, subOpVal, counter)}`); break;
                      case '$lt': subClauses.push(`${elemNumRef} < ${nextParam(params, subOpVal, counter)}`); break;
                      case '$lte': subClauses.push(`${elemNumRef} <= ${nextParam(params, subOpVal, counter)}`); break;
                      default: subClauses.push(`${elemRef} = ${nextParam(params, String(subOpVal), counter)}`); break;
                    }
                  }
                }
              }

              const whereStr = subClauses.length ? subClauses.join(' AND ') : 'TRUE';
              clauses.push(
                `EXISTS (SELECT 1 FROM jsonb_array_elements(${topCol}::jsonb) AS elem WHERE ${whereStr})`
              );
              break;
            }

            // ---- $type → jsonb_typeof() ----
            case '$type': {
              const typeVal = opVal as string | number;
              let jsonbType: string;
              if (typeof typeVal === 'number') {
                const numMap: Record<number, string> = {
                  1: 'number', 2: 'string', 3: 'object', 4: 'array',
                  8: 'boolean', 10: 'null', 16: 'number', 18: 'number',
                };
                jsonbType = numMap[typeVal] ?? 'string';
              } else {
                jsonbType = MONGO_TYPE_TO_JSONB[typeVal.toLowerCase()] ?? typeVal;
              }
              clauses.push(`jsonb_typeof(${col}::jsonb) = ${nextParam(params, jsonbType, counter)}`);
              break;
            }

            // ---- $all → JSONB @> ----
            case '$all': {
              const allArr = opVal as Scalar[];
              if (!allArr.length) { clauses.push('TRUE'); break; }
              clauses.push(`${col}::jsonb @> ${nextParam(params, JSON.stringify(allArr), counter)}::jsonb`);
              break;
            }

            // ---- $size → jsonb_array_length() ----
            case '$size': {
              clauses.push(`jsonb_array_length(${col}::jsonb) = ${nextParam(params, opVal, counter)}`);
              break;
            }

            default:
              throw new JSDBValidationError(`Unknown filter operator: ${op}`);
          }
        }
      }
    }
  }

  return clauses.length > 0 ? clauses.join(' AND ') : 'TRUE';
}

// ---- Sort ----

export function compileSort(sort?: SortSpec): string {
  if (!sort || !Object.keys(sort).length) return '';
  const counter = makeCounter(0);
  const parts = Object.entries(sort).map(([f, d]) => {
    const ref = f.includes('.') ? compileFieldRef(f, counter, true) : quoteIdentifier(f);
    return `${ref} ${d === -1 || d === 'desc' ? 'DESC' : 'ASC'}`;
  });
  return `ORDER BY ${parts.join(', ')}`;
}

// ---- Projection ----

export function compileProjection(projection?: ProjectionSpec): string {
  if (!projection || !Object.keys(projection).length) return '*';
  const counter = makeCounter(0);
  const includes = Object.entries(projection)
    .filter(([, v]) => v === 1 || v === true)
    .map(([k]) => k.includes('.') ? `${compileFieldRef(k, counter, true)} AS "${k.replace(/\./g, '_')}"` : quoteIdentifier(k));
  return includes.length ? includes.join(', ') : '*';
}

// ---- Update ----

export function compileUpdate(update: Update, startIndex = 1): { setClauses: string; params: unknown[] } {
  const counter = makeCounter(startIndex - 1);
  const params: unknown[] = [];
  const clauses: string[] = [];
  const hasOps = Object.keys(update).some((k) => k.startsWith('$'));
  const setData = hasOps
    ? (update as Record<string, unknown>).$set as Document | undefined
    : update as Document;

  if (setData) {
    for (const [f, v] of Object.entries(setData)) {
      validateIdentifier(f, 'field');
      clauses.push(`${quoteIdentifier(f)} = ${nextParam(params, v, counter)}`);
    }
  }

  const inc = (update as Record<string, unknown>).$inc as Record<string, number> | undefined;
  if (inc) {
    for (const [f, amt] of Object.entries(inc)) {
      clauses.push(`${quoteIdentifier(f)} = ${quoteIdentifier(f)} + ${nextParam(params, amt, counter)}`);
    }
  }

  const unset = (update as Record<string, unknown>).$unset as Record<string, unknown> | undefined;
  if (unset) {
    for (const f of Object.keys(unset)) {
      clauses.push(`${quoteIdentifier(f)} = NULL`);
    }
  }

  const mul = (update as Record<string, unknown>).$mul as Record<string, number> | undefined;
  if (mul) {
    for (const [f, factor] of Object.entries(mul)) {
      clauses.push(`${quoteIdentifier(f)} = ${quoteIdentifier(f)} * ${nextParam(params, factor, counter)}`);
    }
  }

  // $push → jsonb append
  const push = (update as Record<string, unknown>).$push as Record<string, unknown> | undefined;
  if (push) {
    for (const [f, v] of Object.entries(push)) {
      validateIdentifier(f, 'field');
      clauses.push(
        `${quoteIdentifier(f)} = COALESCE(${quoteIdentifier(f)}, '[]'::jsonb) || ${nextParam(params, JSON.stringify([v]), counter)}::jsonb`
      );
    }
  }

  // $pull → jsonb remove by value
  const pull = (update as Record<string, unknown>).$pull as Record<string, unknown> | undefined;
  if (pull) {
    for (const [f, v] of Object.entries(pull)) {
      validateIdentifier(f, 'field');
      clauses.push(
        `${quoteIdentifier(f)} = (SELECT jsonb_agg(elem) FROM jsonb_array_elements(${quoteIdentifier(f)}) AS elem WHERE elem != ${nextParam(params, JSON.stringify(v), counter)}::jsonb)`
      );
    }
  }

  if (!clauses.length) throw new JSDBValidationError('Update has no fields');
  return { setClauses: clauses.join(', '), params };
}

// ---- Aggregation ----

export function compileAggregation(
  table: string,
  pipeline: AggregationStage[],
  startIndex = 1
): PgCompiledSQL {
  const counter = makeCounter(startIndex - 1);
  const params: unknown[] = [];

  let selectClause = '*';
  let whereClause = '';
  let groupByClause = '';
  let orderByClause = '';
  let limitClause = '';
  let offsetClause = '';
  let joinClauses = '';

  const selectParts: string[] = [];
  const groupByFields: string[] = [];

  for (const stage of pipeline) {
    const stageKey = Object.keys(stage)[0] as string;

    if (stageKey === '$match') {
      const { $match } = stage as { $match: Filter };
      counter.n = params.length;
      const compiled = compileFilterNode($match, params, counter);
      if (compiled !== 'TRUE') whereClause = `WHERE ${compiled}`;

    } else if (stageKey === '$group') {
      const { $group: groupDef } = stage as { $group: Record<string, unknown> };
      const idField = groupDef._id;

      if (idField !== null && idField !== undefined) {
        if (typeof idField === 'string' && idField.startsWith('$')) {
          const fn = idField.slice(1);
          const ref = fn.includes('.') ? compileFieldRef(fn, counter, true) : quoteIdentifier(fn);
          groupByFields.push(ref);
          selectParts.push(`${ref} AS "_id"`);
        } else if (typeof idField === 'object') {
          for (const [alias, expr] of Object.entries(idField as Record<string, unknown>)) {
            if (typeof expr === 'string' && expr.startsWith('$')) {
              const fn = expr.slice(1);
              const ref = fn.includes('.') ? compileFieldRef(fn, counter, true) : quoteIdentifier(fn);
              groupByFields.push(ref);
              selectParts.push(`${ref} AS ${quoteIdentifier(alias)}`);
            }
          }
        }
      }

      for (const [accKey, accVal] of Object.entries(groupDef)) {
        if (accKey === '_id' || typeof accVal !== 'object' || accVal === null) continue;
        for (const [accOp, accField] of Object.entries(accVal as Record<string, unknown>)) {
          const ref = typeof accField === 'string' && accField.startsWith('$')
            ? (accField.slice(1).includes('.') ? compileFieldRef(accField.slice(1), counter, true) : quoteIdentifier(accField.slice(1)))
            : typeof accField === 'number' ? String(accField) : '1';

          switch (accOp) {
            case '$sum':
              selectParts.push(typeof accField === 'number'
                ? `SUM(${accField}) AS ${quoteIdentifier(accKey)}`
                : `SUM(${ref}) AS ${quoteIdentifier(accKey)}`);
              break;
            case '$avg': selectParts.push(`AVG(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$min': selectParts.push(`MIN(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$max': selectParts.push(`MAX(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$count': selectParts.push(`COUNT(*) AS ${quoteIdentifier(accKey)}`); break;
            case '$first': selectParts.push(`MIN(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$last': selectParts.push(`MAX(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$push': selectParts.push(`jsonb_agg(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$addToSet': selectParts.push(`jsonb_agg(DISTINCT ${ref}) AS ${quoteIdentifier(accKey)}`); break;
          }
        }
      }

      selectClause = selectParts.length ? selectParts.join(', ') : 'COUNT(*) AS count';
      groupByClause = groupByFields.length ? `GROUP BY ${groupByFields.join(', ')}` : '';

    } else if (stageKey === '$project') {
      if (!groupByClause) {
        const fields = Object.entries((stage as { $project: Record<string, unknown> }).$project)
          .filter(([, v]) => v === 1 || v === true)
          .map(([k]) => k.includes('.')
            ? `${compileFieldRef(k, counter, true)} AS "${k.replace(/\./g, '_')}"`
            : quoteIdentifier(k));
        if (fields.length) selectClause = fields.join(', ');
      }

    } else if (stageKey === '$addFields') {
      const extras = Object.entries((stage as { $addFields: Record<string, unknown> }).$addFields)
        .map(([alias, expr]) => {
          if (typeof expr === 'string' && expr.startsWith('$')) {
            const ref = expr.slice(1).includes('.')
              ? compileFieldRef(expr.slice(1), counter, true)
              : quoteIdentifier(expr.slice(1));
            return `${ref} AS ${quoteIdentifier(alias)}`;
          }
          return `${nextParam(params, expr, counter)} AS ${quoteIdentifier(alias)}`;
        });
      if (selectClause === '*') selectClause = `*, ${extras.join(', ')}`;

    } else if (stageKey === '$sort') {
      const parts = Object.entries((stage as { $sort: SortSpec }).$sort).map(([f, d]) => {
        const ref = f.includes('.') ? compileFieldRef(f, counter, true) : quoteIdentifier(f);
        return `${ref} ${d === -1 || d === 'desc' ? 'DESC' : 'ASC'}`;
      });
      orderByClause = `ORDER BY ${parts.join(', ')}`;

    } else if (stageKey === '$limit') {
      limitClause = `LIMIT ${nextParam(params, (stage as { $limit: number }).$limit, counter)}`;

    } else if (stageKey === '$skip') {
      offsetClause = `OFFSET ${nextParam(params, (stage as { $skip: number }).$skip, counter)}`;

    } else if (stageKey === '$count') {
      selectClause = `COUNT(*) AS ${quoteIdentifier((stage as { $count: string }).$count)}`;
      groupByClause = '';

    } else if (stageKey === '$lookup') {
      const { from, localField, foreignField, as: asAlias } = (stage as {
        $lookup: { from: string; localField: string; foreignField: string; as: string };
      }).$lookup;

      const fromQ = quoteIdentifier(from);
      const localRef = localField.includes('.')
        ? compileFieldRef(localField, counter, true)
        : `${quoteIdentifier(table)}.${quoteIdentifier(localField)}`;
      const foreignRef = `${fromQ}.${quoteIdentifier(foreignField)}`;

      joinClauses += ` LEFT JOIN ${fromQ} ON ${localRef} = ${foreignRef}`;

      if (selectClause === '*') {
        selectClause = `${quoteIdentifier(table)}.*, jsonb_agg(to_jsonb(${fromQ}.*)) AS ${quoteIdentifier(asAlias)}`;
      } else {
        selectClause += `, jsonb_agg(to_jsonb(${fromQ}.*)) AS ${quoteIdentifier(asAlias)}`;
      }
      if (!groupByClause) groupByClause = `GROUP BY ${quoteIdentifier(table)}.id`;

    } else if (stageKey === '$unwind') {
      const unwindVal = (stage as { $unwind: string | { path: string } }).$unwind;
      const path = typeof unwindVal === 'string' ? unwindVal : unwindVal.path;
      const fieldName = path.startsWith('$') ? path.slice(1) : path;
      const col = fieldName.includes('.')
        ? compileFieldRef(fieldName, counter)
        : quoteIdentifier(fieldName);

      const alias = `_unwind_${fieldName.replace(/\./g, '_')}`;
      joinClauses += `, jsonb_array_elements(${col}::jsonb) AS ${alias}(value)`;

      if (selectClause === '*') {
        selectClause = `${quoteIdentifier(table)}.*, ${alias}.value AS ${quoteIdentifier(fieldName)}`;
      }

    } else if (stageKey === '$facet') {
      throw new JSDBUnsupportedOperationError(
        '$facet',
        'postgres',
        'Use separate queries for each facet pipeline instead.'
      );

    } else if (stageKey === '$replaceRoot') {
      throw new JSDBUnsupportedOperationError(
        '$replaceRoot',
        'postgres',
        'Use $project to reshape documents instead.'
      );
    }
  }

  const sql = [
    `SELECT ${selectClause}`,
    `FROM ${quoteIdentifier(table)}`,
    joinClauses,
    whereClause,
    groupByClause,
    orderByClause,
    limitClause,
    offsetClause,
  ].filter(Boolean).join(' ');

  return { sql, params };
}

// =====================================================
// Deep Join Compilation
// =====================================================

export function compileDeepJoin(
  table: string,
  joins: Array<{
    collection: string;
    as: string;
    on: { localField: string; foreignField: string; operator?: string };
    type?: string;
  }>,
  options?: {
    filter?: Filter;
    projection?: ProjectionSpec;
    sort?: SortSpec;
    limit?: number;
    offset?: number;
  }
): PgCompiledSQL {
  const counter = makeCounter(0);
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const joinClauses: string[] = [];

  for (const j of joins) {
    const joinTable = quoteIdentifier(j.collection);
    const joinType = (j.type || 'left').toUpperCase();
    const localRef = j.on.localField.includes('.')
      ? compileFieldRef(j.on.localField, counter)
      : `${tableQ}.${quoteIdentifier(j.on.localField)}`;
    const foreignRef = `${joinTable}.${quoteIdentifier(j.on.foreignField)}`;
    const operator = j.on.operator || '=';
    joinClauses.push(`${joinType} JOIN ${joinTable} ON ${localRef} ${operator} ${foreignRef}`);
  }

  let whereClause = '';
  if (options?.filter) {
    counter.n = params.length;
    const compiled = compileFilterNode(options.filter, params, counter);
    if (compiled !== 'TRUE') whereClause = `WHERE ${compiled}`;
  }

  let selectClause = '*';
  if (options?.projection) {
    selectClause = compileProjection(options.projection);
  }

  let orderByClause = '';
  if (options?.sort) {
    orderByClause = compileSort(options.sort);
  }

  let limitClause = '';
  let offsetClause = '';
  if (options?.limit !== undefined) {
    limitClause = `LIMIT ${nextParam(params, options.limit, counter)}`;
  }
  if (options?.offset !== undefined && options.offset > 0) {
    offsetClause = `OFFSET ${nextParam(params, options.offset, counter)}`;
  }

  const sql = [
    `SELECT ${selectClause}`,
    `FROM ${tableQ}`,
    ...joinClauses,
    whereClause,
    orderByClause,
    limitClause,
    offsetClause,
  ].filter(Boolean).join(' ');

  return { sql, params };
}

// =====================================================
// Recursive CTE Compilation
// =====================================================

export function compileRecursiveCTE(
  table: string,
  cte: {
    name: string;
    startWith: Filter;
    connectBy: { field: string; references: string };
    maxDepth?: number;
    search?: 'depth' | 'breadth';
    cycleDetection?: boolean;
  },
  options?: {
    filter?: Filter;
    projection?: ProjectionSpec;
    sort?: SortSpec;
    limit?: number;
  }
): PgCompiledSQL {
  const counter = makeCounter(0);
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const cteName = quoteIdentifier(cte.name);
  const maxDepth = cte.maxDepth ?? 10;

  const anchorFilter = compileFilterNode(cte.startWith, params, counter);
  const anchorSQL = `SELECT *, 0 AS _depth FROM ${tableQ} WHERE ${anchorFilter}`;

  const connectField = quoteIdentifier(cte.connectBy.field);
  const connectRef = quoteIdentifier(cte.connectBy.references);
  const recursiveSQL = `SELECT _child.*, (_parent._depth + 1) AS _depth FROM ${tableQ} AS _parent JOIN ${tableQ} AS _child ON _child.${connectField} = _parent.${connectRef} WHERE _parent._depth < ${nextParam(params, maxDepth, counter)}`;

  let cteSQL = `WITH RECURSIVE ${cteName} AS (\n  ${anchorSQL}\n  UNION ALL\n  ${recursiveSQL}\n)`;

  let searchClause = '';
  if (cte.search === 'breadth') {
    searchClause = `SEARCH BREADTH FIRST BY _depth SET search_order`;
  } else if (cte.search === 'depth') {
    searchClause = `SEARCH DEPTH FIRST BY _depth SET search_order`;
  }

  let selectClause = `${cteName}.*`;
  if (options?.projection) {
    const fields = Object.entries(options.projection)
      .filter(([, v]) => v === 1 || v === true)
      .map(([k]) => `${cteName}.${quoteIdentifier(k)}`);
    if (fields.length) selectClause = fields.join(', ');
  }

  let whereClause = '';
  if (options?.filter) {
    counter.n = params.length;
    const filterSql = compileFilterNode(options.filter, params, counter);
    if (filterSql !== 'TRUE') whereClause = `WHERE ${filterSql}`;
  }

  let orderByClause = '';
  if (options?.sort) {
    orderByClause = compileSort(options.sort);
  }

  let limitClause = '';
  if (options?.limit !== undefined) {
    limitClause = `LIMIT ${nextParam(params, options.limit, counter)}`;
  }

  const sql = [
    cteSQL,
    searchClause,
    `SELECT ${selectClause}`,
    `FROM ${cteName}`,
    whereClause,
    orderByClause,
    limitClause,
  ].filter(Boolean).join(' ');

  return { sql, params };
}

// =====================================================
// Window Functions Compilation
// =====================================================

export function compileWindowFunction(
  table: string,
  pipeline: unknown[]
): PgCompiledSQL {
  const counter = makeCounter(0);
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const selectParts: string[] = [];
  const whereParts: string[] = [];
  const groupByParts: string[] = [];
  let orderByClause = '';
  let limitClause = '';
  let offsetClause = '';

  for (const stage of pipeline) {
    const stageObj = stage as Record<string, unknown>;
    const stageKey = Object.keys(stageObj)[0] as string;

    if (stageKey === '$match') {
      counter.n = params.length;
      const compiled = compileFilterNode((stageObj.$match as Filter), params, counter);
      if (compiled !== 'TRUE') whereParts.push(compiled);

    } else if (stageKey === '$setWindowFields') {
      const windowDef = stageObj.$setWindowFields as Record<string, unknown>;
      const partitionBy = windowDef.partitionBy as string | undefined;
      const sortBy = windowDef.sortBy as Record<string, 1 | -1> | undefined;
      const output = windowDef.output as Record<string, Record<string, unknown>>;

      for (const [fieldName, fnDef] of Object.entries(output)) {
        const fnKey = Object.keys(fnDef)[0];
        const fnValue = fnDef[fnKey];
        const overParts: string[] = [];

        if (partitionBy) {
          const ref = partitionBy.includes('.')
            ? compileFieldRef(partitionBy, counter, true)
            : quoteIdentifier(partitionBy);
          overParts.push(`PARTITION BY ${ref}`);
        }
        if (sortBy) {
          const sortParts = Object.entries(sortBy).map(([f, d]) => {
            const ref = f.includes('.') ? compileFieldRef(f, counter, true) : quoteIdentifier(f);
            return `${ref} ${d === -1 ? 'DESC' : 'ASC'}`;
          });
          overParts.push(`ORDER BY ${sortParts.join(', ')}`);
        }

        const overClause = overParts.length ? `OVER (${overParts.join(' ')})` : 'OVER ()';

        let sqlFn = '';
        if (fnKey === '$function') {
          const funcName = (fnValue as string)?.replace('$', '') || 'rowNumber';
          const snakeCase = funcName.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
          sqlFn = `${snakeCase}() ${overClause}`;
        } else {
          switch (fnKey) {
            case '$rank': sqlFn = `RANK() ${overClause}`; break;
            case '$denseRank': sqlFn = `DENSE_RANK() ${overClause}`; break;
            case '$rowNumber': sqlFn = `ROW_NUMBER() ${overClause}`; break;
            case '$sum': {
              const field = fnValue as string;
              const ref = field?.startsWith('$')
                ? (field.slice(1).includes('.') ? compileFieldRef(field.slice(1), counter, true) : quoteIdentifier(field.slice(1)))
                : '1';
              sqlFn = `SUM(${ref}) ${overClause}`;
              break;
            }
            case '$avg': {
              const field = fnValue as string;
              const ref = field?.startsWith('$')
                ? (field.slice(1).includes('.') ? compileFieldRef(field.slice(1), counter, true) : quoteIdentifier(field.slice(1)))
                : '1';
              sqlFn = `AVG(${ref}) ${overClause}`;
              break;
            }
            case '$min': {
              const field = fnValue as string;
              const ref = field?.startsWith('$')
                ? (field.slice(1).includes('.') ? compileFieldRef(field.slice(1), counter, true) : quoteIdentifier(field.slice(1)))
                : '1';
              sqlFn = `MIN(${ref}) ${overClause}`;
              break;
            }
            case '$max': {
              const field = fnValue as string;
              const ref = field?.startsWith('$')
                ? (field.slice(1).includes('.') ? compileFieldRef(field.slice(1), counter, true) : quoteIdentifier(field.slice(1)))
                : '1';
              sqlFn = `MAX(${ref}) ${overClause}`;
              break;
            }
            case '$first': sqlFn = `FIRST_VALUE(...) ${overClause}`; break;
            case '$last': sqlFn = `LAST_VALUE(...) ${overClause}`; break;
            default: sqlFn = `${fnKey} ${overClause}`;
          }
        }

        selectParts.push(`${sqlFn} AS ${quoteIdentifier(fieldName)}`);
      }

    } else if (stageKey === '$group') {
      const groupDef = (stageObj.$group as Record<string, unknown>);
      const idField = groupDef._id;

      if (idField !== null && idField !== undefined) {
        if (typeof idField === 'string' && idField.startsWith('$')) {
          const fn = idField.slice(1);
          const ref = fn.includes('.') ? compileFieldRef(fn, counter, true) : quoteIdentifier(fn);
          groupByParts.push(ref);
          selectParts.push(`${ref} AS "_id"`);
        }
      }

      for (const [accKey, accVal] of Object.entries(groupDef)) {
        if (accKey === '_id' || typeof accVal !== 'object' || accVal === null) continue;
        for (const [accOp, accField] of Object.entries(accVal as Record<string, unknown>)) {
          const ref = typeof accField === 'string' && accField.startsWith('$')
            ? (accField.slice(1).includes('.') ? compileFieldRef(accField.slice(1), counter, true) : quoteIdentifier(accField.slice(1)))
            : '1';
          switch (accOp) {
            case '$sum': selectParts.push(`SUM(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$avg': selectParts.push(`AVG(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$min': selectParts.push(`MIN(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$max': selectParts.push(`MAX(${ref}) AS ${quoteIdentifier(accKey)}`); break;
            case '$count': selectParts.push(`COUNT(*) AS ${quoteIdentifier(accKey)}`); break;
          }
        }
      }

    } else if (stageKey === '$sort') {
      const sortParts = Object.entries((stageObj.$sort as Record<string, 1 | -1>))
        .map(([f, d]) => {
          const ref = f.includes('.') ? compileFieldRef(f, counter, true) : quoteIdentifier(f);
          return `${ref} ${d === -1 ? 'DESC' : 'ASC'}`;
        });
      orderByClause = `ORDER BY ${sortParts.join(', ')}`;

    } else if (stageKey === '$limit') {
      limitClause = `LIMIT ${nextParam(params, (stageObj.$limit as number), counter)}`;

    } else if (stageKey === '$skip') {
      offsetClause = `OFFSET ${nextParam(params, (stageObj.$skip as number), counter)}`;

    } else if (stageKey === '$project') {
      const fields = Object.entries((stageObj.$project as Record<string, unknown>))
        .filter(([, v]) => v === 1 || v === true)
        .map(([k]) => k.includes('.')
          ? `${compileFieldRef(k, counter, true)} AS "${k.replace(/\./g, '_')}"`
          : quoteIdentifier(k));
      if (fields.length) selectParts.push(...fields);
    }
  }

  const selectClause = selectParts.length > 0 ? selectParts.join(', ') : '*';
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const groupByClause = groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(', ')}` : '';

  const sql = [
    `SELECT ${selectClause}`,
    `FROM ${tableQ}`,
    whereClause,
    groupByClause,
    orderByClause,
    limitClause,
    offsetClause,
  ].filter(Boolean).join(' ');

  return { sql, params };
}

// =====================================================
// $facet Compilation (PostgreSQL: subqueries)
// =====================================================

export function compileFacet(
  table: string,
  facets: Record<string, unknown[]>
): PgCompiledSQL {
  const counter = makeCounter(0);
  const params: unknown[] = [];
  const subqueries: string[] = [];

  for (const [facetName, pipeline] of Object.entries(facets)) {
    const compiled = compileAggregation(table, pipeline as AggregationStage[], counter.n + 1);
    subqueries.push(`SELECT '${facetName}' AS _facet, (${compiled.sql}) AS _data`);
    params.push(...compiled.params);
    counter.n = params.length;
  }

  const sql = subqueries.join('\n UNION ALL\n');
  return { sql, params };
}

// =====================================================
// $bucket Compilation (CASE WHEN)
// =====================================================

export function compileBucket(
  table: string,
  bucketDef: {
    groupBy: string;
    boundaries: unknown[];
    default?: string;
    output?: Document;
  }
): PgCompiledSQL {
  const counter = makeCounter(0);
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const groupByField = bucketDef.groupBy.includes('.')
    ? compileFieldRef(bucketDef.groupBy, counter, true)
    : quoteIdentifier(bucketDef.groupBy);

  const caseParts: string[] = [];
  for (let i = 0; i < bucketDef.boundaries.length - 1; i++) {
    caseParts.push(`WHEN ${groupByField} >= ${nextParam(params, bucketDef.boundaries[i], counter)} AND ${groupByField} < ${nextParam(params, bucketDef.boundaries[i + 1], counter)} THEN ${nextParam(params, `${bucketDef.boundaries[i]}-${bucketDef.boundaries[i + 1]}`, counter)}`);
  }
  if (bucketDef.default) {
    caseParts.push(`ELSE ${nextParam(params, bucketDef.default, counter)}`);
  }

  const caseExpr = `CASE ${caseParts.join(' ')} END`;
  const selectParts: string[] = [`${caseExpr} AS ${quoteIdentifier('_id')}`, 'COUNT(*) AS "_count"'];

  if (bucketDef.output) {
    for (const [alias, expr] of Object.entries(bucketDef.output)) {
      if (typeof expr === 'string' && expr.startsWith('$')) {
        const ref = expr.slice(1).includes('.')
          ? compileFieldRef(expr.slice(1), counter, true)
          : quoteIdentifier(expr.slice(1));
        selectParts.push(`${ref} AS ${quoteIdentifier(alias)}`);
      }
    }
  }

  const sql = `SELECT ${selectParts.join(', ')} FROM ${tableQ} GROUP BY ${quoteIdentifier('_id')} ORDER BY ${quoteIdentifier('_id')}`;
  return { sql, params };
}

// =====================================================
// Stored Procedure / Function Compilation
// FIX: args.map() now correctly maps each arg to its value
// =====================================================

export function compileStoredProcedure(name: string, args: unknown[]): PgCompiledSQL {
  const counter = makeCounter(0);
  const params: unknown[] = [];
  const placeholders = args.map((arg) => nextParam(params, arg, counter)).join(', ');
  const sql = `CALL ${quoteIdentifier(name)}(${placeholders})`;
  return { sql, params };
}

export function compileStoredFunction(name: string, args: unknown[]): PgCompiledSQL {
  const counter = makeCounter(0);
  const params: unknown[] = [];
  const placeholders = args.map((arg) => nextParam(params, arg, counter)).join(', ');
  const sql = `SELECT * FROM ${quoteIdentifier(name)}(${placeholders})`;
  return { sql, params };
}

// =====================================================
// Cursor Pagination Compilation
// =====================================================

export function compileCursorPagination(
  table: string,
  filter: Filter,
  options: {
    after?: string;
    before?: string;
    limit: number;
    sortField?: string;
    sortOrder?: 'asc' | 'desc' | 1 | -1;
  },
  projection?: ProjectionSpec
): PgCompiledSQL {
  const counter = makeCounter(0);
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const sortField = options.sortField || 'id';
  const sortOrder = options.sortOrder === -1 || options.sortOrder === 'desc' ? 'DESC' : 'ASC';
  const sortRef = sortField.includes('.')
    ? compileFieldRef(sortField, counter, true)
    : quoteIdentifier(sortField);

  const mergedFilter = { ...filter };
  if (options.after) {
    const op = sortOrder === 'DESC' ? '$lt' : '$gt';
    mergedFilter[sortField] = { [op]: options.after };
  }
  if (options.before) {
    const op = sortOrder === 'DESC' ? '$gt' : '$lt';
    mergedFilter[sortField] = { [op]: options.before };
  }

  counter.n = params.length;
  const whereSql = compileFilterNode(mergedFilter, params, counter);
  const whereClause = whereSql !== 'TRUE' ? `WHERE ${whereSql}` : '';

  let selectClause = '*';
  if (projection) {
    selectClause = compileProjection(projection);
  }

  const sql = [
    `SELECT ${selectClause}`,
    `FROM ${tableQ}`,
    whereClause,
    `ORDER BY ${sortRef} ${sortOrder}`,
    `LIMIT ${nextParam(params, options.limit + 1, counter)}`,
  ].filter(Boolean).join(' ');

  return { sql, params };
}
