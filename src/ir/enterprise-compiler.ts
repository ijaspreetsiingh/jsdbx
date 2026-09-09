// =====================================================
// JSDB - Enterprise SQL Compiler
// Compiles Enterprise IR to target database SQL
// Supports: CTEs, Window Functions, Triggers,
// Stored Procedures, Views, Transactions, DDL
// =====================================================
import type { CTEDefinition, WindowFunctionSpec, TriggerDefinition, StoredProcedureDefinition, ViewDefinition, TransactionIsolation, ColumnDefinition, DDLIndexDefinition, AlterTableOperation } from '../types/index.js';
import type { EnterpriseParseResult } from './enterprise-parser.js';

// ---- Compiler Options ----

export interface CompilerOptions {
  dialect: 'mysql' | 'postgres' | 'sqlite' | 'mssql';
  version?: string;
  features?: {
    cte?: boolean;
    windowFunctions?: boolean;
    recursiveCte?: boolean;
    materializedCte?: boolean;
    generated?: boolean;
    identity?: boolean;
    check?: boolean;
    lateral?: boolean;
  };
}

// ---- Default Features per Dialect ----

const DIALECT_FEATURES: Record<string, CompilerOptions['features']> = {
  mysql: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: false, generated: true, identity: false, check: false, lateral: false },
  postgres: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: true, generated: true, identity: true, check: true, lateral: true },
  sqlite: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: false, generated: true, identity: true, check: false, lateral: false },
  mssql: { cte: true, windowFunctions: true, recursiveCte: true, materializedCte: false, generated: true, identity: true, check: true, lateral: true },
};

// ---- CTE Compiler ----

export function compileCTE(ctes: CTEDefinition[], options: CompilerOptions): string {
  if (ctes.length === 0) return '';
  
  const parts: string[] = [];
  for (const cte of ctes) {
    let prefix = 'WITH';
    if (cte.recursive) prefix = 'WITH RECURSIVE';
    
    let materializedHint = '';
    if (options.features?.materializedCte && cte.materialized) {
      materializedHint = ` ${cte.materialized}`;
    }
    
    let columnList = '';
    if (cte.columns && cte.columns.length > 0) {
      columnList = ` (${cte.columns.join(', ')})`;
    }
    
    parts.push(`${prefix} ${cte.name}${columnList}${materializedHint} AS (${cte.query.sql})`);
  }
  
  return parts.join(' ');
}

// ---- Window Function Compiler ----

export function compileWindowFunction(wf: WindowFunctionSpec, options: CompilerOptions): string {
  if (!options.features?.windowFunctions) {
    throw new Error(`Window functions not supported in ${options.dialect}`);
  }
  
  const args = wf.args && wf.args.length > 0 ? `(${wf.args.join(', ')})` : '()';
  let overClause = `${wf.fn}${args} OVER (`;
  
  const parts: string[] = [];
  
  if (wf.partitionBy && wf.partitionBy.length > 0) {
    parts.push(`PARTITION BY ${wf.partitionBy.join(', ')}`);
  }
  
  if (wf.orderBy) {
    const orderParts: string[] = [];
    for (const [field, direction] of Object.entries(wf.orderBy)) {
      orderParts.push(`${field} ${direction === -1 ? 'DESC' : 'ASC'}`);
    }
    parts.push(`ORDER BY ${orderParts.join(', ')}`);
  }
  
  if (wf.frame) {
    let frameStr = `${wf.frame.type} `;
    if (wf.frame.start === 'UNBOUNDED PRECEDING') {
      frameStr += 'BETWEEN UNBOUNDED PRECEDING';
    } else if (wf.frame.start === 'CURRENT ROW') {
      frameStr += 'BETWEEN CURRENT ROW';
    } else if (typeof wf.frame.start === 'number') {
      frameStr += `BETWEEN ${wf.frame.start} PRECEDING`;
    }
    
    if (wf.frame.end) {
      if (wf.frame.end === 'UNBOUNDED FOLLOWING') {
        frameStr += ' AND UNBOUNDED FOLLOWING';
      } else if (wf.frame.end === 'CURRENT ROW') {
        frameStr += ' AND CURRENT ROW';
      } else if (typeof wf.frame.end === 'number') {
        frameStr += ` AND ${wf.frame.end} FOLLOWING`;
      }
    }
    
    parts.push(frameStr);
  }
  
  overClause += parts.join(' ') + ')';
  return overClause;
}

// ---- Stored Procedure Compiler ----

