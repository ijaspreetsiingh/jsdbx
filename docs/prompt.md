JSDB — COMPLETE MASTER BUILD PROMPT
AUTONOMOUS FULL PROJECT IMPLEMENTATION
You are the principal architect and autonomous engineering agent responsible for building the complete JSDB project.
You are working inside:

text

C:\Users\ijasp\OneDrive\Desktop\jsdb
I will give you this instruction only once.

Your job is to build the complete project inside this repository.
Do NOT only create a plan.
Do NOT only create documentation.
Do NOT stop at scaffolding.
Do NOT ask me to implement remaining features manually.

Inspect → Design → Implement → Run → Test → Debug → Fix → Integrate → Document → Package.
Continue autonomously until the repository contains the most complete working implementation possible.

OFFICIAL PRODUCT NAME
The official name is:
JSDB
Meaning:
JavaScript Database Runtime
The npm package should be:

bash

npm install jsdb
The CLI should be:

bash

npx jsdb
Use JSDB consistently throughout the entire project.
Do not use UniDB as the public product name.
If old project documents contain "UniDB", treat it as the original concept name and migrate the terminology to JSDB.

CORE PRODUCT IDEA
JSDB is a Universal Database Runtime / Database Portability Framework.
The fundamental goal is:
Write application data logic once and execute it across supported database technologies without rewriting business logic.

The application should communicate with JSDB instead of directly coupling its business logic to one database.
Architecture:

text

APPLICATION  
     │  
     ▼  
 JSDB SDK  
     │  
     ▼  
UNIVERSAL DATA API  
     │  
     ▼  
UNIVERSAL AST / IR  
     │  
     ▼  
QUERY VALIDATOR  
     │  
     ▼  
CAPABILITY REGISTRY  
     │  
     ▼  
QUERY PLANNER  
     │  
     ▼  
DATABASE ADAPTER  
     │  
 ┌───┼───────────────┐  
 ▼   ▼               ▼  
MySQL MongoDB    PostgreSQL/SQLite
JSDB behaves conceptually like a compiler:

text

Universal Data Operation  
          ↓  
Universal AST / IR  
          ↓  
Capability Analysis  
          ↓  
Query Planner  
          ↓  
Database-specific execution
THE MAIN PROBLEM JSDB SOLVES
Modern applications become tightly coupled to their database.
For example:
text

Application  
     ↓  
MySQL
Later the company wants:

text

Application  
     ↓  
MongoDB
Normally developers may need to rewrite:

queries
models
relationships
filtering
pagination
sorting
aggregation
transactions
indexes
migrations
error handling
database-specific logic
tests
JSDB introduces:
text

Application  
     ↓  
JSDB  
     ↓  
Database
The database becomes replaceable within the JSDB Universal Contract.

CRITICAL PORTABILITY PRINCIPLE
JSDB must NEVER claim:
"Every database query can run on every database."

That is technically incorrect.
The actual rule is:

Every operation inside the supported JSDB Universal Contract should execute consistently across supported adapters.

Database-specific functionality must be classified as:

text

NATIVE  
EMULATED  
UNSUPPORTED
Example:

text

CRUD                  → Portable  
Filtering             → Portable  
Sorting               → Portable  
Pagination             → Portable  
Basic Aggregation      → Portable  
Transactions           → Capability dependent  
MySQL FULLTEXT        → MySQL-specific  
Stored Procedures     → MySQL-specific  
Database-specific SQL → Non-portable
Never silently produce incorrect results.
If a feature cannot be safely represented:

text

JSDB_UNSUPPORTED_OPERATION
must be returned with a clear explanation.

ZERO RUNTIME AI
This is a NON-NEGOTIABLE requirement.
JSDB runtime must work completely without AI.
Do NOT require:
OpenAI
Claude
Gemini
Grok
NVIDIA
Nemotron
Ollama
LLM APIs
Internet connectivity
AI may only assist during development.
After JSDB is built:
text

