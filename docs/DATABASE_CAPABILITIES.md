# Database Capabilities Matrix

**Per-database classification: Native / Emulated / Unsupported**

---

## Legend

| Status | Meaning |
|--------|---------|
| ✅ **Native** | Database directly supports operation; direct translation |
| 🔄 **Emulated** | Framework provides reliable alternative; documented limitations |
| ❌ **Unsupported** | Operation cannot be safely ported; throws `UNSUPPORTED_OPERATION` error |

---

## MySQL Capabilities

### CRUD Operations

| Operation | Status | Notes |
|-----------|--------|-------|
| `insertOne` | ✅ Native | `INSERT INTO` |
| `insertMany` | ✅ Native | Multi-row `INSERT` |
| `findOne` | ✅ Native | `SELECT ... LIMIT 1` |
| `find` | ✅ Native | `SELECT` with filters |
| `updateOne` | ✅ Native | `UPDATE ... LIMIT 1` |
| `updateMany` | ✅ Native | `UPDATE` |
| `deleteOne` | ✅ Native | `DELETE ... LIMIT 1` |
| `deleteMany` | ✅ Native | `DELETE` |
| `countDocuments` | ✅ Native | `SELECT COUNT(*)` |

### Filtering

| Operator | Status | Notes |
|----------|--------|-------|
| `$eq` / `$ne` | ✅ Native | `=`, `!=` |
| `$gt` / `$gte` / `$lt` / `$lte` | ✅ Native | `>`, `>=`, `<`, `<=` |
| `$in` / `$nin` | ✅ Native | `IN`, `NOT IN` |
| `$and` / `$or` / `$not` | ✅ Native | `AND`, `OR`, `NOT` |
| `$like` | ✅ Native | `LIKE` (case-insensitive with `LOWER()`) |
| `$regex` | ✅ Native | `REGEXP` |
| `$exists` | ✅ Native | `IS NULL` / `IS NOT NULL` |
| `$type` | ❌ Unsupported | No JSON type introspection in SQL |
| `$elemMatch` | ❌ Unsupported | Requires JSON functions (emulated later) |

### Sorting

| Feature | Status | Notes |
|---------|--------|-------|
| Single field | ✅ Native | `ORDER BY field ASC/DESC` |
| Multi-field | ✅ Native | `ORDER BY a, b DESC` |
| Nested field | 🔄 Emulated | JSON_EXTRACT for JSON columns |

### Pagination

| Feature | Status | Notes |
|---------|--------|-------|
| `limit` | ✅ Native | `LIMIT n` |
| `offset` | ✅ Native | `OFFSET n` |
| Cursor-based | ✅ Native | `WHERE id > ? ORDER BY id LIMIT n` |

### Projection

| Feature | Status | Notes |
|---------|--------|-------|
| Field inclusion | ✅ Native | `SELECT field1, field2` |
| Field exclusion | 🔄 Emulated | `SELECT * EXCEPT(field)` (MySQL 8.0+) or compute complement |
| Nested projection | 🔄 Emulated | `JSON_EXTRACT` for JSON columns |

### Aggregation (Basic)

| Stage | Status | Notes |
|-------|--------|-------|
| `$match` | ✅ Native | `WHERE` |
| `$group` (count/sum/avg/min/max) | ✅ Native | `GROUP BY` + aggregate functions |
| `$project` | ✅ Native | `SELECT` expressions |
| `$sort` | ✅ Native | `ORDER BY` |
| `$limit` | ✅ Native | `LIMIT` |
| `$skip` | ✅ Native | `OFFSET` |
| `$lookup` (basic) | ✅ Native | `JOIN` with foreign keys |
| `$unwind` | ✅ Native | `JOIN` with JSON_TABLE or lateral join |
| `$facet` | ✅ Native | Multiple subqueries with UNION ALL |
| `$bucket` / `$bucketAuto` | ✅ Native | Window functions + CASE |
| `$sortByCount` | ✅ Native | `GROUP BY` + `COUNT` + `ORDER BY` |
| `$sample` | ✅ Native | `ORDER BY RAND() LIMIT n` |
| `$setWindowFields` | ✅ Native | Window functions (MySQL 8.0+) |
| `$graphLookup` | 🔄 Emulated | Recursive CTE |

### Advanced Features