export function compileStoredProcedure(proc: StoredProcedureDefinition, options: CompilerOptions): string {
  switch (options.dialect) {
    case 'mysql':
      return compileMySQLProcedure(proc);
    case 'postgres':
      return compilePostgresProcedure(proc);
    case 'sqlite':
      throw new Error('Stored procedures not supported in SQLite');
    case 'mssql':
      return compileMssqlProcedure(proc);
    default:
      throw new Error(`Unsupported dialect: ${options.dialect}`);
  }
}

function compileMySQLProcedure(proc: StoredProcedureDefinition): string {
  const params = proc.parameters.map(p => {
    const direction = p.direction === 'OUT' ? 'OUT' : p.direction === 'INOUT' ? 'INOUT' : 'IN';
    return `${direction} ${p.name} ${p.type}`;
  }).join(', ');
  
  return `CREATE PROCEDURE ${proc.name}(${params})
BEGIN
${proc.body}
END`;
}

function compilePostgresProcedure(proc: StoredProcedureDefinition): string {
  const params = proc.parameters.map(p => {
    return `${p.name} ${p.type}`;
  }).join(', ');
  
  return `CREATE OR REPLACE FUNCTION ${proc.name}(${params})
RETURNS void AS $$
BEGIN
${proc.body}
END;
$$ LANGUAGE plpgsql;`;
}

function compileMssqlProcedure(proc: StoredProcedureDefinition): string {
  const params = proc.parameters.map(p => {
    const direction = p.direction === 'OUT' ? 'OUTPUT' : '';
    return `@${p.name} ${p.type} ${direction}`;
  }).join(',\n    ');
  
  return `CREATE PROCEDURE ${proc.name}
    ${params}
AS
BEGIN
    SET NOCOUNT ON;
${proc.body}
END`;
}

// ---- Trigger Compiler ----

export function compileTrigger(trigger: TriggerDefinition, options: CompilerOptions): string {
  switch (options.dialect) {
    case 'mysql':
      return compileMySQLTrigger(trigger);
    case 'postgres':
      return compilePostgresTrigger(trigger);
    case 'sqlite':
      return compileSqliteTrigger(trigger);
    case 'mssql':
      return compileMssqlTrigger(trigger);
    default:
      throw new Error(`Unsupported dialect: ${options.dialect}`);
  }
}

function compileMySQLTrigger(trigger: TriggerDefinition): string {
  const events = trigger.events.join(' OR ');
  const forEach = trigger.forEachRow ? 'FOR EACH ROW' : '';
  const whenClause = trigger.when ? `\nWHEN ${trigger.when}` : '';
  
  return `CREATE TRIGGER ${trigger.name}
${trigger.timing} ${events} ON ${trigger.table}
${forEach}${whenClause}
BEGIN
${trigger.body}
END`;
}

function compilePostgresTrigger(trigger: TriggerDefinition): string {
  const events = trigger.events.join(' OR ');
  const forEach = trigger.forEachRow ? 'FOR EACH ROW' : '';
  const whenClause = trigger.when ? `\nWHEN (${trigger.when})` : '';
  
  // PostgreSQL needs separate function and trigger
  return `CREATE OR REPLACE FUNCTION ${trigger.name}_fn()
RETURNS TRIGGER AS $$
BEGIN
${trigger.body}
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ${trigger.name}
${trigger.timing} ${events} ON ${trigger.table}
${forEach}${whenClause}
EXECUTE FUNCTION ${trigger.name}_fn();`;
}

function compileSqliteTrigger(trigger: TriggerDefinition): string {
  const events = trigger.events.join(' OR ');
  const forEach = trigger.forEachRow ? 'FOR EACH ROW' : '';
  
  return `CREATE TRIGGER ${trigger.name}
${trigger.timing} ${events} ON ${trigger.table}
${forEach}
BEGIN
${trigger.body}
END`;
}

function compileMssqlTrigger(trigger: TriggerDefinition): string {
  const events = trigger.events.join(' OR ');
  
  return `CREATE TRIGGER ${trigger.name}
ON ${trigger.table}
${trigger.timing} ${events}
AS
BEGIN
    SET NOCOUNT ON;
${trigger.body}
END`;
}

// ---- View Compiler ----

export function compileView(view: ViewDefinition, options: CompilerOptions): string {
  switch (options.dialect) {
    case 'mysql':
      return compileMySQLView(view);
    case 'postgres':
      return compilePostgresView(view);
    case 'sqlite':
      return compileSqliteView(view);
    case 'mssql':
      return compileMssqlView(view);
    default:
      throw new Error(`Unsupported dialect: ${options.dialect}`);
  }
}

function compileMySQLView(view: ViewDefinition): string {
  const checkOption = view.checkOption ? `\nWITH ${view.checkOption} CHECK OPTION` : '';
  return `CREATE OR REPLACE VIEW ${view.name} AS\n${view.sql}${checkOption}`;
}

