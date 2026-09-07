// =====================================================
// JSDB - Enterprise SQL Parser
// Extends base parser with CTEs, Window Functions,
// Stored Procedures, Triggers, Views, Transactions
// =====================================================
import { parseSQL as baseParse } from './sql-parser.js';
import type { Filter, Document, SortSpec, Scalar, Update } from '../types/index.js';
import type {
  CTEDefinition,
  WindowFunctionSpec,
  TriggerDefinition,
  TriggerTiming,
  TriggerEvent,
  StoredProcedureDefinition,
  ViewDefinition,
  TransactionIsolation,
  SavepointDefinition,
  BatchOperation,
  BatchOptions,
  ColumnDefinition,
  AlterTableOperation,
} from '../types/index.js';
import type { DDLIndexDefinition } from '../types/index.js';

// ---- Enhanced IR Node Types ----

export interface EnterpriseIRNode {
  type: string;
  collection?: string;
  operation: string;
  data: unknown;
  metadata?: {
    cte?: CTEDefinition[];
    windowFunctions?: WindowFunctionSpec[];
    transaction?: TransactionIsolation;
    savepoint?: SavepointDefinition;
    audit?: boolean;
    tenantId?: string;
  };
}

// ---- CTE Parser ----

export function parseCTE(sql: string): CTEDefinition[] {
  const ctes: CTEDefinition[] = [];
  const upperSql = sql.toUpperCase();
  
  // Find the WITH keyword start
  const withIdx = upperSql.indexOf('WITH');
  if (withIdx === -1) return ctes;
  
  // Check for RECURSIVE
  const afterWith = upperSql.slice(withIdx + 4).trimStart();
  const recursive = afterWith.startsWith('RECURSIVE');
  const startOffset = withIdx + 4 + (recursive ? 9 : 0);
  
  // Parse CTE list: cte_name [AS (col1, col2)] AS [MATERIALIZED|NOT MATERIALIZED] (SELECT ...)
  let pos = startOffset;
  const rest = sql.slice(pos).trimStart();
  
  // Parse the CTE names/definitions separated by commas
  // Each CTE: name [(columns)] AS [MATERIALIZED] (query)
  const ctePattern = /(\w+)(?:\s*\([^)]*\))?\s+AS\s+(MATERIALIZED|NOT\s+MATERIALIZED)?\s*\(/i;
  
  let remaining = sql.slice(startOffset);
  
  while (remaining.length > 0) {
    const match = remaining.match(ctePattern);
    if (!match) break;
    
    const cteName = match[1];
    const matKeyword = match[2] || '';
    
    let materialized: 'MATERIALIZED' | 'NOT MATERIALIZED' | undefined;
    if (matKeyword.includes('NOT')) {
      materialized = 'NOT MATERIALIZED';
    } else if (matKeyword.includes('MATERIALIZED')) {
      materialized = 'MATERIALIZED';
    }
    
    // Find the opening paren position and extract query
    const parenStart = remaining.indexOf(match[0]) + match[0].length - 1;
    const parenEnd = findMatchingParen(remaining, parenStart);
    const cteQuery = remaining.slice(parenStart + 1, parenEnd).trim();
    
    ctes.push({
      name: cteName,
      recursive,
      materialized,
      query: {
        type: cteQuery.toUpperCase().startsWith('SELECT') ? 'select' :
              cteQuery.toUpperCase().startsWith('INSERT') ? 'insert' :
              cteQuery.toUpperCase().startsWith('UPDATE') ? 'update' :
              cteQuery.toUpperCase().startsWith('DELETE') ? 'delete' : 'select',
        sql: cteQuery,
      },
    });
    
    // Move past this CTE's closing paren and check for comma (more CTEs) or main query
    remaining = remaining.slice(parenEnd + 1).trimStart();
    if (remaining.startsWith(',')) {
      remaining = remaining.slice(1).trimStart();
    } else {
      break;
    }
  }
  
  return ctes;
}

