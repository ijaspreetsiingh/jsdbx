# JSDB MVP Scope

**Exactly what belongs in MVP and what must NOT be implemented yet**

---

## ✅ IN SCOPE — MVP (Weeks 1-20)

### Core Package (`jsdb`)

| Component | Details |
|-----------|---------|
| **TypeScript SDK** | Full type definitions, JSDoc comments |
| **Universal Database API** | `createClient`, `client.collection()`, `collection.find/findOne/insert/update/delete/count/aggregate` |
| **Query Builder** | Fluent API: `.where()`, `.sort()`, `.limit()`, `.offset()`, `.project()`, `.toArray()`, `.exec()` |
| **Universal AST/IR** | Node types for Select, Insert, Update, Delete, Aggregate, Count, Transaction |
| **Capability Registry** | Native/Emulated/Unsupported classification per operation per DB |
| **Basic Query Planner** | IR → ExecutionPlan with statements, cost estimate, portability warnings |
| **MySQL Adapter** | Full MVP operations (see below) |
| **MongoDB Adapter** | Full MVP operations (see below) |
| **Connection Management** | `connect()`, `disconnect()`, health check |
| **Connection Pooling** | Configurable min/max, idle timeout, using driver pools |
| **Basic Transactions** | `client.transaction(async (tx) => { ... })` with commit/rollback |
| **Unified Errors** | `JSDBError` with codes, cause, portability info |
| **Logging** | Pluggable logger interface, default console implementation |
| **Configuration** | `JSDB_DATABASE` env var + programmatic config override |

### MySQL Adapter — MVP Operations

| Category | Operations |
|----------|------------|
| CRUD | `insertOne`, `insertMany`, `findOne`, `find`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany` |
| Filtering | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`, `$not`, `$like`, `$regex`, `$exists` |
| Sorting | Single/multi-field, ASC/DESC |
| Pagination | `limit`, `offset` |
| Projection | Field inclusion (exclusion via complement) |
| Count | `countDocuments` |
| Aggregation | `$match`, `$group` (count/sum/avg/min/max), `$project`, `$sort`, `$limit`, `$skip` |
| Transactions | BEGIN/COMMIT/ROLLBACK, isolation levels |

### MongoDB Adapter — MVP Operations

| Category | Operations |
|----------|------------|
| CRUD | Same as MySQL |
| Filtering | All MySQL operators + `$elemMatch`, `$type`, `$all`, `$size`, `$text` |
| Sorting | Single/multi-field, nested fields, text score |
| Pagination | `limit`, `offset` + cursor-based (bonus) |
| Projection | Full inclusion/exclusion/nested/computed |
| Count | `countDocuments` |
| Aggregation | All MVP stages + `$lookup`, `$unwind`, `$addFields`, `$facet`, `$bucket` |
| Transactions | Multi-document sessions |

### Developer Experience

| Feature | Details |
|---------|---------|
| **Install** | `npm install jsdb` |
| **Import** | `import { createClient } from 'jsdb'` |
| **Switch DB** | Change `JSDB_DATABASE` env var |
| **Error Messages** | Clear, actionable, with portability hints |
| **TypeScript** | Full autocomplete for query builder |
| **Documentation** | README, API reference, migration guide |

---

## ❌ OUT OF SCOPE — MVP (Explicitly Deferred)

### API Runtime (V1.1+)

- Request/response caching
- Request deduplication
- Query batching
- Parallel query execution
- Rate limiting
- N+1 detection
- Payload optimization
- Response compression

### Security Runtime (V1.2+)

- Authentication (JWT, API keys)
- Authorization / RBAC
- Tenant isolation (auto-filter injection)
- Field-level access control
- Audit logging
- Abuse protection

### Analyzers (V1.3+)

- **Portability Analyzer** (static code analysis)
- **Performance Analyzer** (query inspection)
- **Security Analyzer** (vulnerability detection)
- Database Migration Assistant

