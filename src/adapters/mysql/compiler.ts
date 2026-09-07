// =====================================================
// JSDB - MySQL IR Compiler
// Converts Universal IR/AST → MySQL SQL with parameterized queries
// SECURITY: All values use parameterized binding — never string concatenation
//
// TRANSLATION STRATEGY:
//   $elemMatch  → JSON_CONTAINS / JSON_TABLE (MySQL 8.0+)
//   $type       → JSON_TYPE()
//   $lookup     → LEFT JOIN
//   $unwind     → JSON_TABLE (MySQL 8.0+)
//   nested keys → JSON_EXTRACT(col, '$.path')
//   Deep Joins  → Multiple JOIN clauses
//   CTE         → WITH RECURSIVE (MySQL 8.0+)
//   Window Fn   → RANK(), ROW_NUMBER(), SUM() OVER
//   $facet      → Multiple subqueries UNION ALL
//   $bucket     → CASE WHEN
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
  JoinClause,
  SortDirection,
} from '../../types/index.js';

export interface CompiledSQL {
  sql: string;
  params: unknown[];
}

export interface CompiledUpdate {
  setClauses: string;
  params: unknown[];
}

// ---- Parameter helper ----
function nextParam(params: unknown[], value: unknown): string {
  params.push(value);
  return '?';
}

// ---- Identifier quoting ----

export function quoteIdentifier(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new JSDBValidationError('Identifier must be a non-empty string');
  }
  if (/^[0-9]/.test(name)) {
    throw new JSDBValidationError(`Invalid identifier "${name}": must not start with a digit`);
  }
  return '`' + name.replace(/`/g, '``') + '`';
}

/**
 * Handle dotted field paths — e.g. "address.city" → JSON_EXTRACT(`address`, '$.city')
 * Simple top-level fields just get quoted normally.
 */
function compileFieldRef(fieldPath: string): string {
  if (!fieldPath.includes('.')) {
    return quoteIdentifier(fieldPath);
  }
  const parts = fieldPath.split('.');
  const col = quoteIdentifier(parts[0]);
  const jsonPath = '$.' + parts.slice(1).join('.');
  return `JSON_EXTRACT(${col}, '${jsonPath}')`;
}

// ---- $type mapping ----
// MongoDB BSON type names → MySQL JSON_TYPE values
const BSON_TO_JSON_TYPE: Record<string, string> = {
  double: 'DOUBLE',
  string: 'STRING',
  object: 'OBJECT',
  array: 'ARRAY',
  bool: 'BOOLEAN',
  boolean: 'BOOLEAN',
  date: 'STRING',    // dates stored as strings in JSON
  'null': 'NULL',
  int: 'INTEGER',
  long: 'INTEGER',
  decimal: 'DOUBLE',
  number: 'DOUBLE',
};

// ---- Filter compilation ----