function findMatchingParen(sql: string, start: number): number {
  let depth = 0;
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    if (sql[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return sql.length;
}

// ---- Window Function Parser ----

export function parseWindowFunction(sql: string): WindowFunctionSpec | null {
  const upperSql = sql.toUpperCase();
  
  // Find all OVER (...) positions, then find the function name before each OVER
  const windowFunctions: WindowFunctionSpec[] = [];
  let searchPos = 0;
  
  while (true) {
    const overIdx = upperSql.indexOf(' OVER (', searchPos);
    if (overIdx === -1) break;
    
    // Find the function name+args before this OVER
    const beforeOver = upperSql.slice(0, overIdx);
    const fnMatch = beforeOver.match(/(ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD|FIRST_VALUE|LAST_VALUE|NTH_VALUE|SUM|AVG|COUNT|MIN|MAX)\s*\([^)]*(?:\([^)]*\))*[^)]*\)\s*$/);
    if (!fnMatch) {
      searchPos = overIdx + 1;
      continue;
    }
    
    const fn = fnMatch[1] as WindowFunctionSpec['fn'];
    
    // Now find the OVER content using findMatchingParen
    const overStart = upperSql.indexOf('OVER', overIdx - fnMatch[0].length);
    const overContent = extractOverContent(sql, overStart);
    
    // Parse PARTITION BY
    let partitionBy: string[] | undefined;
    const partitionMatch = overContent.match(/PARTITION\s+BY\s+([\w\s,.\-]+?)(?:\s+ORDER\s+BY|\s*$)/i);
    if (partitionMatch) {
      partitionBy = partitionMatch[1].split(',').map(s => s.trim());
    }
    
    // Parse ORDER BY
    let orderBy: SortSpec | undefined;
    const orderMatch = overContent.match(/ORDER\s+BY\s+(.+?)(?:\s+(?:ROWS|RANGE|GROUPS)|\s*$)/is);
    if (orderMatch) {
      orderBy = parseOrderByFields(orderMatch[1].trim());
    }
    
    // Parse frame
    let frame: WindowFunctionSpec['frame'] | undefined;
    const frameMatch = overContent.match(/(ROWS|RANGE|GROUPS)\s+BETWEEN\s+(.+?)\s+AND\s+(.+?)(?:\)|\s*$)/i);
    if (frameMatch) {
      frame = {
        type: frameMatch[1] as 'ROWS' | 'RANGE' | 'GROUPS',
        start: parseFrameBound(frameMatch[2]),
        end: parseFrameBound(frameMatch[3]),
      };
    } else if (overContent.includes('ROWS BETWEEN')) {
      frame = { type: 'ROWS', start: 'UNBOUNDED PRECEDING', end: 'CURRENT ROW' };
    }
    
    windowFunctions.push({ fn, partitionBy, orderBy, frame });
    searchPos = overIdx + 1;
  }
  
  // Return the last window function found (most specific/complex one)
  // If there are dedicated window functions (RANK, LAG, etc.) prefer those over aggregate ones
  if (windowFunctions.length > 0) {
    const dedicatedFns = windowFunctions.filter(wf => 
      ['ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE', 'LAG', 'LEAD', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE'].includes(wf.fn)
    );
    if (dedicatedFns.length > 0) return dedicatedFns[0];
    return windowFunctions[0];
  }
  
  return null;
}

function extractOverContent(sql: string, overStart: number): string {
  const openParen = sql.indexOf('(', overStart);
  if (openParen === -1) return '';
  const closeParen = findMatchingParen(sql, openParen);
  return sql.slice(openParen + 1, closeParen);
}

function parseFrameBound(s: string): 'UNBOUNDED PRECEDING' | 'CURRENT ROW' | 'PRECEDING' | 'FOLLOWING' | 'UNBOUNDED FOLLOWING' | number {
  const upper = s.toUpperCase().trim();
  if (upper === 'UNBOUNDED PRECEDING') return 'UNBOUNDED PRECEDING';
  if (upper === 'CURRENT ROW') return 'CURRENT ROW';
  if (upper === 'UNBOUNDED FOLLOWING') return 'UNBOUNDED FOLLOWING';
  if (upper.endsWith(' PRECEDING')) return 'PRECEDING';
  if (upper.endsWith(' FOLLOWING')) return 'FOLLOWING';
  const num = parseInt(s.trim(), 10);
  return isNaN(num) ? 'CURRENT ROW' : num;
}

