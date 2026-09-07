// =====================================================
// JSDB CLI
// npx jsdb init | doctor | db:test | schema | migrate |
//          analyze | analyze:performance | analyze:security
// =====================================================
import { Command } from 'commander';
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { loadConfigFromEnv } from '../utils/config.js';
import { portabilityAnalyzer } from '../analyzers/portability.js';
import { securityAnalyzer } from '../analyzers/security.js';
import { createAdapter } from '../adapters/index.js';
import type { DatabaseType } from '../types/index.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('jasdbx')
  .description('JasDBX - JavaScript Database Runtime CLI')
  .version(VERSION);

// ---- init ----
program
  .command('init')
  .description('Initialize JSDB in the current project')
  .option('--db <type>', 'Database type: mysql|mongodb|postgres|sqlite', 'mysql')
  .action(async (opts) => {
    console.log(chalk.cyan('\n  JSDB Init\n'));

    const cwd = process.cwd();
    const envPath = join(cwd, '.env');

    if (existsSync(envPath)) {
      console.log(chalk.yellow('  .env already exists — not overwriting'));
    } else {
      const template = generateEnvTemplate(opts.db as DatabaseType);
      writeFileSync(envPath, template);
      console.log(chalk.green('  ✓  Created .env'));
    }

    // Create jsdb.config.ts if not exists
    const configPath = join(cwd, 'jsdb.config.ts');
    if (!existsSync(configPath)) {
      writeFileSync(configPath, generateConfigTemplate(opts.db as DatabaseType));
      console.log(chalk.green('  ✓  Created jsdb.config.ts'));
    }

    console.log(chalk.green('\n  JSDB initialized! Next steps:'));
    console.log('    1. Edit .env with your database credentials');
    console.log('    2. Run: npx jasdbx doctor');
    console.log('    3. Run: npx jasdbx db:test\n');
  });

// ---- doctor ----
program
  .command('doctor')
  .description('Check JSDB configuration and environment')
  .action(async () => {
    console.log(chalk.cyan('\n  JSDB Doctor\n'));

    const config = loadConfigFromEnv();
    const checks: Array<{ name: string; pass: boolean; message: string }> = [];

    // Check database type
    const validDbs = ['mysql', 'mongodb', 'postgres', 'sqlite'];
    checks.push({
      name: 'JSDB_DATABASE',
      pass: validDbs.includes(config.database ?? ''),
      message: config.database ? `Set to "${config.database}"` : 'Not set! Set JSDB_DATABASE in .env',
    });

    // Check connection config
    if (config.database === 'mysql') {
      const conn = config.connection as Record<string, unknown>;
      checks.push({
        name: 'MySQL host',
        pass: !!(conn?.host),
        message: conn?.host ? String(conn.host) : 'JSDB_HOST not set',
      });
      checks.push({
        name: 'MySQL database',
        pass: !!(conn?.database),
        message: conn?.database ? String(conn.database) : 'JSDB_DATABASE_NAME not set',
      });
    }

    if (config.database === 'mongodb') {
      const conn = config.connection as Record<string, unknown>;
      checks.push({
        name: 'MongoDB URI',
        pass: !!(conn?.uri),
        message: conn?.uri ? 'Set' : 'JSDB_MONGO_URI not set',
      });
    }

    if (config.database === 'sqlite') {
      const conn = config.connection as Record<string, unknown>;
      checks.push({
        name: 'SQLite path',
        pass: !!(conn?.filename),
        message: conn?.filename ? String(conn.filename) : 'JSDB_SQLITE_PATH not set',
      });
    }

    // Driver availability
    const driverCheck = await checkDriverInstalled(config.database as DatabaseType);
    checks.push(driverCheck);

    // Print results
    for (const check of checks) {
      const icon = check.pass ? chalk.green('  ✓') : chalk.red('  ✗');
      const msg = check.pass ? chalk.white(check.message) : chalk.red(check.message);
      console.log(`${icon}  ${check.name}: ${msg}`);
    }

    const failCount = checks.filter((c) => !c.pass).length;
    if (failCount === 0) {
      console.log(chalk.green('\n  All checks passed!\n'));
    } else {
      console.log(chalk.red(`\n  ${failCount} check(s) failed. Fix the issues above.\n`));
    }
  });

