// =====================================================
// JSDB Interactive Migration Wizard
// Backup current DB → Choose new DB → Restore → Update config
// =====================================================
import * as readline from 'readline';
import chalk from 'chalk';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { loadConfigFromEnv } from '../utils/config.js';
import { createAdapter } from '../adapters/index.js';
import type { DatabaseType, JSDBConfig, Document } from '../types/index.js';
import type { DatabaseAdapter } from '../adapters/base.js';

// =====================================================
// Backup format
// =====================================================

interface BackupMeta {
  version: 1;
  source: DatabaseType;
  database: string;
  timestamp: string;
  collections: BackupCollection[];
}

interface BackupCollection {
  name: string;
  count: number;
  documents: Document[];
}

// =====================================================
// CLI helpers
// =====================================================

function createInterface(): readline.Interface {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function confirm(rl: readline.Interface, question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const answer = await ask(rl, `  ${chalk.cyan('?')} ${question} ${chalk.gray(`[${hint}]`)} `);
  if (answer === '') return defaultYes;
  return /^(y|yes)$/i.test(answer);
}

function log(msg: string): void {
  console.log(`  ${msg}`);
}

function logSuccess(msg: string): void {
  log(chalk.green(`✓  ${msg}`));
}

function logError(msg: string): void {
  log(chalk.red(`✗  ${msg}`));
}

function logInfo(msg: string): void {
  log(chalk.cyan(`ℹ  ${msg}`));
}

function logWarn(msg: string): void {
  log(chalk.yellow(`⚠  ${msg}`));
}

function spinnerStart(msg: string): { succeed: (msg: string) => void; fail: (msg: string) => void } {
  process.stdout.write(`  ${chalk.cyan('⟳')} ${msg}...`);
  return {
    succeed(finalMsg: string) {
      process.stdout.write('\r');
      logSuccess(finalMsg);
    },
    fail(finalMsg: string) {
      process.stdout.write('\r');
      logError(finalMsg);
    },
  };
}

// =====================================================
// Connect to a database with given config
// =====================================================

async function connectToDB(type: DatabaseType, connectionConfig: Record<string, unknown>): Promise<DatabaseAdapter> {
  const config: JSDBConfig = {
    database: type,
    connection: connectionConfig,
  };
  const adapter = createAdapter(config);
  await adapter.connect();
  return adapter;
}

// =====================================================
// Detect current DB config — auto from env, fallback to manual
// =====================================================

function detectCurrentDBType(): DatabaseType | null {
  // 1. Check process.env directly (already loaded)
  const db = process.env.JSDB_DATABASE as DatabaseType | undefined;
  if (db && ['mysql', 'mongodb', 'postgres', 'sqlite'].includes(db)) return db;

  // 2. Check .env file exists and parse it
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (key === 'JSDB_DATABASE' && val && ['mysql', 'mongodb', 'postgres', 'sqlite'].includes(val)) {
        return val as DatabaseType;
      }
    }
  }

  // 3. Check common config file names
  const configFiles = [
    'jsdb.config.ts', 'jsdb.config.js', 'jsdb.config.mjs',
    'jsdb.config.cjs', 'jsdb.config.json',
  ];
  for (const file of configFiles) {
    const p = join(process.cwd(), file);
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      // Look for database: 'xxx' or database: "xxx"
      const match = content.match(/database\s*[:=]\s*['"](\w+)['"]/);
      if (match && ['mysql', 'mongodb', 'postgres', 'sqlite'].includes(match[1])) {
        return match[1] as DatabaseType;
      }
    }
  }

  return null;
}

function detectCurrentDBConfig(type: DatabaseType): Record<string, unknown> {
  const config = loadConfigFromEnv();
  if (config.connection && Object.keys(config.connection).length > 0) {
    return config.connection as Record<string, unknown>;
  }
  return {};
}

function hasCompleteCredentials(type: DatabaseType, config: Record<string, unknown>): boolean {
  switch (type) {
    case 'mongodb':
      return !!(config.uri);
    case 'mysql':
      return !!(config.host && config.database);
    case 'postgres':
      return !!(config.connectionString || config.database);
    case 'sqlite':
      return !!(config.filename);
    default:
      return false;
  }
}

// =====================================================
// BACKUP: Dump all collections/tables from source DB
// =====================================================