| Feature | Status | Notes |
|---------|--------|-------|
| Deep Joins | ✅ Native | `INNER JOIN`, `LEFT JOIN`, `RIGHT JOIN`, `CROSS JOIN` |
| Recursive CTE | ✅ Native | `WITH RECURSIVE` (MySQL 8.0+) |
| Window Functions | ✅ Native | `RANK()`, `ROW_NUMBER()`, `SUM() OVER`, etc. |
| Stored Procedures | ✅ Native | `CALL procedure_name()` |
| Stored Functions | ✅ Native | `SELECT function_name()` |
| Cursor Pagination | ✅ Native | Keyset pagination |
| Query Batching | ✅ Native | Multiple queries in single roundtrip |

### Transactions

| Feature | Status | Notes |
|---------|--------|-------|
| ACID transactions | ✅ Native | `BEGIN`, `COMMIT`, `ROLLBACK` |
| Isolation levels | ✅ Native | `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE` |
| Savepoints | ✅ Native | `SAVEPOINT`, `RELEASE`, `ROLLBACK TO` |

### Indexes

| Feature | Status | Notes |
|---------|--------|-------|
| Single field | ✅ Native | `CREATE INDEX` |
| Compound | ✅ Native | `CREATE INDEX (a, b)` |
| Unique | ✅ Native | `CREATE UNIQUE INDEX` |
| Partial/Filtered | ✅ Native | `CREATE INDEX ... WHERE` |
| Full-text | ✅ Native | `FULLTEXT INDEX` |
| JSON path | 🔄 Emulated | Functional index on `JSON_EXTRACT` |

---

## MongoDB Capabilities

### CRUD Operations

| Operation | Status | Notes |
|-----------|--------|-------|
| `insertOne` | ✅ Native | `insertOne()` |
| `insertMany` | ✅ Native | `insertMany()` |
| `findOne` | ✅ Native | `findOne()` |
| `find` | ✅ Native | `find()` |
| `updateOne` | ✅ Native | `updateOne()` |
| `updateMany` | ✅ Native | `updateMany()` |
| `deleteOne` | ✅ Native | `deleteOne()` |
| `deleteMany` | ✅ Native | `deleteMany()` |
| `countDocuments` | ✅ Native | `countDocuments()` |

### Filtering

| Operator | Status | Notes |
|----------|--------|-------|
| `$eq` / `$ne` | ✅ Native | Direct match |
| `$gt` / `$gte` / `$lt` / `$lte` | ✅ Native | Comparison |
| `$in` / `$nin` | ✅ Native | `$in`, `$nin` |
| `$and` / `$or` / `$not` / `$nor` | ✅ Native | Logical operators |
| `$regex` | ✅ Native | `$regex` |
| `$exists` | ✅ Native | `$exists` |
| `$type` | ✅ Native | `$type` (BSON type) |
| `$elemMatch` | ✅ Native | `$elemMatch` for arrays |
| `$all` | ✅ Native | `$all` |
| `$size` | ✅ Native | `$size` |
| `$text` | ✅ Native | `$text` search |

### Sorting

| Feature | Status | Notes |
|---------|--------|-------|
| Single field | ✅ Native | `{ field: 1 }` |
| Multi-field | ✅ Native | `{ a: 1, b: -1 }` |
| Nested field | ✅ Native | `{ "address.city": 1 }` |
| Text score | ✅ Native | `{ $meta: "textScore" }` |

### Pagination

| Feature | Status | Notes |
|---------|--------|-------|
| `limit` | ✅ Native | `limit(n)` |
| `offset` | ✅ Native | `skip(n)` |
| Cursor-based | ✅ Native | `find().sort({_id:1}).limit(n)` + range query |

### Projection

| Feature | Status | Notes |
|---------|--------|-------|
| Field inclusion | ✅ Native | `{ field: 1 }` |
| Field exclusion | ✅ Native | `{ field: 0 }` |
| Nested projection | ✅ Native | `{ "address.city": 1 }` |
| Array slice | ✅ Native | `{ tags: { $slice: 5 } }` |
| Computed fields | ✅ Native | `$project` with expressions |

### Aggregation

| Stage | Status | Notes |
|-------|--------|-------|
| `$match` | ✅ Native | |
| `$group` | ✅ Native | Full accumulator support |
| `$project` | ✅ Native | |
| `$addFields` | ✅ Native | |
| `$sort` | ✅ Native | |
| `$limit` | ✅ Native | |
| `$skip` | ✅ Native | |
| `$lookup` | ✅ Native | Left outer join to other collections |
| `$unwind` | ✅ Native | Deconstruct arrays |
| `$facet` | ✅ Native | Multiple pipelines |
| `$bucket` / `$bucketAuto` | ✅ Native | |
| `$sortByCount` | ✅ Native | |
| `$sample` | ✅ Native | Random sampling |
| `$graphLookup` | ✅ Native | Recursive search |
| `$setWindowFields` | ✅ Native | Window functions (MongoDB 5.0+) |
| `$unionWith` | ✅ Native | Union with other collections |
| `$redact` | ✅ Native | Field-level access control |
| `$out` / `$merge` | ✅ Native | Write results to collection |