// ---- db:test ----
program
  .command('db:test')
  .description('Test database connectivity')
  .action(async () => {
    console.log(chalk.cyan('\n  JSDB Database Test\n'));

    const config = loadConfigFromEnv();
    console.log(`  Testing connection to: ${chalk.bold(config.database?.toUpperCase())}`);

    try {
      const adapter = createAdapter(config as Parameters<typeof createAdapter>[0]);
      await adapter.connect();
      const ok = await adapter.ping();
      await adapter.disconnect();

      if (ok) {
        console.log(chalk.green('  ✓  Connection successful!\n'));
      } else {
        console.log(chalk.red('  ✗  Ping returned false\n'));
      }
    } catch (err) {
      console.log(chalk.red(`  ✗  Connection failed: ${(err as Error).message}\n`));
    }
  });

// ---- analyze ----
program
  .command('analyze')
  .description('Run JSDB portability analysis')
  .option('--db <type>', 'Database to analyze (default: from env)')
  .action(async (opts) => {
    const config = loadConfigFromEnv();
    const db = (opts.db ?? config.database ?? 'mysql') as DatabaseType;

    console.log(chalk.cyan('\n  JSDB Portability Analysis\n'));

    const analysis = portabilityAnalyzer.analyze(db);
    console.log(portabilityAnalyzer.formatReport(analysis));
  });

// ---- analyze:performance ----
program
  .command('analyze:performance')
  .description('Analyze query performance patterns')
  .action(async () => {
    console.log(chalk.cyan('\n  JSDB Performance Analysis\n'));
    console.log('  Run your application with performance tracking enabled.');
    console.log('  Then query: db.getObservability() for collected metrics.\n');
    console.log('  For live analysis, use:');
    console.log('    JSDB_DEV_MODE=true npx jasdbx db:test\n');
  });

// ---- analyze:security ----
program
  .command('analyze:security')
  .description('Run JSDB security configuration analysis')
  .action(async () => {
    const config = loadConfigFromEnv();
    console.log(chalk.cyan('\n  JSDB Security Analysis\n'));

    const report = securityAnalyzer.analyze({
      hasAuthentication: false,
      hasAuthorization: false,
      hasRateLimit: false,
      hasInputValidation: false,
      tenancyEnabled: config.tenancy?.enabled,
      auditLogEnabled: config.logging?.level === 'debug',
      tlsEnabled: false,
    });

    console.log(securityAnalyzer.formatReport(report));
  });

// ---- schema ----
program
  .command('schema')
  .description('Display or validate schema')
  .option('--validate <file>', 'Validate a schema file')
  .action(async (opts) => {
    console.log(chalk.cyan('\n  JSDB Schema\n'));

    if (opts.validate) {
      if (!existsSync(opts.validate)) {
        console.log(chalk.red(`  File not found: ${opts.validate}`));
        return;
      }
      const content = readFileSync(opts.validate, 'utf-8');
      try {
        const schema = JSON.parse(content);
        const { SchemaEngine } = await import('../schema/engine.js');
        for (const [, colSchema] of Object.entries(schema.collections ?? {})) {
          const errors = SchemaEngine.validate(colSchema as Parameters<typeof SchemaEngine.validate>[0]);
          if (errors.length > 0) {
            console.log(chalk.red(`  Schema errors:`));
            errors.forEach((e: string) => console.log(chalk.red(`    - ${e}`)));
          } else {
            console.log(chalk.green(`  ✓  Schema is valid`));
          }
        }
      } catch (err) {
        console.log(chalk.red(`  Invalid JSON: ${(err as Error).message}`));
      }
    } else {
      console.log('  Use --validate <schema.json> to validate a schema file');
      console.log('  See docs/SCHEMA.md for schema format\n');
    }
  });

