// =====================================================
// JSDB - MongoDB Capabilities
// =====================================================
import type { CapabilityEntry } from './registry.js';

export const mongodbCapabilities: CapabilityEntry[] = [
  // --- CRUD ---
  { database: 'mongodb', feature: 'crud.find', status: 'native' },
  { database: 'mongodb', feature: 'crud.findOne', status: 'native' },
  { database: 'mongodb', feature: 'crud.insert', status: 'native' },
  { database: 'mongodb', feature: 'crud.insertMany', status: 'native' },
  { database: 'mongodb', feature: 'crud.update', status: 'native' },
  { database: 'mongodb', feature: 'crud.updateMany', status: 'native' },
  { database: 'mongodb', feature: 'crud.delete', status: 'native' },
  { database: 'mongodb', feature: 'crud.deleteMany', status: 'native' },
  { database: 'mongodb', feature: 'crud.count', status: 'native' },

  // --- Filter ---
  { database: 'mongodb', feature: 'filter.eq', status: 'native' },
  { database: 'mongodb', feature: 'filter.ne', status: 'native' },
  { database: 'mongodb', feature: 'filter.comparison', status: 'native' },
  { database: 'mongodb', feature: 'filter.in', status: 'native' },
  { database: 'mongodb', feature: 'filter.and', status: 'native' },
  { database: 'mongodb', feature: 'filter.or', status: 'native' },
  { database: 'mongodb', feature: 'filter.nor', status: 'native' },
  { database: 'mongodb', feature: 'filter.not', status: 'native' },
  { database: 'mongodb', feature: 'filter.like', status: 'emulated', notes: 'Implemented via $regex' },
  { database: 'mongodb', feature: 'filter.regex', status: 'native' },
  { database: 'mongodb', feature: 'filter.exists', status: 'native' },
  { database: 'mongodb', feature: 'filter.elemMatch', status: 'native' },
  { database: 'mongodb', feature: 'filter.type', status: 'native', notes: 'BSON type introspection' },
  { database: 'mongodb', feature: 'filter.all', status: 'native' },
  { database: 'mongodb', feature: 'filter.size', status: 'native' },

  // --- Sorting / Pagination / Projection ---
  { database: 'mongodb', feature: 'sorting', status: 'native' },
  { database: 'mongodb', feature: 'pagination.limit', status: 'native' },
  { database: 'mongodb', feature: 'pagination.offset', status: 'native', notes: 'Via skip()' },
  { database: 'mongodb', feature: 'pagination.cursor', status: 'native' },
  { database: 'mongodb', feature: 'projection', status: 'native' },
  { database: 'mongodb', feature: 'projection.exclusion', status: 'native' },
  { database: 'mongodb', feature: 'projection.nested', status: 'native' },
  { database: 'mongodb', feature: 'projection.computed', status: 'native', notes: '$project expressions' },

  // --- Aggregation ---
  { database: 'mongodb', feature: 'aggregation', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.match', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.group', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.project', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.sort', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.limit', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.skip', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.lookup', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.unwind', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.facet', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.bucket', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.count', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.addFields', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.replaceRoot', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.graphLookup', status: 'native' },

  // --- Advanced Aggregation ---
  { database: 'mongodb', feature: 'aggregation.setWindowFields', status: 'native', notes: 'MongoDB 5.0+' },
  { database: 'mongodb', feature: 'aggregation.bucket', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.bucketAuto', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.unionWith', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.sample', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.sortByCount', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.redact', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.out', status: 'native' },
  { database: 'mongodb', feature: 'aggregation.merge', status: 'native' },

  // --- Deep Joins ---
  { database: 'mongodb', feature: 'join', status: 'emulated', notes: 'Via $lookup aggregation' },
  { database: 'mongodb', feature: 'join.inner', status: 'emulated', notes: '$lookup + $unwind' },
  { database: 'mongodb', feature: 'join.left', status: 'native', notes: '$lookup' },
  { database: 'mongodb', feature: 'join.right', status: 'emulated', notes: 'Reverse $lookup' },
  { database: 'mongodb', feature: 'join.cross', status: 'emulated', notes: '$lookup with pipeline' },

  // --- Recursive CTE ---
  {
    database: 'mongodb',
    feature: 'recursive.cte',
    status: 'native',
    notes: '$graphLookup aggregation stage',
  },
  { database: 'mongodb', feature: 'recursive.maxDepth', status: 'native', notes: 'maxDepth option' },
  { database: 'mongodb', feature: 'recursive.bfs', status: 'native', notes: 'depthField tracking' },
  { database: 'mongodb', feature: 'recursive.cycleDetection', status: 'native', notes: 'restrictSearchWith' },

  // --- Stored Procedures ---
  {
    database: 'mongodb',
    feature: 'storedProcedure.call',
    status: 'unsupported',
    notes: 'MongoDB does not support stored procedures',
  },
  {
    database: 'mongodb',
    feature: 'storedFunction.call',
    status: 'unsupported',
    notes: 'MongoDB does not support stored functions',
  },

  // --- Real-time ---
  {
    database: 'mongodb',
    feature: 'realtime.watch',
    status: 'native',
    notes: 'Change Streams (requires replica set)',
    semanticDifferences: ['Requires replica set or sharded cluster'],
  },
  {
    database: 'mongodb',
    feature: 'realtime.changeStreams',
    status: 'native',
    notes: 'Native change streams',
  },
  {
    database: 'mongodb',
    feature: 'realtime.resumeToken',
    status: 'native',
    notes: 'Native resume token support',
  },

  // --- Batch ---
  { database: 'mongodb', feature: 'batch', status: 'emulated', notes: 'Multiple operations via bulkWrite' },

  // --- Transactions ---
  {
    database: 'mongodb',
    feature: 'transactions',
    status: 'native',
    notes: 'Requires replica set; causal consistency',
    semanticDifferences: ['Requires replica set or sharded cluster'],
  },

  // --- Indexes ---
  { database: 'mongodb', feature: 'index.single', status: 'native' },
  { database: 'mongodb', feature: 'index.compound', status: 'native' },
  { database: 'mongodb', feature: 'index.unique', status: 'native' },
  { database: 'mongodb', feature: 'index.partial', status: 'native', notes: 'partialFilterExpression' },
  { database: 'mongodb', feature: 'index.ttl', status: 'native', notes: 'expireAfterSeconds' },
  { database: 'mongodb', feature: 'index.geospatial', status: 'native', notes: '2dsphere/2d' },
  { database: 'mongodb', feature: 'index.text', status: 'native' },
  { database: 'mongodb', feature: 'index.wildcard', status: 'native' },
];