### Observability (V1.5+)

- Metrics collection (latency, throughput, errors)
- Slow query detection
- Cache hit ratios
- Dashboard / exporters (Prometheus, OpenTelemetry)

### Advanced Database Features

- Schema migrations
- Schema validation / entity definitions
- Stored procedures / functions
- Database-specific hints (MySQL `FORCE INDEX`, MongoDB `hint()`)
- Change streams / CDC
- Geospatial queries
- Full-text search (beyond basic `$regex`/`LIKE`)

### Multi-Language SDKs

- PHP, Python, Go, Rust — **V3.0+**

### Adapter Marketplace

- Community adapter system — **V2.0+**

### Enterprise Features

- SSO, governance, SLA, private deployment — **Enterprise tier only**

---

## 🎯 MVP Success Criteria

A developer can:

1. `npm install jsdb`
2. Configure MySQL via `JSDB_DATABASE=mysql`
3. Write universal queries using the fluent API
4. Switch to MongoDB by changing **only** `JSDB_DATABASE=mongodb`
5. Have the same queries work for all **universally portable** operations
6. Get clear errors for **unsupported** operations with migration hints
7. Use transactions, connection pooling, and basic aggregation
8. See portability warnings in logs for emulated operations

---

## 📦 Package Structure (MVP)

```
jsdb/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Public exports
│   ├── client.ts                   # JSDBClient
│   ├── collection.ts               # Collection
│   ├── query-builder.ts            # QueryBuilder
│   ├── config.ts                   # Configuration
│   ├── factory.ts                  # createClient()
│   ├── types/
│   │   ├── index.ts                # Public types
│   │   ├── query.ts                # Filter, Sort, Projection, etc.
│   │   └── result.ts               # InsertResult, UpdateResult, etc.
│   ├── ir/
│   │   ├── nodes.ts                # IR node types
│   │   ├── builder.ts              # QueryBuilder → IR
│   │   └── index.ts
│   ├── capabilities/
│   │   ├── registry.ts             # CapabilityRegistry
│   │   ├── mysql.ts                # MySQL capability map
│   │   ├── mongodb.ts              # MongoDB capability map
│   │   └── warnings.ts             # PortabilityWarning
│   ├── planner/
│   │   ├── planner.ts              # QueryPlanner
│   │   └── execution-plan.ts       # ExecutionPlan
│   ├── adapters/
│   │   ├── index.ts                # Adapter interface
│   │   ├── mysql/
│   │   │   ├── index.ts
│   │   │   ├── pool.ts
│   │   │   ├── compiler.ts
│   │   │   ├── where.ts
│   │   │   ├── pagination.ts
│   │   │   ├── aggregation.ts
│   │   │   ├── transaction.ts
│   │   │   └── mapper.ts
│   │   └── mongodb/
│   │       ├── index.ts
│   │       ├── pool.ts
│   │       ├── compiler.ts
│   │       ├── filter.ts
│   │       ├── pagination.ts
│   │       ├── aggregation.ts
│   │       ├── transaction.ts
│   │       └── mapper.ts
│   ├── errors/
│   │   ├── index.ts
│   │   └── codes.ts
│   └── utils/
│       ├── logger.ts
│       └── clone.ts
├── tests/
│   ├── unit/
│   ├── integration/
│   │   ├── mysql/
│   │   └── mongodb/
│   └── e2e/
├── docs/
│   ├── API.md
│   ├── MIGRATION.md
│   └── CAPABILITIES.md
├── benchmarks/
└── README.md
```

---

## 🚫 Scope Creep Prevention

**Before adding ANY feature, ask:**

1. Is it in the MVP table above? → **No = defer**
2. Does it require a new adapter method? → **No = defer**
3. Does it change the IR node types? → **No = defer**
4. Can it be a separate npm package (`jsdb-cache`, `jsdb-auth`)? → **Yes = defer to separate package**

**Exception:** Critical bug fixes or security patches.