// =====================================================
// JSDB Compatibility Layer — Index
// =====================================================

export { execSQL, ensureConnected, getSharedAdapter, setSharedAdapter, getSharedConfig, resetSharedAdapter } from './core.js';
export type { CompatQueryResult } from './core.js';

// MongoDB direction exports
export {
  mongoFind, mongoFindOne, mongoInsertOne, mongoInsertMany,
  mongoUpdateOne, mongoUpdateMany, mongoDeleteOne, mongoDeleteMany,
  mongoCountDocuments, mongoAggregate, mongoCreateCollection,
  mongoDropCollection, mongoListCollections,
} from './mongo-core.js';
export type { MongoFindOptions, MongoWriteResult } from './mongo-core.js';