function parseOrderByFields(s: string): SortSpec {
  const sort: SortSpec = {};
  const parts = s.split(',');
  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    const field = tokens[0];
    const direction = (tokens[1] || 'ASC').toUpperCase();
    sort[field] = direction === 'DESC' ? -1 : 1;
  }
  return sort;
}

// ---- Stored Procedure Parser ----

export function parseStoredProcedure(sql: string): {
  type: 'call' | 'create';
  data: StoredProcedureDefinition | { name: string; parameters: unknown[] };
} {
  // CALL procedure_name(args)
  if (sql.toUpperCase().trim().startsWith('CALL ')) {
    const match = sql.match(/CALL\s+(\w+)\s*\(([^)]*)\)/i);
    if (match) {
      const params = match[2] ? match[2].split(',').map(p => p.trim().replace(/^'|'$/g, '')) : [];
      return { type: 'call', data: { name: match[1], parameters: params } };
    }
  }
  
  const upperSql = sql.toUpperCase().trim();
  
  // CREATE PROCEDURE
  if (upperSql.startsWith('CREATE') && upperSql.includes('PROCEDURE')) {
    return { type: 'create', data: parseCreateProcedure(sql) };
  }
  
  // CREATE FUNCTION
  if (upperSql.startsWith('CREATE') && upperSql.includes('FUNCTION')) {
    return { type: 'create', data: parseCreateFunction(sql) };
  }
  
  throw new Error('Unknown stored procedure syntax');
}

function parseCreateProcedure(sql: string): StoredProcedureDefinition {
  const match = sql.match(/CREATE\s+(?:DEFINER\s*=\S+\s+)?PROCEDURE\s+(\w+)\s*\(([^)]*)\)/i);
  if (!match) throw new Error('Invalid CREATE PROCEDURE syntax');
  
  const name = match[1];
  const params = match[2] ? match[2].split(',').map(p => {
    const tokens = p.trim().split(/\s+/);
    return { name: tokens[0], type: tokens[1] || 'VARCHAR', direction: 'IN' as const };
  }) : [];
  
  // Extract body
  const bodyMatch = sql.match(/BEGIN\s+([\s\S]+?)\s+END/i);
  const body = bodyMatch ? bodyMatch[1] : '';
  
  return { name, parameters: params, body, language: 'MySQL' };
}

function parseCreateFunction(sql: string): StoredProcedureDefinition {
  const match = sql.match(/CREATE\s+(?:DEFINER\s*=\S+\s+)?FUNCTION\s+(\w+)\s*\(([^)]*)\)\s+RETURNS\s+(\w+)/i);
  if (!match) {
    // Try simpler pattern without RETURNS
    const simpleMatch = sql.match(/CREATE\s+(?:DEFINER\s*=\S+\s+)?FUNCTION\s+(\w+)\s*\(([^)]*)\)/i);
    if (!simpleMatch) throw new Error('Invalid CREATE FUNCTION syntax');
    const name = simpleMatch[1];
    const params = simpleMatch[2] ? simpleMatch[2].split(',').map(p => {
      const tokens = p.trim().split(/\s+/);
      return { name: tokens[0], type: tokens[1] || 'VARCHAR', direction: 'IN' as const };
    }) : [];
    const bodyMatch = sql.match(/BEGIN\s+([\s\S]+?)\s+END/i);
    const body = bodyMatch ? bodyMatch[1] : '';
    return { name, parameters: params, body, language: 'MySQL' };
  }
  
  const name = match[1];
  const params = match[2] ? match[2].split(',').map(p => {
    const tokens = p.trim().split(/\s+/);
    return { name: tokens[0], type: tokens[1] || 'VARCHAR', direction: 'IN' as const };
  }) : [];
  
  const bodyMatch = sql.match(/BEGIN\s+([\s\S]+?)\s+END/i);
  const body = bodyMatch ? bodyMatch[1] : '';
  
  return { name, parameters: params, body, language: 'MySQL' };
}

