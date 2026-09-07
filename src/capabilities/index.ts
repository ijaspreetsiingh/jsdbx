// =====================================================
// JSDB - Capabilities Module Entry
// =====================================================
export * from './registry.js';
export * from './mysql.js';
export * from './mongodb.js';
export * from './postgres.js';
export * from './sqlite.js';

import { globalRegistry } from './registry.js';
import { mysqlCapabilities } from './mysql.js';
import { mongodbCapabilities } from './mongodb.js';
import { postgresCapabilities } from './postgres.js';
import { sqliteCapabilities } from './sqlite.js';

// Register all capabilities on import
globalRegistry.registerMany(mysqlCapabilities);
globalRegistry.registerMany(mongodbCapabilities);
globalRegistry.registerMany(postgresCapabilities);
globalRegistry.registerMany(sqliteCapabilities);

export { globalRegistry };
