// =====================================================
// JSDB - Schema Engine
// Universal schema → database-specific DDL
// =====================================================
import type {
  SchemaDefinition,
  CollectionSchema,
  FieldDefinition,
  IndexDefinition,
  FieldType,
  DatabaseType,
} from '../types/index.js';
import { JSDBSchemaError } from '../errors/index.js';

export interface DDLStatement {
  sql: string;
  database: DatabaseType;
  type: 'CREATE_TABLE' | 'CREATE_INDEX' | 'ALTER_TABLE' | 'DROP_TABLE' | 'DROP_INDEX';
}

// ---- Type Mapping ----

const MYSQL_TYPE_MAP: Record<FieldType, string> = {
  string: 'VARCHAR(255)',
  text: 'TEXT',
  number: 'DOUBLE',
  integer: 'INT',
  float: 'FLOAT',
  decimal: 'DECIMAL(18,6)',
  boolean: 'TINYINT(1)',
  date: 'DATETIME',
  objectId: 'VARCHAR(24)',
  uuid: 'VARCHAR(36)',
  json: 'JSON',
  binary: 'BLOB',
  array: 'JSON',
  object: 'JSON',
};

const POSTGRES_TYPE_MAP: Record<FieldType, string> = {
  string: 'VARCHAR(255)',
  text: 'TEXT',
  number: 'DOUBLE PRECISION',
  integer: 'INTEGER',
  float: 'REAL',
  decimal: 'NUMERIC(18,6)',
  boolean: 'BOOLEAN',
  date: 'TIMESTAMPTZ',
  objectId: 'VARCHAR(24)',
  uuid: 'UUID',
  json: 'JSONB',
  binary: 'BYTEA',
  array: 'JSONB',
  object: 'JSONB',
};

const SQLITE_TYPE_MAP: Record<FieldType, string> = {
  string: 'TEXT',
  text: 'TEXT',
  number: 'REAL',
  integer: 'INTEGER',
  float: 'REAL',
  decimal: 'REAL',
  boolean: 'INTEGER',
  date: 'TEXT',
  objectId: 'TEXT',
  uuid: 'TEXT',
  json: 'TEXT',
  binary: 'BLOB',
  array: 'TEXT',
  object: 'TEXT',
};