// ---- Trigger Parser ----

export function parseTrigger(sql: string): TriggerDefinition {
  // Match from original SQL to preserve case
  const match = sql.match(
    /CREATE\s+TRIGGER\s+(\w+)\s+(BEFORE|AFTER|INSTEAD\s+OF)\s+(INSERT|UPDATE|DELETE)(?:\s+OR\s+(INSERT|UPDATE|DELETE))*\s+ON\s+(\w+)/i
  );
  
  if (!match) throw new Error('Invalid CREATE TRIGGER syntax');
  
  const name = match[1];
  const timing = (match[2].toUpperCase()) as TriggerTiming;
  const events: TriggerEvent[] = [(match[3].toUpperCase()) as TriggerEvent];
  if (match[4]) events.push((match[4].toUpperCase()) as TriggerEvent);
  if (match[5]) events.push((match[5].toUpperCase()) as TriggerEvent);
  const table = match[5] || match[match.length - 1];
  
  const upperSql = sql.toUpperCase();
  
  // Check FOR EACH ROW
  const forEachRow = upperSql.includes('FOR EACH ROW');
  
  // Extract WHEN condition
  let when: string | undefined;
  const whenMatch = sql.match(/WHEN\s+([\s\S]+?)(?:\s+BEGIN|\s*$)/i);
  if (whenMatch) when = whenMatch[1].trim();
  
  // Extract body
  const bodyMatch = sql.match(/BEGIN\s+([\s\S]+?)\s+END/i);
  const body = bodyMatch ? bodyMatch[1] : '';
  
  return { name, timing, events, table, forEachRow, when, body };
}

// ---- View Parser ----

export function parseView(sql: string): ViewDefinition {
  // Match from original SQL to preserve case
  const match = sql.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(?:ALGORITHM\s*=\S+\s+)?(?:DEFINER\s*=\S+\s+)?(?:SQL\s+SECURITY\s+(?:DEFINER|INVOKER)\s+)?VIEW\s+(\w+)\s+(?:\([^)]*\)\s+)?AS\s+(SELECT[\s\S]+)/i);
  
  if (!match) throw new Error('Invalid CREATE VIEW syntax');
  
  const name = match[1];
  const viewSql = match[2];
  
  const upperSql = sql.toUpperCase();
  
  // Check for CHECK OPTION
  let checkOption: ViewDefinition['checkOption'];
  if (upperSql.includes('WITH CASCADED CHECK OPTION')) {
    checkOption = 'CASCADE';
  } else if (upperSql.includes('WITH LOCAL CHECK OPTION')) {
    checkOption = 'LOCAL';
  }
  
  const securityBarrier = upperSql.includes('SQL SECURITY INVOKER');
  
  return { name, sql: viewSql, checkOption, securityBarrier };
}

// ---- Transaction Parser ----

export function parseTransaction(sql: string): {
  type: 'begin' | 'commit' | 'rollback' | 'savepoint' | 'set_isolation';
  data?: TransactionIsolation | SavepointDefinition;
} {
  const upperSql = sql.toUpperCase().trim();
  
  if (upperSql === 'BEGIN' || upperSql === 'START TRANSACTION') {
    return { type: 'begin' };
  }
  
  if (upperSql === 'COMMIT' || upperSql === 'END WORK') {
    return { type: 'commit' };
  }
  
  if (upperSql.startsWith('ROLLBACK')) {
    const savepointMatch = sql.match(/ROLLBACK\s+TO\s+(?:SAVEPOINT\s+)?(\w+)/i);
    if (savepointMatch) {
      return { type: 'rollback', data: { name: savepointMatch[1] } };
    }
    return { type: 'rollback' };
  }
  
  if (upperSql.startsWith('SAVEPOINT')) {
    const match = sql.match(/SAVEPOINT\s+(\w+)/i);
    if (match) return { type: 'savepoint', data: { name: match[1] } };
  }
  
  if (upperSql.startsWith('SET') && upperSql.includes('TRANSACTION')) {
    const match = upperSql.match(/SET\s+TRANSACTION\s+(?:ISOLATION\s+LEVEL\s+)?(\w[\w\s]+?)(?:\s*,\s*(READ\s+(?:ONLY|WRITE)))?(?:\s*,\s*DEFERRABLE)?$/i);
    if (match) {
      const level = match[1].trim() as TransactionIsolation['level'];
      const readOnly = upperSql.includes('READ ONLY');
      return { type: 'set_isolation', data: { level, readOnly } };
    }
  }
  
  throw new Error('Unknown transaction syntax');
}

