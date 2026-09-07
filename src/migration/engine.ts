// =====================================================
// JSDB - Migration Engine
// =====================================================
import { createHash } from 'crypto';
import { JSDBMigrationError } from '../errors/index.js';
import { createLogger } from '../utils/logger.js';
import type { MigrationDefinition, MigrationRecord, DatabaseType } from '../types/index.js';

const MIGRATIONS_TABLE = '__jsdb_migrations';
const MIGRATIONS_COLLECTION = '__jsdb_migrations';

export interface MigrationContext {
  database: DatabaseType;
  executeRaw: (sql: string, params?: unknown[]) => Promise<unknown>;
  find: (collection: string, filter: Record<string, unknown>) => Promise<unknown[]>;
  insert: (collection: string, doc: Record<string, unknown>) => Promise<unknown>;
  delete: (collection: string, filter: Record<string, unknown>) => Promise<unknown>;
}

export class MigrationEngine {
  private migrations: MigrationDefinition[] = [];
  private logger = createLogger('info', 'JSDB:Migration');

  register(migration: MigrationDefinition): void {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.id.localeCompare(b.id));
  }

  registerMany(migrations: MigrationDefinition[]): void {
    migrations.forEach((m) => this.register(m));
  }

  private checksum(migration: MigrationDefinition): string {
    return createHash('sha256')
      .update(migration.id + migration.name + migration.up.toString())
      .digest('hex')
      .slice(0, 16);
  }

  async ensureMigrationsTable(ctx: MigrationContext): Promise<void> {
    if (ctx.database === 'mongodb') {
      // MongoDB: collection is created on first insert
      return;
    }

    const sql = ctx.database === 'mysql' || ctx.database === 'sqlite'
      ? `CREATE TABLE IF NOT EXISTS \`${MIGRATIONS_TABLE}\` (
          \`id\` VARCHAR(255) PRIMARY KEY,
          \`name\` VARCHAR(500) NOT NULL,
          \`applied_at\` DATETIME DEFAULT CURRENT_TIMESTAMP,
          \`checksum\` VARCHAR(64) NOT NULL
        )`
      : `CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
          "id" VARCHAR(255) PRIMARY KEY,
          "name" VARCHAR(500) NOT NULL,
          "applied_at" TIMESTAMPTZ DEFAULT NOW(),
          "checksum" VARCHAR(64) NOT NULL
        )`;

    await ctx.executeRaw(sql);
  }

  async getAppliedMigrations(ctx: MigrationContext): Promise<MigrationRecord[]> {
    if (ctx.database === 'mongodb') {
      const docs = await ctx.find(MIGRATIONS_COLLECTION, {});
      return (docs as Array<Record<string, unknown>>).map((d) => ({
        id: d.id as string,
        name: d.name as string,
        appliedAt: new Date(d.appliedAt as string),
        checksum: d.checksum as string,
      }));
    }

    const rows = await ctx.executeRaw(
      `SELECT id, name, applied_at, checksum FROM ${ctx.database === 'sqlite' ? '"' + MIGRATIONS_TABLE + '"' : '`' + MIGRATIONS_TABLE + '`'} ORDER BY id ASC`
    ) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      appliedAt: new Date(r.applied_at as string),
      checksum: r.checksum as string,
    }));
  }

  async run(ctx: MigrationContext, options?: { dryRun?: boolean; target?: string }): Promise<{ applied: string[]; skipped: string[]; errors: string[] }> {
    await this.ensureMigrationsTable(ctx);
    const applied = await this.getAppliedMigrations(ctx);
    const appliedIds = new Set(applied.map((m) => m.id));

    const toApply = this.migrations.filter((m) => {
      if (appliedIds.has(m.id)) return false;
      if (options?.target && m.id > options.target) return false;
      return true;
    });

    const results = { applied: [] as string[], skipped: [] as string[], errors: [] as string[] };

    for (const migration of toApply) {
      if (options?.dryRun) {
        results.applied.push(migration.id);
        this.logger.info(`[DRY RUN] Would apply migration: ${migration.id} - ${migration.name}`);
        continue;
      }

      try {
        this.logger.info(`Applying migration: ${migration.id} - ${migration.name}`);
        await migration.up(ctx);

        // Record migration
        if (ctx.database === 'mongodb') {
          await ctx.insert(MIGRATIONS_COLLECTION, {
            id: migration.id,
            name: migration.name,
            appliedAt: new Date().toISOString(),
            checksum: this.checksum(migration),
          });
        } else {
          const tableName = ctx.database === 'sqlite' ? `"${MIGRATIONS_TABLE}"` : `\`${MIGRATIONS_TABLE}\``;
          await ctx.executeRaw(
            `INSERT INTO ${tableName} (id, name, checksum) VALUES (?, ?, ?)`,
            [migration.id, migration.name, this.checksum(migration)]
          );
        }

        results.applied.push(migration.id);
        this.logger.info(`Migration applied: ${migration.id}`);
      } catch (err) {
        const msg = `Migration ${migration.id} failed: ${(err as Error).message}`;
        results.errors.push(msg);
        this.logger.error(msg);
        throw new JSDBMigrationError(msg, err as Error);
      }
    }

    return results;
  }

  async rollback(ctx: MigrationContext, steps = 1): Promise<string[]> {
    const applied = await this.getAppliedMigrations(ctx);
    const toRollback = applied.slice(-steps).reverse();
    const rolled: string[] = [];

    for (const record of toRollback) {
      const migration = this.migrations.find((m) => m.id === record.id);
      if (!migration?.down) {
        this.logger.warn(`Migration ${record.id} has no down() — skipping rollback`);
        continue;
      }

      this.logger.info(`Rolling back migration: ${record.id}`);
      await migration.down(ctx);

      // Remove record
      if (ctx.database === 'mongodb') {
        await ctx.delete(MIGRATIONS_COLLECTION, { id: record.id });
      } else {
        const tableName = ctx.database === 'sqlite' ? `"${MIGRATIONS_TABLE}"` : `\`${MIGRATIONS_TABLE}\``;
        await ctx.executeRaw(`DELETE FROM ${tableName} WHERE id = ?`, [record.id]);
      }

      rolled.push(record.id);
    }

    return rolled;
  }

  getMigrations(): MigrationDefinition[] {
    return [...this.migrations];
  }
}