function quoteMySQL(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

function quotePG(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function quoteSQLite(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

export class SchemaEngine {
  /**
   * Generate DDL statements for MySQL
   */
  static generateMySQLDDL(schema: CollectionSchema): DDLStatement[] {
    const stmts: DDLStatement[] = [];
    const cols: string[] = [];

    // Auto-add timestamps if configured
    const fields = { ...schema.fields };
    if (schema.timestamps) {
      if (!fields.createdAt) fields.createdAt = { type: 'date', default: 'now' };
      if (!fields.updatedAt) fields.updatedAt = { type: 'date', default: 'now' };
    }

    for (const [fieldName, def] of Object.entries(fields)) {
      const col = buildMySQLColumn(fieldName, def);
      cols.push(col);
    }

    const createSQL = `CREATE TABLE IF NOT EXISTS ${quoteMySQL(schema.name)} (\n  ${cols.join(',\n  ')}\n)`;
    stmts.push({ sql: createSQL, database: 'mysql', type: 'CREATE_TABLE' });

    // Indexes
    for (const idx of schema.indexes ?? []) {
      stmts.push({
        sql: buildMySQLIndex(schema.name, idx),
        database: 'mysql',
        type: 'CREATE_INDEX',
      });
    }

    return stmts;
  }

  /**
   * Generate DDL statements for PostgreSQL
   */
  static generatePostgresDDL(schema: CollectionSchema): DDLStatement[] {
    const stmts: DDLStatement[] = [];
    const cols: string[] = [];

    const fields = { ...schema.fields };
    if (schema.timestamps) {
      if (!fields.createdAt) fields.createdAt = { type: 'date', default: 'now', nullable: true };
      if (!fields.updatedAt) fields.updatedAt = { type: 'date', default: 'now', nullable: true };
    }

    for (const [fieldName, def] of Object.entries(fields)) {
      cols.push(buildPGColumn(fieldName, def));
    }

    stmts.push({
      sql: `CREATE TABLE IF NOT EXISTS ${quotePG(schema.name)} (\n  ${cols.join(',\n  ')}\n)`,
      database: 'postgres',
      type: 'CREATE_TABLE',
    });

    for (const idx of schema.indexes ?? []) {
      stmts.push({
        sql: buildPGIndex(schema.name, idx),
        database: 'postgres',
        type: 'CREATE_INDEX',
      });
    }

    return stmts;
  }

  /**
   * Generate DDL statements for SQLite
   */
  static generateSQLiteDDL(schema: CollectionSchema): DDLStatement[] {
    const stmts: DDLStatement[] = [];
    const cols: string[] = [];

    const fields = { ...schema.fields };
    if (schema.timestamps) {
      if (!fields.createdAt) fields.createdAt = { type: 'date', nullable: true };
      if (!fields.updatedAt) fields.updatedAt = { type: 'date', nullable: true };
    }

    for (const [fieldName, def] of Object.entries(fields)) {
      cols.push(buildSQLiteColumn(fieldName, def));
    }

    stmts.push({
      sql: `CREATE TABLE IF NOT EXISTS ${quoteSQLite(schema.name)} (\n  ${cols.join(',\n  ')}\n)`,
      database: 'sqlite',
      type: 'CREATE_TABLE',
    });

    for (const idx of schema.indexes ?? []) {
      stmts.push({
        sql: `CREATE ${idx.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${quoteSQLite(idx.name ?? `idx_${schema.name}_${idx.fields.join('_')}`)} ON ${quoteSQLite(schema.name)} (${idx.fields.map(quoteSQLite).join(', ')})`,
        database: 'sqlite',
        type: 'CREATE_INDEX',
      });
    }

    return stmts;
  }

  /**
   * MongoDB: no DDL needed, but can create indexes
   */
  static generateMongoDBIndexCommands(schema: CollectionSchema): Array<{ collection: string; keys: Record<string, unknown>; options: Record<string, unknown> }> {
    const commands = [];
    for (const idx of schema.indexes ?? []) {
      const keys: Record<string, unknown> = {};
      for (const f of idx.fields) keys[f] = idx.fulltext ? 'text' : 1;
      const options: Record<string, unknown> = {};
      if (idx.unique) options.unique = true;
      if (idx.name) options.name = idx.name;
      if (idx.sparse) options.sparse = true;
      if (idx.ttl !== undefined) options.expireAfterSeconds = idx.ttl;
      commands.push({ collection: schema.name, keys, options });
    }
    return commands;
  }

  /**
   * Generate DDL for all databases
   */
  static generateAll(schema: CollectionSchema): Record<DatabaseType, DDLStatement[]> {
    return {
      mysql: SchemaEngine.generateMySQLDDL(schema),
      postgres: SchemaEngine.generatePostgresDDL(schema),
      sqlite: SchemaEngine.generateSQLiteDDL(schema),
      mongodb: [], // Schema-less
    };
  }

  /**
   * Validate a schema definition
   */
  static validate(schema: CollectionSchema): string[] {
    const errors: string[] = [];

    if (!schema.name) errors.push('Schema must have a name');
    if (!schema.fields || Object.keys(schema.fields).length === 0) {
      errors.push('Schema must have at least one field');
    }

    for (const [fieldName, def] of Object.entries(schema.fields ?? {})) {
      if (!def.type) errors.push(`Field "${fieldName}" is missing type`);
    }

    return errors;
  }
}

// ---- Column builders ----

function buildMySQLColumn(name: string, def: FieldDefinition): string {
  const type = MYSQL_TYPE_MAP[def.type] ?? 'TEXT';
  let col = `${quoteMySQL(name)} ${type}`;

  if (def.maxLength && def.type === 'string') {
    col = `${quoteMySQL(name)} VARCHAR(${def.maxLength})`;
  }
  if (def.primaryKey) {
    col += ' PRIMARY KEY';
    if (def.autoIncrement) col += ' AUTO_INCREMENT';
  }
  if (def.unique && !def.primaryKey) col += ' UNIQUE';
  if (def.required && !def.nullable) col += ' NOT NULL';
  if (def.nullable) col += ' NULL';
  if (def.default !== undefined && def.default !== 'now') {
    col += ` DEFAULT ${JSON.stringify(def.default)}`;
  } else if (def.default === 'now') {
    col += ' DEFAULT CURRENT_TIMESTAMP';
  }

  return col;
}

function buildPGColumn(name: string, def: FieldDefinition): string {
  let type = POSTGRES_TYPE_MAP[def.type] ?? 'TEXT';
  if (def.primaryKey && def.autoIncrement) type = 'SERIAL';
  if (def.maxLength && def.type === 'string') type = `VARCHAR(${def.maxLength})`;

  let col = `${quotePG(name)} ${type}`;
  if (def.primaryKey && !def.autoIncrement) col += ' PRIMARY KEY';
  if (def.primaryKey && def.autoIncrement) col += ' PRIMARY KEY';
  if (def.unique && !def.primaryKey) col += ' UNIQUE';
  if (def.required && !def.nullable) col += ' NOT NULL';
  if (def.default !== undefined && def.default !== 'now') {
    col += ` DEFAULT ${JSON.stringify(def.default)}`;
  } else if (def.default === 'now') {
    col += ' DEFAULT NOW()';
  }

  return col;
}

function buildSQLiteColumn(name: string, def: FieldDefinition): string {
  const type = SQLITE_TYPE_MAP[def.type] ?? 'TEXT';
  let col = `${quoteSQLite(name)} ${type}`;
  if (def.primaryKey) {
    col += ' PRIMARY KEY';
    if (def.autoIncrement) col += ' AUTOINCREMENT';
  }
  if (def.unique && !def.primaryKey) col += ' UNIQUE';
  if (def.required && !def.nullable) col += ' NOT NULL';
  if (def.default !== undefined && def.default !== 'now') {
    col += ` DEFAULT ${JSON.stringify(def.default)}`;
  }
  return col;
}

function buildMySQLIndex(table: string, idx: IndexDefinition): string {
  const name = idx.name ?? `idx_${table}_${idx.fields.join('_')}`;
  const type = idx.unique ? 'UNIQUE' : idx.fulltext ? 'FULLTEXT' : '';
  const cols = idx.fields.map(quoteMySQL).join(', ');
  return `CREATE ${type} INDEX IF NOT EXISTS ${quoteMySQL(name)} ON ${quoteMySQL(table)} (${cols})`;
}

function buildPGIndex(table: string, idx: IndexDefinition): string {
  const name = idx.name ?? `idx_${table}_${idx.fields.join('_')}`;
  const unique = idx.unique ? 'UNIQUE ' : '';
  const cols = idx.fields.map(quotePG).join(', ');
  return `CREATE ${unique}INDEX IF NOT EXISTS ${quotePG(name)} ON ${quotePG(table)} (${cols})`;
}