async function backupDatabase(adapter: DatabaseAdapter, dbName: string): Promise<BackupCollection[]> {
  const collections = await adapter.listCollections();
  const results: BackupCollection[] = [];

  for (const collName of collections) {
    const sp = spinnerStart(`Backing up "${collName}"`);
    try {
      // Fetch all documents in batches of 1000
      const allDocs: Document[] = [];
      let skip = 0;
      const batchSize = 1000;
      while (true) {
        const result = await adapter.find(collName, {}, { limit: batchSize, skip, sort: { _id: 1 } });
        allDocs.push(...result.documents);
        if (result.documents.length < batchSize) break;
        skip += batchSize;
      }
      results.push({ name: collName, count: allDocs.length, documents: allDocs });
      sp.succeed(`Backed up "${collName}" — ${allDocs.length} documents`);
    } catch (err) {
      sp.fail(`Failed to backup "${collName}": ${(err as Error).message}`);
      results.push({ name: collName, count: 0, documents: [] });
    }
  }

  return results;
}

// =====================================================
// RESTORE: Insert all data into target DB
// =====================================================

async function restoreDatabase(adapter: DatabaseAdapter, backup: BackupMeta): Promise<void> {
  for (const coll of backup.collections) {
    if (coll.documents.length === 0) {
      logWarn(`Skipping empty collection "${coll.name}"`);
      continue;
    }

    const sp = spinnerStart(`Restoring "${coll.name}" (${coll.documents.length} documents)`);
    try {
      // Create collection/table
      await adapter.createCollection(coll.name, { ifNotExists: true });

      // Insert in batches of 500
      const batchSize = 500;
      let inserted = 0;
      for (let i = 0; i < coll.documents.length; i += batchSize) {
        const batch = coll.documents.slice(i, i + batchSize);
        // Remove _id if target is SQL (it has auto-increment id)
        // But keep _id for MongoDB
        const docs = adapter.type === 'mongodb'
          ? batch
          : batch.map((d) => {
              const { _id, id, ...rest } = d;
              // Keep id if it exists, otherwise use _id as id
              if (id !== undefined) return { id, ...rest };
              if (_id !== undefined) return { id: _id, ...rest };
              return rest;
            });
        await adapter.insertMany(coll.name, docs, { ordered: true });
        inserted += docs.length;
      }

      sp.succeed(`Restored "${coll.name}" — ${inserted} documents`);
    } catch (err) {
      sp.fail(`Failed to restore "${coll.name}": ${(err as Error).message}`);
    }
  }
}

// =====================================================
// Update .env file
// =====================================================

function updateEnvFile(cwd: string, newType: DatabaseType, creds: Record<string, string>): void {
  const envPath = join(cwd, '.env');
  let lines: string[] = [];

  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf-8');
    lines = content.split('\n');
  }

  // Remove old JSDB_ lines
  lines = lines.filter((l) => !l.trim().startsWith('JSDB_'));

  // Add new JSDB_ lines
  const newLines = generateEnvLines(newType, creds);
  lines.push('', '# JSDB Configuration (auto-generated by migrate wizard)', ...newLines);

  writeFileSync(envPath, lines.join('\n') + '\n');
}

function generateEnvLines(db: DatabaseType, creds: Record<string, string>): string[] {
  switch (db) {
    case 'mongodb':
      return [
        `JSDB_DATABASE=mongodb`,
        `JSDB_MONGODB_URI=${creds.uri ?? 'mongodb://localhost:27017'}`,
        `JSDB_MONGODB_DATABASE=${creds.database ?? 'myapp'}`,
        `JSDB_LOG_LEVEL=info`,
        `JSDB_CACHE=memory`,
      ];
    case 'mysql':
      return [
        `JSDB_DATABASE=mysql`,
        `JSDB_MYSQL_HOST=${creds.host ?? 'localhost'}`,
        `JSDB_MYSQL_PORT=${creds.port ?? '3306'}`,
        `JSDB_MYSQL_DATABASE=${creds.database ?? 'myapp'}`,
        `JSDB_MYSQL_USER=${creds.user ?? 'root'}`,
        `JSDB_MYSQL_PASSWORD=${creds.password ?? ''}`,
        `JSDB_LOG_LEVEL=info`,
        `JSDB_CACHE=memory`,
      ];
    case 'postgres':
      return [
        `JSDB_DATABASE=postgres`,
        `JSDB_POSTGRES_URL=${creds.url ?? 'postgresql://postgres:password@localhost:5432/myapp'}`,
        `JSDB_LOG_LEVEL=info`,
        `JSDB_CACHE=memory`,
      ];
    case 'sqlite':
      return [
        `JSDB_DATABASE=sqlite`,
        `JSDB_SQLITE_PATH=${creds.path ?? './data.db'}`,
        `JSDB_LOG_LEVEL=info`,
        `JSDB_CACHE=memory`,
      ];
    default:
      return [];
  }
}

