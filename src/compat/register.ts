// =====================================================
// JSDB Register — Zero-Code Interception Hook
//
// Add ONE line to the very top of your app entry point:
//
//   import 'jsdb/register';           // ESM
//   require('jsdb/register');         // CJS
//
// After this, ALL calls to mysql2, mysql, pg are
// transparently intercepted by JSDB. No other changes needed.
//
// HOW IT WORKS:
// Node.js's require() system caches modules by resolved path.
// We pre-populate the module cache with JSDB proxy objects
// BEFORE any user module loads the real drivers.
//
// For ESM projects the import side-effect achieves the same via
// the loader hook approach. For CJS projects, require cache
// patching is synchronous and reliable.
//
// LIMITATION: This only works if 'jsdb/register' is imported
// BEFORE the first import/require of mysql2/pg/mysql.
// In ESM, import ordering matters — put this import first.
// =====================================================

// We need to patch the CJS require cache at load time.
// In ESM context this file is evaluated as a side effect.

import { createRequire } from 'module';
import { createLogger } from '../utils/logger.js';

// IMPORTANT: Do NOT top-level import from './core.js' here.
// core.js imports adapters which import mysql2/pg — but register intercepts
// those drivers BEFORE they load, causing circular dependency hang.
// We use lazy require() inside each function instead.

const logger = createLogger('info', 'JSDB:register');

// ---- CJS require cache patching ----
// Works in both CJS and ESM (via createRequire)

function patchRequireCache(): void {
  // Only works in CJS or when running under Node.js module system
  if (typeof require === 'undefined') {
    patchEsmModuleCache();
    return;
  }

  patchCjsModuleCache(require);
}

function patchCjsModuleCache(req: NodeRequire): void {
  // Resolve actual paths of the real drivers (if installed)
  // Then replace them in the cache with our proxies

  const drivers = [
    { name: 'mysql2', proxyPath: 'jsdb/mysql2' },
    { name: 'mysql2/promise', proxyPath: 'jsdb/mysql2' },
    { name: 'pg', proxyPath: 'jsdb/pg' },
    { name: 'mysql', proxyPath: 'jsdb/mysql' },
    // NOTE: Do NOT intercept 'mongodb' or 'mongoose' here.
    // JSDB's own MongoDB compat layer imports the real 'mongodb' driver.
    // Intercepting it causes circular dependency → OOM.
    // Use explicit imports: import ... from 'jasdbx/mongodb' or 'jasdbx/mongoose'
  ];

  for (const driver of drivers) {
    try {
      // Try to resolve the real driver path
      const realPath = require.resolve(driver.name);

      // Build our proxy object
      let proxyExports: unknown;
      if (driver.name === 'mysql2' || driver.name === 'mysql2/promise') {
        proxyExports = buildMysql2Proxy();
      } else if (driver.name === 'pg') {
        proxyExports = buildPgProxy();
      } else if (driver.name === 'mysql') {
        proxyExports = buildMysqlProxy();
      }

      if (proxyExports && require.cache) {
        // Inject into require cache
        (require.cache as Record<string, unknown>)[realPath] = {
          id: realPath,
          filename: realPath,
          loaded: true,
          exports: proxyExports,
          parent: null,
          children: [],
          path: realPath,
        };
        logger.info(`JSDB intercepted: require('${driver.name}') → JSDB proxy`);
      }
    } catch {
      // Driver not installed — that's fine, skip
      logger.info(`JSDB register: '${driver.name}' not installed, skipping interception`);
    }
  }
}

function patchEsmModuleCache(): void {
  // In ESM, we can't patch module cache directly.
  // The user must use explicit import aliasing (import ... from 'jsdb/mysql2')
  // OR use the --experimental-loader flag.
  // We log a helpful message here.
  logger.warn(
    'JSDB register: Running in ESM mode. ' +
    'For zero-code interception in ESM, use import maps or explicit driver imports. ' +
    'See docs/COMPATIBILITY_REPORT.md for details.'
  );
}

// ---- Proxy builders ----
// These build synchronous proxy objects that mirror the real driver APIs
// but route through JSDB's execSQL() engine.