APPLICATION  
     ↓  
    JSDB  
     ↓  
DATABASE
No AI.
Query translation must be deterministic compiler-style logic.

DEVELOPER EXPERIENCE
The most important developer experience is:
bash

npm install jsdb
Then:

bash

npx jsdb init
JSDB creates/configures the project.
Example:

env

JSDB_DATABASE=mysql  
JSDB_HOST=localhost  
JSDB_PORT=3306  
JSDB_DATABASE_NAME=myapp  
JSDB_USER=root  
JSDB_PASSWORD=secret
Application code:

ts

import { db } from "jsdb";  
const users = await db.table("users")  
    .where("age", ">", 18)  
    .where("status", "=", "active")  
    .orderBy("name", "asc")  
    .limit(20)  
    .get();
Or provide a strongly typed modern API where appropriate:

ts

const users = await db.users.findMany({  
    where: {  
        age: { gt: 18 },  
        status: "active"  
    },  
    orderBy: {  
        name: "asc"  
    },  
    limit: 20  
});
Both styles may coexist if architecturally practical.

DATABASE SWITCHING
This is the primary demonstration.
Application starts with:
env

JSDB_DATABASE=mysql
The application runs against MySQL.
Later change:

env

JSDB_DATABASE=mongodb
and MongoDB configuration.
The same JSDB Universal API should continue working for supported portable operations.
Developer should NOT need:

ts

if (database === "mysql") {  
   ...  
}  
if (database === "mongodb") {  
   ...  
}
Business logic remains database-independent.

INITIAL DATABASE SUPPORT
The original project vision starts with:
text

MySQL  
+  
MongoDB
These are the highest-priority adapters because they represent fundamentally different database models.
Then support:

text

PostgreSQL  
SQLite
where practical.
Architecture must allow future adapters such as:

text

MariaDB  
SQL Server  
Redis-compatible stores  
ElasticSearch  
Cassandra  
DynamoDB  
Neo4j  
ClickHouse
BUT:
Do not force fundamentally incompatible databases into a fake universal model.
Only add an adapter where semantic mapping makes sense.

UNIVERSAL DATABASE API
Implement a complete universal API.
At minimum:
text

table()  
findMany()  
findFirst()  
findById()  
create()  
createMany()  
update()  
updateMany()  
delete()  
deleteMany()  
count()  
aggregate()
Support:

text

SELECT / projection  
INSERT  
UPDATE  
DELETE  
WHERE  
AND  
OR  
NOT  
EQ  
NE  
GT  
GTE  
LT  
LTE  
IN  
NOT IN  
NULL  
LIKE where portable  
ORDER BY  
LIMIT  
OFFSET  
PAGINATION  
COUNT  
SUM  
AVG  
MIN  
MAX  
GROUP BY where portable
Keep the universal contract explicit.

UNIVERSAL AST / IR
Create a database-independent internal representation.
Example:
text

Query  
 ├── operation  
 ├── entity  
 ├── filters  
 ├── projection  
 ├── sorting  
 ├── pagination  
 ├── aggregation  
 ├── relationships  
 └── transaction context
Flow:

text

Developer API  
      ↓  
Universal Query Builder  
      ↓  
Universal AST  
      ↓  
Validation  
      ↓  
Capability Registry  
      ↓  
Query Planner  
      ↓  
Adapter Compiler
The AST must be deterministic.

QUERY PLANNER
Implement the JSDB Query Planner.
Responsibilities:
normalize query
validate query
inspect capabilities
determine supported operations
select execution strategy
push filtering to the database
minimize unnecessary data transfer
select native operations where possible
use emulation only when safe
reject unsupported operations
generate adapter-specific execution plans
Target:
text

Universal Query  
      ↓  
Compact AST  
      ↓  
Planner  
      ↓  
Native Database Operation
Avoid unnecessary transformations.

CAPABILITY REGISTRY
Implement a central Capability Registry.
Each adapter must declare capabilities.
Example:
ts

