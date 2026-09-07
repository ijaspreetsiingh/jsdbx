// =============================================================
// JSDB Node.js ESM Loader Hook
// Enables TRUE zero-source-change integration for ESM projects.
//
// USAGE (zero import changes in your app):
//   node --import jasdbx/loader app.js
//   node --loader jasdbx/loader app.js   (Node < 20.6)
//
// What this does:
//   Any ESM `import` of 'mysql2', 'mysql2/promise', 'pg',
//   'mysql', 'mongodb', 'mongoose' is intercepted and
//   redirected to the JSDB compat proxy BEFORE the real
//   module is loaded.
//
// IMPORTANT HONESTY NOTE:
//   This approach works for ESM. For CJS require(), the
//   existing jsdb/register file patches the require cache.
//   Both are documented below.
//
// INTEGRATION LEVELS (ordered by zero-code-change effort):
//
//   Level 1 — TRUE ZERO CODE CHANGE (ESM):
//     node --import jasdbx/loader your-app.js
//     No source file changes needed at all.
//
//   Level 2 — TRUE ZERO CODE CHANGE (CJS):
//     require('jasdbx/register')  ← add to very top of entry file
//     (One line in ONE file — no other changes)
//
//   Level 3 — ONE LINE PER DRIVER FILE:
//     import mysql from 'jasdbx/mysql2'  (was 'mysql2/promise')
//     import { Pool } from 'jasdbx/pg'   (was 'pg')
//     import { MongoClient } from 'jasdbx/mongodb'  (was 'mongodb')
//     import mongoose from 'jasdbx/mongoose'  (was 'mongoose')
//
//   Level 4 — package.json alias (zero source changes, needs build tool):
//     See docs/ZERO_CODE_CHANGE.md for webpack/vite/tsconfig paths config
// =============================================================

// Resolve the package directory to find our compat modules
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Map of intercepted module specifiers → JSDB compat module paths
const INTERCEPT_MAP = new Map([
  ['mysql2',           path.resolve(__dirname, 'mysql2.js')],
  ['mysql2/promise',   path.resolve(__dirname, 'mysql2.js')],
  ['pg',               path.resolve(__dirname, 'pg.js')],
  ['mysql',            path.resolve(__dirname, 'mysql.js')],
  ['mongodb',          path.resolve(__dirname, 'mongodb.js')],
  ['mongoose',         path.resolve(__dirname, 'mongoose.js')],
  // Also handle the package name itself when published
  ['jasdbx/mysql2',    path.resolve(__dirname, 'mysql2.js')],
  ['jasdbx/pg',        path.resolve(__dirname, 'pg.js')],
  ['jasdbx/mysql',     path.resolve(__dirname, 'mysql.js')],
  ['jasdbx/mongodb',   path.resolve(__dirname, 'mongodb.js')],
  ['jasdbx/mongoose',  path.resolve(__dirname, 'mongoose.js')],
]);

/**
 * Node.js ESM resolve hook.
 * Called for every import specifier before Node resolves the file path.
 * We intercept known driver names and redirect to JSDB compat modules.
 */
export async function resolve(specifier, context, nextResolve) {
  const interceptPath = INTERCEPT_MAP.get(specifier);
  if (interceptPath) {
    // Return the JSDB compat module URL instead of the real driver
    return {
      shortCircuit: true,
      url: pathToFileURL(interceptPath).href,
      format: 'module',
    };
  }
  // All other specifiers resolve normally
  return nextResolve(specifier, context);
}

/**
 * Node.js ESM load hook (optional — for diagnostics).
 */
export async function load(url, context, nextLoad) {
  return nextLoad(url, context);
}
