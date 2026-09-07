// =====================================================
// JSDB - Main Client
// Primary entry point for developers
// =====================================================
import type { JSDBConfig, Document, Filter, Update, AggregationStage, InsertOneResult, InsertManyResult, UpdateResult, DeleteResult } from '../types/index.js';
import type { DatabaseAdapter, AdapterTransaction, AdapterFindResult } from '../adapters/base.js';
import { createAdapter } from '../adapters/index.js';
import { createCacheManager, CacheManager } from '../cache/cache.js';
import { ObservabilityManager, globalObservability } from '../observability/index.js';
import { SecurityManager } from '../security/index.js';
import { mergeConfig, validateConfig } from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { JSDBCollection } from './collection.js';
import { nativeQueryToIR, checkPortability, type SourceDialect, type TranslationOptions } from '../ir/native-query.js';
import { queryPlanner, strictPlanner } from '../planner/planner.js';
import { globalPlanCache } from '../planner/cache.js';

export interface TransactionContext {
  collection(name: string): JSDBCollection;
  tx: AdapterTransaction;
}

/**
 * JSDB Client — the main entry point for all database operations
 *
 * Usage:
 *   const db = createClient({ database: 'mysql', ... });
 *   await db.connect();
 *   const users = await db.collection('users').find({ age: { $gt: 18 } });
 *   await db.disconnect();
 */
export class JSDBClient {
  private adapter: DatabaseAdapter;
  private cacheManager: CacheManager;
  private observability: ObservabilityManager;
  public readonly security: SecurityManager;
  private config: JSDBConfig;
  private logger = createLogger('info', 'JSDB');

  constructor(config: JSDBConfig) {
    this.config = mergeConfig(config);
    validateConfig(this.config);

    this.adapter = createAdapter(this.config);
    this.cacheManager = createCacheManager(this.config.cache);
    this.observability = globalObservability;
    this.security = new SecurityManager({
      tenantField: this.config.tenancy?.tenantField,
      tenancyEnabled: this.config.tenancy?.enabled,
      auditEnabled: this.config.logging?.level === 'debug',
    });
  }

  // ---- Connection ----

  async connect(): Promise<void> {
    await this.adapter.connect();
    this.logger.info('JSDB connected', { database: this.config.database });
  }

  async disconnect(): Promise<void> {
    await this.adapter.disconnect();
    this.logger.info('JSDB disconnected');
  }

  isConnected(): boolean {
    return this.adapter.isConnected();
  }

  async ping(): Promise<boolean> {
    return this.adapter.ping();
  }

  // ---- Collection access ----

  collection(name: string): JSDBCollection {
    return new JSDBCollection(
      name,
      this.adapter,
      this.cacheManager,
      this.observability,
      this.security,
      this.config
    );
  }

  /**
   * table() — alias for collection(), fluent-query style
   */
  table(name: string): JSDBCollection {
    return this.collection(name);
  }

  // ---- Transaction ----

