export * from './base.js';
export { MySQLAdapter } from './mysql/adapter.js';
export { MongoDBAdapter } from './mongodb/adapter.js';
export { PostgreSQLAdapter } from './postgres/adapter.js';
export { SQLiteAdapter } from './sqlite/adapter.js';

import type { DatabaseType, JSDBConfig } from '../types/index.js';
import type { DatabaseAdapter } from './base.js';
import { MySQLAdapter } from './mysql/adapter.js';
import { MongoDBAdapter } from './mongodb/adapter.js';
import { PostgreSQLAdapter } from './postgres/adapter.js';
import { SQLiteAdapter } from './sqlite/adapter.js';
import { JSDBConfigurationError } from '../errors/index.js';

export function createAdapter(config: JSDBConfig): DatabaseAdapter {
  switch (config.database) {
    case 'mysql':
      return new MySQLAdapter(config);
    case 'mongodb':
      return new MongoDBAdapter(config);
    case 'postgres':
      return new PostgreSQLAdapter(config);
    case 'sqlite':
      return new SQLiteAdapter(config);
    default:
      throw new JSDBConfigurationError(
        `Unknown database type: "${config.database}". Supported: mysql, mongodb, postgres, sqlite`
      );
  }
}