// =====================================================
// Update jsdb.config.ts
// =====================================================

function updateConfigFile(cwd: string, newType: DatabaseType): void {
  const configPath = join(cwd, 'jsdb.config.ts');
  const template = `import type { JSDBConfig } from 'jasdbx';

const config: JSDBConfig = {
  database: '${newType}',
  // connection: { ... } // Override .env settings here if needed
  pool: {
    min: 2,
    max: 10,
  },
  logging: {
    level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
    logQueries: process.env.NODE_ENV !== 'production',
  },
  cache: {
    provider: 'memory',
    ttlSeconds: 300,
  },
};

export default config;
`;
  writeFileSync(configPath, template);
}

// =====================================================
// Ask user which DB they're currently using (manual fallback)
// =====================================================

async function askSourceDBType(rl: readline.Interface): Promise<DatabaseType> {
  log('  What database are you currently using?\n');
  log('    1) MongoDB');
  log('    2) MySQL');
  log('    3) PostgreSQL');
  log('    4) SQLite');
  console.log('');

  const choice = await ask(rl, `  ${chalk.cyan('?')} Enter choice [1-4]: `);
  const dbMap: Record<string, DatabaseType> = { '1': 'mongodb', '2': 'mysql', '3': 'postgres', '4': 'sqlite' };
  const type = dbMap[choice];

  if (!type) {
    logError('Invalid choice. Please enter 1, 2, 3, or 4.');
    return askSourceDBType(rl);
  }

  return type;
}

// =====================================================
// Collect source DB credentials (when auto-detect fails)
// =====================================================

async function collectSourceCredentials(rl: readline.Interface, dbType: DatabaseType): Promise<Record<string, unknown>> {
  const creds: Record<string, unknown> = {};

  log(chalk.bold(`\n  Enter ${dbType.toUpperCase()} connection details:\n`));

  switch (dbType) {
    case 'mongodb': {
      const uri = await ask(rl, `  ${chalk.cyan('?')} MongoDB URI ${chalk.gray('[mongodb://localhost:27017]')}: `);
      creds.uri = uri || 'mongodb://localhost:27017';
      const db = await ask(rl, `  ${chalk.cyan('?')} Database name ${chalk.gray('[myapp]')}: `);
      creds.database = db || 'myapp';
      break;
    }
    case 'mysql': {
      const host = await ask(rl, `  ${chalk.cyan('?')} Host ${chalk.gray('[localhost]')}: `);
      creds.host = host || 'localhost';
      const port = await ask(rl, `  ${chalk.cyan('?')} Port ${chalk.gray('[3306]')}: `);
      creds.port = parseInt(port || '3306', 10);
      const db = await ask(rl, `  ${chalk.cyan('?')} Database name ${chalk.gray('[myapp]')}: `);
      creds.database = db || 'myapp';
      const user = await ask(rl, `  ${chalk.cyan('?')} Username ${chalk.gray('[root]')}: `);
      creds.user = user || 'root';
      const pass = await ask(rl, `  ${chalk.cyan('?')} Password ${chalk.gray('[]')}: `);
      creds.password = pass || '';
      break;
    }
    case 'postgres': {
      const url = await ask(rl, `  ${chalk.cyan('?')} Connection URL ${chalk.gray('[postgresql://postgres:password@localhost:5432/myapp]')}: `);
      if (url) {
        creds.connectionString = url;
      } else {
        creds.connectionString = 'postgresql://postgres:password@localhost:5432/myapp';
      }
      break;
    }
    case 'sqlite': {
      const path = await ask(rl, `  ${chalk.cyan('?')} Database file path ${chalk.gray('[./data.db]')}: `);
      creds.filename = path || './data.db';
      break;
    }
  }

  return creds;
}

// =====================================================
// Collect new DB credentials
// =====================================================