// ---- DDL Parser ----

export function parseDDL(sql: string): {
  type: 'create_table' | 'alter_table' | 'drop_table' | 'create_index' | 'drop_index' | 'create_view' | 'drop_view' | 'create_trigger' | 'drop_trigger';
  data: unknown;
} {
  const upperSql = sql.toUpperCase().trim();
  
  if (upperSql.startsWith('CREATE TABLE')) {
    return { type: 'create_table', data: parseCreateTable(sql) };
  }
  
  if (upperSql.startsWith('ALTER TABLE')) {
    return { type: 'alter_table', data: parseAlterTable(sql) };
  }
  
  if (upperSql.startsWith('DROP TABLE')) {
    return { type: 'drop_table', data: { name: extractTableName(sql, 'DROP TABLE') } };
  }
  
  if (upperSql.startsWith('CREATE INDEX') || upperSql.startsWith('CREATE UNIQUE INDEX')) {
    return { type: 'create_index', data: parseCreateIndex(sql) };
  }
  
  if (upperSql.startsWith('DROP INDEX')) {
    return { type: 'drop_index', data: { name: extractTableName(sql, 'DROP INDEX') } };
  }
  
  if (upperSql.startsWith('CREATE VIEW')) {
    return { type: 'create_view', data: parseView(sql) };
  }
  
  if (upperSql.startsWith('DROP VIEW')) {
    return { type: 'drop_view', data: { name: extractTableName(sql, 'DROP VIEW') } };
  }
  
  if (upperSql.startsWith('CREATE TRIGGER')) {
    return { type: 'create_trigger', data: parseTrigger(sql) };
  }
  
  if (upperSql.startsWith('DROP TRIGGER')) {
    return { type: 'drop_trigger', data: { name: extractTableName(sql, 'DROP TRIGGER') } };
  }
  
  throw new Error('Unknown DDL syntax');
}

function parseCreateTable(sql: string): { name: string; columns: ColumnDefinition[]; constraints: unknown[] } {
  const match = sql.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]+)\)/i);
  if (!match) throw new Error('Invalid CREATE TABLE syntax');
  
  const name = match[1];
  const body = match[2];
  
  const columns: ColumnDefinition[] = [];
  const constraints: unknown[] = [];
  
  // Simple column parser
  const parts = splitColumns(body);
  for (const part of parts) {
    const trimmed = part.trim().toUpperCase();
    if (trimmed.startsWith('PRIMARY KEY') || trimmed.startsWith('UNIQUE') || trimmed.startsWith('CONSTRAINT') || trimmed.startsWith('FOREIGN KEY') || trimmed.startsWith('INDEX') || trimmed.startsWith('KEY')) {
      constraints.push(part.trim());
      continue;
    }
    
    const col = parseColumnDef(part.trim());
    if (col) columns.push(col);
  }
  
  return { name, columns, constraints };
}

function splitColumns(body: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) result.push(current);
  return result;
}

