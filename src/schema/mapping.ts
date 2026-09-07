// =====================================================
// JSDB - Schema Mapping System
// Maps between SQL and MongoDB schemas
// =====================================================

import type { DatabaseType, FieldType, Filter, Document } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('info', 'JSDB:SchemaMapping');

export type RelationshipType = 'oneToOne' | 'oneToMany' | 'manyToOne' | 'manyToMany';

export interface FieldMapping {
  sql: string;
  mongo: string;
  sqlType?: string;
  mongoType?: string;
  transformer?: {
    toSql?: (value: unknown) => unknown;
    toMongo?: (value: unknown) => unknown;
  };
}

export interface RelationshipMapping {
  type: RelationshipType;
  fromCollection: string;
  toCollection: string;
  localField: string;
  foreignField: string;
  as?: string;
}

export interface CollectionMapping {
  sqlTable: string;
  mongoCollection: string;
  fields: FieldMapping[];
  relationships?: RelationshipMapping[];
  indexes?: IndexMapping[];
}

export interface IndexMapping {
  name: string;
  fields: string[];
  unique?: boolean;
  sparse?: boolean;
  ttl?: number;
  fulltext?: boolean;
}

export interface SchemaMapping {
  name: string;
  version: string;
  collections: CollectionMapping[];
  typeMapping: TypeMappingEntry[];
}

export interface TypeMappingEntry {
  sqlType: string;
  mongoType: string;
  converter?: {
    toSql?: (value: unknown) => unknown;
    toMongo?: (value: unknown) => unknown;
  };
}

/**
 * Default type mappings between SQL and MongoDB
 */
export const DEFAULT_TYPE_MAPPINGS: TypeMappingEntry[] = [
  { sqlType: 'INT', mongoType: 'number' },
  { sqlType: 'INTEGER', mongoType: 'number' },
  { sqlType: 'BIGINT', mongoType: 'number' },
  { sqlType: 'SMALLINT', mongoType: 'number' },
  { sqlType: 'TINYINT', mongoType: 'number' },
  { sqlType: 'FLOAT', mongoType: 'number' },
  { sqlType: 'DOUBLE', mongoType: 'number' },
  { sqlType: 'DECIMAL', mongoType: 'number' },
  { sqlType: 'NUMERIC', mongoType: 'number' },
  { sqlType: 'VARCHAR', mongoType: 'string' },
  { sqlType: 'CHAR', mongoType: 'string' },
  { sqlType: 'TEXT', mongoType: 'string' },
  { sqlType: 'LONGTEXT', mongoType: 'string' },
  { sqlType: 'BOOLEAN', mongoType: 'boolean' },
  { sqlType: 'BOOL', mongoType: 'boolean' },
  { sqlType: 'DATE', mongoType: 'Date' },
  { sqlType: 'DATETIME', mongoType: 'Date' },
  { sqlType: 'TIMESTAMP', mongoType: 'Date' },
  { sqlType: 'JSON', mongoType: 'object' },
  { sqlType: 'JSONB', mongoType: 'object' },
  { sqlType: 'BINARY', mongoType: 'Binary' },
  { sqlType: 'VARBINARY', mongoType: 'Binary' },
  { sqlType: 'BLOB', mongoType: 'Binary' },
  { sqlType: 'UUID', mongoType: 'ObjectId' },
];

/**
 * Schema Mapping Manager
 * Manages mappings between SQL and MongoDB schemas
 */
export class SchemaMappingManager {
  private mappings = new Map<string, SchemaMapping>();
  private typeMappings: TypeMappingEntry[];

  constructor(typeMappings?: TypeMappingEntry[]) {
    this.typeMappings = typeMappings ?? DEFAULT_TYPE_MAPPINGS;
  }

  /**
   * Register a schema mapping
   */
  register(mapping: SchemaMapping): void {
    this.mappings.set(mapping.name, mapping);
    logger.info('Schema mapping registered', {
      name: mapping.name,
      collections: mapping.collections.length,
    });
  }

  /**
   * Get a schema mapping by name
   */
  get(name: string): SchemaMapping | undefined {
    return this.mappings.get(name);
  }

  /**
   * Get all registered mappings
   */
  getAll(): SchemaMapping[] {
    return Array.from(this.mappings.values());
  }

  /**
   * Map a SQL table name to MongoDB collection name
   */
  mapTableName(sqlTable: string, mappingName?: string): string {
    const mapping = mappingName ? this.mappings.get(mappingName) : this.findMappingBySqlTable(sqlTable);
    if (!mapping) return sqlTable;

    const collection = mapping.collections.find(c => c.sqlTable === sqlTable);
    return collection?.mongoCollection ?? sqlTable;
  }

  /**
   * Map a MongoDB collection name to SQL table name
   */
  mapCollectionName(mongoCollection: string, mappingName?: string): string {
    const mapping = mappingName ? this.mappings.get(mappingName) : this.findMappingByMongoCollection(mongoCollection);
    if (!mapping) return mongoCollection;

    const collection = mapping.collections.find(c => c.mongoCollection === mongoCollection);
    return collection?.sqlTable ?? mongoCollection;
  }