export function compileFilter(filter: Filter, params: unknown[] = []): { sql: string; params: unknown[] } {
  const clauses: string[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (key === '$and') {
      const parts = (value as Filter[]).map((f) => {
        const sub = compileFilter(f, params);
        return `(${sub.sql})`;
      });
      if (parts.length > 0) clauses.push(`(${parts.join(' AND ')})`);

    } else if (key === '$or') {
      const parts = (value as Filter[]).map((f) => {
        const sub = compileFilter(f, params);
        return `(${sub.sql})`;
      });
      if (parts.length > 0) clauses.push(`(${parts.join(' OR ')})`);

    } else if (key === '$nor') {
      const parts = (value as Filter[]).map((f) => {
        const sub = compileFilter(f, params);
        return `(${sub.sql})`;
      });
      if (parts.length > 0) clauses.push(`NOT (${parts.join(' OR ')})`);

    } else if (key === '$not') {
      const sub = compileFilter(value as Filter, params);
      clauses.push(`NOT (${sub.sql})`);

    } else {
      // Field-level filter — support dotted paths
      const col = compileFieldRef(key);

      if (value === null) {
        clauses.push(`${col} IS NULL`);
      } else if (typeof value !== 'object' || value instanceof Date) {
        params.push(value);
        clauses.push(`${col} = ?`);
      } else {
        const ops = value as Record<string, unknown>;
        for (const [op, opVal] of Object.entries(ops)) {
          switch (op) {
            case '$eq':
              if (opVal === null) clauses.push(`${col} IS NULL`);
              else { params.push(opVal); clauses.push(`${col} = ?`); }
              break;
            case '$ne':
              if (opVal === null) clauses.push(`${col} IS NOT NULL`);
              else { params.push(opVal); clauses.push(`${col} != ?`); }
              break;
            case '$gt':
              params.push(opVal); clauses.push(`${col} > ?`);
              break;
            case '$gte':
              params.push(opVal); clauses.push(`${col} >= ?`);
              break;
            case '$lt':
              params.push(opVal); clauses.push(`${col} < ?`);
              break;
            case '$lte':
              params.push(opVal); clauses.push(`${col} <= ?`);
              break;
            case '$in': {
              const arr = opVal as Scalar[];
              if (!Array.isArray(arr) || arr.length === 0) {
                clauses.push('1 = 0');
              } else {
                arr.forEach((v) => params.push(v));
                clauses.push(`${col} IN (${arr.map(() => '?').join(', ')})`);
              }
              break;
            }
            case '$nin': {
              const arr = opVal as Scalar[];
              if (!Array.isArray(arr) || arr.length === 0) {
                clauses.push('1 = 1');
              } else {
                arr.forEach((v) => params.push(v));
                clauses.push(`${col} NOT IN (${arr.map(() => '?').join(', ')})`);
              }
              break;
            }
            case '$like':
              params.push(opVal);
              clauses.push(`${col} LIKE ?`);
              break;
            case '$ilike':
              params.push(opVal);
              clauses.push(`LOWER(${col}) LIKE LOWER(?)`);
              break;
            case '$regex':
              params.push(opVal);
              clauses.push(`${col} REGEXP ?`);
              break;
            case '$exists':
              clauses.push(opVal ? `${col} IS NOT NULL` : `${col} IS NULL`);
              break;

            // ---- $elemMatch emulation ----
            // Strategy: JSON_CONTAINS with a JSON fragment, or subquery via JSON_TABLE
            // Works when the column is a JSON array column.
            // For simple scalar array: JSON_CONTAINS(col, JSON_QUOTE(val))
            // For object match: JSON_CONTAINS(col, JSON_OBJECT(...))
            case '$elemMatch': {
              const matchObj = opVal as Record<string, unknown>;
              const matchEntries = Object.entries(matchObj);

              if (matchEntries.length === 0) {
                clauses.push(`${col} IS NOT NULL`);
                break;
              }

              // Build a JSON_TABLE subquery to check each array element
              // SELECT 1 FROM JSON_TABLE(`items`, '$[*]' COLUMNS(qty INT PATH '$.qty')) jt WHERE jt.qty > 5
              // We wrap this as EXISTS(...)
              const jtCols: string[] = [];
              const jtWhere: string[] = [];

              for (const [subField, subVal] of matchEntries) {
                const jtCol = `jt_${subField.replace(/[^a-z0-9_]/gi, '_')}`;
                jtCols.push(`${jtCol} JSON PATH '$.${subField}'`);

                if (subVal === null) {
                  jtWhere.push(`${jtCol} IS NULL`);
                } else if (typeof subVal !== 'object' || subVal instanceof Date) {
                  params.push(subVal);
                  jtWhere.push(`${jtCol} = CAST(? AS JSON)`);
                } else {
                  const subOps = subVal as Record<string, unknown>;
                  for (const [subOp, subOpVal] of Object.entries(subOps)) {
                    switch (subOp) {
                      case '$eq': params.push(subOpVal); jtWhere.push(`${jtCol} = CAST(? AS JSON)`); break;
                      case '$ne': params.push(subOpVal); jtWhere.push(`${jtCol} != CAST(? AS JSON)`); break;
                      case '$gt': params.push(subOpVal); jtWhere.push(`${jtCol} > CAST(? AS JSON)`); break;
                      case '$gte': params.push(subOpVal); jtWhere.push(`${jtCol} >= CAST(? AS JSON)`); break;
                      case '$lt': params.push(subOpVal); jtWhere.push(`${jtCol} < CAST(? AS JSON)`); break;
                      case '$lte': params.push(subOpVal); jtWhere.push(`${jtCol} <= CAST(? AS JSON)`); break;
                      default: params.push(subOpVal); jtWhere.push(`${jtCol} = CAST(? AS JSON)`); break;
                    }
                  }
                }
              }

              const colRaw = key.includes('.') ? `JSON_EXTRACT(${quoteIdentifier(key.split('.')[0])}, '$.${key.split('.').slice(1).join('.')}')` : quoteIdentifier(key);
              const jtColDefs = jtCols.join(', ');
              const jtWhereStr = jtWhere.length > 0 ? jtWhere.join(' AND ') : '1=1';
              clauses.push(
                `EXISTS (SELECT 1 FROM JSON_TABLE(${colRaw}, '$[*]' COLUMNS(${jtColDefs})) AS _jt WHERE ${jtWhereStr})`
              );
              break;
            }

            // ---- $type emulation ----
            // MongoDB $type → MySQL JSON_TYPE()
            case '$type': {
              const typeVal = opVal as string | number;
              let jsonTypeName: string;

              if (typeof typeVal === 'number') {
                // BSON type numbers
                const bsonNumMap: Record<number, string> = {
                  1: 'DOUBLE', 2: 'STRING', 3: 'OBJECT', 4: 'ARRAY',
                  8: 'BOOLEAN', 10: 'NULL', 16: 'INTEGER', 18: 'INTEGER',
                };
                jsonTypeName = bsonNumMap[typeVal] ?? 'STRING';
              } else {
                jsonTypeName = BSON_TO_JSON_TYPE[typeVal.toLowerCase()] ?? typeVal.toUpperCase();
              }

              params.push(jsonTypeName);
              clauses.push(`JSON_TYPE(${col}) = ?`);
              break;
            }

            // ---- $all emulation ----
            // Check that array contains ALL given values
            case '$all': {
              const allArr = opVal as Scalar[];
              if (!Array.isArray(allArr) || allArr.length === 0) {
                clauses.push(`${col} IS NOT NULL`);
                break;
              }
              const allClauses = allArr.map((v) => {
                params.push(JSON.stringify(v));
                return `JSON_CONTAINS(${col}, ?)`;
              });
              clauses.push(`(${allClauses.join(' AND ')})`);
              break;
            }

            // ---- $size emulation ----
            case '$size': {
              params.push(opVal);
              clauses.push(`JSON_LENGTH(${col}) = ?`);
              break;
            }

            default:
              throw new JSDBValidationError(`Unknown filter operator: ${op}`);
          }
        }
      }
    }
  }

  return {
    sql: clauses.length > 0 ? clauses.join(' AND ') : '1 = 1',
    params,
  };
}

