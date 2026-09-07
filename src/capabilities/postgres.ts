// =====================================================
// JSDB - PostgreSQL Capabilities
// PostgreSQL has excellent JSON support (JSONB)
// Most MongoDB-style ops are emulatable
// =====================================================
import type { CapabilityEntry } from './registry.js';

export const postgresCapabilities: CapabilityEntry[] = [
  // --- CRUD ---
  { database: 'postgres', feature: 'crud.find', status: 'native' },
  { database: 'postgres', feature: 'crud.findOne', status: 'native' },
  { database: 'postgres', feature: 'crud.insert', status: 'native' },
  { database: 'postgres', feature: 'crud.insertMany', status: 'native' },
  { database: 'postgres', feature: 'crud.update', status: 'native' },
  { database: 'postgres', feature: 'crud.updateMany', status: 'native' },
  { database: 'postgres', feature: 'crud.delete', status: 'native' },
  { database: 'postgres', feature: 'crud.deleteMany', status: 'native' },
  { database: 'postgres', feature: 'crud.count', status: 'native' },

  // --- Filter ---
  { database: 'postgres', feature: 'filter.eq', status: 'native' },
  { database: 'postgres', feature: 'filter.ne', status: 'native' },
  { database: 'postgres', feature: 'filter.comparison', status: 'native' },
  { database: 'postgres', feature: 'filter.in', status: 'native' },
  { database: 'postgres', feature: 'filter.and', status: 'native' },
  { database: 'postgres', feature: 'filter.or', status: 'native' },
  { database: 'postgres', feature: 'filter.not', status: 'native' },
  { database: 'postgres', feature: 'filter.like', status: 'native', notes: 'ILIKE for case-insensitive' },
  { database: 'postgres', feature: 'filter.regex', status: 'native', notes: '~ and ~* operators' },
  { database: 'postgres', feature: 'filter.exists', status: 'native' },
  {
    database: 'postgres',
    feature: 'filter.elemMatch',
    status: 'emulated',
    notes: 'jsonb_array_elements() subquery. Column must be JSONB array.',
    limitations: ['Column must be JSONB type'],
  },
  {
    database: 'postgres',
    feature: 'filter.type',
    status: 'emulated',
    notes: 'jsonb_typeof() function',
    limitations: ['Column must be JSONB type'],
  },
  {
    database: 'postgres',
    feature: 'filter.all',
    status: 'emulated',
    notes: "JSONB @> operator: col @> '[val]'::jsonb",
    limitations: ['Column must be JSONB array'],
  },
  {
    database: 'postgres',
    feature: 'filter.size',
    status: 'emulated',
    notes: 'jsonb_array_length()',
    limitations: ['Column must be JSONB array'],
  },
  {
    database: 'postgres',
    feature: 'filter.nested',
    status: 'native',
    notes: "JSONB path: col->'key'->>'subkey'",
  },

  // --- Sorting / Pagination / Projection ---
  { database: 'postgres', feature: 'sorting', status: 'native' },
  { database: 'postgres', feature: 'pagination.limit', status: 'native' },
  { database: 'postgres', feature: 'pagination.offset', status: 'native' },
  { database: 'postgres', feature: 'pagination.cursor', status: 'emulated', notes: 'Keyset pagination' },
  { database: 'postgres', feature: 'projection', status: 'native' },
  { database: 'postgres', feature: 'projection.exclusion', status: 'emulated' },
  { database: 'postgres', feature: 'projection.nested', status: 'native', notes: 'JSONB operators' },

  // --- Aggregation ---
  { database: 'postgres', feature: 'aggregation', status: 'native' },
  { database: 'postgres', feature: 'aggregation.match', status: 'native' },
  { database: 'postgres', feature: 'aggregation.group', status: 'native' },
  { database: 'postgres', feature: 'aggregation.project', status: 'native' },
  { database: 'postgres', feature: 'aggregation.sort', status: 'native' },
  { database: 'postgres', feature: 'aggregation.limit', status: 'native' },
  { database: 'postgres', feature: 'aggregation.skip', status: 'native' },
  { database: 'postgres', feature: 'aggregation.lookup', status: 'native', notes: 'JOIN' },
  {
    database: 'postgres',
    feature: 'aggregation.unwind',
    status: 'emulated',
    notes: 'jsonb_array_elements() lateral join',
    limitations: ['Column must be JSONB array'],
  },
  {
    database: 'postgres',
    feature: 'aggregation.facet',
    status: 'emulated',
    notes: 'Multiple CTEs executed and merged',
    limitations: ['Not atomic'],
  },
  { database: 'postgres', feature: 'aggregation.count', status: 'native' },
  { database: 'postgres', feature: 'aggregation.addFields', status: 'emulated', notes: 'SELECT expressions' },

  // --- Advanced Aggregation ---
  { database: 'postgres', feature: 'aggregation.setWindowFields', status: 'native', notes: 'Full window function support' },
  {
    database: 'postgres',
    feature: 'aggregation.bucket',
    status: 'emulated',
    notes: 'CASE WHEN emulation',
  },
  {
    database: 'postgres',
    feature: 'aggregation.bucketAuto',
    status: 'emulated',
    notes: 'NTILE() or manual calculation',
  },
  {
    database: 'postgres',
    feature: 'aggregation.graphLookup',
    status: 'native',
    notes: 'WITH RECURSIVE CTE',
  },
  {
    database: 'postgres',
    feature: 'aggregation.unionWith',
    status: 'emulated',
    notes: 'UNION ALL emulation',
  },
  {
    database: 'postgres',
    feature: 'aggregation.sample',
    status: 'emulated',
    notes: 'TABLESAMPLE SYSTEM() or ORDER BY RANDOM()',
  },
  {
    database: 'postgres',
    feature: 'aggregation.sortByCount',
    status: 'emulated',
    notes: 'GROUP BY + COUNT + ORDER BY',
  },
  {
    database: 'postgres',
    feature: 'aggregation.redact',
    status: 'emulated',
    notes: 'WHERE clause emulation',
  },
  {
    database: 'postgres',
    feature: 'aggregation.out',
    status: 'emulated',
    notes: 'CREATE TABLE AS SELECT',
  },
  {
    database: 'postgres',
    feature: 'aggregation.merge',
    status: 'emulated',
    notes: 'INSERT ... ON CONFLICT',
  },

  // --- Deep Joins ---
  { database: 'postgres', feature: 'join', status: 'native', notes: 'INNER/LEFT/RIGHT/CROSS JOIN' },
  { database: 'postgres', feature: 'join.inner', status: 'native' },
  { database: 'postgres', feature: 'join.left', status: 'native' },
  { database: 'postgres', feature: 'join.right', status: 'native' },
  { database: 'postgres', feature: 'join.cross', status: 'native' },

  // --- Recursive CTE ---
  {
    database: 'postgres',
    feature: 'recursive.cte',
    status: 'native',
    notes: 'WITH RECURSIVE + SEARCH clause',
  },
  { database: 'postgres', feature: 'recursive.maxDepth', status: 'native', notes: 'WHERE depth < N' },
  { database: 'postgres', feature: 'recursive.bfs', status: 'native', notes: 'SEARCH BREADTH FIRST' },
  { database: 'postgres', feature: 'recursive.cycleDetection', status: 'native', notes: 'CYCLE clause (PostgreSQL 14+)' },

  // --- Stored Procedures ---
  {
    database: 'postgres',
    feature: 'storedProcedure.call',
    status: 'native',
    notes: 'CALL procedure_name()',
  },
  {
    database: 'postgres',
    feature: 'storedFunction.call',
    status: 'native',
    notes: 'SELECT * FROM function_name()',
  },

  // --- Real-time ---
  {
    database: 'postgres',
    feature: 'realtime.watch',
    status: 'native',
    notes: 'LISTEN/NOTIFY with triggers',
  },
  {
    database: 'postgres',
    feature: 'realtime.changeStreams',
    status: 'emulated',
    notes: 'LISTEN/NOTIFY + triggers',
  },
  {
    database: 'postgres',
    feature: 'realtime.resumeToken',
    status: 'emulated',
    notes: 'LSN-based resume',
  },

  // --- Batch ---
  { database: 'postgres', feature: 'batch', status: 'emulated', notes: 'Multiple statements' },

  // --- Transactions ---
  { database: 'postgres', feature: 'transactions', status: 'native', notes: 'Full ACID transactions' },
  { database: 'postgres', feature: 'transactions.isolation', status: 'native' },
  { database: 'postgres', feature: 'transactions.savepoints', status: 'native' },

  // --- Indexes ---
  { database: 'postgres', feature: 'index.single', status: 'native' },
  { database: 'postgres', feature: 'index.compound', status: 'native' },
  { database: 'postgres', feature: 'index.unique', status: 'native' },
  { database: 'postgres', feature: 'index.partial', status: 'native' },
  { database: 'postgres', feature: 'index.fulltext', status: 'native', notes: 'tsvector/tsquery' },
  { database: 'postgres', feature: 'index.geospatial', status: 'native', notes: 'PostGIS' },
  { database: 'postgres', feature: 'index.ttl', status: 'emulated', notes: 'pg_cron or application-level' },
];