  /**
   * Map a SQL field name to MongoDB field name
   */
  mapFieldName(
    sqlField: string,
    sqlTable: string,
    mappingName?: string
  ): string {
    const mapping = mappingName ? this.mappings.get(mappingName) : this.findMappingBySqlTable(sqlTable);
    if (!mapping) return sqlField;

    const collection = mapping.collections.find(c => c.sqlTable === sqlTable);
    if (!collection) return sqlField;

    const field = collection.fields.find(f => f.sql === sqlField);
    return field?.mongo ?? sqlField;
  }

  /**
   * Map a MongoDB field name to SQL field name
   */
  mapMongoFieldName(
    mongoField: string,
    mongoCollection: string,
    mappingName?: string
  ): string {
    const mapping = mappingName ? this.mappings.get(mappingName) : this.findMappingByMongoCollection(mongoCollection);
    if (!mapping) return mongoField;

    const collection = mapping.collections.find(c => c.mongoCollection === mongoCollection);
    if (!collection) return mongoField;

    const field = collection.fields.find(f => f.mongo === mongoField);
    return field?.sql ?? mongoField;
  }

  /**
   * Convert a SQL filter to MongoDB filter
   */
  sqlFilterToMongo(
    filter: Filter,
    sqlTable: string,
    mappingName?: string
  ): Filter {
    const result: Filter = {};

    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) {
        // Logical operators - keep as is
        if (Array.isArray(value)) {
          (result as any)[key] = value.map(v =>
            typeof v === 'object' && v !== null
              ? this.sqlFilterToMongo(v as Filter, sqlTable, mappingName)
              : v
          );
        } else {
          (result as any)[key] = value;
        }
        continue;
      }

      const mongoField = this.mapFieldName(key, sqlTable, mappingName);

      if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        const ops = value as Record<string, unknown>;
        const compiled: Record<string, unknown> = {};

        for (const [op, opVal] of Object.entries(ops)) {
          switch (op) {
            case '$like':
              compiled['$regex'] = (opVal as string)
                .replace(/%/g, '.*')
                .replace(/_/g, '.');
              break;
            case '$ilike':
              compiled['$regex'] = (opVal as string)
                .replace(/%/g, '.*')
                .replace(/_/g, '.');
              compiled['$options'] = 'i';
              break;
            default:
              compiled[op] = opVal;
          }
        }