function parseColumnDef(s: string): ColumnDefinition | null {
  const tokens = s.trim().split(/\s+/);
  if (tokens.length < 2) return null;
  
  const name = tokens[0].replace(/[`"[\]]/g, '');
  const type = tokens[1].toUpperCase();
  
  const col: ColumnDefinition = { name, type };
  
  const upper = s.toUpperCase();
  if (upper.includes('NOT NULL')) col.nullable = false;
  else col.nullable = true;
  if (upper.includes('AUTO_INCREMENT') || upper.includes('SERIAL')) col.autoIncrement = true;
  if (upper.includes('PRIMARY KEY')) col.primaryKey = true;
  if (upper.includes('UNIQUE')) col.unique = true;
  
  // Extract DEFAULT
  const defaultMatch = s.match(/DEFAULT\s+([^\s,]+)/i);
  if (defaultMatch) {
    const val = defaultMatch[1].replace(/['"]/g, '');
    col.defaultValue = val === 'NULL' ? null : val;
  }
  
  return col;
}

function parseAlterTable(sql: string): AlterTableOperation {
  const upperSql = sql.toUpperCase();
  const tableName = extractTableName(sql, 'ALTER TABLE');
  
  if (upperSql.includes('ADD COLUMN') || upperSql.match(/ADD\s+\w+\s+\w+/)) {
    const match = sql.match(/ADD\s+(?:COLUMN\s+)?(\w+)\s+([\w()]+)(?:\s+(?:NOT\s+NULL))?(?:\s+DEFAULT\s+([^\s,;]+))?/i);
    if (match) {
      const col: ColumnDefinition = { name: match[1], type: match[2].toUpperCase() };
      if (match[3]) col.defaultValue = match[3].replace(/['"]/g, '');
      return {
        type: 'ADD_COLUMN',
        table: tableName,
        column: col,
      };
    }
  }
  
  if (upperSql.includes('DROP COLUMN')) {
    const match = sql.match(/DROP\s+COLUMN\s+(\w+)/i);
    if (match) {
      return { type: 'DROP_COLUMN', table: tableName, columnName: match[1] };
    }
  }
  
  if (upperSql.includes('RENAME COLUMN')) {
    const match = sql.match(/RENAME\s+COLUMN\s+(\w+)\s+TO\s+(\w+)/i);
    if (match) {
      return { type: 'RENAME_COLUMN', table: tableName, columnName: match[1], newName: match[2] };
    }
  }
  
  if (upperSql.includes('RENAME TO')) {
    const match = sql.match(/RENAME\s+TO\s+(\w+)/i);
    if (match) {
      return { type: 'RENAME_TABLE', table: tableName, newName: match[1] };
    }
  }
  
  throw new Error('Unknown ALTER TABLE operation');
}

function parseCreateIndex(sql: string): DDLIndexDefinition {
  const match = sql.match(/CREATE\s+(UNIQUE\s+)?INDEX\s+(\w+)\s+ON\s+(\w+)\s*\(([^)]+)\)/i);
  if (!match) throw new Error('Invalid CREATE INDEX syntax');
  
  return {
    name: match[2],
    table: match[3],
    columns: match[4].split(',').map(c => c.trim().replace(/[`"[\]]/g, '')),
    unique: !!match[1],
  };
}

function extractTableName(sql: string, keyword: string): string {
  const upperSql = sql.toUpperCase();
  const start = upperSql.indexOf(keyword) + keyword.length;
  const rest = sql.slice(start).trim();
  const match = rest.match(/(?:IF\s+(?:NOT\s+EXISTS|EXISTS)\s+)?(\w+)/i);
  return match ? match[1] : '';
}

// ---- Batch Operation Parser ----

export function parseBatchOperations(sql: string): BatchOperation[] {
  const operations: BatchOperation[] = [];
  
  // Split by semicolons (respecting strings)
  const statements = splitStatements(sql);
  
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue;
    
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('INSERT')) {
      operations.push(parseBatchInsert(trimmed));
    } else if (upper.startsWith('UPDATE')) {
      operations.push(parseBatchUpdate(trimmed));
    } else if (upper.startsWith('DELETE')) {
      operations.push(parseBatchDelete(trimmed));
    }
  }
  
  return operations;
}

