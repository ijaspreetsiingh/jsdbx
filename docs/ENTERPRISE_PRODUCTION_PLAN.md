# JSDB Enterprise Production Plan
# Goal: Koi bhi query → Koi bhi DB — Bina ek line change kiye

**Document Version:** 1.0  
**Current State:** Phase 0–12 complete (basic compat layer working, 580+ tests pass)  
**Target:** Production-grade universal query translation engine

---

## CORE GOAL (Ek line mein)

```
MongoDB query lagi ho project mein → .env mein JSDB_DATABASE=mysql likho → MySQL pe chalegi
MySQL SQL query lagi ho → .env mein JSDB_DATABASE=mongodb → MongoDB pe chalegi
Koi query rewrite nahi, koi code change nahi
```

---

## ABHI KYA KAAM KARTA HAI (Proven, 580 tests)

| Operation | mysql2→MySQL | mysql2→MongoDB | pg→MySQL | MongoDB→MySQL | Mongoose→MySQL |
|-----------|-------------|----------------|----------|---------------|----------------|
| SELECT/find | ✅ | ✅ | ✅ | ✅ | ✅ |
| INSERT/insertOne | ✅ | ✅ | ✅ | ✅ | ✅ |
| UPDATE/updateOne | ✅ | ✅ | ✅ | ✅ | ✅ |
| DELETE/deleteOne | ✅ | ✅ | ✅ | ✅ | ✅ |
| WHERE/filter | ✅ | ✅ | ✅ | ✅ | ✅ |
| AND/OR/$and/$or | ✅ | ✅ | ✅ | ✅ | ✅ |
| IN/NOT IN/$in/$nin | ✅ | ✅ | ✅ | ✅ | ✅ |
| BETWEEN | ✅ | ✅ | ✅ | ✅ | ✅ |
| LIKE/$regex | ✅ | ✅ | ✅ | ✅ | ✅ |
| IS NULL/null filter | ✅ | ✅ | ✅ | ✅ | ✅ |
| ORDER BY/sort | ✅ | ✅ | ✅ | ✅ | ✅ |
| LIMIT OFFSET/skip | ✅ | ✅ | ✅ | ✅ | ✅ |
| COUNT/countDocuments | ✅ | ✅ | ✅ | ✅ | ✅ |
| GROUP BY/$group | ✅ | ✅ | ✅ | ✅ | ✅ |
| SUM/AVG/MIN/MAX | ✅ | ✅ | ✅ | ✅ | ✅ |
| WHERE IN (SELECT) | ✅ | ✅ | ✅ | N/A | N/A |
| Transactions | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bulk insert/update | ✅ | ✅ | ✅ | ✅ | ✅ |
| Concurrent queries | ✅ | ✅ | ✅ | ✅ | ✅ |
| SQL Injection safety | ✅ | ✅ | ✅ | ✅ | ✅ |
| pg $1 $2 params | ✅ | ✅ | ✅ | N/A | N/A |

---

## ABHI KYA NAHI KAAM KARTA (Honest gaps)

| Feature | Status | Impact |
|---------|--------|--------|
| Self-referential UPDATE: `SET col = col - ?` | ❌ Broken | High — ERP stock updates |
| Arithmetic in SELECT: `price * qty AS total` | ❌ Broken | High — reporting queries |
| CASE WHEN THEN ELSE END in SELECT | ❌ Broken | High — conditional logic |
| Correlated subqueries: `WHERE x IN (SELECT ... WHERE t.id = outer.id)` | ❌ Not supported | Medium |
| HAVING clause with aggregate alias | ❌ Broken | Medium |
| Multi-table UPDATE with JOIN | ⚠️ SQL DBs only | Medium |
| Window functions (RANK, ROW_NUMBER) via SQL string | ⚠️ Partial | Medium |
| Stored procedures: `CALL proc()` | ⚠️ MySQL/PG only | Low for portability |
| DB-specific functions: DATE_FORMAT, TO_CHAR, etc. | ❌ Not translated | High for existing apps |
| `INSERT ... ON DUPLICATE KEY UPDATE` → MongoDB | ⚠️ Partial | Medium |
| ESM zero-code interception (`--import` loader) | ⚠️ Loader exists, not tested at scale | High |
| Real performance benchmarks vs native driver | ❌ Not done | Critical before production |