### Advanced Features

| Feature | Status | Notes |
|---------|--------|-------|
| Deep Joins | ✅ Native | `$lookup` with nested arrays |
| Recursive CTE | ✅ Native | `$graphLookup` |
| Window Functions | ✅ Native | `$setWindowFields` |
| Stored Procedures | ❌ Unsupported | MongoDB doesn't support stored procedures |
| Cursor Pagination | ✅ Native | Range queries on `_id` |
| Change Streams | ✅ Native | Real-time change notifications |
| Query Batching | ✅ Native | Bulk operations |

### Transactions

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-document transactions | ✅ Native | Replica set required; causal consistency |
| Snapshot isolation | ✅ Native | Default for transactions |
| Retryable writes | ✅ Native | Automatic retry on transient errors |

### Indexes

| Feature | Status | Notes |
|---------|--------|-------|
| Single field | ✅ Native | |
| Compound | ✅ Native | |
| Unique | ✅ Native | |
| Partial | ✅ Native | `partialFilterExpression` |
| Text | ✅ Native | |
| Geospatial (2dsphere, 2d) | ✅ Native | |
| TTL | ✅ Native | `expireAfterSeconds` |
| Wildcard | ✅ Native | `wildcardProjection` |
| Array | ✅ Native | Automatic for array fields |

---

## PostgreSQL Capabilities

### CRUD Operations

| Operation | Status | Notes |
|-----------|--------|-------|
| `insertOne` | ✅ Native | `INSERT INTO` |
| `insertMany` | ✅ Native | Multi-row `INSERT` |
| `findOne` | ✅ Native | `SELECT ... LIMIT 1` |
| `find` | ✅ Native | `SELECT` with filters |
| `updateOne` | ✅ Native | `UPDATE ... LIMIT 1` |
| `updateMany` | ✅ Native | `UPDATE` |
| `deleteOne` | ✅ Native | `DELETE ... LIMIT 1` |
| `deleteMany` | ✅ Native | `DELETE` |
| `countDocuments` | ✅ Native | `SELECT COUNT(*)` |

### Filtering

| Operator | Status | Notes |
|----------|--------|-------|
| `$eq` / `$ne` | ✅ Native | `=`, `!=` |
| `$gt` / `$gte` / `$lt` / `$lte` | ✅ Native | `>`, `>=`, `<`, `<=` |
| `$in` / `$nin` | ✅ Native | `IN`, `NOT IN` |
| `$and` / `$or` / `$not` | ✅ Native | `AND`, `OR`, `NOT` |
| `$like` | ✅ Native | `LIKE` |
| `$regex` | ✅ Native | `~` (POSIX regex) |
| `$exists` | ✅ Native | `IS NULL` / `IS NOT NULL` |

### Sorting

| Feature | Status | Notes |
|---------|--------|-------|
| Single field | ✅ Native | `ORDER BY field ASC/DESC` |
| Multi-field | ✅ Native | `ORDER BY a, b DESC` |
| Nested field | ✅ Native | JSONB path access |

### Pagination

| Feature | Status | Notes |
|---------|--------|-------|
| `limit` | ✅ Native | `LIMIT n` |
| `offset` | ✅ Native | `OFFSET n` |
| Cursor-based | ✅ Native | Keyset pagination |

### Aggregation

| Stage | Status | Notes |
|-------|--------|-------|
| `$match` | ✅ Native | `WHERE` |
| `$group` | ✅ Native | `GROUP BY` + aggregate functions |
| `$project` | ✅ Native | `SELECT` expressions |
| `$sort` | ✅ Native | `ORDER BY` |
| `$limit` | ✅ Native | `LIMIT` |
| `$skip` | ✅ Native | `OFFSET` |
| `$lookup` | ✅ Native | `LEFT JOIN` |
| `$unwind` | ✅ Native | `LATERAL JOIN` + `jsonb_array_elements` |
| `$facet` | ✅ Native | Multiple subqueries |
| `$bucket` / `$bucketAuto` | ✅ Native | Window functions |
| `$setWindowFields` | ✅ Native | Window functions |

### Advanced Features