async function collectCredentials(rl: readline.Interface, dbType: DatabaseType): Promise<Record<string, string>> {
  const creds: Record<string, string> = {};

  log(chalk.bold(`\n  Configure ${dbType.toUpperCase()} connection:\n`));

  switch (dbType) {
    case 'mongodb': {
      creds.uri = await ask(rl, `  ${chalk.cyan('?')} MongoDB URI ${chalk.gray('[mongodb://localhost:27017]')}: `);
      if (!creds.uri) creds.uri = 'mongodb://localhost:27017';
      creds.database = await ask(rl, `  ${chalk.cyan('?')} Database name ${chalk.gray('[myapp]')}: `);
      if (!creds.database) creds.database = 'myapp';
      break;
    }
    case 'mysql': {
      creds.host = await ask(rl, `  ${chalk.cyan('?')} Host ${chalk.gray('[localhost]')}: `);
      if (!creds.host) creds.host = 'localhost';
      creds.port = await ask(rl, `  ${chalk.cyan('?')} Port ${chalk.gray('[3306]')}: `);
      if (!creds.port) creds.port = '3306';
      creds.database = await ask(rl, `  ${chalk.cyan('?')} Database name ${chalk.gray('[myapp]')}: `);
      if (!creds.database) creds.database = 'myapp';
      creds.user = await ask(rl, `  ${chalk.cyan('?')} Username ${chalk.gray('[root]')}: `);
      if (!creds.user) creds.user = 'root';
      creds.password = await ask(rl, `  ${chalk.cyan('?')} Password ${chalk.gray('[]')}: `);
      break;
    }
    case 'postgres': {
      creds.url = await ask(rl, `  ${chalk.cyan('?')} Connection URL ${chalk.gray('[postgresql://postgres:password@localhost:5432/myapp]')}: `);
      if (!creds.url) creds.url = 'postgresql://postgres:password@localhost:5432/myapp';
      break;
    }
    case 'sqlite': {
      creds.path = await ask(rl, `  ${chalk.cyan('?')} Database file path ${chalk.gray('[./data.db]')}: `);
      if (!creds.path) creds.path = './data.db';
      break;
    }
  }

  return creds;
}

// =====================================================
// MAIN: Interactive migration wizard
// =====================================================