  async transaction<T>(fn: (ctx: TransactionContext) => Promise<T>): Promise<T> {
    const tx = await this.adapter.beginTransaction();
    const client = this;

    const ctx: TransactionContext = {
      tx,
      collection(name: string): JSDBCollection {
        return new JSDBCollection(
          name,
          client.adapter,
          client.cacheManager,
          client.observability,
          client.security,
          client.config,
          { tx }  // Pass transaction so all operations use the transaction connection
        );
      },
    };

    try {
      const result = await fn(ctx);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  // ---- Schema ops ----

  async createCollection(name: string, options?: { ifNotExists?: boolean }): Promise<void> {
    await this.adapter.createCollection(name, options);
  }

  async dropCollection(name: string, options?: { ifExists?: boolean }): Promise<void> {
    await this.adapter.dropCollection(name, options);
  }

  async listCollections(): Promise<string[]> {
    return this.adapter.listCollections();
  }

  // ---- Raw / Escape Hatch ---- (NON_PORTABLE)

  /**
   * Execute a raw/native query — NON_PORTABLE
   * This bypasses all JSDB safety layers. Use only for database-specific operations.
   */
  async raw(query: string, params?: unknown[]): Promise<unknown> {
    this.logger.warn('raw() called — this operation is NON_PORTABLE and bypasses JSDB safety layers');
    return this.adapter.executeRaw(query, params);
  }

  /**
   * Get the raw native connection — NON_PORTABLE
   */
  getRawConnection(): unknown {
    this.logger.warn('getRawConnection() called — NON_PORTABLE');
    return this.adapter.getRawConnection();
  }

  /**
   * MySQL-specific operations — NON_PORTABLE
   */
  mysql(fn: (conn: unknown) => Promise<unknown>): Promise<unknown> {
    if (this.config.database !== 'mysql') {
      throw new Error('db.mysql() can only be called when JSDB_DATABASE=mysql');
    }
    this.logger.warn('db.mysql() — NON_PORTABLE MySQL-specific operation');
    return fn(this.adapter.getRawConnection());
  }

  /**
   * MongoDB-specific operations — NON_PORTABLE
   */
  mongodb(fn: (client: unknown) => Promise<unknown>): Promise<unknown> {
    if (this.config.database !== 'mongodb') {
      throw new Error('db.mongodb() can only be called when JSDB_DATABASE=mongodb');
    }
    this.logger.warn('db.mongodb() — NON_PORTABLE MongoDB-specific operation');
    return fn(this.adapter.getRawConnection());
  }

  // ---- Native Query Translation (CORE PRODUCT FEATURE) ----

  /**
   * Execute a native query from ANY supported database dialect.
   * JSDB automatically translates it to the target database.
   *
   * Usage:
   *   // SQL → MongoDB (JSDB translates automatically)
   *   const users = await db.nativeQuery('SELECT * FROM users WHERE age > 18 ORDER BY name');
   *
   *   // SQL → PostgreSQL (same query, different DB)
   *   const users = await db.nativeQuery('SELECT * FROM users WHERE age > 18 ORDER BY name');
   *
   *   // MongoDB-style pipeline → SQL
   *   const result = await db.nativeQuery([{ $match: { status: 'active' } }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
   */
  async nativeQuery<T = Document[]>(
    query: string | Document | Document[],
    options?: {
      sourceDialect?: SourceDialect;
      strictMode?: boolean;
    }
  ): Promise<T> {
    const targetDb = this.config.database as import('../types/index.js').DatabaseType;

    // Step 1: Translate native query → Universal IR
    const translationOpts: TranslationOptions = {
      sourceDialect: options?.sourceDialect,
      targetDatabase: targetDb,
      strictMode: options?.strictMode,
    };

    const translation = nativeQueryToIR(query, translationOpts);

    // Step 2: Run through Query Planner for capability analysis
    const planner = options?.strictMode ? strictPlanner : queryPlanner;

    // Check plan cache
    let plan = globalPlanCache.get(translation.ir, targetDb);
    if (!plan) {
      plan = planner.plan(translation.ir, targetDb);
      globalPlanCache.set(translation.ir, targetDb, plan);
    }

    // Step 3: Warn about portability issues
    if (plan.warnings.length > 0) {
      for (const warning of plan.warnings) {
        this.logger.warn(warning);
      }
    }

    // Step 4: Execute via adapter
    const result = await this.adapter.execute(plan);

    return result as T;
  }

  /**
   * Check if a native query is portable across all supported databases
   */
  checkQueryPortability(
    query: string | Document | Document[],
    options?: { sourceDialect?: SourceDialect }
  ): {
    portable: boolean;
    databases: Map<string, { supported: boolean; warnings: string[] }>;
    ir: import('../ir/nodes.js').IRNode;
  } {
    const targetDb = this.config.database as import('../types/index.js').DatabaseType;
    const translation = nativeQueryToIR(query, {
      sourceDialect: options?.sourceDialect,
      targetDatabase: targetDb,
    });
    const portability = checkPortability(translation.ir);

    const dbResults = new Map<string, { supported: boolean; warnings: string[] }>();
    for (const [db, result] of portability) {
      dbResults.set(db, result);
    }

    return {
      portable: Array.from(portability.values()).every(r => r.supported),
      databases: dbResults,
      ir: translation.ir,
    };
  }

  // ---- Info ----

  getDatabaseType(): string {
    return this.config.database;
  }

  getAdapter(): DatabaseAdapter {
    return this.adapter;
  }

  getCacheManager(): CacheManager {
    return this.cacheManager;
  }

  getObservability(): ObservabilityManager {
    return this.observability;
  }
}

/**
 * Factory function to create a JSDB client from an explicit config object.
 */
export function createClient(config: JSDBConfig): JSDBClient {
  return new JSDBClient(config);
}

/**
 * createClientFromEnv — the zero-config factory.
 *
 * Reads ALL configuration from environment variables:
 *   JSDB_DATABASE=mysql | mongodb | postgres | sqlite
 *   JSDB_HOST, JSDB_PORT, JSDB_DATABASE_NAME, JSDB_USER, JSDB_PASSWORD
 *   JSDB_MONGO_URI, JSDB_DATABASE_URL, JSDB_SQLITE_PATH
 *
 * Usage in your app:
 *   const db = createClientFromEnv();
 *   await db.connect();
 *   // change JSDB_DATABASE=mongodb → same code works on MongoDB
 *
 * The user changes only .env — zero application code changes.
 */
export function createClientFromEnv(overrides?: Partial<JSDBConfig>): JSDBClient {
  const envConfig = mergeConfig((overrides ?? {}) as JSDBConfig);
  return new JSDBClient(envConfig);
}
