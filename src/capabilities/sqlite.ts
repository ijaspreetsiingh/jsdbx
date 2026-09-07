// =====================================================
// JSDB - SQLite Capabilities
// SQLite 3.38+ has JSON functions (json_each, json_extract, etc.)
// =====================================================
import type { CapabilityEntry } from './registry.js';

export const sqliteCapabilities: CapabilityEntry[] = [
  // --- CRUD ---
  { database: 'sqlite', feature: 'crud.find', status: 'native' },
  { database: 'sqlite', feature: 'crud.findOne', status: 'native' },
  { database: 'sqlite', feature: 'crud.insert', status: 'native' },
  { database: 'sqlite', feature: 'crud.insertMany', status: 'native' },
  { database: 'sqlite', feature: 'crud.update', status: 'native' },
  { database: 'sqlite', feature: 'crud.updateMany', status: 'native' },
  { database: 'sqlite', feature: 'crud.delete', status: 'native' },
  { database: 'sqlite', feature: 'crud.deleteMany', status: 'native' },
  { database: 'sqlite', feature: 'crud.count', status: 'native' },

  // --- Filter ---
  { database: 'sqlite', feature: 'filter.eq', status: 'native' },
  { database: 'sqlite', feature: 'filter.ne', status: 'native' },
  { database: 'sqlite', feature: 'filter.comparison', status: 'native' },
  { database: 'sqlite', feature: 'filter.in', status: 'native' },
  { database: 'sqlite', feature: 'filter.and', status: 'native' },
  { database: 'sqlite', feature: 'filter.or', status: 'native' },
  { database: 'sqlite', feature: 'filter.not', status: 'native' },
  { database: 'sqlite', feature: 'filter.like', status: 'native', notes: 'LIKE (case-insensitive for ASCII)' },
  {
    database: 'sqlite',
    feature: 'filter.regex',
    status: 'emulated',
    notes: 'GLOB for simple patterns; LIKE for basic matching',
    limitations: ['No full REGEXP without extension'],
  },
  { database: 'sqlite', feature: 'filter.exists', status: 'native' },
  {
    database: 'sqlite',
    feature: 'filter.elemMatch',
    status: 'emulated',
    notes: 'json_each() subquery (SQLite 3.38+)',
    limitations: ['Requires SQLite 3.38+', 'Column must store JSON array text'],
  },
  {
    database: 'sqlite',
    feature: 'filter.type',
    status: 'emulated',
    notes: 'json_type() function (SQLite 3.38+)',
    limitations: ['Column must store JSON text'],
  },
  {
    database: 'sqlite',
    feature: 'filter.all',
    status: 'emulated',
    notes: 'Multiple json_each() checks',
    limitations: ['Column must be JSON array text'],
  },
  {
    database: 'sqlite',
    feature: 'filter.size',
    status: 'emulated',
    notes: 'json_array_length()',
    limitations: ['Column must be JSON array text'],
  },
  {
    database: 'sqlite',
    feature: 'filter.nested',
    status: 'emulated',
    notes: "json_extract(col, '$.path')",
    limitations: ['Parent column must store JSON text'],
  },

  // --- Sorting / Pagination / Projection ---
  { database: 'sqlite', feature: 'sorting', status: 'native' },
  { database: 'sqlite', feature: 'pagination.limit', status: 'native' },
  { database: 'sqlite', feature: 'pagination.offset', status: 'native' },
  { database: 'sqlite', feature: 'pagination.cursor', status: 'emulated', notes: 'Keyset with rowid or stable column' },
  { database: 'sqlite', feature: 'projection', status: 'native' },
  { database: 'sqlite', feature: 'projection.exclusion', status: 'emulated' },
  {
    database: 'sqlite',
    feature: 'projection.nested',
    status: 'emulated',
    notes: "json_extract(col, '$.path')",
  },

  // --- Aggregation ---
  { database: 'sqlite', feature: 'aggregation', status: 'native' },
  { database: 'sqlite', feature: 'aggregation.match', status: 'native' },
  { database: 'sqlite', feature: 'aggregation.group', status: 'native' },
  { database: 'sqlite', feature: 'aggregation.project', status: 'native' },
  { database: 'sqlite', feature: 'aggregation.sort', status: 'native' },
  { database: 'sqlite', feature: 'aggregation.limit', status: 'native' },
  { database: 'sqlite', feature: 'aggregation.skip', status: 'native' },
  { database: 'sqlite', feature: 'aggregation.lookup', status: 'emulated', notes: 'LEFT JOIN' },
  {
    database: 'sqlite',
    feature: 'aggregation.unwind',
    status: 'emulated',
    notes: 'json_each() (SQLite 3.38+)',
    limitations: ['Requires SQLite 3.38+', 'Column must be JSON array'],
  },
  {
    database: 'sqlite',
    feature: 'aggregation.facet',
    status: 'emulated',
    notes: 'Multiple queries merged in application',
    limitations: ['Not atomic'],
  },
  { database: 'sqlite', feature: 'aggregation.count', status: 'native' },
  { database: 'sqlite', feature: 'aggregation.addFields', status: 'emulated', notes: 'SELECT expressions' },

  // --- Advanced Aggregation ---
  {
    database: 'sqlite',
    feature: 'aggregation.setWindowFields',
    status: 'emulated',
    notes: 'SQLite 3.25.0+ supports basic window functions: RANK(), ROW_NUMBER(), SUM() OVER',
    limitations: ['Requires SQLite 3.25.0+', 'Limited window function support'],
  },
  {
    database: 'sqlite',
    feature: 'aggregation.bucket',
    status: 'emulated',
    notes: 'CASE WHEN emulation',
  },
  {
    database: 'sqlite',
    feature: 'aggregation.bucketAuto',
    status: 'emulated',
    notes: 'NTILE() or manual calculation',
  },
  {
    database: 'sqlite',
    feature: 'aggregation.graphLookup',
    status: 'native',
    notes: 'WITH RECURSIVE CTE (SQLite 3.8.3+)',
  },
  {
    database: 'sqlite',
    feature: 'aggregation.unionWith',
    status: 'emulated',
    notes: 'UNION ALL emulation',
  },
  {
    database: 'sqlite',
    feature: 'aggregation.sample',
    status: 'emulated',
    notes: 'ORDER BY RANDOM() LIMIT n',
  },
  {
    database: 'sqlite',
    feature: 'aggregation.sortByCount',
    status: 'emulated',
    notes: 'GROUP BY + COUNT + ORDER BY',
  },
  {
    database: 'sqlite',
    feature: 'aggregation.redact',
    status: 'emulated',
    notes: 'WHERE clause emulation',
  },
  {
    database: 'sqlite',
    feature: 'aggregation.out',
    status: 'emulated',
    notes: 'CREATE TABLE AS SELECT',
  },
  {
    database: 'sqlite',
    feature: 'aggregation.merge',
    status: 'emulated',
    notes: 'INSERT OR REPLACE',
  },

  // --- Deep Joins ---
  { database: 'sqlite', feature: 'join', status: 'native', notes: 'INNER/LEFT/RIGHT/CROSS JOIN' },
  { database: 'sqlite', feature: 'join.inner', status: 'native' },
  { database: 'sqlite', feature: 'join.left', status: 'native' },
  { database: 'sqlite', feature: 'join.right', status: 'emulated', notes: 'SQLite has limited RIGHT JOIN support' },
  { database: 'sqlite', feature: 'join.cross', status: 'native' },

  // --- Recursive CTE ---
  {
    database: 'sqlite',
    feature: 'recursive.cte',
    status: 'native',
    notes: 'WITH RECURSIVE (SQLite 3.8.3+)',
  },
  { database: 'sqlite', feature: 'recursive.maxDepth', status: 'native', notes: 'WHERE depth < N' },
  { database: 'sqlite', feature: 'recursive.bfs', status: 'emulated', notes: 'Manual level tracking' },
  { database: 'sqlite', feature: 'recursive.cycleDetection', status: 'emulated', notes: 'Manual path tracking' },

  // --- Stored Procedures ---
  {
    database: 'sqlite',
    feature: 'storedProcedure.call',
    status: 'unsupported',
    notes: 'SQLite does not support stored procedures',
  },
  {
    database: 'sqlite',
    feature: 'storedFunction.call',
    status: 'emulated',
    notes: 'Register JS functions via better-sqlite3',
  },

  // --- Real-time ---
  {
    database: 'sqlite',
    feature: 'realtime.watch',
    status: 'emulated',
    notes: 'Polling-based with change tracking',
    limitations: ['Not real-time — depends on poll interval'],
  },
  {
    database: 'sqlite',
    feature: 'realtime.changeStreams',
    status: 'unsupported',
    notes: 'SQLite does not support change streams',
  },
  {
    database: 'sqlite',
    feature: 'realtime.resumeToken',
    status: 'emulated',
    notes: 'Rowid-based resume',
  },

  // --- Batch ---
  { database: 'sqlite', feature: 'batch', status: 'emulated', notes: 'Multiple statements' },

  // --- Transactions ---
  {
    database: 'sqlite',
    feature: 'transactions',
    status: 'native',
    notes: 'Serialized; WAL mode for reads',
    semanticDifferences: ['Single writer at a time'],
  },

  // --- Indexes ---
  { database: 'sqlite', feature: 'index.single', status: 'native' },
  { database: 'sqlite', feature: 'index.compound', status: 'native' },
  { database: 'sqlite', feature: 'index.unique', status: 'native' },
  { database: 'sqlite', feature: 'index.partial', status: 'native', notes: 'WHERE clause indexes' },
  { database: 'sqlite', feature: 'index.fulltext', status: 'native', notes: 'FTS5 virtual table' },
  { database: 'sqlite', feature: 'index.geospatial', status: 'emulated', notes: 'SpatiaLite extension needed' },
  { database: 'sqlite', feature: 'index.ttl', status: 'emulated', notes: 'Application-level cleanup needed' },
];
