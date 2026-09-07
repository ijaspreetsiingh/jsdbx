// =====================================================
// JSDB - Configuration Loader
// =====================================================
import { JSDBConfigurationError } from '../errors/index.js';
import type {
  JSDBConfig,
  DatabaseType,
  LogLevel,
  MysqlConnectionConfig,
  MongoConnectionConfig,
  PostgresConnectionConfig,
  SqliteConnectionConfig,
} from '../types/index.js';

/**
 * Load JSDB config from environment variables
 */
export function loadConfigFromEnv(): Partial<JSDBConfig> {
  const database = process.env.JSDB_DATABASE as DatabaseType | undefined;
  const logLevel = (process.env.JSDB_LOG_LEVEL ?? 'info') as LogLevel;

  let connection: JSDBConfig['connection'] | undefined;

  if (database === 'mysql') {
    connection = {
      host: process.env.JSDB_MYSQL_HOST ?? process.env.JSDB_HOST ?? 'localhost',
      port: parseInt(process.env.JSDB_MYSQL_PORT ?? process.env.JSDB_PORT ?? '3306', 10),
      database: process.env.JSDB_MYSQL_DATABASE ?? process.env.JSDB_DATABASE_NAME,
      user: process.env.JSDB_MYSQL_USER ?? process.env.JSDB_USER,
      password: process.env.JSDB_MYSQL_PASSWORD ?? process.env.JSDB_PASSWORD,
    } satisfies MysqlConnectionConfig;
  } else if (database === 'mongodb') {
    connection = {
      uri: process.env.JSDB_MONGODB_URI ?? process.env.JSDB_MONGO_URI ?? 'mongodb://localhost:27017',
      database: process.env.JSDB_MONGODB_DATABASE ?? process.env.JSDB_MONGO_DATABASE ?? process.env.JSDB_DATABASE_NAME,
    } satisfies MongoConnectionConfig;
  } else if (database === 'postgres') {
    const url = process.env.JSDB_POSTGRES_URL ?? process.env.JSDB_DATABASE_URL;
    if (url) {
      connection = { connectionString: url } satisfies PostgresConnectionConfig;
    } else {
      connection = {
        host: process.env.JSDB_POSTGRES_HOST ?? process.env.JSDB_HOST ?? 'localhost',
        port: parseInt(process.env.JSDB_POSTGRES_PORT ?? process.env.JSDB_PORT ?? '5432', 10),
        database: process.env.JSDB_POSTGRES_DATABASE ?? process.env.JSDB_DATABASE_NAME,
        user: process.env.JSDB_POSTGRES_USER ?? process.env.JSDB_USER,
        password: process.env.JSDB_POSTGRES_PASSWORD ?? process.env.JSDB_PASSWORD,
      } satisfies PostgresConnectionConfig;
    }
  } else if (database === 'sqlite') {
    connection = {
      filename: process.env.JSDB_SQLITE_PATH ?? './data.db',
    } satisfies SqliteConnectionConfig;
  }

  const cacheProvider = process.env.JSDB_CACHE as 'none' | 'memory' | 'redis' | undefined;

  return {
    database: database ?? 'sqlite',
    connection,
    pool: {
      min: parseInt(process.env.JSDB_POOL_MIN ?? '2', 10),
      max: parseInt(process.env.JSDB_POOL_MAX ?? '10', 10),
      idleTimeoutMs: parseInt(process.env.JSDB_POOL_IDLE_TIMEOUT ?? '60000', 10),
      acquireTimeoutMs: parseInt(process.env.JSDB_CONNECT_TIMEOUT ?? '10000', 10),
    },
    logging: {
      level: logLevel,
      logQueries: logLevel === 'debug',
      slowQueryThresholdMs: parseInt(process.env.JSDB_SLOW_QUERY_THRESHOLD ?? '1000', 10),
    },
    cache: cacheProvider
      ? {
          provider: cacheProvider,
          ttlSeconds: parseInt(process.env.JSDB_CACHE_TTL ?? '300', 10),
          redisUrl: process.env.JSDB_REDIS_URL,
        }
      : undefined,
    tenancy: {
      enabled: process.env.JSDB_TENANCY === 'true',
      tenantField: process.env.JSDB_TENANT_FIELD ?? 'tenantId',
    },
    devMode: process.env.JSDB_DEV_MODE === 'true',
    queryTimeoutMs: parseInt(process.env.JSDB_QUERY_TIMEOUT ?? '30000', 10),
  };
}

/**
 * Merge config with environment defaults
 */
export function mergeConfig(provided: JSDBConfig): JSDBConfig {
  const envConfig = loadConfigFromEnv();
  return {
    ...envConfig,
    ...provided,
    connection: provided.connection ?? envConfig.connection,
    pool: { ...envConfig.pool, ...provided.pool },
    logging: { ...envConfig.logging, ...provided.logging },
    cache: { ...envConfig.cache, ...provided.cache },
    tenancy: { ...envConfig.tenancy, ...provided.tenancy },
  };
}

/**
 * Validate config — throws JSDBConfigurationError on problems
 */
export function validateConfig(config: JSDBConfig): void {
  const validDatabases: DatabaseType[] = ['mysql', 'mongodb', 'postgres', 'sqlite'];
  if (!validDatabases.includes(config.database)) {
    throw new JSDBConfigurationError(
      `Invalid database type: "${config.database}". Must be one of: ${validDatabases.join(', ')}`
    );
  }

  if (config.database === 'mysql') {
    const conn = config.connection as MysqlConnectionConfig | undefined;
    if (!conn?.database) {
      throw new JSDBConfigurationError(
        'MySQL configuration requires JSDB_DATABASE_NAME (database name)'
      );
    }
  }

  if (config.database === 'mongodb') {
    const conn = config.connection as MongoConnectionConfig | undefined;
    if (!conn?.uri && !process.env.JSDB_MONGO_URI) {
      throw new JSDBConfigurationError(
        'MongoDB configuration requires JSDB_MONGO_URI or connection.uri'
      );
    }
  }

  if (config.database === 'postgres') {
    const conn = config.connection as PostgresConnectionConfig | undefined;
    if (!conn?.connectionString && !conn?.database) {
      throw new JSDBConfigurationError(
        'PostgreSQL configuration requires JSDB_DATABASE_URL or database name'
      );
    }
  }
}