function compilePostgresView(view: ViewDefinition): string {
  const checkOption = view.checkOption ? `\nWITH ${view.checkOption} CHECK OPTION` : '';
  const securityBarrier = view.securityBarrier ? '\nWITH (security_barrier=true)' : '';
  return `CREATE OR REPLACE VIEW ${view.name} AS\n${view.sql}${checkOption}${securityBarrier}`;
}

function compileSqliteView(view: ViewDefinition): string {
  return `CREATE VIEW IF NOT EXISTS ${view.name} AS\n${view.sql}`;
}

function compileMssqlView(view: ViewDefinition): string {
  return `CREATE OR ALTER VIEW ${view.name} AS\n${view.sql}`;
}

// ---- Transaction Compiler ----

export function compileTransaction(type: string, options: CompilerOptions, isolation?: TransactionIsolation, savepointName?: string): string {
  switch (type) {
    case 'begin':
      if (isolation) {
        return compileBeginTransaction(isolation, options);
      }
      return options.dialect === 'mssql' ? 'BEGIN TRANSACTION' : 'START TRANSACTION';
    
    case 'commit':
      return options.dialect === 'mssql' ? 'COMMIT TRANSACTION' : 'COMMIT';
    
    case 'rollback':
      if (savepointName) {
        return `ROLLBACK TO SAVEPOINT ${savepointName}`;
      }
      return options.dialect === 'mssql' ? 'ROLLBACK TRANSACTION' : 'ROLLBACK';
    
    case 'savepoint':
      return `SAVEPOINT ${savepointName}`;
    
    default:
      throw new Error(`Unknown transaction type: ${type}`);
  }
}

function compileBeginTransaction(isolation: TransactionIsolation, options: CompilerOptions): string {
  let sql = 'START TRANSACTION';
  
  if (isolation.level) {
    sql += ` ISOLATION LEVEL ${isolation.level}`;
  }
  
  if (isolation.readOnly) {
    sql += ' READ ONLY';
  } else if (options.dialect === 'postgres') {
    sql += ' READ WRITE';
  }
  
  if (isolation.deferrable && options.dialect === 'postgres') {
    sql += ' DEFERRABLE';
  }
  
  return sql;
}

// ---- DDL Compiler ----

export function compileCreateTable(name: string, columns: ColumnDefinition[], options: CompilerOptions): string {
  const colDefs = columns.map(col => compileColumnDef(col, options)).join(',\n  ');
  return `CREATE TABLE ${name} (\n  ${colDefs}\n)`;
}

function compileColumnDef(col: ColumnDefinition, options: CompilerOptions): string {
  let def = `${col.name} ${col.type}`;
  
  if (col.length) def += `(${col.length})`;
  if (col.precision) def += `(${col.precision}${col.scale ? `, ${col.scale}` : ''})`;
  
  if (col.nullable === false) def += ' NOT NULL';
  
  if (col.autoIncrement) {
    if (options.dialect === 'mysql') def += ' AUTO_INCREMENT';
    else if (options.dialect === 'postgres') def += ' GENERATED ALWAYS AS IDENTITY';
    else if (options.dialect === 'sqlite') def += ' AUTOINCREMENT';
  }
  
  if (col.primaryKey) def += ' PRIMARY KEY';
  if (col.unique) def += ' UNIQUE';
  
  if (col.defaultValue !== undefined) {
    if (col.defaultValue === null) {
      def += ' DEFAULT NULL';
    } else if (typeof col.defaultValue === 'string') {
      def += ` DEFAULT '${col.defaultValue}'`;
    } else {
      def += ` DEFAULT ${col.defaultValue}`;
    }
  }
  
  if (col.references) {
    def += ` REFERENCES ${col.references.table}(${col.references.column})`;
    if (col.references.onDelete) def += ` ON DELETE ${col.references.onDelete}`;
    if (col.references.onUpdate) def += ` ON UPDATE ${col.references.onUpdate}`;
  }
  
  return def;
}

export function compileAlterTable(op: AlterTableOperation, options: CompilerOptions): string {
  switch (op.type) {
    case 'ADD_COLUMN':
      return `ALTER TABLE ${op.table} ADD COLUMN ${compileColumnDef(op.column!, options)}`;
    
    case 'DROP_COLUMN':
      if (options.dialect === 'mssql') {
        return `ALTER TABLE ${op.table} DROP COLUMN ${op.columnName}`;
      }
      return `ALTER TABLE ${op.table} DROP COLUMN ${op.columnName}`;
    
    case 'RENAME_COLUMN':
      if (options.dialect === 'mysql') {
        return `ALTER TABLE ${op.table} CHANGE COLUMN ${op.columnName} ${op.newName} ${op.column?.type || 'VARCHAR(255)'}`;
      }
      return `ALTER TABLE ${op.table} RENAME COLUMN ${op.columnName} TO ${op.newName}`;
    
    case 'RENAME_TABLE':
      if (options.dialect === 'mysql') {
        return `RENAME TABLE ${op.table} TO ${op.newName}`;
      }
      return `ALTER TABLE ${op.table} RENAME TO ${op.newName}`;
    
    default:
      throw new Error(`Unsupported ALTER operation: ${op.type}`);
  }
}