        result[mongoField] = compiled as any;
      } else {
        result[mongoField] = value as any;
      }
    }

    return result;
  }

  /**
   * Convert a MongoDB filter to SQL filter
   */
  mongoFilterToSql(
    filter: Filter,
    mongoCollection: string,
    mappingName?: string
  ): Filter {
    const result: Filter = {};

    for (const [key, value] of Object.entries(filter)) {
      if (key.startsWith('$')) {
        // Logical operators - keep as is
        if (Array.isArray(value)) {
          (result as any)[key] = value.map(v =>
            typeof v === 'object' && v !== null
              ? this.mongoFilterToSql(v as Filter, mongoCollection, mappingName)
              : v
          );
        } else {
          (result as any)[key] = value;
        }
        continue;
      }

      const sqlField = this.mapMongoFieldName(key, mongoCollection, mappingName);

      if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
        const ops = value as Record<string, unknown>;
        const compiled: Record<string, unknown> = {};

        for (const [op, opVal] of Object.entries(ops)) {
          switch (op) {
            case '$regex':
              compiled['$like'] = (opVal as string)
                .replace(/\.\*/g, '%')
                .replace(/\./g, '_');
              break;
            case '$options':
              // Skip $options as it's part of $regex
              break;
            default:
              compiled[op] = opVal;
          }
        }

        if (Object.keys(compiled).length > 0) {
          result[sqlField] = compiled as any;
        }
      } else {
        result[sqlField] = value as any;
      }
    }

    return result;
  }

  /**
   * Convert a SQL document to MongoDB document
   */
  sqlDocumentToMongo(
    doc: Document,
    sqlTable: string,
    mappingName?: string
  ): Document {
    const result: Document = {};
    const mapping = mappingName ? this.mappings.get(mappingName) : this.findMappingBySqlTable(sqlTable);
    const collection = mapping?.collections.find(c => c.sqlTable === sqlTable);

    for (const [key, value] of Object.entries(doc)) {
      const field = collection?.fields.find(f => f.sql === key);
      const mongoKey = field?.mongo ?? key;

      // Apply transformer if available
      if (field?.transformer?.toMongo) {
        result[mongoKey] = field.transformer.toMongo(value) as any;
      } else {
        // Apply type conversion
        result[mongoKey] = this.convertValue(value, field?.mongoType) as any;
      }
    }

    return result;
  }

  /**
   * Convert a MongoDB document to SQL document
   */
  mongoDocumentToSql(
    doc: Document,
    mongoCollection: string,
    mappingName?: string
  ): Document {
    const result: Document = {};
    const mapping = mappingName ? this.mappings.get(mappingName) : this.findMappingByMongoCollection(mongoCollection);
    const collection = mapping?.collections.find(c => c.mongoCollection === mongoCollection);

    for (const [key, value] of Object.entries(doc)) {
      const field = collection?.fields.find(f => f.mongo === key);
      const sqlKey = field?.sql ?? key;

      // Apply transformer if available
      if (field?.transformer?.toSql) {
        result[sqlKey] = field.transformer.toSql(value) as any;
      } else {
        // Apply type conversion
        result[sqlKey] = this.convertValue(value, field?.sqlType) as any;
      }
    }

    return result;
  }

  /**
   * Get relationship mappings for a collection
   */
  getRelationships(
    collectionName: string,
    mappingName?: string
  ): RelationshipMapping[] {
    const mapping = mappingName
      ? this.mappings.get(mappingName)
      : this.findMappingByAnyCollection(collectionName);

    if (!mapping) return [];

    const collection = mapping.collections.find(
      c => c.sqlTable === collectionName || c.mongoCollection === collectionName
    );

    return collection?.relationships ?? [];
  }

  /**
   * Generate a default mapping from a SQL schema
   */
  generateFromSqlSchema(
    schema: { tables: { name: string; columns: { name: string; type: string }[] }[] },
    mappingName: string
  ): SchemaMapping {
    const collections: CollectionMapping[] = [];

    for (const table of schema.tables) {
      const fields: FieldMapping[] = table.columns.map(col => ({
        sql: col.name,
        mongo: col.name,
        sqlType: col.type,
        mongoType: this.sqlTypeToMongoType(col.type),
      }));

      collections.push({
        sqlTable: table.name,
        mongoCollection: table.name,
        fields,
      });
    }

    return {
      name: mappingName,
      version: '1.0.0',
      collections,
      typeMapping: this.typeMappings,
    };
  }

  /**
   * Generate a default mapping from a MongoDB schema
   */
  generateFromMongoSchema(
    schema: { collections: { name: string; fields: { name: string; type: string }[] }[] },
    mappingName: string
  ): SchemaMapping {
    const collections: CollectionMapping[] = [];

    for (const coll of schema.collections) {
      const fields: FieldMapping[] = coll.fields.map(field => ({
        sql: field.name,
        mongo: field.name,
        sqlType: this.mongoTypeToSqlType(field.type),
        mongoType: field.type,
      }));

      collections.push({
        sqlTable: coll.name,
        mongoCollection: coll.name,
        fields,
      });
    }

    return {
      name: mappingName,
      version: '1.0.0',
      collections,
      typeMapping: this.typeMappings,
    };
  }

  /**
   * Validate a mapping
   */
  validate(mapping: SchemaMapping): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!mapping.name) {
      errors.push('Mapping name is required');
    }

    if (!mapping.collections || mapping.collections.length === 0) {
      errors.push('At least one collection mapping is required');
    }

    for (const collection of mapping.collections ?? []) {
      if (!collection.sqlTable) {
        errors.push(`SQL table name is required for collection mapping`);
      }
      if (!collection.mongoCollection) {
        errors.push(`MongoDB collection name is required for collection mapping`);
      }
      if (!collection.fields || collection.fields.length === 0) {
        errors.push(`At least one field mapping is required for ${collection.sqlTable}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // Private helpers

  private findMappingBySqlTable(sqlTable: string): SchemaMapping | undefined {
    for (const mapping of this.mappings.values()) {
      if (mapping.collections.some(c => c.sqlTable === sqlTable)) {
        return mapping;
      }
    }
    return undefined;
  }

  private findMappingByMongoCollection(mongoCollection: string): SchemaMapping | undefined {
    for (const mapping of this.mappings.values()) {
      if (mapping.collections.some(c => c.mongoCollection === mongoCollection)) {
        return mapping;
      }
    }
    return undefined;
  }

  private findMappingByAnyCollection(name: string): SchemaMapping | undefined {
    for (const mapping of this.mappings.values()) {
      if (mapping.collections.some(c => c.sqlTable === name || c.mongoCollection === name)) {
        return mapping;
      }
    }
    return undefined;
  }

  private sqlTypeToMongoType(sqlType: string): string {
    const upper = sqlType.toUpperCase();
    const mapping = this.typeMappings.find(t => t.sqlType.toUpperCase() === upper);
    return mapping?.mongoType ?? 'string';
  }

  private mongoTypeToSqlType(mongoType: string): string {
    const mapping = this.typeMappings.find(t => t.mongoType === mongoType);
    return mapping?.sqlType ?? 'VARCHAR';
  }

  private convertValue(value: unknown, targetType?: string): unknown {
    if (value === null || value === undefined) return value;

    if (!targetType) return value;

    switch (targetType) {
      case 'number':
        return Number(value);
      case 'string':
        return String(value);
      case 'boolean':
        return Boolean(value);
      case 'Date':
        if (value instanceof Date) return value;
        if (typeof value === 'string' || typeof value === 'number') {
          return new Date(value);
        }
        return value;
      default:
        return value;
    }
  }
}

// Singleton
export const schemaMappingManager = new SchemaMappingManager();