| Feature | Status | Notes |
|---------|--------|-------|
| Deep Joins | ✅ Native | All join types |
| Recursive CTE | ✅ Native | `WITH RECURSIVE` |
| Window Functions | ✅ Native | Full support |
| Stored Procedures | ✅ Native | `CALL procedure_name()` |
| Stored Functions | ✅ Native | `SELECT function_name()` |
| Cursor Pagination | ✅ Native | Keyset pagination |
| LISTEN/NOTIFY | ✅ Native | Real-time notifications |
| Query Batching | ✅ Native | Multiple queries |

### Transactions

| Feature | Status | Notes |
|---------|--------|-------|
| ACID transactions | ✅ Native | Full support |
| Isolation levels | ✅ Native | `READ COMMITTED`, `REPEATABLE READ`, `SERIALIZABLE` |
| Savepoints | ✅ Native | `SAVEPOINT`, `RELEASE`, `ROLLBACK TO` |

### Indexes

| Feature | Status | Notes |
|---------|--------|-------|
| Single field | ✅ Native | |
| Compound | ✅ Native | |
| Unique | ✅ Native | |
| Partial | ✅ Native | `WHERE` clause |
| Full-text | ✅ Native | `tsvector` + `tsquery` |
| GiST / GIN | ✅ Native | For complex types |
| BRIN | ✅ Native | Block range index |

---

## SQLite Capabilities

### CRUD Operations

| Operation | Status | Notes |
|-----------|--------|-------|
| `insertOne` | ✅ Native | `INSERT INTO` |
| `insertMany` | ✅ Native | Transaction-wrapped inserts |
| `findOne` | ✅ Native | `SELECT ... LIMIT 1` |
| `find` | ✅ Native | `SELECT` with filters |
| `updateOne` | ✅ Native | `UPDATE ... LIMIT 1` |
| `updateMany` | ✅ Native | `UPDATE` |
| `deleteOne` | ✅ Native | `DELETE ... LIMIT 1` |
| `deleteMany` | ✅ Native | `DELETE` |
| `countDocuments` | ✅ Native | `SELECT COUNT(*)` |

### Filtering

| Operator | Status | Notes |
|----------|--------|-------|
| `$eq` / `$ne` | ✅ Native | `=`, `!=` |
| `$gt` / `$gte` / `$lt` / `$lte` | ✅ Native | `>`, `>=`, `<`, `<=` |
| `$in` / `$nin` | ✅ Native | `IN`, `NOT IN` |
| `$and` / `$or` / `$not` | ✅ Native | `AND`, `OR`, `NOT` |
| `$like` | ✅ Native | `LIKE` |
| `$regex` | ❌ Unsupported | No native regex |
| `$exists` | ✅ Native | `IS NULL` / `IS NOT NULL` |

### Aggregation

| Stage | Status | Notes |
|-------|--------|-------|
| `$match` | ✅ Native | `WHERE` |
| `$group` | ✅ Native | `GROUP BY` + aggregate functions |
| `$project` | ✅ Native | `SELECT` expressions |
| `$sort` | ✅ Native | `ORDER BY` |
| `$limit` | ✅ Native | `LIMIT` |
| `$skip` | ✅ Native | `OFFSET` |
| `$lookup` | ❌ Unsupported | No JOIN support in SQLite |
| `$unwind` | ❌ Unsupported | No array functions |
| `$facet` | ❌ Unsupported | No subquery support |
| `$setWindowFields` | 🔄 Emulated | Limited window functions (SQLite 3.25+) |

### Advanced Features

| Feature | Status | Notes |
|---------|--------|-------|
| Deep Joins | ✅ Native | `INNER JOIN`, `LEFT JOIN` |
| Recursive CTE | ✅ Native | `WITH RECURSIVE` |
| Window Functions | 🔄 Emulated | Limited support (SQLite 3.25+) |
| Stored Procedures | ❌ Unsupported | SQLite doesn't support stored procedures |
| Cursor Pagination | ✅ Native | Keyset pagination |

### Transactions

| Feature | Status | Notes |
|---------|--------|-------|
| ACID transactions | ✅ Native | Full support |
| Deferred/Immediate/Exclusive | ✅ Native | `BEGIN DEFERRED`, `BEGIN IMMEDIATE`, `BEGIN EXCLUSIVE` |

### Indexes

| Feature | Status | Notes |
|---------|--------|-------|
| Single field | ✅ Native | |
| Compound | ✅ Native | |
| Unique | ✅ Native | |
| Partial | ✅ Native | `WHERE` clause |
| Full-text | ✅ Native | FTS5 |
| GIN | ❌ Unsupported | Not supported |

---

## Cross-Database Portability Summary

### Universally Portable (All Databases)