{  
    database: "mysql",  
    feature: "transactions",  
    support: "native"  
}
Possible states:

text

native  
emulated  
unsupported
Store:

feature
database
support status
notes
fallback
limitations
semantic differences
The planner must consult the registry.
MYSQL ADAPTER
Build a real MySQL adapter.
Support:
connection
pooling
CRUD
filtering
sorting
pagination
projection
count
aggregation
transactions
indexes
parameterized queries
prepared statements where appropriate
error normalization
query timing
logging
Security:
NEVER concatenate untrusted values into SQL.
MONGODB ADAPTER
Build a real MongoDB adapter.
Support:
connection
connection reuse
CRUD
filtering
sorting
pagination
projection
count
aggregation
transactions where supported
indexes
error normalization
query timing
logging
Translate Universal AST/IR into MongoDB-native operations.
POSTGRESQL ADAPTER
Implement PostgreSQL using the same adapter contract.
Support the portable Universal API.
Register PostgreSQL capabilities.
Do not pretend PostgreSQL-specific functionality is universal.
SQLITE ADAPTER
Implement SQLite adapter.
Support the Universal API where SQLite semantics allow it.
Clearly expose limitations.
CONNECTION RUNTIME
Create a unified connection manager.
Features:
text

connection lifecycle  
pooling  
connection limits  
timeouts  
health checks  
reconnect handling  
graceful shutdown  
configuration
Application developers should not need to manually manage connections.

TRANSACTION SYSTEM
Provide:
ts

await db.transaction(async (tx) => {  
    ...  
});
Transactions should use native database transactions.
Do not fake guarantees.
Support:

text

commit  
rollback  
failure handling  
nested operations where supported
Document database-specific differences.

SCHEMA ENGINE
Create a Universal Schema system.
Support:
text

fields  
types  
required  
nullable  
defaults  
indexes  
relationships  
constraints where portable
Adapters should translate universal schema definitions into database-specific structures.

RELATIONSHIP ABSTRACTION
Support basic:
text

one-to-one  
one-to-many  
many-to-one
The system must distinguish:

text

native  
emulated  
unsupported
Do not pretend MongoDB behaves exactly like a relational database.

INDEX ABSTRACTION
Universal:
ts

schema.index("users", ["email"]);
Adapters create appropriate native indexes.
Advanced database-specific index types must remain database-specific.

DATABASE-SPECIFIC EXTENSIONS
Provide an explicit escape hatch.
Concept:
ts

db.extension("mysql", ...)
or:

ts

db.mysql(...)
or:

ts

db.raw(...)
These operations must be marked:

text

NON_PORTABLE
Portability analyzer must identify them.

MIGRATION ENGINE
Build a real migration system.
CLI:
bash

npx jsdb migrate
Support:

text

schema changes  
create table/collection  
alter structure  
indexes  
basic data migration  
migration history  
rollback where safely possible
DATABASE MIGRATION ASSISTANT
Build:
bash

npx jsdb migrate --from mysql --to mongodb
The system should:

inspect source schema
inspect data
map compatible types
detect relationships
identify portability issues
propose target structure
transfer supported data
validate results
generate migration report
Do NOT blindly convert relational tables into documents.
Provide mapping strategies.
Example:
text

users  
orders  
order_items
may become:

text

users collection  
orders collection
with configurable embedding/referencing.

PORTABILITY ANALYZER
Build:
bash

npx jsdb analyze
Example:

text

JSDB PORTABILITY REPORT  
Database: MySQL  
CRUD                  ✓  
Filtering             ✓  
Sorting               ✓  
Pagination             ✓  
Projection             ✓  
Aggregation            ✓  
Transactions           ✓  
Database-specific:  
FULLTEXT              ⚠  
Stored Procedures     ⚠  
Raw SQL               ⚠  
Portability Score:  
91 / 100
The analyzer must be based on actual detected operations.
Never fabricate results.

PERFORMANCE ENGINE
JSDB must avoid becoming a performance bottleneck.
Implement where practical:
text