---

## PLAN: Phase by Phase

---

### PHASE A — SQL Parser: Missing Critical Features
**Timeline:** 2–3 weeks  
**Priority:** CRITICAL — ERP projects pe 40% queries inhi patterns mein hoti hain

#### A1. Self-Referential UPDATE
**Problem:**
```sql
UPDATE products SET stock = stock - 5 WHERE id = ?
UPDATE accounts SET balance = balance + ? WHERE user_id = ?
```
**Current behavior:** `stock` field mein literal string `"stock"` set ho jaata hai  
**Fix needed:**
- `sql-parser.ts` mein `parseSetClause()` ko extend karo — expression parsing add karo
- IR mein naya node type: `{ $inc: { stock: -5 } }` ya `{ $mul: ... }`
- MySQL compiler: `SET stock = stock - ?`
- MongoDB compiler: `{ $inc: { stock: -5 } }`

**Files to change:**
- `src/ir/sql-parser.ts` — `parseSetClause()` method
- `src/ir/nodes.ts` — UpdateExpression IR node
- `src/adapters/mysql/compiler.ts` — compileUpdate()
- `src/adapters/mongodb/compiler.ts` — compileUpdate()
- `src/adapters/postgres/compiler.ts` — compileUpdate()

#### A2. Arithmetic Expressions in SELECT
**Problem:**
```sql
SELECT price * quantity AS line_total FROM order_items
SELECT salary * 1.1 AS new_salary FROM employees
SELECT (subtotal + tax - discount) AS final FROM orders
```
**Current behavior:** Arithmetic columns not included in IR projection  
**Fix needed:**
- SQL parser mein arithmetic expression parser (+ - * / precedence)
- IR mein `ComputedField` type: `{ type: 'arithmetic', left, op, right, alias }`
- Each compiler: SQL DBs → native arithmetic SQL, MongoDB → `$multiply`, `$add` etc in `$project`

**Files to change:**
- `src/ir/sql-parser.ts` — `parseSelectColumn()`, `parseExpression()`
- `src/ir/nodes.ts` — ComputedField, ArithmeticExpr types
- All 4 compilers

#### A3. CASE WHEN THEN ELSE END
**Problem:**
```sql
SELECT 
  CASE WHEN stock > 100 THEN 'high' 
       WHEN stock > 10 THEN 'medium' 
       ELSE 'low' END AS stock_level
FROM products
```
**Current behavior:** Parser tokenizes CASE but IR doesn't carry it  
**Fix needed:**
- IR mein `CaseExpression` node
- SQL compilers: native CASE WHEN SQL
- MongoDB compiler: `$switch` / `$cond` operator in `$project`

**Files to change:**
- `src/ir/sql-parser.ts` — `parseCaseColumn()` already exists, needs IR output
- `src/ir/nodes.ts` — CaseExpressionIR type
- All compilers

#### A4. HAVING Clause
**Problem:**
```sql
SELECT category, COUNT(*) AS cnt FROM products 
GROUP BY category 
HAVING cnt > 5
-- or --
HAVING COUNT(*) > 5
```
**Current behavior:** HAVING parsed but filter not applied correctly in aggregation  
**Fix needed:**
- SQL parser mein HAVING → IR aggregate pipeline mein `$match` as last stage
- Memory adapter mein HAVING filter support

**Files to change:**
- `src/ir/sql-parser.ts` — `selectToIR()` HAVING handling
- `src/adapters/memory/adapter.ts` — aggregate HAVING stage

---

### PHASE B — MongoDB → SQL Translation: Missing Operations
**Timeline:** 2 weeks  
**Priority:** HIGH — MongoDB-native code ko SQL pe chalana