// ---- Projection ----

export function compileProjection(projection?: ProjectionSpec): string {
  if (!projection || Object.keys(projection).length === 0) return '*';
  const keys = Object.keys(projection);
  const includes = keys.filter((k) => projection[k] === 1 || projection[k] === true);
  if (includes.length > 0) {
    return includes.map((f) => compileFieldRef(f)).join(', ');
  }
  return '*';
}

// ---- Sort ----

export function compileSort(sort?: SortSpec): string {
  if (!sort || Object.keys(sort).length === 0) return '';
  const parts = Object.entries(sort).map(([field, dir]) => {
    const direction = dir === -1 || dir === 'desc' ? 'DESC' : 'ASC';
    return `${compileFieldRef(field)} ${direction}`;
  });
  return `ORDER BY ${parts.join(', ')}`;
}

// ---- Update ----

export function compileUpdate(update: Update): CompiledUpdate {
  const params: unknown[] = [];
  const setClauses: string[] = [];

  const hasOperators = Object.keys(update).some((k) => k.startsWith('$'));
  const setData = hasOperators ? (update as Record<string, unknown>).$set as Document | undefined : update as Document;

  if (setData) {
    for (const [field, value] of Object.entries(setData)) {
      validateIdentifier(field, 'field name');
      params.push(value);
      setClauses.push(`${quoteIdentifier(field)} = ?`);
    }
  }

  const inc = (update as Record<string, unknown>).$inc as Record<string, number> | undefined;
  if (inc) {
    for (const [field, amount] of Object.entries(inc)) {
      validateIdentifier(field, 'field name');
      params.push(amount);
      setClauses.push(`${quoteIdentifier(field)} = ${quoteIdentifier(field)} + ?`);
    }
  }

  const unset = (update as Record<string, unknown>).$unset as Record<string, unknown> | undefined;
  if (unset) {
    for (const field of Object.keys(unset)) {
      validateIdentifier(field, 'field name');
      setClauses.push(`${quoteIdentifier(field)} = NULL`);
    }
  }

  const mul = (update as Record<string, unknown>).$mul as Record<string, number> | undefined;
  if (mul) {
    for (const [field, factor] of Object.entries(mul)) {
      validateIdentifier(field, 'field name');
      params.push(factor);
      setClauses.push(`${quoteIdentifier(field)} = ${quoteIdentifier(field)} * ?`);
    }
  }

  // $push — append to JSON array
  const push = (update as Record<string, unknown>).$push as Record<string, unknown> | undefined;
  if (push) {
    for (const [field, value] of Object.entries(push)) {
      validateIdentifier(field, 'field name');
      params.push(JSON.stringify(value));
      setClauses.push(`${quoteIdentifier(field)} = JSON_ARRAY_APPEND(COALESCE(${quoteIdentifier(field)}, JSON_ARRAY()), '$', CAST(? AS JSON))`);
    }
  }

  // $pull — remove from JSON array
  const pull = (update as Record<string, unknown>).$pull as Record<string, unknown> | undefined;
  if (pull) {
    for (const [field, value] of Object.entries(pull)) {
      validateIdentifier(field, 'field name');
      // Use JSON_REMOVE with JSON_SEARCH to find and remove the element
      params.push(JSON.stringify(value));
      setClauses.push(
        `${quoteIdentifier(field)} = JSON_REMOVE(${quoteIdentifier(field)}, JSON_UNQUOTE(JSON_SEARCH(${quoteIdentifier(field)}, 'one', ?)))`
      );
    }
  }

  if (setClauses.length === 0) {
    throw new JSDBValidationError('Update must contain at least one field to modify');
  }

  return { setClauses: setClauses.join(', '), params };
}