connection pooling  
prepared statements  
query pushdown  
compact AST  
plan caching  
adapter-specific plan caching  
query batching  
request deduplication  
pagination  
payload minimization  
N+1 detection
Important principle:
BAD:

text

Database  
  ↓  
1,000,000 records  
  ↓  
JSDB filtering
GOOD:

text

Database  
  ↓  
Database-side filtering  
  ↓  
100 records  
  ↓  
JSDB
PLAN CACHING
Support caching of frequently executed logical query plans.
Important:
MySQL and MongoDB may require different execution strategies.
Therefore plan caching must be adapter-aware.
API RUNTIME
JSDB should include an optional API Runtime module.
Architecture:
text

HTTP Request  
     ↓  
JSDB API Runtime  
     ↓  
Validation  
     ↓  
Authentication  
     ↓  
Authorization  
     ↓  
Cache  
     ↓  
Query Planner  
     ↓  
JSDB Core  
     ↓  
Database
Implement:

text

request validation  
response shaping  
caching  
request deduplication  
query batching  
rate limiting  
timeouts  
pagination  
payload minimization  
N+1 detection  
API policies
Keep API Runtime modular so users can use JSDB Core without it.

CACHE SYSTEM
Implement pluggable caching.
Support:
text

Memory  
Redis-compatible backend
Features:

text

get  
set  
delete  
TTL  
invalidation  
namespace  
key generation
Configuration:

env

JSDB_CACHE=memory
or:

env

JSDB_CACHE=redis
REQUEST DEDUPLICATION
If multiple identical safe operations arrive concurrently:
text

Request A ─┐  
Request B ─┼──→ One underlying operation  
Request C ─┘
Implement safe deduplication.
Never deduplicate unsafe mutations.

QUERY BATCHING
Implement batching where logically safe.
Support explicit batching APIs.
Detect repeated compatible operations.
N+1 DETECTION
In development mode:
text

JSDB WARNING  
Potential N+1 query detected.  
Entity: orders  
Repeated operations: 51  
Suggestion:  
Use batching or relationship loading.
SECURITY RUNTIME
Build a modular security runtime.
Requirements:
text

authentication hooks  
authorization  
RBAC  
permissions  
field-level access control  
input validation  
safe query construction  
rate limiting  
audit logging  
secure error handling  
credential protection
Use established cryptographic/security libraries.
Do not invent cryptography.

TENANT ISOLATION
Implement multi-tenant support.
Configuration:
env

JSDB_TENANCY=true  
JSDB_TENANT_FIELD=tenantId
Architecture:

text

Request  
   ↓  
Tenant Resolver  
   ↓  
Tenant Context  
   ↓  
JSDB Query  
   ↓  
Automatic Tenant Scope  
   ↓  
Database
Supported operations must automatically include tenant isolation when configured.
Prevent accidental cross-tenant access.
Create automated tests proving:

text

Tenant A cannot read Tenant B data.  
Tenant A cannot update Tenant B data.  
Tenant A cannot delete Tenant B data.
API POLICY SYSTEM
Allow policies like:
ts

{  
    authentication: "required",  
    rateLimit: {  
        requests: 100,  
        window: "1m"  
    },  
    fields: {  
        allowed: [  
            "id",  
            "name",  
            "email"  
        ],  
        denied: [  
            "password",  
            "internalToken"  
        ]  
    }  
}
Policies should be composable.

SECURITY REQUIREMENTS
JSDB infrastructure must enforce:
text

Parameterized queries  
No SQL injection  
No NoSQL injection  
No command injection  
Secure credentials  
No password logging  
Secure connection strings  
Identifier validation  
Safe migrations  
Permission checks  
TLS/secure connections where supported  
Dependency security
Never expose secrets in logs or errors.

OBSERVABILITY
Implement structured observability.
Capture:
text

request ID  
query ID  
database  
adapter  
operation  
duration  
cache hit/miss  
error  
connection information where safe
Example:

json

{  
    "requestId": "...",  
    "database": "mysql",  
    "adapter": "mysql",  
    "operation": "findMany",  
    "duration": 4.2,  
    "cacheHit": false  
}
Never log passwords, connection secrets or sensitive data.

PERFORMANCE ANALYZER
CLI:
bash

npx jsdb analyze:performance
Detect where possible:

text

N+1 queries  
slow queries  
SELECT *  
missing pagination  
large payloads  
repeated queries  
cache opportunities  
unnecessary database calls
Provide actionable recommendations.
Do not make fake performance claims.

SECURITY ANALYZER
CLI:
bash

npx jsdb analyze:security
Detect:

text

unsafe raw queries  
missing authentication  
missing authorization  
missing rate limits  
sensitive fields  
tenant isolation problems  
unsafe error handling  
weak configuration
Clearly state what static analysis can and cannot guarantee.

CLI
Implement a professional CLI:
bash

npx jsdb init  
npx jsdb doctor  
npx jsdb db:test  
npx jsdb schema  
npx jsdb migrate  
npx jsdb analyze  
npx jsdb analyze:performance  
npx jsdb analyze:security
Future-compatible commands:

bash

npx jsdb adapter  
npx jsdb add
CLI must provide useful errors and readable output.

CONFIGURATION
Use .env and/or jsdb.config.ts.
MySQL:
env

JSDB_DATABASE=mysql  
JSDB_HOST=localhost  
JSDB_PORT=3306  
JSDB_DATABASE_NAME=myapp  
JSDB_USER=root  
JSDB_PASSWORD=
MongoDB:

env

JSDB_DATABASE=mongodb  
JSDB_MONGO_URI=mongodb://localhost:27017  
JSDB_DATABASE_NAME=myapp
PostgreSQL:

env

JSDB_DATABASE=postgres  
JSDB_DATABASE_URL=postgresql://...
SQLite:

env

JSDB_DATABASE=sqlite  
JSDB_SQLITE_PATH=./data.db
ADAPTER ARCHITECTURE
Every database adapter must implement the same core contract.
Conceptually:
text

DatabaseAdapter  
│  
├── connect()  
├── disconnect()  
├── execute()  
├── find()  
├── insert()  
├── update()  
├── delete()  
├── count()  
├── aggregate()  
├── transaction()  
├── schema()  
└── capabilities()
Do not tightly couple adapters to application logic.

CONFORMANCE TEST SUITE
This is a core intellectual feature of JSDB.
The same logical tests must run against:
text

MySQL  
MongoDB  
PostgreSQL  
SQLite
Example:

text

Create User  
Get User  
Update User  
Delete User  
Filter User  
Sort User  
Paginate User  
Count Users  
Aggregate
Expected logical behavior should be consistent.

DATA CONSISTENCY TESTING
Test:
text

NULL  
empty strings  
boolean values  
dates  
time zones  
decimal numbers  
large integers  
Unicode  
duplicate records  
ordering  
pagination  
missing fields
Document legitimate database differences.

TRANSACTION TESTING
Test:
text

successful transaction  
rollback  
failure handling  
nested operations  
concurrent transactions
Do not fake unsupported semantics.

EXAMPLE DEMO APPLICATION
Create:
text

examples/jsdb-demo/
Build a complete e-commerce demonstration.
Entities:

text

Users  
Products  
Categories  
Orders  
Order Items  
Payments
The demo must run using:

text

MySQL
Then switch to:

text

MongoDB
without changing business logic for supported features.
This becomes the primary JSDB demonstration.

DATABASE SWITCH DEMONSTRATION
The final demo must show:
Step 1
env

JSDB_DATABASE=mysql
Step 2
Run application.
Step 3
Change configuration:

env

JSDB_DATABASE=mongodb
Step 4
Run the same application.
Step 5
Verify the supported operations still work.
This is the most important proof of concept.

RAW DATABASE ESCAPE HATCH
Developers must still be able to use advanced native functionality.
Example:
ts