#### B1. `$lookup` → SQL JOIN
**Problem:**
```javascript
db.orders.aggregate([
  { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'user' } }
])
```
**Current behavior:** MySQL/PG compilers mein `$lookup` → LEFT JOIN exists but fragile  
**Fix needed:**
- MongoDB aggregation compiler already has basic `$lookup` → LEFT JOIN
- Nested/pipeline `$lookup` (MongoDB 3.6+) needs sub-pipeline support
- Result merging: SQL LEFT JOIN rows → MongoDB-style embedded document array

#### B2. `$unwind` → SQL Lateral Join / JSON_TABLE
**Problem:**
```javascript
db.orders.aggregate([
  { $unwind: '$items' }
])
```
**Current behavior:** MySQL compiler has `JSON_TABLE` approach, fragile  
**Fix needed:**
- Proper `$unwind` emulation in MySQL: `JSON_TABLE` with proper column definitions
- PostgreSQL: `LATERAL JOIN jsonb_array_elements()`
- SQLite: ❌ UNSUPPORTED — throw clear error

#### B3. `$push`, `$addToSet` accumulators → SQL
**Problem:**
```javascript
db.orders.aggregate([
  { $group: { _id: '$customer', items: { $push: '$product' } } }
])
```
**Fix needed:**
- MySQL: `JSON_ARRAYAGG()`
- PostgreSQL: `array_agg()` or `json_agg()`
- SQLite: ❌ Limited — `group_concat()`

#### B4. MongoDB Update Operators → SQL
**Problem:**
```javascript
collection.updateOne({ _id: 1 }, { $inc: { views: 1 }, $push: { tags: 'new' } })
```
**Current behavior:** `$inc` works in MemoryAdapter but not in real SQL compilers  
**Fix needed:**
- MySQL/PG compiler: `$inc` → `SET col = col + ?`
- MySQL/PG compiler: `$mul` → `SET col = col * ?`
- MySQL/PG compiler: `$push` → `JSON_ARRAY_APPEND()`
- MySQL/PG compiler: `$pull` → JSON_REMOVE with JSON_SEARCH
- MySQL/PG compiler: `$unset` → `SET col = NULL`
- MySQL/PG compiler: `$rename` → copy + nullify

**Files to change:**
- `src/adapters/mysql/compiler.ts` — `compileUpdate()`
- `src/adapters/postgres/compiler.ts` — `compileUpdate()`

---

### PHASE C — Performance: Production Load Readiness
**Timeline:** 3 weeks  
**Priority:** CRITICAL before any real production use

#### C1. IR Plan Caching (Already has skeleton, needs hardening)
**Problem:** Har query pe SQL string → tokenize → parse → IR build → plan → execute.  
On 10,000 queries/sec, parsing overhead kills performance.

**Fix needed:**
- Query template fingerprinting: `SELECT * FROM users WHERE id = ?` → same IR every time
- LRU cache for plan objects (already has `PlanCache` class, needs actual use in hot path)
- Cache invalidation on schema change

**Implementation:**
```typescript
// src/planner/cache.ts — already exists, wire it into execSQL
const cacheKey = fingerprint(sql); // hash of sql template (params stripped)
let plan = planCache.get(cacheKey, db);
if (!plan) {
  const ir = sqlToIR(parseSQL(sql));
  plan = queryPlanner.plan(ir, db);
  planCache.set(cacheKey, db, plan);
}
```

**Expected gain:** 60–80% reduction in CPU per query after warm-up

#### C2. Connection Pool Tuning
**Problem:** Current pool config is basic. ERP apps need:
- Per-request connection checkout timeout
- Pool exhaustion handling
- Read/write splitting (primary + replicas)

**Fix needed:**
- MySQL: `mysql2` pool `waitForConnections: true`, `connectionLimit`, `queueLimit`
- PostgreSQL: `pg` pool `max`, `idleTimeoutMillis`, `connectionTimeoutMillis`
- Add `pool.readReplicas[]` config option for read-heavy workloads
- Health check + auto-reconnect on connection drop

**Files to change:**
- `src/adapters/mysql/adapter.ts`
- `src/adapters/postgres/adapter.ts`
- `src/types/index.ts` — JSDBConfig pool options