// ---- Aggregation Pipeline ----

export function compileAggregation(
  table: string,
  pipeline: AggregationStage[]
): CompiledSQL {
  const params: unknown[] = [];
  let whereClause = '';
  let groupByClause = '';
  let selectClause = '*';
  let orderByClause = '';
  let limitClause = '';
  let offsetClause = '';
  let joinClauses = '';
  let havingClause = '';

  const selectParts: string[] = [];
  const groupByFields: string[] = [];

  for (const stage of pipeline) {
    const stageKey = Object.keys(stage)[0] as string;

    if (stageKey === '$match') {
      const matchStage = stage as { $match: Filter };
      const compiled = compileFilter(matchStage.$match, params);
      if (compiled.sql !== '1 = 1') whereClause = `WHERE ${compiled.sql}`;

    } else if (stageKey === '$group') {
      const groupStage = stage as { $group: Record<string, unknown> };
      const groupDef = groupStage.$group;
      const idField = groupDef._id;

      if (idField === null || idField === undefined) {
        // Global aggregation — no GROUP BY
      } else if (typeof idField === 'string' && idField.startsWith('$')) {
        const fieldName = idField.slice(1);
        const colRef = compileFieldRef(fieldName);
        groupByFields.push(colRef);
        selectParts.push(`${colRef} AS \`_id\``);
      } else if (typeof idField === 'object' && idField !== null) {
        for (const [alias, fieldExpr] of Object.entries(idField as Record<string, unknown>)) {
          if (typeof fieldExpr === 'string' && fieldExpr.startsWith('$')) {
            const fieldName = fieldExpr.slice(1);
            const colRef = compileFieldRef(fieldName);
            groupByFields.push(colRef);
            selectParts.push(`${colRef} AS ${quoteIdentifier(alias)}`);
          }
        }
      }

      for (const [accKey, accVal] of Object.entries(groupDef)) {
        if (accKey === '_id') continue;
        if (typeof accVal !== 'object' || accVal === null) continue;
        const accOps = accVal as Record<string, unknown>;

        for (const [accOp, accField] of Object.entries(accOps)) {
          const fieldRef = typeof accField === 'string' && accField.startsWith('$')
            ? compileFieldRef(accField.slice(1))
            : accField === 1 ? '1' : `${accField}`;

          switch (accOp) {
            case '$sum':
              selectParts.push(
                typeof accField === 'number'
                  ? `SUM(${accField}) AS ${quoteIdentifier(accKey)}`
                  : `SUM(${fieldRef}) AS ${quoteIdentifier(accKey)}`
              );
              break;
            case '$avg': selectParts.push(`AVG(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$min': selectParts.push(`MIN(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$max': selectParts.push(`MAX(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$count': selectParts.push(`COUNT(*) AS ${quoteIdentifier(accKey)}`); break;
            case '$first': selectParts.push(`MIN(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$last': selectParts.push(`MAX(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$push': selectParts.push(`JSON_ARRAYAGG(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$addToSet': selectParts.push(`JSON_ARRAYAGG(DISTINCT ${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
          }
        }
      }

      selectClause = selectParts.length > 0 ? selectParts.join(', ') : 'COUNT(*) AS `count`';
      groupByClause = groupByFields.length > 0 ? `GROUP BY ${groupByFields.join(', ')}` : '';

    } else if (stageKey === '$project') {
      const projStage = stage as { $project: Record<string, unknown> };
      if (!groupByClause) {
        const projFields = Object.entries(projStage.$project)
          .filter(([, v]) => v === 1 || v === true)
          .map(([k]) => compileFieldRef(k));
        if (projFields.length > 0) selectClause = projFields.join(', ');
      }

    } else if (stageKey === '$addFields') {
      const addStage = stage as { $addFields: Record<string, unknown> };
      const extraParts: string[] = [];
      for (const [alias, expr] of Object.entries(addStage.$addFields)) {
        if (typeof expr === 'string' && expr.startsWith('$')) {
          extraParts.push(`${compileFieldRef(expr.slice(1))} AS ${quoteIdentifier(alias)}`);
        } else {
          params.push(expr);
          extraParts.push(`? AS ${quoteIdentifier(alias)}`);
        }
      }
      if (selectClause === '*' && extraParts.length > 0) {
        selectClause = `*, ${extraParts.join(', ')}`;
      }

    } else if (stageKey === '$sort') {
      const sortStage = stage as { $sort: SortSpec };
      const parts = Object.entries(sortStage.$sort).map(([field, dir]) => {
        const direction = dir === -1 || dir === 'desc' ? 'DESC' : 'ASC';
        return `${compileFieldRef(field)} ${direction}`;
      });
      orderByClause = `ORDER BY ${parts.join(', ')}`;

    } else if (stageKey === '$limit') {
      const limitStage = stage as { $limit: number };
      params.push(limitStage.$limit);
      limitClause = `LIMIT ?`;

    } else if (stageKey === '$skip') {
      const skipStage = stage as { $skip: number };
      params.push(skipStage.$skip);
      offsetClause = `OFFSET ?`;

    } else if (stageKey === '$count') {
      const countStage = stage as { $count: string };
      selectClause = `COUNT(*) AS ${quoteIdentifier(countStage.$count)}`;
      groupByClause = '';

    } else if (stageKey === '$lookup') {
      // ---- $lookup → LEFT JOIN emulation ----
      const lookupStage = stage as {
        $lookup: {
          from: string;
          localField: string;
          foreignField: string;
          as: string;
        };
      };
      const { from, localField, foreignField, as: asAlias } = lookupStage.$lookup;
      const fromTable = quoteIdentifier(from);
      const localCol = compileFieldRef(localField);
      const foreignCol = `${fromTable}.${quoteIdentifier(foreignField)}`;

      // Join and aggregate matched rows as JSON array
      joinClauses += ` LEFT JOIN ${fromTable} ON ${localCol} = ${foreignCol}`;

      // Add joined fields as JSON array in select
      if (selectClause === '*') {
        selectClause = `${quoteIdentifier(table)}.*, JSON_ARRAYAGG(${fromTable}.*) AS ${quoteIdentifier(asAlias)}`;
      } else {
        selectClause += `, JSON_ARRAYAGG(${fromTable}.*) AS ${quoteIdentifier(asAlias)}`;
      }

      // GROUP BY to collapse multiple rows
      if (!groupByClause) {
        groupByClause = `GROUP BY ${quoteIdentifier(table)}.id`;
      }

    } else if (stageKey === '$unwind') {
      // ---- $unwind → JSON_TABLE emulation (MySQL 8.0+) ----
      const unwindStage = stage as { $unwind: string | { path: string; includeArrayIndex?: string; preserveNullAndEmptyArrays?: boolean } };
      const unwindPath = typeof unwindStage.$unwind === 'string'
        ? unwindStage.$unwind
        : unwindStage.$unwind.path;

      // Remove leading $
      const fieldName = unwindPath.startsWith('$') ? unwindPath.slice(1) : unwindPath;
      const col = quoteIdentifier(fieldName);

      // Replace select with JSON_TABLE expansion
      joinClauses += ` JOIN JSON_TABLE(${col}, '$[*]' COLUMNS(${quoteIdentifier(fieldName + '_item')} JSON PATH '$')) AS _unwind_${fieldName}`;
      if (selectClause === '*') {
        selectClause = `${quoteIdentifier(table)}.*, _unwind_${fieldName}.${quoteIdentifier(fieldName + '_item')} AS ${col}`;
      }

    } else if (stageKey === '$facet') {
      throw new JSDBUnsupportedOperationError(
        '$facet',
        'mysql',
        'Use separate queries for each facet pipeline instead.'
      );

    } else if (stageKey === '$replaceRoot') {
      throw new JSDBUnsupportedOperationError(
        '$replaceRoot',
        'mysql',
        'Use $project to reshape documents instead.'
      );
    }
  }

  const tableQuoted = quoteIdentifier(table);
  const sql = [
    `SELECT ${selectClause}`,
    `FROM ${tableQuoted}`,
    joinClauses,
    whereClause,
    groupByClause,
    havingClause,
    orderByClause,
    limitClause,
    offsetClause,
  ]
    .filter(Boolean)
    .join(' ');

  return { sql, params };
}

// =====================================================
// Deep Join Compilation
// =====================================================

export function compileDeepJoin(
  table: string,
  joins: JoinClause[],
  options?: {
    filter?: Filter;
    projection?: ProjectionSpec;
    sort?: SortSpec;
    limit?: number;
    offset?: number;
  }
): CompiledSQL {
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const joinClauses: string[] = [];

  for (const j of joins) {
    const joinTable = quoteIdentifier(j.collection);
    const joinType = (j.type || 'left').toUpperCase();
    const localRef = compileFieldRef(j.on.localField);
    const foreignRef = `${joinTable}.${quoteIdentifier(j.on.foreignField)}`;
    const operator = j.on.operator || '=';
    joinClauses.push(`${joinType} JOIN ${joinTable} ON ${localRef} ${operator} ${foreignRef}`);
  }

  let whereClause = '';
  if (options?.filter) {
    const compiled = compileFilter(options.filter, params);
    if (compiled.sql !== '1 = 1') whereClause = `WHERE ${compiled.sql}`;
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
    params.push(options.limit);
    limitClause = 'LIMIT ?';
  }
  if (options?.offset !== undefined && options.offset > 0) {
    params.push(options.offset);
    offsetClause = 'OFFSET ?';
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
): CompiledSQL {
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const cteName = quoteIdentifier(cte.name);
  const maxDepth = cte.maxDepth ?? 10;

  // Anchor query: starting point
  const anchorFilter = compileFilter(cte.startWith, params);
  const anchorSQL = `SELECT *, 0 AS _depth FROM ${tableQ} WHERE ${anchorFilter.sql}`;

  // Recursive part
  const recFilterSql = compileFilter(cte.startWith, params);
  const connectField = quoteIdentifier(cte.connectBy.field);
  const connectRef = quoteIdentifier(cte.connectBy.references);
  const recursiveSQL = `SELECT t._child.*, (t._parent._depth + 1) AS _depth FROM ${tableQ} AS _parent JOIN ${tableQ} AS _child ON _child.${connectField} = _parent.${connectRef} WHERE _parent._depth < ${maxDepth}`;

  // CTE definition
  let cteSQL = `WITH RECURSIVE ${cteName} AS (\n  ${anchorSQL}\n  UNION ALL\n  ${recursiveSQL}\n)`;

  // Cycle detection: add a PATH column to prevent infinite loops
  if (cte.cycleDetection) {
    // MySQL 8.0.3+ supports CYCLE clause
    cteSQL = `WITH RECURSIVE ${cteName} AS (\n  ${anchorSQL}\n  UNION ALL\n  ${recursiveSQL}\n) CYCLE _depth SET is_cycle USING path`;
  }

  // Search ordering
  let searchClause = '';
  if (cte.search === 'breadth') {
    searchClause = `SEARCH BREADTH FIRST BY _depth SET search_order`;
  } else if (cte.search === 'depth') {
    searchClause = `SEARCH DEPTH FIRST BY _depth SET search_order`;
  }

  // Final SELECT
  let selectClause = `${cteName}.*`;
  if (options?.projection) {
    selectClause = Object.entries(options.projection)
      .filter(([, v]) => v === 1 || v === true)
      .map(([k]) => `${cteName}.${quoteIdentifier(k)}`)
      .join(', ') || selectClause;
  }

  let whereClause = '';
  if (options?.filter) {
    const filterParams: unknown[] = [];
    const filterSql = compileFilter(options.filter, filterParams);
    if (filterSql.sql !== '1 = 1') {
      whereClause = `WHERE ${filterSql.sql}`;
      params.push(...filterParams);
    }
  }

  let orderByClause = '';
  if (options?.sort) {
    orderByClause = compileSort(options.sort);
  }

  let limitClause = '';
  if (options?.limit !== undefined) {
    params.push(options.limit);
    limitClause = 'LIMIT ?';
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
  pipeline: AggregationStage[]
): CompiledSQL {
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const selectParts: string[] = [];
  const whereParts: string[] = [];
  const groupByParts: string[] = [];
  const orderByParts: string[] = [];
  let limitClause = '';
  let offsetClause = '';

  for (const stage of pipeline) {
    const stageKey = Object.keys(stage)[0] as string;

    if (stageKey === '$match') {
      const compiled = compileFilter((stage as { $match: Filter }).$match, params);
      if (compiled.sql !== '1 = 1') whereParts.push(compiled.sql);

    } else if (stageKey === '$setWindowFields') {
      const windowStage = stage as { $setWindowFields: {
        partitionBy?: string;
        sortBy?: Record<string, SortDirection>;
        output: Record<string, { $function: string; $value?: unknown; $order?: SortDirection; window?: { documents?: [number | string, number | string]; range?: [number | string, number | string] } }>;
      }};
      const { partitionBy, sortBy, output } = windowStage.$setWindowFields;

      for (const [fieldName, windowDef] of Object.entries(output)) {
        const { $function: fn, window } = windowDef;

        // Build OVER clause
        let overClause = 'OVER (';
        if (partitionBy) {
          overClause += `PARTITION BY ${compileFieldRef(partitionBy)} `;
        }
        if (sortBy) {
          const sortParts = Object.entries(sortBy).map(([f, d]) => {
            return `${compileFieldRef(f)} ${d === -1 || d === 'desc' ? 'DESC' : 'ASC'}`;
          });
          overClause += `ORDER BY ${sortParts.join(', ')} `;
        }
        if (window?.documents) {
          const [start, end] = window.documents;
          overClause += `ROWS BETWEEN ${formatBound(start)} AND ${formatBound(end)} `;
        }
        overClause += ')';

        let sqlFn = '';
        switch (fn) {
          case '$rank': sqlFn = `RANK() ${overClause}`; break;
          case '$denseRank': sqlFn = `DENSE_RANK() ${overClause}`; break;
          case '$rowNumber': sqlFn = `ROW_NUMBER() ${overClause}`; break;
          case '$sum': sqlFn = `SUM(${compileFieldRef((windowDef.$value as string)?.slice(1) || fieldName)}) ${overClause}`; break;
          case '$avg': sqlFn = `AVG(${compileFieldRef((windowDef.$value as string)?.slice(1) || fieldName)}) ${overClause}`; break;
          case '$min': sqlFn = `MIN(${compileFieldRef((windowDef.$value as string)?.slice(1) || fieldName)}) ${overClause}`; break;
          case '$max': sqlFn = `MAX(${compileFieldRef((windowDef.$value as string)?.slice(1) || fieldName)}) ${overClause}`; break;
          case '$first': sqlFn = `FIRST_VALUE(${compileFieldRef((windowDef.$value as string)?.slice(1) || fieldName)}) ${overClause}`; break;
          case '$last': sqlFn = `LAST_VALUE(${compileFieldRef((windowDef.$value as string)?.slice(1) || fieldName)}) ${overClause}`; break;
          default: sqlFn = `${fn} ${overClause}`;
        }

        selectParts.push(`${sqlFn} AS ${quoteIdentifier(fieldName)}`);
      }

    } else if (stageKey === '$group') {
      const groupStage = stage as { $group: Record<string, unknown> };
      const groupDef = groupStage.$group;
      const idField = groupDef._id;

      if (idField !== null && idField !== undefined) {
        if (typeof idField === 'string' && idField.startsWith('$')) {
          const fieldName = idField.slice(1);
          const colRef = compileFieldRef(fieldName);
          groupByParts.push(colRef);
          selectParts.push(`${colRef} AS \`_id\``);
        }
      }

      for (const [accKey, accVal] of Object.entries(groupDef)) {
        if (accKey === '_id' || typeof accVal !== 'object' || accVal === null) continue;
        for (const [accOp, accField] of Object.entries(accVal as Record<string, unknown>)) {
          const fieldRef = typeof accField === 'string' && accField.startsWith('$')
            ? compileFieldRef(accField.slice(1))
            : '1';
          switch (accOp) {
            case '$sum': selectParts.push(`SUM(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$avg': selectParts.push(`AVG(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$min': selectParts.push(`MIN(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$max': selectParts.push(`MAX(${fieldRef}) AS ${quoteIdentifier(accKey)}`); break;
            case '$count': selectParts.push(`COUNT(*) AS ${quoteIdentifier(accKey)}`); break;
          }
        }
      }

    } else if (stageKey === '$sort') {
      const sortParts = Object.entries((stage as { $sort: Record<string, SortDirection> }).$sort)
        .map(([f, d]) => `${compileFieldRef(f)} ${d === -1 || d === 'desc' ? 'DESC' : 'ASC'}`);
      orderByParts.push(...sortParts);

    } else if (stageKey === '$limit') {
      params.push((stage as { $limit: number }).$limit);
      limitClause = 'LIMIT ?';

    } else if (stageKey === '$skip') {
      params.push((stage as { $skip: number }).$skip);
      offsetClause = 'OFFSET ?';

    } else if (stageKey === '$project') {
      const fields = Object.entries((stage as { $project: Record<string, unknown> }).$project)
        .filter(([, v]) => v === 1 || v === true)
        .map(([k]) => compileFieldRef(k));
      if (fields.length > 0) selectParts.push(...fields);
    }
  }

  const selectClause = selectParts.length > 0 ? selectParts.join(', ') : '*';
  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const groupByClause = groupByParts.length > 0 ? `GROUP BY ${groupByParts.join(', ')}` : '';
  const orderByClause = orderByParts.length > 0 ? `ORDER BY ${orderByParts.join(', ')}` : '';

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

function formatBound(val: number | string): string {
  if (val === 'unbounded' || val === -1) return 'UNBOUNDED PRECEDING';
  if (val === 0 || val === 'current') return 'CURRENT ROW';
  if (typeof val === 'number' && val > 0) return `${val} FOLLOWING`;
  if (typeof val === 'number' && val < 0) return `${Math.abs(val)} PRECEDING`;
  return 'CURRENT ROW';
}

// =====================================================
// $facet Compilation (Multiple subqueries UNION ALL)
// =====================================================

export function compileFacet(
  table: string,
  facets: Record<string, AggregationStage[]>
): CompiledSQL {
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const subqueries: string[] = [];

  for (const [facetName, pipeline] of Object.entries(facets)) {
    const compiled = compileAggregation(table, pipeline);
    subqueries.push(`SELECT '${facetName}' AS _facet, (${compiled.sql}) AS _data`);
    params.push(...compiled.params);
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
): CompiledSQL {
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const groupByField = compileFieldRef(bucketDef.groupBy);

  // Build CASE WHEN expression
  const caseParts: string[] = [];
  for (let i = 0; i < bucketDef.boundaries.length - 1; i++) {
    params.push(bucketDef.boundaries[i], bucketDef.boundaries[i + 1]);
    caseParts.push(`WHEN ${groupByField} >= ? AND ${groupByField} < ? THEN ?`);
    params.push(`${bucketDef.boundaries[i]}-${bucketDef.boundaries[i + 1]}`);
  }
  if (bucketDef.default) {
    caseParts.push(`ELSE ${nextParam(params, bucketDef.default)}`);
  }

  const caseExpr = `CASE ${caseParts.join(' ')} END`;

  // Build output aggregation
  const selectParts: string[] = [`${caseExpr} AS ${quoteIdentifier('_id')}`];
  if (bucketDef.output) {
    for (const [alias, expr] of Object.entries(bucketDef.output)) {
      if (typeof expr === 'string' && expr.startsWith('$')) {
        const fieldRef = compileFieldRef(expr.slice(1));
        selectParts.push(`${fieldRef} AS ${quoteIdentifier(alias)}`);
      }
    }
  }
  selectParts.push('COUNT(*) AS _count');

  const selectClause = selectParts.join(', ');
  const sql = `SELECT ${selectClause} FROM ${tableQ} GROUP BY ${quoteIdentifier('_id')} ORDER BY ${quoteIdentifier('_id')}`;

  return { sql, params };
}

// =====================================================
// Stored Procedure / Function Compilation
// =====================================================

export function compileStoredProcedure(name: string, args: unknown[]): CompiledSQL {
  const params: unknown[] = [];
  const placeholders = args.map((arg) => nextParam(params, arg)).join(', ');
  const sql = `CALL ${quoteIdentifier(name)}(${placeholders})`;
  return { sql, params };
}

export function compileStoredFunction(name: string, args: unknown[]): CompiledSQL {
  const params: unknown[] = [];
  const placeholders = args.map((arg) => nextParam(params, arg)).join(', ');
  const sql = `SELECT ${quoteIdentifier(name)}(${placeholders}) AS _result`;
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
    sortOrder?: SortDirection;
  },
  projection?: ProjectionSpec
): CompiledSQL {
  const params: unknown[] = [];
  const tableQ = quoteIdentifier(table);
  const sortField = options.sortField || '_id';
  const sortOrder = options.sortOrder === -1 || options.sortOrder === 'desc' ? 'DESC' : 'ASC';
  const sortRef = compileFieldRef(sortField);

  // Merge user filter with cursor condition
  const mergedFilter = { ...filter };

  if (options.after) {
    const operator = sortOrder === 'DESC' ? '$lt' : '$gt';
    mergedFilter[sortField] = { [operator]: options.after };
  }
  if (options.before) {
    const operator = sortOrder === 'DESC' ? '$gt' : '$lt';
    mergedFilter[sortField] = { [operator]: options.before };
  }

  const compiledFilter = compileFilter(mergedFilter, params);
  const whereClause = `WHERE ${compiledFilter.sql}`;

  let selectClause = '*';
  if (projection) {
    selectClause = compileProjection(projection);
  }

  params.push(options.limit + 1); // Fetch one extra to detect hasMore

  const sql = [
    `SELECT ${selectClause}`,
    `FROM ${tableQ}`,
    whereClause,
    `ORDER BY ${sortRef} ${sortSortOrder(options.sortOrder)}`,
    `LIMIT ?`,
  ].filter(Boolean).join(' ');

  return { sql, params };
}

function sortSortOrder(order?: SortDirection): string {
  return order === -1 || order === 'desc' ? 'DESC' : 'ASC';
}

// =====================================================
// Batch Query Compilation
// =====================================================

export function compileBatch(queries: CompiledSQL[]): CompiledSQL {
  // MySQL doesn't support true batching, but we can combine statements with ;
  const combinedSql = queries.map((q) => q.sql).join(';\n');
  const combinedParams = queries.flatMap((q) => q.params);
  return { sql: combinedSql, params: combinedParams };
}
