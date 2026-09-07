# JSDB Architectural Decisions

**Important decisions and their rationale**

---

## 1. Universal AST/IR Instead of String-Based Query Building

**Decision:** Build a structured Intermediate Representation (IR) rather than generating SQL/MongoDB queries directly from method chains.

**Rationale:**
- Enables capability analysis before execution
- Allows query optimization (planner) independent of target database
- Makes portability analysis possible (static analysis on IR)
- Cleaner separation: API → IR → Planner → Adapter
- Future: enables query caching at IR level

**Trade-off:** More upfront complexity vs. direct string building.

---

## 2. Capability Registry: Native / Emulated / Unsupported

**Decision:** Explicit three-tier classification per operation per database. No silent fallbacks.

**Rationale:**
- "Correctness over magic" — developer must know when behavior changes
- Unsupported = explicit error, not wrong results
- Emulated = documented strategy with known limitations
- Enables Portability Analyzer to give accurate reports

**Trade-off:** More work to classify everything; some operations marked "unsupported" that could work with effort.

---

## 3. Environment Variable for Database Selection

**Decision:** `JSDB_DATABASE=mysql|mongodb` as primary switch, with code config override.

**Rationale:**
- Zero code changes to switch databases in CI/staging/prod
- Matches 12-factor app principles
- Enables true portability testing

**Trade-off:** Requires all adapters to implement identical interface.

---

## 4. Adapter Pattern with Shared IR/Planner

**Decision:** Each database gets its own adapter package; shared IR and planner in core.

**Rationale:**
- Adapters can be developed/maintained independently
- New databases don't require core changes
- Clear boundary: core = universal, adapter = specific
- Future: marketplace for community adapters

**Trade-off:** More packages to coordinate; version synchronization needed.

---

## 5. TypeScript-First, No Runtime Type Checking

**Decision:** Full TypeScript types for developer experience; no `zod`/`io-ts` validation at runtime in MVP.

**Rationale:**
- Keeps bundle size small
- Zero runtime overhead
- TypeScript provides compile-time safety
- Can add runtime validation as optional module later

**Trade-off:** Invalid data at runtime won't be caught until query execution.

---

## 6. Use `mysql2/promise` and Official `mongodb` Driver

**Decision:** Wrap official drivers rather than reimplementing protocol.

**Rationale:**
- Battle-tested, maintained by database vendors
- Connection pooling, TLS, auth handled correctly
- Focus effort on translation layer, not network protocol
- Easier security audits

**Trade-off:** Dependency on external packages; version lock-in.

---

## 7. Fluent Query Builder → IR at Execution Time

**Decision:** Query builder methods (`.find()`, `.where()`, `.sort()`) build a mutable query object; IR is generated when `.toArray()`/`.exec()` called.

**Rationale:**
- Familiar developer experience (like Mongoose, Prisma)
- Allows method chaining
- IR generation deferred until all clauses known
- Enables planner to see full query

**Trade-off:** Mutable builder state; must clone for reuse.

---

## 8. Transactions: Opt-In, Adapter-Specific Semantics

**Decision:** `client.transaction(async (tx) => { ... })` with adapter handling BEGIN/COMMIT/ROLLBACK.

**Rationale:**
- MySQL: ACID transactions with isolation levels
- MongoDB: Causal consistency via sessions (not full ACID)
- Capability registry marks transaction support per DB
- Developer opts in explicitly

**Trade-off:** Can't provide universal transaction semantics; must document per-DB behavior.

---

## 9. No ORM-Style Entity/Schema Definitions in MVP

**Decision:** Schema-less, document/row-based API. No decorators, no entity classes.

**Rationale:**
- Keeps core minimal
- Works with existing databases (no migration needed)
- Schema can be layered on top later (separate package)
- Matches MongoDB flexibility + SQL reality

**Trade-off:** Less type safety vs. Prisma/Drizzle; more verbose for complex apps.

---

## 10. Unified Error Hierarchy with Portability Info

**Decision:** All errors extend `JSDBError` with `code`, `cause`, and optional `portabilityInfo`.

**Rationale:**
- Consistent error handling across databases
- Portability info helps migration: "This works on MySQL but not MongoDB"
- Structured codes enable programmatic handling

**Trade-off:** More error classes to maintain.

---

## 11. Logging: Pluggable, Structured, Leveled

**Decision:** `logger: { debug, info, warn, error }` interface; default to `console` with levels.

**Rationale:**
- Integrates with any logging framework (pino, winston, etc.)
- Structured logs enable observability
- Zero dependencies in core

**Trade-off:** No pretty printing by default.

---

## 12. Connection Pool: Per-Client, Configurable

**Decision:** Each `JSDBClient` owns a pool; config via `pool: { min, max, idleTimeout }`.

**Rationale:**
- Explicit resource ownership
- Enables multi-tenant (one client per tenant)
- Configurable for serverless vs. long-running

**Trade-off:** Developer must manage `connect()`/`disconnect()`.

---

## 13. Pagination: Offset-Based in MVP, Cursor-Based Future

**Decision:** MVP uses `limit`/`offset` (maps to `LIMIT/OFFSET` and `skip/limit`).

**Rationale:**
- Universal across SQL and MongoDB
- Simple to understand and implement
- Cursor-based requires sort stability guarantees

**Trade-off:** Offset pagination degrades on large datasets; documented limitation.

---

## 14. Aggregation: Pipeline Model (MongoDB-style) Mapped to SQL

**Decision:** Use MongoDB aggregation pipeline as universal model; compile to SQL `GROUP BY`/`WINDOW` functions.

**Rationale:**
- MongoDB pipeline is more expressive than SQL `GROUP BY`
- Can represent: `$match`, `$group`, `$project`, `$sort`, `$limit`, `$lookup` (basic)
- SQL compilation targets standard SQL:2003 features

**Trade-off:** Complex SQL generation; some pipelines "unsupported" on MySQL.

---

## 15. No Built-in Migration Tool in MVP

**Decision:** Schema migrations out of scope for MVP.

**Rationale:**
- Core problem is query portability, not schema management
- Existing tools (Flyway, Liquibase, mongock) handle this well
- Can integrate later as optional module

**Trade-off:** Developer manages schema separately.