#### C3. Streaming / Cursor Support for Large Result Sets
**Problem:** `SELECT * FROM transactions` → millions of rows → out of memory  
**Fix needed:**
- `collection.find().stream()` → Node.js Readable stream
- MySQL: `pool.query().stream()`
- MongoDB: cursor iteration
- PostgreSQL: `pg` cursor via `pg-cursor`

**Implementation:**
```typescript
// New API
const stream = db.collection('transactions')
  .find({ year: 2024 })
  .stream(); // returns Node.js Readable

stream.on('data', (row) => process(row));
stream.on('end', () => done());
```

#### C4. Query Batching / N+1 Prevention
**Problem:** ORM-style code mein N+1 queries common hain  
**Current state:** `QueryBatcher` class exists in `src/query/batch.ts`  
**Fix needed:**
- DataLoader-style batching (Facebook's pattern)
- Auto-detect N+1 and warn in development mode (already has N1Detector)
- `db.collection('users').findByIds([1,2,3,4,5])` → single query

---

### PHASE D — Zero-Code Integration: Real Production Deployment
**Timeline:** 2 weeks  
**Priority:** HIGH — ye hi main selling point hai

#### D1. CJS require() Interception (Improve existing register.ts)
**Current state:** `register.ts` patches require cache — works but brittle  
**Problem:** Works only if `require('jsdb/register')` runs BEFORE real driver  

**Fix needed:**
- Node.js `--require jsdb/register` flag support (no source file change at all)
- More robust cache patching — handle edge cases where driver is already loaded
- `module.exports = proxy` properly for legacy `mysql` package

**Usage after fix:**
```bash
# Zero source changes — just add --require flag
node --require jasdbx/register your-app.js

# Or in package.json
{
  "scripts": {
    "start": "node --require jasdbx/register server.js"
  }
}
```

#### D2. ESM `--import` Loader (New loader.mjs exists, needs testing)
**Current state:** `src/compat/loader.mjs` created  
**Problem:** Not tested at scale, resolve hook may have edge cases  

**Fix needed:**
- Test with Vite, Webpack, esbuild bundled apps
- Handle dynamic imports: `const m = await import('mysql2')`
- Handle re-exports: `export { createPool } from 'mysql2'`

**Usage after fix:**
```bash
# ESM projects — zero source changes
node --import jasdbx/loader server.js
```

#### D3. Package.json `imports` Map (True zero-code for npm workspaces)
**Problem:** Node.js `imports` field in package.json can alias module names  
**Fix needed:**
Add to project's `package.json`:
```json
{
  "imports": {
    "mysql2": "jasdbx/mysql2",
    "mysql2/promise": "jasdbx/mysql2",
    "pg": "jasdbx/pg",
    "mongodb": "jasdbx/mongodb",
    "mongoose": "jasdbx/mongoose"
  }
}
```
JSDB can auto-add this during `npx jasdbx init` — TRUE zero source changes.

**Implementation:**
- `src/cli/index.ts` mein `init` command — writes `imports` to user's `package.json`

#### D4. Webpack / Vite / esbuild Alias Plugin
**Fix needed:**
```javascript
// webpack.config.js — auto-generated by jsdb init
module.exports = {
  resolve: {
    alias: {
      'mysql2': 'jasdbx/mysql2',
      'mysql2/promise': 'jasdbx/mysql2',
      'pg': 'jasdbx/pg',
      'mongodb': 'jasdbx/mongodb',
      'mongoose': 'jasdbx/mongoose',
    }
  }
}
```
- `npx jasdbx init --bundler=webpack` → auto-generates alias config
- Same for Vite (`vite.config.ts`) and esbuild

---

### PHASE E — Advanced SQL Features
**Timeline:** 3 weeks  
**Priority:** HIGH — ye features real ERP mein bohot common hain

#### E1. Correlated Subqueries
**Problem:**
```sql
SELECT * FROM employees e 
WHERE salary > (SELECT AVG(salary) FROM employees WHERE dept = e.dept)
```
**Strategy:**
- Simple correlated subqueries → execute per-row (slow but correct)
- Add `$where` style emulation for MongoDB
- Mark complex cases as `PARTIALLY_SUPPORTED` with clear warning

#### E2. Multi-level JOIN (3+ tables)
**Problem:**
```sql
SELECT u.name, o.total, p.name 
FROM users u
JOIN orders o ON o.user_id = u.id
JOIN order_items oi ON oi.order_id = o.id  
JOIN products p ON p.id = oi.product_id
WHERE u.is_active = 1
```
**Current state:** SQL parser handles multi-JOINs, IR carries them  
**Gap:** MongoDB target mein chained `$lookup` stages properly generate nahi ho rahe  
**Fix needed:**
- `sqlToIR()` mein multi-join → chain of `$lookup` + `$unwind` stages
- Each JOIN becomes its own `$lookup` stage in MongoDB aggregation pipeline

#### E3. UNION / UNION ALL
**Problem:**
```sql
SELECT name FROM customers
UNION ALL
SELECT name FROM vendors
```
**Fix needed:**
- SQL parser mein UNION parsing
- IR mein `UnionNode` type
- MySQL/PG: native UNION
- MongoDB: `$unionWith` aggregation stage
- SQLite: native UNION

#### E4. Common Table Expressions (CTE) via SQL string
**Problem:**
```sql
WITH ranked AS (
  SELECT *, RANK() OVER (PARTITION BY dept ORDER BY salary DESC) as rn
  FROM employees
)
SELECT * FROM ranked WHERE rn = 1
```
**Current state:** IR has CTE nodes for programmatic API, SQL parser nahi padhta CTE  
**Fix needed:**
- SQL parser mein `WITH ... AS (...)` parsing
- `selectToIR()` mein CTE detection
- Pass through to native SQL compilers (MySQL/PG support it natively)
- MongoDB: `$lookup` with pipeline emulation

#### E5. DB-Specific Function Translation Table
**Problem:** ERP apps mein DB-specific functions bohot use hoti hain:

```sql
-- MySQL functions
DATE_FORMAT(created_at, '%Y-%m')
IFNULL(phone, 'N/A')
CONCAT(first_name, ' ', last_name)
YEAR(birth_date), MONTH(birth_date)

-- These need translation to PostgreSQL equivalents:
TO_CHAR(created_at, 'YYYY-MM')
COALESCE(phone, 'N/A')
first_name || ' ' || last_name
EXTRACT(YEAR FROM birth_date)

-- And to MongoDB equivalents:
{ $dateToString: { format: '%Y-%m', date: '$created_at' } }
{ $ifNull: ['$phone', 'N/A'] }
{ $concat: ['$first_name', ' ', '$last_name'] }
```

**Fix needed:**
- `src/ir/function-translator.ts` — new file
- Function translation table: MySQL fn → IR fn node → target-specific output
- Per-compiler: translate IR fn nodes to native functions
- Unknown functions: pass through with `UNKNOWN_FUNCTION` warning

**Implementation skeleton:**
```typescript
// src/ir/function-translator.ts
const FUNCTION_MAP: Record<string, {
  ir: string;
  mysql?: string;
  postgres?: string;
  sqlite?: string;
  mongodb?: (args: unknown[]) => unknown;
}> = {
  'DATE_FORMAT': {
    ir: 'date_format',
    mysql: 'DATE_FORMAT({0}, {1})',
    postgres: 'TO_CHAR({0}, {1})',
    sqlite: "strftime({1}, {0})",
    mongodb: (args) => ({ $dateToString: { format: args[1], date: `$${args[0]}` } }),
  },
  'IFNULL': {
    ir: 'coalesce',
    mysql: 'IFNULL({0}, {1})',
    postgres: 'COALESCE({0}, {1})',
    sqlite: 'IFNULL({0}, {1})',
    mongodb: (args) => ({ $ifNull: [args[0], args[1]] }),
  },
  'CONCAT': {
    ir: 'concat',
    mysql: "CONCAT({...})",
    postgres: "CONCAT({...})",
    sqlite: "{0} || {1}",
    mongodb: (args) => ({ $concat: args }),
  },
  // ... 50+ more common functions
};
```

---

### PHASE F — Real-World Test Suite
**Timeline:** 2 weeks  
**Priority:** HIGH — claim prove karna padega

#### F1. Real Database Integration Tests (Docker)
**Current state:** MemoryAdapter pe 580 tests pass  
**What's needed:** Same tests on REAL MySQL, PostgreSQL, MongoDB

```yaml
# docker-compose.test.yml already exists
services:
  mysql:    image: mysql:8.0
  postgres: image: postgres:16
  mongodb:  image: mongo:7
```

**Test matrix to run:**
```
mysql2 SQL  → Real MySQL 8.0
mysql2 SQL  → Real MongoDB 7.0 (translation proof)
mysql2 SQL  → Real PostgreSQL 16
pg SQL      → Real MySQL 8.0
pg SQL      → Real PostgreSQL 16
MongoDB API → Real MySQL 8.0
MongoDB API → Real PostgreSQL 16
Mongoose    → Real MySQL 8.0
```

#### F2. Performance Benchmark Suite
```typescript
// tests/benchmarks/throughput.bench.ts
bench('mysql2 native vs JSDB overhead', async () => {
  // 1000 queries
  for (let i = 0; i < 1000; i++) {
    await pool.query('SELECT * FROM users WHERE id = ?', [i % 100 + 1]);
  }
});
// Expected: JSDB overhead < 2ms per query after plan cache warmup
```

**Target metrics:**
- Per-query overhead: < 2ms (after cache warmup)
- Per-query overhead: < 10ms (cold, first query)
- Memory per 1000 cached plans: < 50MB
- Concurrent 100 connections: no deadlock, no memory leak

#### F3. ERP-Scale Load Test
```typescript
// tests/load/erp-load.test.ts
// 50 concurrent users, 10,000 operations each
// Mix of: 60% reads, 25% writes, 10% aggregations, 5% transactions
```

---

### PHASE G — CLI: `npx jasdbx` Production Tools
**Timeline:** 2 weeks

#### G1. `npx jasdbx init` — Project Setup
```bash
npx jasdbx init
# ? Which framework? (Express/NestJS/Fastify/Other)
# ? Current database driver? (mysql2/pg/mongodb/mongoose)
# ? Target database? (MySQL/PostgreSQL/MongoDB/SQLite)
# → Writes .env template
# → Adds package.json "imports" map
# → Creates jsdb.config.ts
```

#### G2. `npx jasdbx doctor` — Health Check
```bash
npx jasdbx doctor
# ✅ JSDB config found
# ✅ Target database: mongodb
# ✅ Connection: mongodb://localhost:27017 — Connected
# ⚠️  Found 3 queries using DATE_FORMAT() — not fully portable to MongoDB
# ❌  Found 1 correlated subquery — UNSUPPORTED on MongoDB
# 📊  Portability score: 87/100
```

#### G3. `npx jasdbx analyze` — Query Portability Scan
```bash
npx jasdbx analyze ./src
# Scanning 127 files...
# Found 842 database queries
# 
# PORTABLE (812):     96.4%
# EMULATED (24):       2.8%
# UNSUPPORTED (6):     0.7%
#
# UNSUPPORTED QUERIES:
# src/reports/revenue.ts:45  — Correlated subquery
# src/billing/invoice.ts:89  — DATE_FORMAT → needs function map
# src/inventory/batch.ts:23  — UPDATE stock = stock - ? (self-ref)
```

---

### PHASE H — Additional Database Adapters
**Timeline:** 4–6 weeks (post core completion)

| Database | Adapter | Use Case | Priority |
|----------|---------|----------|----------|
| **MariaDB** | `mysql2` compatible | MySQL alternative | High |
| **CockroachDB** | `pg` compatible | Distributed SQL | High |
| **DynamoDB** | `@aws-sdk/client-dynamodb` | AWS workloads | Medium |
| **Redis** | `ioredis` | Cache + simple queries | Medium |
| **Firestore** | Firebase Admin SDK | Google Cloud | Medium |
| **MS SQL Server** | `mssql` | Enterprise Windows shops | High |
| **Oracle** | `oracledb` | Legacy enterprise | Medium |
| **SAP HANA** | `@sap/hana-client` | SAP ecosystem | Medium |
| **Cassandra** | `cassandra-driver` | Time-series, IoT | Low |
| **ClickHouse** | `@clickhouse/client` | Analytics | Low |

**MS SQL Server — High Priority Because:**
- Most enterprise ERP systems (SAP, Oracle ERP, custom enterprise) use MSSQL
- `mssql` npm package has similar pool/query API
- Stored procedures heavily used

**SAP HANA — For SAP integration:**
- `@sap/hana-client` driver
- HANA SQL is mostly standard SQL with extensions
- `TO_NVARCHAR`, `DAYS_BETWEEN`, `ADD_MONTHS` functions need translation table

---

## IMPLEMENTATION ORDER (AI ke liye)

AI is document ko padh ke kaam kare, ye order follow kare:

### Sprint 1 (Week 1–2): Fix Critical SQL Gaps
1. `src/ir/sql-parser.ts` — self-referential UPDATE expressions
2. `src/ir/sql-parser.ts` — arithmetic in SELECT list
3. `src/ir/sql-parser.ts` — CASE WHEN THEN ELSE parsing to IR
4. `src/adapters/mysql/compiler.ts` — $inc, $mul, arithmetic update operators
5. `src/adapters/postgres/compiler.ts` — same
6. `src/adapters/mongodb/compiler.ts` — $inc/$mul already work, verify
7. Tests: `tests/unit/sql-parser-expressions.test.ts` — new test file

### Sprint 2 (Week 3–4): MongoDB → SQL Missing Pieces
1. `src/adapters/mysql/compiler.ts` — $push/$pull in UPDATE
2. `src/adapters/postgres/compiler.ts` — same
3. `src/ir/sql-parser.ts` — HAVING clause fix
4. Multi-join SQL → MongoDB chained $lookup fix
5. Tests: `tests/compat/matrix/` — add arithmetic + CASE + HAVING tests

### Sprint 3 (Week 5–6): Performance + Caching
1. `src/compat/core.ts` — wire `PlanCache` into `execSQL()` hot path
2. `src/compat/core.ts` — query template fingerprinting (strip params from SQL for cache key)
3. `src/adapters/mysql/adapter.ts` — pool tuning options
4. `src/adapters/postgres/adapter.ts` — pool tuning
5. `tests/benchmarks/` — benchmark suite setup

### Sprint 4 (Week 7–8): Function Translation Table
1. `src/ir/function-translator.ts` — new file, 50+ common functions
2. `src/ir/sql-parser.ts` — function call parsing in SELECT and WHERE
3. `src/adapters/mysql/compiler.ts` — translate IR fn nodes
4. `src/adapters/postgres/compiler.ts` — translate IR fn nodes
5. `src/adapters/mongodb/compiler.ts` — translate IR fn nodes to $expr

### Sprint 5 (Week 9–10): Zero-Code Integration
1. `src/compat/register.ts` — harden require cache patching
2. `src/compat/loader.mjs` — test ESM loader at scale
3. `src/cli/index.ts` — `init` command with package.json imports map
4. `src/cli/index.ts` — `doctor` command
5. `src/cli/index.ts` — `analyze` command (portability scanner)

### Sprint 6 (Week 11–12): Real DB Integration Tests
1. `tests/integration/` — real MySQL tests (Docker)
2. `tests/integration/` — real PostgreSQL tests (Docker)
3. `tests/integration/` — real MongoDB tests (Docker)
4. `tests/integration/` — cross-translation tests (mysql2 SQL → real MongoDB)
5. CI/CD pipeline setup for Docker-based integration tests

### Sprint 7 (Week 13–14): SQL UNION + CTE
1. `src/ir/sql-parser.ts` — WITH CTE parsing
2. `src/ir/sql-parser.ts` — UNION / UNION ALL parsing
3. `src/ir/nodes.ts` — UnionNode, CTENode IR types
4. All compilers — UNION and CTE compilation
5. Tests

### Sprint 8 (Week 15–16): Additional Adapters
1. MariaDB adapter (`mysql2` compatible, minimal changes)
2. MS SQL Server adapter (`mssql` package)
3. CockroachDB adapter (`pg` compatible, minimal changes)

---

## FILES STRUCTURE AFTER COMPLETION

```
src/
├── ir/
│   ├── sql-parser.ts          ← Major changes: arithmetic, CASE, CTE, UNION
│   ├── nodes.ts               ← New IR node types
│   ├── function-translator.ts ← NEW: 50+ function mappings
│   └── native-query.ts
├── adapters/
│   ├── mysql/
│   │   └── compiler.ts        ← $inc/$mul/$push/$pull, arithmetic, CASE
│   ├── postgres/
│   │   └── compiler.ts        ← Same
│   ├── mongodb/
│   │   └── compiler.ts        ← Chained $lookup, $unwind improvements
│   ├── mssql/                 ← NEW
│   │   ├── adapter.ts
│   │   ├── compiler.ts
│   │   └── index.ts
│   └── mariadb/               ← NEW (thin wrapper over mysql)
├── compat/
│   ├── core.ts                ← Plan cache wired in, subquery expansion
│   ├── register.ts            ← Hardened
│   └── loader.mjs             ← Tested + working
├── cli/
│   └── index.ts               ← init, doctor, analyze commands
└── tests/
    ├── unit/
    │   └── sql-parser-expressions.test.ts  ← NEW
    ├── integration/                         ← NEW (real DBs)
    │   ├── mysql-real.test.ts
    │   ├── postgres-real.test.ts
    │   └── mongodb-real.test.ts
    └── benchmarks/                          ← NEW
        └── throughput.bench.ts
```

---

## SUCCESS CRITERIA

Ye criteria poora hone ke baad project "production-ready" kahlaega:

| Criteria | Metric | How to Test |
|----------|--------|-------------|
| Query translation accuracy | 95%+ real-world ERP queries translate correctly | Integration tests on real DBs |
| Performance overhead | < 2ms per query (after 100 query warmup) | Benchmark suite |
| Zero-code integration | `--require jasdbx/register` works for any CJS app | E2E test on sample app |
| SQL → MongoDB | 90%+ standard SQL queries run on MongoDB | Matrix tests on real MongoDB |
| MongoDB → SQL | 90%+ standard find/aggregate queries run on MySQL/PG | Matrix tests on real MySQL |
| Load handling | 1000 concurrent queries without OOM or deadlock | Load test |
| Correctness | Same query returns same rows regardless of target DB | Cross-DB conformance tests |
| Error clarity | Unsupported operations give clear actionable error | Error handling tests |

---

## KYA KABHI BHI POSSIBLE NAHI HOGA (Honest limits)

Ye cheezein koi bhi universal DB layer provide nahi kar sakti:

| Feature | Why Not Possible |
|---------|-----------------|
| **Triggers pe portability** | Triggers DB-engine ke andar chalte hain, JSDB layer ke bahar |
| **Stored procedures portability** | ABAP/PL-SQL/T-SQL language differences too fundamental |
| **Full-text search semantic equivalence** | MySQL FULLTEXT vs MongoDB text vs PG tsvector completely different ranking |
| **DB-specific type semantics** | PostgreSQL UUID type vs MySQL CHAR(36) different behavior |
| **100% arbitrary SQL portability** | Database compilers mein decades of DB-specific features hain |
| **Zero overhead** | Translation layer hamesha kuch na kuch overhead legi |

---

## BOTTOM LINE

Is plan ko follow karke JSDB ye achieve kar sakta hai:

```
Existing application (koi bhi — ERP, SaaS, microservice)
  mysql2 ya pg ya mongodb ya mongoose use kar raha ho
  
  JSDB install karo
  .env mein JSDB_DATABASE=mongodb (ya koi bhi) likho
  node --require jasdbx/register server.js chalao
  
  Application ki 90%+ database operations
  automatically target DB pe chalenge
  
  Baki 10% ke liye clear error + fix suggestion milegi
```

SAP-level ERP ke liye: ye 80-90% queries cover karega.  
Baaki 10% (stored procedures, triggers, SAP HANA-specific functions) ke liye  
adapter-specific escape hatches use karne padenge.  
100% magic portability possible nahi hai — lekin 90% kisi bhi framework se better hai.
