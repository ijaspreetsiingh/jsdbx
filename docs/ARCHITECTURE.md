# JSDB Architecture

**Current technical architecture and component relationships**

---

## High-Level Component Diagram

```text
┌─────────────────────────────────────────────────────────────┐
│                        JSDB Core                            │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  Universal   │  │    Query     │  │  Capability      │  │
│  │  Database    │──│    Planner   │──│  Registry        │  │
│  │  API         │  │              │  │                  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                     │            │
│         ▼                 ▼                     ▼            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Universal AST / IR                       │   │
│  └────────────────────────┬──────────────────────────────┘   │
│                           │                                   │
│          ┌────────────────┼────────────────┐                 │
│          ▼                ▼                ▼                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   MySQL      │  │   MongoDB    │  │  (Future)    │       │
│  │   Adapter    │  │   Adapter    │  │   Adapters   │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Universal Database API (`src/api/`)

**Purpose:** Single interface for all database operations.

**Key interfaces:**
```typescript
interface JSDBClient {
  collection(name: string): Collection;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}

interface Collection {
  find(filter: Filter): QueryBuilder;
  findOne(filter: Filter): Promise<Document | null>;
  insertOne(doc: Document): Promise<InsertResult>;
  insertMany(docs: Document[]): Promise<InsertResult>;
  updateOne(filter: Filter, update: Update): Promise<UpdateResult>;
  updateMany(filter: Filter, update: Update): Promise<UpdateResult>;
  deleteOne(filter: Filter): Promise<DeleteResult>;
  deleteMany(filter: Filter): Promise<DeleteResult>;
  countDocuments(filter: Filter): Promise<number>;
  aggregate(pipeline: AggregationStage[]): AggregationCursor;
}
```

### 2. Universal AST / IR (`src/ir/`)

**Purpose:** Database-agnostic representation of queries.

**Node types:**
```typescript
type IRNode =
  | { type: 'Select'; collection: string; projection: string[]; filter: FilterIR; sort: SortIR; limit: number; offset: number }
  | { type: 'Insert'; collection: string; documents: Document[] }
  | { type: 'Update'; collection: string; filter: FilterIR; update: UpdateIR }
  | { type: 'Delete'; collection: string; filter: FilterIR }
  | { type: 'Aggregate'; collection: string; pipeline: AggregationStageIR[] }
  | { type: 'Count'; collection: string; filter: FilterIR }
  | { type: 'Transaction'; operations: IRNode[] };
```

### 3. Capability Registry (`src/capabilities/`)

**Purpose:** Classify each operation per database.

```typescript
type CapabilityStatus = 'native' | 'emulated' | 'unsupported';

interface CapabilityRegistry {
  getCapability(database: DatabaseType, operation: OperationKey): CapabilityStatus;
  getEmulationStrategy(database: DatabaseType, operation: OperationKey): EmulationStrategy | null;
}
```

**Per-database capabilities tracked in:** `DATABASE_CAPABILITIES.md`

### 4. Query Planner (`src/planner/`)

**Purpose:** Convert Universal AST → Database-specific execution plan.

```typescript
interface ExecutionPlan {
  database: DatabaseType;
  statements: DatabaseStatement[];
  estimatedCost: number;
  warnings: PortabilityWarning[];
}

interface QueryPlanner {
  plan(ir: IRNode, targetDatabase: DatabaseType): ExecutionPlan;
}
```

### 5. Database Adapters (`src/adapters/`)

**Purpose:** Execute plans on specific databases.

```typescript
interface DatabaseAdapter {
  readonly type: DatabaseType;
  readonly capabilities: CapabilityRegistry;
  
  execute(plan: ExecutionPlan): Promise<QueryResult>;
  beginTransaction(): Promise<Transaction>;
  commitTransaction(tx: Transaction): Promise<void>;
  rollbackTransaction(tx: Transaction): Promise<void>;
  getConnectionPool(): ConnectionPool;
}
```

---

## Data Flow

```text
User Code
    │
    ▼
JSDB Client (Universal API)
    │
    ▼
Query Builder → Universal AST/IR
    │
    ▼
Capability Registry Check
    │
    ▼
Query Planner → Execution Plan (DB-specific)
    │
    ▼
Database Adapter → Native Query Execution
    │
    ▼
Result Mapping → User Code
```

---

## Configuration

```typescript
interface JSDBConfig {
  database: 'mysql' | 'mongodb';
  connection: ConnectionConfig;
  pool?: PoolConfig;
  logging?: LoggingConfig;
  capabilities?: CapabilityOverrides;
}
```

**Environment variable:** `JSDB_DATABASE=mysql|mongodb`

---

## Error Handling

```typescript
class JSDBError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly cause?: Error,
    public readonly portabilityInfo?: PortabilityInfo
  ) {}
}

type ErrorCode =
  | 'CONNECTION_FAILED'
  | 'QUERY_FAILED'
  | 'UNSUPPORTED_OPERATION'
  | 'CAPABILITY_MISMATCH'
  | 'TRANSACTION_FAILED'
  | 'VALIDATION_ERROR';
```

---

## Extension Points (Future Modules)

| Module | Integration Point |
|--------|-------------------|
| API Runtime | Wraps `JSDBClient` with middleware |
| Cache | Intercepts `execute()` in adapters |
| Rate Limiting | Middleware on `JSDBClient` methods |
| Auth/RBAC | Pre-execution hooks on `Collection` |
| Tenant Isolation | Automatic filter injection in Query Planner |
| Analyzers | Static analysis on IR/Usage patterns |