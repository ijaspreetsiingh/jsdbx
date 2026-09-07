// =====================================================
// JSDB - MySQL Capabilities
// All previously "unsupported" ops are now "emulated"
// via JSON functions (MySQL 8.0+)
// =====================================================
import type { CapabilityEntry } from './registry.js';

export const mysqlCapabilities: CapabilityEntry[] = [
  // --- CRUD ---
  { database: 'mysql', feature: 'crud.find', status: 'native', notes: 'SELECT with filters' },
  { database: 'mysql', feature: 'crud.findOne', status: 'native', notes: 'SELECT ... LIMIT 1' },
  { database: 'mysql', feature: 'crud.insert', status: 'native', notes: 'INSERT INTO' },
  { database: 'mysql', feature: 'crud.insertMany', status: 'native', notes: 'Multi-row INSERT' },
  { database: 'mysql', feature: 'crud.update', status: 'native', notes: 'UPDATE ... LIMIT 1' },
  { database: 'mysql', feature: 'crud.updateMany', status: 'native', notes: 'UPDATE' },
  { database: 'mysql', feature: 'crud.delete', status: 'native', notes: 'DELETE ... LIMIT 1' },
  { database: 'mysql', feature: 'crud.deleteMany', status: 'native', notes: 'DELETE' },
  { database: 'mysql', feature: 'crud.count', status: 'native', notes: 'SELECT COUNT(*)' },

  // --- Filter ---
  { database: 'mysql', feature: 'filter.eq', status: 'native' },
  { database: 'mysql', feature: 'filter.ne', status: 'native' },
  { database: 'mysql', feature: 'filter.comparison', status: 'native', notes: '> >= < <=' },
  { database: 'mysql', feature: 'filter.in', status: 'native', notes: 'IN / NOT IN' },
  { database: 'mysql', feature: 'filter.and', status: 'native' },
  { database: 'mysql', feature: 'filter.or', status: 'native' },
  { database: 'mysql', feature: 'filter.not', status: 'native' },
  { database: 'mysql', feature: 'filter.like', status: 'native', notes: 'LIKE / ILIKE via LOWER()' },
  { database: 'mysql', feature: 'filter.regex', status: 'native', notes: 'REGEXP' },
  { database: 'mysql', feature: 'filter.exists', status: 'native', notes: 'IS NULL / IS NOT NULL' },
  {
    database: 'mysql',
    feature: 'filter.elemMatch',
    status: 'emulated',
    notes: 'JSON_TABLE subquery (MySQL 8.0+). Column must be JSON type.',
    limitations: ['Requires MySQL 8.0+', 'Column must store JSON array'],
  },
  {
    database: 'mysql',
    feature: 'filter.type',
    status: 'emulated',
    notes: 'JSON_TYPE() function. Works on JSON columns.',
    limitations: ['Column must be JSON type'],
  },
  {
    database: 'mysql',
    feature: 'filter.all',
    status: 'emulated',
    notes: 'JSON_CONTAINS() per element',
    limitations: ['Column must be JSON array'],
  },
  {
    database: 'mysql',
    feature: 'filter.size',
    status: 'emulated',
    notes: 'JSON_LENGTH()',
    limitations: ['Column must be JSON array'],
  },

  // --- Nested field access ---
  {
    database: 'mysql',
    feature: 'filter.nested',
    status: 'emulated',
    notes: 'JSON_EXTRACT(col, "$.path") for dotted field paths',
    limitations: ['Parent column must be JSON type'],
  },

  // --- Sorting / Pagination / Projection ---
  { database: 'mysql', feature: 'sorting', status: 'native', notes: 'ORDER BY' },
  { database: 'mysql', feature: 'pagination.limit', status: 'native', notes: 'LIMIT' },
  { database: 'mysql', feature: 'pagination.offset', status: 'native', notes: 'OFFSET' },
  {
    database: 'mysql',
    feature: 'pagination.cursor',
    status: 'emulated',
    notes: 'Keyset pagination with stable sort column',
  },
  { database: 'mysql', feature: 'projection', status: 'native', notes: 'SELECT col1, col2' },
  {
    database: 'mysql',
    feature: 'projection.exclusion',
    status: 'emulated',
    notes: 'Field complement computed client-side',
  },
  {
    database: 'mysql',
    feature: 'projection.nested',
    status: 'emulated',
    notes: 'JSON_EXTRACT for dotted paths',
    limitations: ['Only for JSON columns'],
  },

  // --- Aggregation ---
  { database: 'mysql', feature: 'aggregation', status: 'native' },
  { database: 'mysql', feature: 'aggregation.match', status: 'native', notes: 'WHERE' },
  { database: 'mysql', feature: 'aggregation.group', status: 'native', notes: 'GROUP BY' },
  { database: 'mysql', feature: 'aggregation.project', status: 'native', notes: 'SELECT expressions' },
  { database: 'mysql', feature: 'aggregation.sort', status: 'native', notes: 'ORDER BY' },
  { database: 'mysql', feature: 'aggregation.limit', status: 'native', notes: 'LIMIT' },
  { database: 'mysql', feature: 'aggregation.skip', status: 'native', notes: 'OFFSET' },
  {
    database: 'mysql',
    feature: 'aggregation.lookup',
    status: 'emulated',
    notes: 'LEFT JOIN — from/localField/foreignField required',
    limitations: ['Ad-hoc pipeline joins only with explicit fields'],
  },
  {
    database: 'mysql',
    feature: 'aggregation.unwind',
    status: 'emulated',
    notes: 'JSON_TABLE (MySQL 8.0+). Column must be JSON array.',
    limitations: ['Requires MySQL 8.0+', 'Column must be JSON array type'],
  },
  {
    database: 'mysql',
    feature: 'aggregation.facet',
    status: 'emulated',
    notes: 'Multiple queries executed sequentially and merged',
    limitations: ['Not atomic — results from separate queries'],
  },
  { database: 'mysql', feature: 'aggregation.count', status: 'native', notes: 'COUNT(*)' },
  { database: 'mysql', feature: 'aggregation.addFields', status: 'emulated', notes: 'SELECT expressions' },

  // --- Advanced Aggregation ---
  {
    database: 'mysql',
    feature: 'aggregation.setWindowFields',
    status: 'native',
    notes: 'MySQL 8.0+ window functions: RANK(), ROW_NUMBER(), SUM() OVER, etc.',
    limitations: ['Requires MySQL 8.0+'],
  },
  {
    database: 'mysql',
    feature: 'aggregation.bucket',
    status: 'emulated',
    notes: 'CASE WHEN emulation',
  },
  {
    database: 'mysql',
    feature: 'aggregation.bucketAuto',
    status: 'emulated',
    notes: 'Approximated via NTILE() or manual calculation',
  },
  {
    database: 'mysql',
    feature: 'aggregation.graphLookup',
    status: 'emulated',
    notes: 'Recursive CTE emulation (MySQL 8.0+)',
    limitations: ['Requires MySQL 8.0+'],
  },
  {
    database: 'mysql',
    feature: 'aggregation.unionWith',
    status: 'emulated',
    notes: 'UNION ALL emulation',
  },
  {
    database: 'mysql',
    feature: 'aggregation.sample',
    status: 'emulated',
    notes: 'ORDER BY RAND() LIMIT n',
  },
  {
    database: 'mysql',
    feature: 'aggregation.sortByCount',
    status: 'emulated',
    notes: 'GROUP BY + COUNT + ORDER BY',
  },
  {
    database: 'mysql',
    feature: 'aggregation.redact',
    status: 'emulated',
    notes: 'WHERE clause emulation',
  },
  {
    database: 'mysql',
    feature: 'aggregation.out',
    status: 'emulated',
    notes: 'CREATE TABLE AS SELECT',
  },
  {
    database: 'mysql',
    feature: 'aggregation.merge',
    status: 'emulated',
    notes: 'INSERT ... ON DUPLICATE KEY UPDATE',
  },

  // --- Deep Joins ---
  { database: 'mysql', feature: 'join', status: 'native', notes: 'INNER/LEFT/RIGHT/CROSS JOIN' },
  { database: 'mysql', feature: 'join.inner', status: 'native' },
  { database: 'mysql', feature: 'join.left', status: 'native' },
  { database: 'mysql', feature: 'join.right', status: 'native' },
  { database: 'mysql', feature: 'join.cross', status: 'native' },

  // --- Recursive CTE ---
  {
    database: 'mysql',
    feature: 'recursive.cte',
    status: 'native',
    notes: 'WITH RECURSIVE (MySQL 8.0+)',
    limitations: ['Requires MySQL 8.0+'],
  },
  { database: 'mysql', feature: 'recursive.maxDepth', status: 'native', notes: 'WHERE depth < N' },
  { database: 'mysql', feature: 'recursive.bfs', status: 'emulated', notes: 'Manual level tracking' },
  { database: 'mysql', feature: 'recursive.cycleDetection', status: 'emulated', notes: 'Manual path tracking' },

  // --- Stored Procedures ---
  {
    database: 'mysql',
    feature: 'storedProcedure.call',
    status: 'native',
    notes: 'CALL procedure_name()',
  },
  {
    database: 'mysql',
    feature: 'storedFunction.call',
    status: 'native',
    notes: 'SELECT function_name()',
  },

  // --- Real-time ---
  {
    database: 'mysql',
    feature: 'realtime.watch',
    status: 'emulated',
    notes: 'Polling-based with change tracking table',
    limitations: ['Not real-time — depends on poll interval'],
  },
  {
    database: 'mysql',
    feature: 'realtime.changeStreams',
    status: 'unsupported',
    notes: 'MySQL does not support change streams natively',
  },
  {
    database: 'mysql',
    feature: 'realtime.resumeToken',
    status: 'emulated',
    notes: 'Timestamp-based resume',
  },

  // --- Batch ---
  { database: 'mysql', feature: 'batch', status: 'emulated', notes: 'Multiple statements separated by ;' },

  // --- Transactions ---
  { database: 'mysql', feature: 'transactions', status: 'native', notes: 'Full ACID transactions' },
  { database: 'mysql', feature: 'transactions.isolation', status: 'native' },
  { database: 'mysql', feature: 'transactions.savepoints', status: 'native' },

  // --- Indexes ---
  { database: 'mysql', feature: 'index.single', status: 'native' },
  { database: 'mysql', feature: 'index.compound', status: 'native' },
  { database: 'mysql', feature: 'index.unique', status: 'native' },
  { database: 'mysql', feature: 'index.partial', status: 'native', notes: 'CREATE INDEX ... WHERE' },
  { database: 'mysql', feature: 'index.fulltext', status: 'native', notes: 'FULLTEXT INDEX' },
  {
    database: 'mysql',
    feature: 'index.geospatial',
    status: 'emulated',
    notes: 'MySQL SPATIAL index (limited vs PostGIS/MongoDB)',
    limitations: ['Only basic 2D operations'],
  },
  {
    database: 'mysql',
    feature: 'index.ttl',
    status: 'emulated',
    notes: 'Use MySQL Events scheduler as approximation',
    limitations: ['Not automatic — requires scheduled job'],
  },
];