export async function runMigrationWizard(): Promise<void> {
  const rl = createInterface();
  const cwd = process.cwd();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  console.log(chalk.bold.cyan('\n  ╔══════════════════════════════════════════╗'));
  console.log(chalk.bold.cyan('  ║     JSDB Database Migration Wizard       ║'));
  console.log(chalk.bold.cyan('  ╚══════════════════════════════════════════╝\n'));

  // ---- Step 1: Detect current DB ----
  const detectedType = detectCurrentDBType();
  let currentType: DatabaseType;
  let currentConfig: Record<string, unknown>;

  if (detectedType) {
    currentType = detectedType;
    currentConfig = detectCurrentDBConfig(detectedType);

    if (hasCompleteCredentials(detectedType, currentConfig)) {
      logInfo(`Current database: ${chalk.bold(detectedType.toUpperCase())} (auto-detected from .env)`);
    } else {
      logWarn(`Detected ${detectedType.toUpperCase()} but credentials incomplete.`);
      logInfo('Let me help you connect — answer a few questions:\n');
      currentConfig = await collectSourceCredentials(rl, detectedType);
    }
  } else {
    logWarn('No database configuration found (.env / env vars / config file)');
    logInfo('Let\'s set up your current database connection:\n');
    currentType = await askSourceDBType(rl);
    currentConfig = await collectSourceCredentials(rl, currentType);
  }

  // ---- Step 2: Ask to backup ----
  const doBackup = await confirm(rl, 'Do you want to backup your current database?', true);

  let backup: BackupMeta | null = null;

  if (doBackup) {
    console.log('');
    log(chalk.bold('Connecting to source database...'));
    let sourceAdapter: DatabaseAdapter;
    try {
      sourceAdapter = await connectToDB(currentType, currentConfig);
    } catch (err) {
      logError(`Cannot connect to ${currentType}: ${(err as Error).message}`);
      logInfo('Check your credentials and make sure the database is running.');
      rl.close();
      return;
    }

    logSuccess(`Connected to ${currentType}`);

    // Backup
    console.log('');
    log(chalk.bold('Starting backup...'));
    const collections = await backupDatabase(sourceAdapter, currentType);

    const totalDocs = collections.reduce((sum, c) => sum + c.count, 0);
    const totalCollections = collections.length;

    // Save backup to file
    const backupDir = join(cwd, `jsdb-backup-${timestamp}`);
    mkdirSync(backupDir, { recursive: true });

    backup = {
      version: 1,
      source: currentType,
      database: (currentConfig.database ?? currentConfig.uri ?? 'unknown') as string,
      timestamp: new Date().toISOString(),
      collections,
    };

    const backupPath = join(backupDir, 'backup.json');
    writeFileSync(backupPath, JSON.stringify(backup, null, 2));

    console.log('');
    logSuccess(`Backup complete: ${totalCollections} collections, ${totalDocs} total documents`);
    logInfo(`Backup saved to: ${backupDir}/backup.json`);

    await sourceAdapter.disconnect();
  }

  // ---- Step 3: Choose new database ----
  console.log('');
  log(chalk.bold('Select new database type:\n'));
  log('  1) MongoDB');
  log('  2) MySQL');
  log('  3) PostgreSQL');
  log('  4) SQLite');
  console.log('');

  const choice = await ask(rl, `  ${chalk.cyan('?')} Enter choice [1-4]: `);
  const dbMap: Record<string, DatabaseType> = { '1': 'mongodb', '2': 'mysql', '3': 'postgres', '4': 'sqlite' };
  const newType = dbMap[choice];

  if (!newType) {
    logError('Invalid choice. Please enter 1, 2, 3, or 4.');
    rl.close();
    return;
  }

  logInfo(`Target database: ${chalk.bold(newType.toUpperCase())}`);

  // ---- Step 4: Collect credentials ----
  const creds = await collectCredentials(rl, newType);

  // ---- Step 5: Test connection to new DB ----
  console.log('');
  log(chalk.bold('Testing connection to new database...'));
  let targetAdapter: DatabaseAdapter;
  try {
    targetAdapter = await connectToDB(newType, creds as unknown as Record<string, unknown>);
    logSuccess(`Connected to ${newType}`);
    await targetAdapter.disconnect();
  } catch (err) {
    logError(`Cannot connect to ${newType}: ${(err as Error).message}`);
    logWarn('Continuing anyway — you can fix credentials later.');
  }

  // ---- Step 6: Update config files ----
  console.log('');
  log(chalk.bold('Updating configuration files...'));

  // Update .env
  updateEnvFile(cwd, newType, creds);
  logSuccess('.env updated');

  // Update jsdb.config.ts
  updateConfigFile(cwd, newType);
  logSuccess('jsdb.config.ts updated');

  // ---- Step 7: Restore backup ----
  if (backup && backup.collections.length > 0) {
    const doRestore = await confirm(rl, `Restore backup to ${newType.toUpperCase()}?`, true);

    if (doRestore) {
      console.log('');
      log(chalk.bold(`Restoring to ${newType.toUpperCase()}...`));

      // Update env for restore so adapter picks up new config
      process.env.JSDB_DATABASE = newType;
      // Clear old env vars
      for (const key of Object.keys(process.env)) {
        if (key.startsWith('JSDB_') && key !== 'JSDB_DATABASE') {
          delete process.env[key];
        }
      }
      // Set new env vars
      switch (newType) {
        case 'mongodb':
          process.env.JSDB_MONGODB_URI = creds.uri;
          process.env.JSDB_MONGODB_DATABASE = creds.database;
          break;
        case 'mysql':
          process.env.JSDB_MYSQL_HOST = creds.host;
          process.env.JSDB_MYSQL_PORT = creds.port;
          process.env.JSDB_MYSQL_DATABASE = creds.database;
          process.env.JSDB_MYSQL_USER = creds.user;
          process.env.JSDB_MYSQL_PASSWORD = creds.password;
          break;
        case 'postgres':
          process.env.JSDB_POSTGRES_URL = creds.url;
          break;
        case 'sqlite':
          process.env.JSDB_SQLITE_PATH = creds.path;
          break;
      }

      let restoreAdapter: DatabaseAdapter;
      try {
        restoreAdapter = await connectToDB(newType, creds as unknown as Record<string, unknown>);
      } catch (err) {
        logError(`Cannot connect to ${newType} for restore: ${(err as Error).message}`);
        rl.close();
        return;
      }

      await restoreDatabase(restoreAdapter, backup);
      await restoreAdapter.disconnect();

      console.log('');
      logSuccess(`Migration complete! ${backup.collections.length} collections restored to ${newType.toUpperCase()}`);
    }
  }

  // ---- Done ----
  console.log('');
  log(chalk.bold.green('  Migration wizard finished!'));
  log('');
  log('  Next steps:');
  log('    1. Verify your data: npx jasdbx db:test');
  log('    2. Check config: npx jasdbx doctor');
  log('    3. Start your app with the new database');
  console.log('');

  rl.close();
}