db.mysql(...)
or:

ts

db.mongodb(...)
or:

ts

db.raw(...)
But these operations must be explicitly marked:

text

NON_PORTABLE
This preserves power without pretending all databases are equivalent.

PROJECT DOCUMENTATION
Create:
text

docs/  
├── JSDB_SPEC.md  
├── ARCHITECTURE.md  
├── GETTING_STARTED.md  
├── UNIVERSAL_API.md  
├── MYSQL.md  
├── MONGODB.md  
├── POSTGRESQL.md  
├── SQLITE.md  
├── CAPABILITIES.md  
├── QUERY_PLANNER.md  
├── AST_IR.md  
├── SCHEMA.md  
├── TRANSACTIONS.md  
├── RELATIONSHIPS.md  
├── API_RUNTIME.md  
├── SECURITY.md  
├── TENANCY.md  
├── CACHING.md  
├── ANALYZERS.md  
├── MIGRATION.md  
├── CLI.md  
├── PERFORMANCE.md  
├── TESTING.md  
├── ROADMAP.md  
└── DECISIONS.md
SINGLE SOURCE OF TRUTH
docs/JSDB_SPEC.md is the permanent source of truth.
It must preserve the complete JSDB vision.
It must contain:

text

product vision  
problem statement  
database portability  
Universal API  
Universal AST/IR  
Capability Registry  
Query Planner  
database adapters  
transactions  
schema  
relationships  
migration  
portability analyzer  
API Runtime  
security  
tenant isolation  
performance  
observability  
CLI  
business model  
future ecosystem
Any future AI developer must read this file before modifying the architecture.

ARCHITECTURAL DECISIONS
Maintain:
text

docs/DECISIONS.md
Whenever an important architecture decision is made, document:

text

Decision  
Reason  
Alternatives  
Tradeoffs  
Impact
This prevents future AI agents from accidentally destroying the architecture.

ROADMAP
Maintain:
text

docs/ROADMAP.md
Include:

text

JSDB 0.x  
JSDB 1.x  
JSDB 2.x  
Future platform
But do NOT allow roadmap documentation to replace actual implementation of the current requested features.

FUTURE JSDB PLATFORM
The long-term vision is larger than a query builder.
JSDB should become:
UNIVERSAL DATABASE RUNTIME PLATFORM
Architecture:
text

                    JSDB PLATFORM  
                         │  
       ┌─────────────────┼─────────────────┐  
       │                 │                 │  
Universal Runtime   Migration Engine   Portability Analyzer  
       │  
       ├── MySQL  
       ├── MongoDB  
       ├── PostgreSQL  
       ├── SQLite  
       └── Future Adapters
Potential future products:

text

JSDB Cloud  
JSDB Analyze  
JSDB Migrate  
JSDB Studio  
JSDB Monitor  
JSDB Marketplace
FUTURE SDKs
Architecture should eventually support:
text

TypeScript / Node.js  
PHP  
Python  
Go  
Rust
Potential integrations:

text

Laravel  
NestJS  
Django
Do not implement every language if it compromises the current project, but keep the architecture extensible.

ADAPTER ECOSYSTEM
Future CLI concept:
bash

npx jsdb add postgres  
npx jsdb add mongodb  
npx jsdb add sqlite
Third-party adapters may eventually support:

text

ElasticSearch  
Cassandra  
DynamoDB  
Neo4j  
ClickHouse
Only where semantic mapping is meaningful.

BUSINESS MODEL
Design documentation for:
Open Source Core
Free:
text

JSDB Core  
MySQL Adapter  
MongoDB Adapter  
CLI  
Basic SDK
Pro
Potential paid features:

text

Advanced portability analyzer  
Migration tools  
Performance tools  
Advanced monitoring  
Enterprise support
Enterprise
Potential:

text

Private deployment  
SSO  
Audit logs  
SLA  
Enterprise support  
Custom adapters
Do not implement payment systems unless required for the current repository. Document the architecture/business model.