function buildMysql2Proxy() {
  // CRITICAL: Do NOT require('./core.js') here at build time.
  // That triggers adapter loading → require('mysql2') → circular dep → OOM.
  // Instead, lazy-load on first actual query call.
  let _core: { execSQL: Function; ensureConnected: Function } | null = null;
  function getCore() {
    if (!_core) {
      _core = require('./core.js') as { execSQL: Function; ensureConnected: Function };
    }
    return _core;
  }

  function createPool(config: Record<string, unknown> = {}) {
    getCore().ensureConnected().catch(() => {});
    return {
      query: async (sql: string, values?: unknown[]) => {
        const r = await getCore().execSQL(sql, values ?? []);
        return [r.rows, r.fields];
      },
      execute: async (sql: string, values?: unknown[]) => {
        const r = await getCore().execSQL(sql, values ?? []);
        return [r.rows, r.fields];
      },
      getConnection: async () => createConnection(),
      end: async () => { const a = await getCore().ensureConnected(); await a.disconnect(); },
      promise: () => createPool(config),
    };
  }

  function createConnection(_config: Record<string, unknown> = {}) {
    let tx: unknown = null;
    return {
      query: async (sql: string, values?: unknown[]) => {
        const r = await getCore().execSQL(sql, values ?? [], tx ?? undefined);
        return [r.rows, r.fields];
      },
      execute: async (sql: string, values?: unknown[]) => {
        const r = await getCore().execSQL(sql, values ?? [], tx ?? undefined);
        return [r.rows, r.fields];
      },
      beginTransaction: async () => {
        const a = await getCore().ensureConnected();
        tx = await a.beginTransaction();
      },
      commit: async () => { await (tx as any)?.commit(); tx = null; },
      rollback: async () => { await (tx as any)?.rollback(); tx = null; },
      release: () => {},
      end: async () => { await (tx as any)?.rollback().catch(() => {}); },
      escape: (v: unknown) => typeof v === 'string' ? `'${v}'` : String(v),
    };
  }

  const proxy = {
    createPool,
    createConnection,
    escape: (v: unknown) => typeof v === 'string' ? `'${v}'` : String(v),
    escapeId: (id: string) => '`' + id + '`',
    format: (sql: string, vals: unknown[] = []) => { let i = 0; return sql.replace(/\?/g, () => String(vals[i++])); },
    promise: { createPool, createConnection },
  };

  // mysql2/promise also uses default export with createPool
  return Object.assign(proxy, { default: proxy });
}

function buildPgProxy() {
  let _core: { execSQL: Function; ensureConnected: Function } | null = null;
  function getCore() {
    if (!_core) {
      _core = require('./core.js') as { execSQL: Function; ensureConnected: Function };
    }
    return _core;
  }

  class Pool {
    constructor(_config?: unknown) {
      getCore().ensureConnected().catch(() => {});
    }
    async query(text: string, values?: unknown[]) {
      const r = await getCore().execSQL(text, values ?? []);
      return { rows: r.rows, fields: r.fields, rowCount: r.rowCount, command: text.trim().split(/\s+/)[0]?.toUpperCase() };
    }
    async connect() { return new Client(); }
    async end() { const a = await getCore().ensureConnected(); await a.disconnect(); }
  }

  class Client {
    async connect() { await getCore().ensureConnected(); }
    async query(text: string, values?: unknown[]) {
      const r = await getCore().execSQL(text, values ?? []);
      return { rows: r.rows, fields: r.fields, rowCount: r.rowCount, command: text.trim().split(/\s+/)[0]?.toUpperCase() };
    }
    async end() {}
    async release() {}
  }

  return Object.assign({ Pool, Client, default: { Pool, Client } }, { Pool, Client });
}

function buildMysqlProxy() {
  let _core: { execSQL: Function; ensureConnected: Function } | null = null;
  function getCore() {
    if (!_core) {
      _core = require('./core.js') as { execSQL: Function; ensureConnected: Function };
    }
    return _core;
  }

  function createConnection(_config?: unknown) {
    return {
      connect: (cb?: (e: Error | null) => void) => getCore().ensureConnected().then(() => cb?.(null)).catch(cb),
      query: (sql: string, valuesOrCb: unknown, cb?: unknown) => {
        const [vals, callback] = typeof valuesOrCb === 'function' ? [[], valuesOrCb] : [valuesOrCb, cb];
        getCore().execSQL(sql, vals as unknown[])
          .then((r: any) => (callback as Function)(null, r.rows, r.fields))
          .catch((e: Error) => (callback as Function)(e));
      },
      end: (cb?: () => void) => cb?.(),
      escape: (v: unknown) => String(v),
    };
  }

  const proxy = { createConnection, escape: (v: unknown) => String(v) };
  return Object.assign(proxy, { default: proxy });
}

// ---- Execute patching at module load time ----
patchRequireCache();

// Start the JSDB adapter connection proactively (lazy require to avoid circular dep)
setTimeout(() => {
  const core = require('./core.js') as typeof import('./core.js');
  core.ensureConnected()
    .then(() => {
      const config = core.getSharedConfig();
      logger.info(
        `JSDB register complete — target database: ${config.database}. ` +
        `All mysql2/pg/mysql calls will route through JSDB.`
      );
    })
    .catch((err: Error) => {
      logger.warn(`JSDB register: adapter connect warning: ${err.message}`);
    });
}, 0);