| Operation | MySQL | MongoDB | PostgreSQL | SQLite |
|-----------|-------|---------|------------|--------|
| CRUD | ✅ | ✅ | ✅ | ✅ |
| Basic filtering | ✅ | ✅ | ✅ | ✅ |
| Sorting | ✅ | ✅ | ✅ | ✅ |
| Pagination (limit/offset) | ✅ | ✅ | ✅ | ✅ |
| Count | ✅ | ✅ | ✅ | ✅ |
| Basic aggregation | ✅ | ✅ | ✅ | ✅ |
| Transactions | ✅ | ✅ | ✅ | ✅ |

### Advanced Features (Cross-Database)

| Feature | MySQL | MongoDB | PostgreSQL | SQLite |
|---------|-------|---------|------------|--------|
| Deep Joins | ✅ | ✅ | ✅ | ✅ |
| Recursive CTE | ✅ | ✅ ($graphLookup) | ✅ | ✅ |
| Window Functions | ✅ | ✅ ($setWindowFields) | ✅ | 🔄 Limited |
| Stored Procedures | ✅ | ❌ | ✅ | ❌ |
| Cursor Pagination | ✅ | ✅ | ✅ | ✅ |
| Change Streams | ❌ | ✅ | ✅ (LISTEN/NOTIFY) | ❌ |
| Query Batching | ✅ | ✅ | ✅ | ✅ |

### Database-Specific Features

| Feature | MySQL | MongoDB | PostgreSQL | SQLite |
|---------|-------|---------|------------|--------|
| Geospatial | 🔄 Limited | ✅ | ✅ (PostGIS) | ❌ |
| Full-text search | ✅ | ✅ | ✅ | ✅ (FTS5) |
| JSON operations | 🔄 Limited | ✅ | ✅ (JSONB) | 🔄 Limited |
| TTL indexes | ❌ | ✅ | 🔄 (pg_cron) | ❌ |
| LISTEN/NOTIFY | ❌ | ❌ | ✅ | ❌ |
| Change Streams | ❌ | ✅ | ❌ | ❌ |

---

## Emulation Strategies

| Operation | MySQL Emulation | PostgreSQL Emulation | SQLite Emulation |
|-----------|-----------------|----------------------|------------------|
| `$unwind` | `JOIN` with `JSON_TABLE` | `LATERAL JOIN` + `jsonb_array_elements` | ❌ Unsupported |
| `$graphLookup` | Recursive CTE | Recursive CTE | Recursive CTE |
| `$facet` | Multiple subqueries | Multiple subqueries | ❌ Unsupported |
| `$bucket` | Window functions + CASE | Window functions | ❌ Unsupported |
| `$setWindowFields` | Window functions (8.0+) | Window functions | Limited (3.25+) |
| `$lookup` | `LEFT JOIN` | `LEFT JOIN` | ❌ Unsupported |
| Change Streams | Polling-based | LISTEN/NOTIFY | Polling-based |

---

## Portability Warning Examples

```typescript
// When developer uses $lookup on SQLite
await db.collection('orders').aggregate([
  { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } }
]);

// JSDB throws:
JSDBError: UNSUPPORTED_OPERATION
Operation: aggregation.lookup
Database: sqlite
Message: "$lookup not supported on SQLite. Use separate queries or normalize data."
Portability: This query works on MySQL, MongoDB, and PostgreSQL but not SQLite.
Suggestion: Consider using separate queries and joining in application code.
```

---

## Usage Example

```typescript
import { createClient } from 'jsdb';

// Switch databases by changing environment variable
// JSDB_DATABASE=mysql|mongodb|postgresql|sqlite

const db = createClient({
  database: process.env.JSDB_DATABASE || 'mysql',
  connection: {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '3306'),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  }
});

await db.connect();

// This query works on ALL databases
const orders = await db.collection('orders')
  .find({ status: 'active' })
  .sort({ createdAt: -1 })
  .limit(10)
  .toArray();

// Advanced: Deep joins (MySQL, PostgreSQL, MongoDB)
const ordersWithUsers = await db.collection('orders')
  .join([
    { collection: 'users', as: 'user', on: { localField: 'userId', foreignField: '_id' } }
  ])
  .toArray();

// Advanced: Recursive CTE (MySQL, PostgreSQL, SQLite) or $graphLookup (MongoDB)
const hierarchy = await db.collection('employees')
  .recursiveCTE({
    name: 'org_tree',
    startWith: { managerId: null },
    connectBy: { field: 'managerId', references: '_id' },
    maxDepth: 10
  })
  .toArray();

await db.disconnect();
```