OPEN SOURCE STRATEGY
The intended strategy is:
text

Open-source JSDB Core  
+  
Commercial advanced tooling
Developers should be able to inspect and trust the core runtime.

PRODUCT PHILOSOPHY
JSDB must follow these four rules:
Rule 1
Never silently produce incorrect results.
Rule 2

Prefer native database execution.
Rule 3

Expose portability limitations clearly.
Rule 4

AI must never be required at runtime.
Core principle:
CORRECTNESS OVER MAGIC

PERFORMANCE PHILOSOPHY
JSDB should aim for:
As close to native database-driver performance as practical.

Do not promise arbitrary APIs will be "sub-millisecond".
Optimize:

text

connection reuse  
query pushdown  
compact AST  
plan caching  
batching  
deduplication  
payload minimization
Benchmark actual results.

SECURITY PHILOSOPHY
Security must be designed from the beginning.
Requirements:
text

parameterized queries  
credential isolation  
secure connections  
no secret logging  
safe migrations  
input validation  
adapter isolation  
permission checks  
dependency security  
tenant isolation
PACKAGE STRUCTURE
Use a clean modular architecture.
Recommended:
text

jsdb/  
│  
├── packages/  
│   ├── core/  
│   ├── query/  
│   ├── planner/  
│   ├── capabilities/  
│   ├── connection/  
│   ├── schema/  
│   ├── transactions/  
│   │  
│   ├── adapters/  
│   │   ├── mysql/  
│   │   ├── mongodb/  
│   │   ├── postgres/  
│   │   └── sqlite/  
│   │  
│   ├── api-runtime/  
│   ├── security/  
│   ├── analyzer/  
│   ├── migration/  
│   ├── observability/  
│   └── cli/  
│  
├── examples/  
├── tests/  
├── benchmarks/  
├── docs/  
├── scripts/  
│  
├── package.json  
├── tsconfig.json  
├── README.md  
└── .env.example
You may change the structure if you have a technically better solution.
Do not over-engineer.

TESTING STANDARD
Create automated tests for:
text

Core  
Universal API  
AST  
Planner  
Capabilities  
MySQL  
MongoDB  
PostgreSQL  
SQLite  
Transactions  
Schema  
Relationships  
Migration  
CLI  
Cache  
Deduplication  
Security  
Tenant Isolation  
Analyzers  
Observability
Cross-database tests are especially important.

PERFORMANCE BENCHMARK
Compare:
text

Native MySQL driver  
vs  
JSDB + MySQL  
Native MongoDB driver  
vs  
JSDB + MongoDB
Measure:

text

latency  
throughput  
memory  
CPU  
connection behavior
Do NOT fabricate benchmark numbers.

QUALITY REQUIREMENT
Do not create fake implementations just to make the checklist look complete.
Do not create empty placeholder functions for core functionality.
Do not claim:
text

"implemented"
unless it actually works.
If a feature cannot be implemented safely in the available environment:

implement the maximum real functionality possible
document the limitation
create an extension point
continue with the rest of the system
DEVELOPMENT LOOP
For every major phase:
text

IMPLEMENT  
   ↓  
BUILD  
   ↓  
RUN  
   ↓  
TEST  
   ↓  
FIX  
   ↓  
REFACTOR  
   ↓  
DOCUMENT  
   ↓  
CONTINUE
Never just write code without executing it.

ENVIRONMENT / DATABASE TESTING
If local MySQL/MongoDB/PostgreSQL/SQLite services are available:
use them.
If some database server is unavailable:
still implement the adapter
use mocks/unit tests where appropriate
create integration-test configuration
clearly report what could and could not be executed
Never fake a successful integration test.
NPM PACKAGE
Prepare the package for:
bash

npm install jsdb
Run:

bash

npm run build  
npm test  
npm run lint  
npm pack
Then install the generated tarball into a clean example project.
Verify:

bash

npm install ./jsdb-*.tgz
and test the public API.