// ---- migrate ----
program
  .command('migrate')
  .description('Run database migrations')
  .option('--from <db>', 'Source database for migration assistant')
  .option('--to <db>', 'Target database for migration assistant')
  .option('--dry-run', 'Preview migrations without applying')
  .option('--rollback [steps]', 'Rollback N migrations')
  .action(async (opts) => {
    console.log(chalk.cyan('\n  JSDB Migrate\n'));

    if (opts.from && opts.to) {
      console.log(`  Migration Assistant: ${opts.from.toUpperCase()} → ${opts.to.toUpperCase()}`);
      console.log(chalk.yellow('\n  Migration assistant requires a running source database.'));
      console.log('  Use the MigrationEngine API in your code for programmatic migrations.');
      console.log('  See docs/MIGRATION.md for details.\n');
      return;
    }

    console.log('  To run migrations programmatically:');
    console.log('');
    console.log('    import { MigrationEngine } from "jasdbx";');
    console.log('    const engine = new MigrationEngine();');
    console.log('    engine.register({ id: "001", name: "create_users", up: async (ctx) => { ... } });');
    console.log('    await engine.run(ctx);');
    console.log('\n  See docs/MIGRATION.md for full documentation.\n');
  });

// ---- migrate:interactive ----
program
  .command('migrate:interactive')
  .description('Interactive migration wizard — backup current DB, switch to new DB, restore data')
  .action(async () => {
    const { runMigrationWizard } = await import('./migrate.js');
    await runMigrationWizard();
  });

// ---- adapter ----
program
  .command('adapter')
  .description('Manage database adapters')
  .action(() => {
    console.log(chalk.cyan('\n  JSDB Adapter Management\n'));
    console.log('  Available adapters: mysql | mongodb | postgres | sqlite');
    console.log('  To add a database driver:');
    console.log('    npm install mysql2        # MySQL');
    console.log('    npm install mongodb       # MongoDB');
    console.log('    npm install pg            # PostgreSQL');
    console.log('    npm install better-sqlite3 # SQLite\n');
  });

program.parse(process.argv);

// ---- Helpers ----

async function checkDriverInstalled(db: DatabaseType): Promise<{ name: string; pass: boolean; message: string }> {
  const drivers: Record<DatabaseType, string> = {
    mysql: 'mysql2',
    mongodb: 'mongodb',
    postgres: 'pg',
    sqlite: 'better-sqlite3',
  };
  const driver = drivers[db] ?? '';
  try {
    await import(driver);
    return { name: `${driver} driver`, pass: true, message: 'Installed' };
  } catch {
    return { name: `${driver} driver`, pass: false, message: `Not installed. Run: npm install ${driver}` };
  }
}

function generateEnvTemplate(db: DatabaseType): string {
  const templates: Record<DatabaseType, string> = {
    mysql: `# JSDB Configuration
JSDB_DATABASE=mysql
JSDB_HOST=localhost
JSDB_PORT=3306
JSDB_DATABASE_NAME=myapp
JSDB_USER=root
JSDB_PASSWORD=
JSDB_LOG_LEVEL=info
JSDB_CACHE=memory
`,
    mongodb: `# JSDB Configuration
JSDB_DATABASE=mongodb
JSDB_MONGO_URI=mongodb://localhost:27017
JSDB_DATABASE_NAME=myapp
JSDB_LOG_LEVEL=info
JSDB_CACHE=memory
`,
    postgres: `# JSDB Configuration
JSDB_DATABASE=postgres
JSDB_HOST=localhost
JSDB_PORT=5432
JSDB_DATABASE_NAME=myapp
JSDB_USER=postgres
JSDB_PASSWORD=
JSDB_LOG_LEVEL=info
JSDB_CACHE=memory
`,
    sqlite: `# JSDB Configuration
JSDB_DATABASE=sqlite
JSDB_SQLITE_PATH=./data.db
JSDB_LOG_LEVEL=info
JSDB_CACHE=memory
`,
  };
  return templates[db] ?? templates.sqlite;
}

function generateConfigTemplate(db: DatabaseType): string {
  return `import type { JSDBConfig } from 'jasdbx';

const config: JSDBConfig = {
  database: '${db}',
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
}
