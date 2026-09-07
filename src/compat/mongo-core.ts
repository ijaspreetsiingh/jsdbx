// =====================================================
// JSDB MongoDB → Universal IR Engine
//
// Converts MongoDB-style query objects and aggregation
// pipelines into Universal IR, then executes against
// whatever JSDB_DATABASE is configured.
//
// This is the mirror of execSQL() but for MongoDB queries.
// Existing MongoDB driver code (collection.find({age:{$gt:18}}))
// goes through here instead of execSQL().
// =====================================================

import { ensureConnected, getSharedConfig } from './core.js';
import { queryPlanner } from '../planner/planner.js';
import { createLogger } from '../utils/logger.js';
import type { AdapterTransaction } from '../adapters/base.js';
import type {
  Filter,
  Update,
  Document,
  AggregationStage,
  FindOptions,
} from '../types/index.js';
import type { IRNode } from '../ir/nodes.js';
import type { CompatQueryResult } from './core.js';

const logger = createLogger('info', 'JSDB:mongo-core');

// ---- MongoDB filter → IR filter ----
// MongoDB filters ARE the IR filter format (we designed it that way)
// So this is mostly a pass-through with light normalisation.

function mongoFilterToIR(filter: Record<string, unknown>): Filter {
  return filter as Filter;
}

function mongoUpdateToIR(update: Record<string, unknown>): Update {
  // MongoDB update operators ($set, $inc etc) map 1:1 to IR Update
  const hasOps = Object.keys(update).some(k => k.startsWith('$'));
  if (hasOps) return update as Update;
  // Plain replacement doc — wrap in $set
  return { $set: update } as Update;
}

// ---- Core execMongo ----

export interface MongoFindOptions {
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
  projection?: Record<string, 0 | 1>;
}

export interface MongoWriteResult {
  acknowledged: boolean;
  insertedId?: unknown;
  insertedIds?: unknown[];
  insertedCount?: number;
  matchedCount?: number;
  modifiedCount?: number;
  deletedCount?: number;
  upsertedId?: unknown;
  upsertedCount?: number;
}

/**
 * Execute a MongoDB-style find query against the configured target DB.
 * Used by the MongoClient/Collection proxy.
 */
export async function mongoFind(
  collection: string,
  filter: Record<string, unknown> = {},
  options: MongoFindOptions = {},
  tx?: AdapterTransaction
): Promise<Document[]> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'find',
    collection,
    filter: mongoFilterToIR(filter),
    sort: options.sort as FindOptions['sort'],
    limit: options.limit,
    offset: options.skip ?? 0,
    projection: options.projection as FindOptions['projection'],
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  for (const w of plan.warnings) logger.warn(w);

  const result = await adapter.execute(plan, tx) as { documents: Document[] };
  return result.documents ?? [];
}

export async function mongoFindOne(
  collection: string,
  filter: Record<string, unknown> = {},
  options: Pick<MongoFindOptions, 'projection' | 'sort'> = {},
  tx?: AdapterTransaction
): Promise<Document | null> {
  const docs = await mongoFind(collection, filter, { ...options, limit: 1 }, tx);
  return docs[0] ?? null;
}

export async function mongoInsertOne(
  collection: string,
  doc: Record<string, unknown>,
  tx?: AdapterTransaction
): Promise<MongoWriteResult> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'insert',
    collection,
    document: doc as Document,
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  const result = await adapter.execute(plan, tx) as { insertedId: string; acknowledged: boolean };

  return {
    acknowledged: result.acknowledged ?? true,
    insertedId: result.insertedId,
  };
}

export async function mongoInsertMany(
  collection: string,
  docs: Record<string, unknown>[],
  options: { ordered?: boolean } = {},
  tx?: AdapterTransaction
): Promise<MongoWriteResult> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'insertMany',
    collection,
    documents: docs as Document[],
    ordered: options.ordered ?? true,
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  const result = await adapter.execute(plan, tx) as { insertedIds: string[]; insertedCount: number; acknowledged: boolean };

  return {
    acknowledged: result.acknowledged ?? true,
    insertedIds: result.insertedIds,
    insertedCount: result.insertedCount,
  };
}

export async function mongoUpdateOne(
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  options: { upsert?: boolean } = {},
  tx?: AdapterTransaction
): Promise<MongoWriteResult> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'update',
    collection,
    filter: mongoFilterToIR(filter),
    update: mongoUpdateToIR(update),
    upsert: options.upsert ?? false,
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  const result = await adapter.execute(plan, tx) as { matchedCount: number; modifiedCount: number; upsertedId?: string };

  return {
    acknowledged: true,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
    upsertedId: result.upsertedId,
    upsertedCount: result.upsertedId ? 1 : 0,
  };
}

export async function mongoUpdateMany(
  collection: string,
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  tx?: AdapterTransaction
): Promise<MongoWriteResult> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'updateMany',
    collection,
    filter: mongoFilterToIR(filter),
    update: mongoUpdateToIR(update),
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  const result = await adapter.execute(plan, tx) as { matchedCount: number; modifiedCount: number };

  return {
    acknowledged: true,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}

export async function mongoDeleteOne(
  collection: string,
  filter: Record<string, unknown>,
  tx?: AdapterTransaction
): Promise<MongoWriteResult> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'delete',
    collection,
    filter: mongoFilterToIR(filter),
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  const result = await adapter.execute(plan, tx) as { deletedCount: number; acknowledged: boolean };

  return { acknowledged: result.acknowledged ?? true, deletedCount: result.deletedCount };
}

export async function mongoDeleteMany(
  collection: string,
  filter: Record<string, unknown>,
  tx?: AdapterTransaction
): Promise<MongoWriteResult> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'deleteMany',
    collection,
    filter: mongoFilterToIR(filter),
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  const result = await adapter.execute(plan, tx) as { deletedCount: number; acknowledged: boolean };

  return { acknowledged: result.acknowledged ?? true, deletedCount: result.deletedCount };
}

export async function mongoCountDocuments(
  collection: string,
  filter: Record<string, unknown> = {},
  tx?: AdapterTransaction
): Promise<number> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'count',
    collection,
    filter: mongoFilterToIR(filter),
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  const result = await adapter.execute(plan, tx) as { count: number };
  return result.count ?? 0;
}

export async function mongoAggregate(
  collection: string,
  pipeline: AggregationStage[],
  tx?: AdapterTransaction
): Promise<Document[]> {
  const adapter = await ensureConnected();
  const config = getSharedConfig();

  const ir: IRNode = {
    type: 'aggregate',
    collection,
    pipeline,
    metadata: { timestamp: new Date() },
  };

  const plan = queryPlanner.plan(ir, config.database as import('../types/index.js').DatabaseType);
  const result = await adapter.execute(plan, tx) as { documents: Document[] };
  return result.documents ?? [];
}

export async function mongoCreateCollection(
  name: string,
  options: { ifNotExists?: boolean } = {}
): Promise<void> {
  const adapter = await ensureConnected();
  await adapter.createCollection(name, options);
}

export async function mongoDropCollection(
  name: string,
  options: { ifExists?: boolean } = {}
): Promise<void> {
  const adapter = await ensureConnected();
  await adapter.dropCollection(name, options);
}

export async function mongoListCollections(): Promise<string[]> {
  const adapter = await ensureConnected();
  return adapter.listCollections();
}