function splitStatements(sql: string): string[] {
  const result: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    
    if (!inString && (ch === "'" || ch === '"')) {
      inString = true;
      stringChar = ch;
    } else if (inString && ch === stringChar) {
      inString = false;
    }
    
    if (ch === ';' && !inString) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  
  if (current.trim()) result.push(current);
  return result;
}

function parseBatchInsert(sql: string): BatchOperation {
  const match = sql.match(/INSERT\s+(?:INTO\s+)?(\w+)\s*(?:\([^)]+\))?\s*VALUES\s*\(([\s\S]+)\)/i);
  if (!match) throw new Error('Invalid INSERT syntax');
  
  return {
    type: 'insert',
    collection: match[1],
    documents: [{ raw: match[2] }], // Simplified - real parser would handle multiple values
  };
}

function parseBatchUpdate(sql: string): BatchOperation {
  const match = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) throw new Error('Invalid UPDATE syntax');
  
  return {
    type: 'update',
    collection: match[1],
    filter: match[3] ? { $where: match[3] } : {},
    update: { $set: match[2] },
  };
}

function parseBatchDelete(sql: string): BatchOperation {
  const match = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?$/i);
  if (!match) throw new Error('Invalid DELETE syntax');
  
  return {
    type: 'delete',
    collection: match[1],
    filter: match[2] ? { $where: match[2] } : {},
  };
}

// ---- Enhanced Main Parse Function ----

export interface EnterpriseParseResult {
  type: 'query' | 'ddl' | 'transaction' | 'procedure' | 'trigger' | 'view' | 'batch';
  ctes: CTEDefinition[];
  windowFunctions: WindowFunctionSpec[];
  data: unknown;
  raw: string;
}

export function parseEnterprise(sql: string): EnterpriseParseResult {
  const upperSql = sql.toUpperCase().trim();
  
  // Detect statement type
  if (upperSql.startsWith('WITH')) {
    const ctes = parseCTE(sql);
    return { type: 'query', ctes, windowFunctions: [], data: null, raw: sql };
  }
  
  if (upperSql.match(/^(ROW_NUMBER|RANK|DENSE_RANK|NTILE|LAG|LEAD|FIRST_VALUE|LAST_VALUE|NTH_VALUE)\s*\(/)) {
    const wf = parseWindowFunction(sql);
    return { type: 'query', ctes: [], windowFunctions: wf ? [wf] : [], data: null, raw: sql };
  }
  
  if (upperSql.startsWith('CALL') || (upperSql.startsWith('CREATE') && (upperSql.includes('PROCEDURE') || upperSql.includes('FUNCTION')))) {
    return { type: 'procedure', ctes: [], windowFunctions: [], data: parseStoredProcedure(sql), raw: sql };
  }
  
  if (upperSql.startsWith('CREATE') && upperSql.includes('TRIGGER')) {
    return { type: 'trigger', ctes: [], windowFunctions: [], data: parseTrigger(sql), raw: sql };
  }
  
  if (upperSql.startsWith('CREATE') && upperSql.includes('VIEW')) {
    return { type: 'view', ctes: [], windowFunctions: [], data: parseView(sql), raw: sql };
  }
  
  if (upperSql.match(/^(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|SET\s+TRANSACTION)/)) {
    return { type: 'transaction', ctes: [], windowFunctions: [], data: parseTransaction(sql), raw: sql };
  }
  
  if (upperSql.match(/^(CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE|CREATE\s+INDEX|DROP\s+INDEX|CREATE\s+VIEW|DROP\s+VIEW|CREATE\s+TRIGGER|DROP\s+TRIGGER)/)) {
    return { type: 'ddl', ctes: [], windowFunctions: [], data: parseDDL(sql), raw: sql };
  }
  
  if (upperSql.includes(';') && upperSql.split(';').length > 2) {
    return { type: 'batch', ctes: [], windowFunctions: [], data: parseBatchOperations(sql), raw: sql };
  }
  
  // Default: parse as regular SELECT/INSERT/UPDATE/DELETE
  return { type: 'query', ctes: [], windowFunctions: [], data: null, raw: sql };
}

export { baseParse as parse };