CLI PACKAGE
Verify:
bash

npx jsdb init  
npx jsdb doctor  
npx jsdb db:test  
npx jsdb analyze
from a clean project.

FINAL END-TO-END TEST
Create a clean demo application.
Run:
text

JSDB + MySQL
Verify:

text

Create  
Read  
Update  
Delete  
Filter  
Sort  
Pagination  
Count  
Aggregation  
Transaction
Then switch configuration to:

text

JSDB + MongoDB
Run the same business logic.
Verify the same supported operations.

FINAL PROJECT CHECKLIST
Before declaring completion, verify:
text

✓ JSDB Core  
✓ Universal API  
✓ Universal AST / IR  
✓ Capability Registry  
✓ Query Planner  
✓ MySQL Adapter  
✓ MongoDB Adapter  
✓ PostgreSQL Adapter  
✓ SQLite Adapter  
✓ Connection Manager  
✓ Connection Pooling  
✓ Transactions  
✓ Schema Engine  
✓ Relationships  
✓ Index Abstraction  
✓ Raw Database Extensions  
✓ Migration Engine  
✓ Migration Assistant  
✓ Portability Analyzer  
✓ Performance Analyzer  
✓ Security Analyzer  
✓ API Runtime  
✓ Cache  
✓ Request Deduplication  
✓ Query Batching  
✓ N+1 Detection  
✓ Authentication Hooks  
✓ Authorization  
✓ RBAC  
✓ Field-level Access  
✓ Tenant Isolation  
✓ API Policies  
✓ Audit Logging  
✓ Observability  
✓ CLI  
✓ Conformance Tests  
✓ Benchmarks  
✓ Demo Application  
✓ Documentation  
✓ npm Package
Only mark a feature as complete if it actually exists and is tested.

FINAL REPORT
At the end, provide:
text

=====================================  
JSDB COMPLETE BUILD REPORT  
=====================================  
Project:  
JSDB  
Location:  
C:\Users\ijasp\OneDrive\Desktop\jsdb  
Build:  
PASS / FAIL  
Tests:  
X passed  
X failed  
Adapters:  
MySQL  
MongoDB  
PostgreSQL  
SQLite  
CLI:  
PASS / FAIL  
NPM PACKAGE:  
READY / NOT READY  
END-TO-END DEMO:  
PASS / FAIL  
Implemented Modules:  
...  
Known Limitations:  
...  
Security Findings:  
...  
Performance Findings:  
...  
Next Recommended Improvements:  
...
Do not falsely report success.

MOST IMPORTANT REQUIREMENT
This is NOT a request for a theoretical architecture.
This is NOT a request for a simple prototype.
This is NOT a request for only an MVP plan.
This is an instruction to build the complete JSDB project represented by this specification.
The original vision must remain intact:
text

Universal Data Model  
        +  
Universal AST / IR  
        +  
Capability Registry  
        +  
Query Planner  
        +  
Database Adapters  
        +  
Conformance Testing  
        +  
Portability Analyzer  
        +  
Migration  
        +  
API Runtime  
        +  
Security Runtime  
        +  
Observability
The final product should make database selection an infrastructure decision rather than an application-wide rewrite.

START NOW
Immediately inspect:
text

C:\Users\ijasp\OneDrive\Desktop\jsdb
Then:

Understand existing repository.
Create/update docs/JSDB_SPEC.md.
Create architecture.
Implement the complete system.
Install required dependencies.
Run builds.
Run tests.
Fix failures.
Run integration tests where infrastructure exists.
Build npm package.
Test package from a clean project.
Test CLI.
Test MySQL.
Test MongoDB.
Test database switching.
Test portability.
Test security.
Test tenant isolation.
Test performance.
Update all documentation.
Produce final build report.
Do not stop after planning.
Do not ask me what to do next.
Do not repeatedly ask for confirmation.
Make reasonable engineering decisions autonomously.
Do not sacrifice correctness just to claim completion.
BUILD JSDB.