export function compileCreateIndex(idx: DDLIndexDefinition, options: CompilerOptions): string {
  const unique = idx.unique ? 'UNIQUE ' : '';
  const idxType = idx.type && options.dialect === 'postgres' ? ` USING ${idx.type}` : '';
  const where = idx.where ? ` WHERE ${idx.where}` : '';
  
  return `CREATE ${unique}INDEX ${idx.name} ON ${idx.table}${idxType} (${idx.columns.join(', ')})${where}`;
}

// ---- Batch Operation Compiler ----

export function compileBatch(operations: Array<{ type: string; collection: string; documents?: unknown[]; filter?: unknown; update?: unknown }>, options: CompilerOptions): string[] {
  const results: string[] = [];
  
  for (const op of operations) {
    switch (op.type) {
      case 'insert':
        if (op.documents && op.documents.length > 0) {
          const values = op.documents.map(doc => {
            if (typeof doc === 'object' && doc !== null) {
              const entries = Object.entries(doc as Record<string, unknown>);
              const vals = entries.map(([, v]) => formatValue(v, options)).join(', ');
              return `(${vals})`;
            }
            return `(${formatValue(doc, options)})`;
          }).join(',\n  ');
          results.push(`INSERT INTO ${op.collection} VALUES\n  ${values}`);
        }
        break;
      
      case 'update':
        if (op.update && typeof op.update === 'object') {
          const setClauses = Object.entries(op.update as Record<string, unknown>)
            .map(([k, v]) => `${k} = ${formatValue(v, options)}`)
            .join(', ');
          results.push(`UPDATE ${op.collection} SET ${setClauses}${op.filter ? ' WHERE ...' : ''}`);
        }
        break;
      
      case 'delete':
        results.push(`DELETE FROM ${op.collection}${op.filter ? ' WHERE ...' : ''}`);
        break;
    }
  }
  
  return results;
}

function formatValue(value: unknown, _options: CompilerOptions): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19)}'`;
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  return `'${JSON.stringify(value)}'`;
}

// ---- Feature Check ----

export function checkFeatureSupport(feature: string, options: CompilerOptions): boolean {
  const features = DIALECT_FEATURES[options.dialect] || {};
  return (features as Record<string, boolean>)[feature] === true;
}

// ---- Main Compile Function ----

export function compileEnterprise(parseResult: EnterpriseParseResult, options: CompilerOptions): string {
  const { type, ctes, windowFunctions: _windowFunctions, data } = parseResult;
  
  // Compile CTEs if present
  let cteClause = '';
  if (ctes.length > 0) {
    cteClause = compileCTE(ctes, options);
  }
  
  switch (type) {
    case 'query':
      // Return the raw SQL with CTE prefix if any
      return cteClause ? `${cteClause} ${parseResult.raw}` : parseResult.raw;
    
    case 'procedure':
      return compileStoredProcedure(data as StoredProcedureDefinition, options);
    
    case 'trigger':
      return compileTrigger(data as TriggerDefinition, options);
    
    case 'view':
      return compileView(data as ViewDefinition, options);
    
    case 'transaction': {
      const txData = data as { type: string; data?: TransactionIsolation | { name: string } };
      return compileTransaction(txData.type, options, txData.data as TransactionIsolation, (txData.data as { name: string })?.name);
    }
    
    case 'ddl': {
      const ddlData = data as { type: string; name?: string; table?: string; columns?: ColumnDefinition[]; column?: ColumnDefinition; columnName?: string; newName?: string; index?: DDLIndexDefinition };
      if (ddlData.type === 'create_table') {
        return compileCreateTable(ddlData.name || '', ddlData.columns || [], options);
      }
      if (ddlData.type === 'create_index') {
        return compileCreateIndex(ddlData.index || { name: '', table: '', columns: [] }, options);
      }
      return compileAlterTable(data as AlterTableOperation, options);
    }
    
    case 'batch':
      return compileBatch(data as Array<{ type: string; collection: string; documents?: unknown[]; filter?: unknown; update?: unknown }>, options).join(';\n');
    
    default:
      return parseResult.raw;
  }
}
