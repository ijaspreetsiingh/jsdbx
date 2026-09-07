# JSDB Specification

**Single Source of Truth for the JSDB Project**

---

## 1. JSDB Vision

JSDB is an npm-installable Node.js/TypeScript framework that provides a universal database runtime.

**Package name:** `jsdb`

**Install:** `npm install jsdb`

---

## 2. Core Idea

A developer should be able to install JSDB into an existing Node.js application and use a universal database API instead of tightly coupling business logic to a specific database.

---

## 3. Database Switching

The developer selects the database through environment configuration.

```env
JSDB_DATABASE=mysql
```

Later:

```env
JSDB_DATABASE=mongodb
```

The same application/business logic should continue working for operations supported by the JSDB Universal Contract.

---

## 4. Important Rule — No Magic Translation

**DO NOT claim that arbitrary raw MySQL/SQL queries can magically run on MongoDB.**

Instead:

**Universal JSDB operations → Universal AST/IR → Database-specific execution**

Database-specific features must be identified as:

* **Native** — Database directly supports it
* **Emulated** — Framework provides reliable alternative strategy
* **Unsupported** — Operation safely portable nahi hai

Unsupported operations must produce clear errors/warnings instead of silently producing incorrect results.

**Principle: Correctness over magic.**

---

## 5. Initial Database Support

**MVP:**
* MySQL
* MongoDB

**Future:**
* PostgreSQL
* SQLite
* MariaDB
* SQL Server
* Other databases where practical

---

## 6. No Runtime AI Dependency

AI is NOT part of the JSDB runtime.

AI may be used by developers during development, but the final JSDB framework must work completely without AI.

**Production runtime: ZERO AI dependency.**

---

## 7. Long-Term Vision

The complete vision includes:

* Universal Database API
* Universal AST/IR
* Query Planner
* Capability Registry
* Database Adapters
* Connection Management
* Transactions
* Portability Analyzer
* Database Migration Assistant
* API Runtime
* Caching
* Request Deduplication
* Query Batching
* Rate Limiting
* Security Runtime
* Authentication
* Authorization/RBAC
* Tenant Isolation
* Audit Logging
* Performance Analyzer
* Security Analyzer
* Observability
* Future multi-language SDKs (PHP, Python, Go, Rust)

**However, these features must be implemented incrementally.**

**Do NOT attempt to build the entire vision in the MVP.**

---

## 8. MVP Principle

Build a small but real and usable JSDB core first.

The MVP should focus primarily on:

```text
JSDB Core
│
├── TypeScript SDK
├── Universal Database API
├── MySQL Adapter
├── MongoDB Adapter
├── Universal Query AST/IR
├── Capability Registry
├── Basic Query Planner
├── CRUD
├── Filtering
├── Sorting
├── Pagination
├── Projection
├── Count
├── Basic Aggregation
├── Connection Management
├── Connection Pooling
├── Basic Transactions
├── Unified Errors
└── Logging
```

Everything else should be modular and added later.

---

## 9. Architecture Principle

The architecture must be designed so future modules can be added without rewriting the JSDB core.

Target architecture:

```text
                    JSDB
                     │
        ┌────────────┴────────────┐
        │                         │
     JSDB Core              Future Modules
        │                         │
   Universal API          ┌───────┼────────┐
        │                 │       │        │
     AST / IR            API    Security Analyzer
        │               Runtime   Runtime
   Capability              │       │        │
    Registry             Cache    Auth   Analysis
        │
   Query Planner
        │
   ┌────┴────┐
   │         │
 MySQL    MongoDB
 Adapter   Adapter
```

---

## 10. Development Rule

Before implementing any major feature, check:

1. Does it match `/docs/JSDB_SPEC.md`?
2. Does it preserve database portability?
3. Does it unnecessarily couple application code to one database?
4. Can the feature be modular?
5. Can future database adapters use the same abstraction?
6. Does it preserve the original JSDB vision?

If a proposed implementation conflicts with the specification, explain the conflict before changing the architecture.

---

## 11. Project Memory / Context Files

These files must be maintained and updated:

```text
/docs/
├── JSDB_SPEC.md           # This file - complete product vision
├── ARCHITECTURE.md        # Current technical architecture
├── ROADMAP.md             # MVP → V1 → future stages
├── DECISIONS.md           # Important architectural decisions + WHY
├── DATABASE_CAPABILITIES.md # Native/Emulated/Unsupported per DB
└── MVP_SCOPE.md           # Exactly what belongs in MVP
```

### File Purposes

| File | Purpose |
|------|---------|
| `JSDB_SPEC.md` | Complete product vision and non-negotiable principles |
| `ARCHITECTURE.md` | Current technical architecture and component relationships |
| `ROADMAP.md` | Development phases and milestones |
| `DECISIONS.md` | Architectural decisions with rationale |
| `DATABASE_CAPABILITIES.md` | Per-database capability classification |
| `MVP_SCOPE.md` | Strict MVP boundary — what's in, what's out |

These documents ensure continuity across development sessions and different contributors.