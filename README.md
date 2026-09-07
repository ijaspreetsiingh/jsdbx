# jasdbx

**Enterprise JavaScript Database Runtime** — Write once, run on any database.

`jasdbx` is a universal database portability framework that lets you write standard SQL or MongoDB-style queries and run them on MySQL, PostgreSQL, MongoDB, or SQLite — without changing your application code.

## Features

- **Universal** — MySQL, PostgreSQL, MongoDB, SQLite support out of the box
- **Zero Code Changes** — Swap databases by changing one env var
- **Dual API** — Full callback + Promise support (works with existing codebases)
- **5-Stage Pipeline** — Developer API → IR Builder → Query Planner → Capability Check → Target Compiler
- **Enterprise Features** — Connection pooling, circuit breaker, streaming cursors, schema validation, migrations
- **Drop-in Compat** — Works as a replacement for `mysql2`, `pg`, `mongodb`, and `mongoose` drivers

## Quick Start

```bash
npm install jasdbx
```

### SQL Style (MySQL/PostgreSQL/SQLite)

```js
const mysql = require('jasdbx/mysql2');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'myapp'
});

const [rows] = await pool.query('SELECT * FROM users WHERE age > ?', [18]);
console.log(rows);
```

### MongoDB Style

```js
const { MongoClient } = require('jasdbx/mongodb');

const client = new MongoClient('mongodb://localhost:27017');
await client.connect();

const db = client.db('myapp');
const users = db.collection('users');

const result = await users.find({ age: { $gt: 18 } }).toArray();
console.log(result);
```

### Mongoose Style

```js
const mongoose = require('jasdbx/mongoose');

await mongoose.connect('mongodb://localhost:27017/myapp');

const User = mongoose.model('User', {
  name: String,
  age: Number
});

const adults = await User.find({ age: { $gte: 18 } });
```

### Switch Database (Zero Code Changes)

Change one env var:

```bash
# Use MongoDB
JSDB_DATABASE=mongodb
JSDB_MONGODB_URI=mongodb://localhost:27017
JSDB_MONGODB_DATABASE=myapp

# Switch to MySQL — same app code works!
JSDB_DATABASE=mysql
JSDB_MYSQL_HOST=localhost
JSDB_MYSQL_USER=root
JSDB_MYSQL_PASSWORD=password
JSDB_MYSQL_DATABASE=myapp

# Switch to PostgreSQL
JSDB_DATABASE=postgresql
JSDB_POSTGRES_URL=postgresql://user:pass@localhost:5432/myapp
```

## SQL DDL on MongoDB

Run standard SQL DDL statements that work across all databases:

```js
// CREATE TABLE — creates a MongoDB collection
await pool.query('CREATE TABLE IF NOT EXISTS products (id INT, name TEXT, price DECIMAL)');

// SHOW TABLES
const [tables] = await pool.query('SHOW TABLES');

// DROP TABLE
await pool.query('DROP TABLE products');
```

## Advanced Queries

### Aggregations

```js
// SQL aggregate
const [result] = await pool.query(
  'SELECT department, COUNT(*) as count, AVG(salary) as avg_salary FROM employees GROUP BY department HAVING count > 5'
);
```

### JOINs

```js
const [rows] = await pool.query(
  `SELECT u.name, o.total FROM users u
   INNER JOIN orders o ON u.id = o.user_id
   WHERE o.total > 100
   ORDER BY o.total DESC
   LIMIT 10`
);
```

### Transactions

```js
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  await connection.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1]);
  await connection.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2]);
  await connection.commit();
} catch (err) {
  await connection.rollback();
  throw err;
} finally {
  connection.release();
}
```

### Streaming

```js
const stream = pool.query('SELECT * FROM large_table').stream();
stream.on('data', (row) => console.log(row));
stream.on('end', () => console.log('done'));
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `JSDB_DATABASE` | Target database: `mongodb`, `mysql`, `postgresql`, `sqlite` | `mongodb` |
| `JSDB_MONGODB_URI` or `JSDB_MONGO_URI` | MongoDB connection string | - |
| `JSDB_MONGODB_DATABASE` or `JSDB_MONGO_DATABASE` or `JSDB_DATABASE_NAME` | Database name | - |
| `JSDB_MYSQL_HOST` or `JSDB_HOST` | MySQL host | `localhost` |
| `JSDB_MYSQL_PORT` or `JSDB_PORT` | MySQL port | `3306` |
| `JSDB_MYSQL_USER` or `JSDB_USER` | MySQL user | `root` |
| `JSDB_MYSQL_PASSWORD` or `JSDB_PASSWORD` | MySQL password | - |
| `JSDB_MYSQL_DATABASE` or `JSDB_DATABASE_NAME` | MySQL database | - |
| `JSDB_POSTGRES_URL` or `JSDB_DATABASE_URL` | PostgreSQL connection string | - |

## Compat Layers

Drop-in replacements for existing database drivers:

| Import | Replaces | API |
|--------|----------|-----|
| `jasdbx/mysql2` | `mysql2` | callback + Promise |
| `jasdbx/pg` | `pg` | callback + Promise |
| `jasdbx/mongodb` | `mongodb` | callback + Promise |
| `jasdbx/mongoose` | `mongoose` | Promise |

## CLI

```bash
npx jasdbx init --db mysql       # Initialize JSDB in your project
npx jasdbx doctor                # Check configuration & environment
npx jasdbx db:test               # Test database connectivity
npx jasdbx schema                # Show current database schema
npx jasdbx schema --export schema.json  # Export schema to file
npx jasdbx migrate               # Run pending migrations
npx jasdbx migrate:interactive   # Interactive migration mode
npx jasdbx adapter               # Show active adapter info
npx jasdbx analyze               # Full portability analysis
npx jasdbx analyze:performance   # Performance analysis
npx jasdbx analyze:security      # Security audit
```

## Enterprise Features

### Connection Pooling

```js
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'myapp',
  connectionLimit: 10,
  queueLimit: 0
});
```

### Circuit Breaker

Automatically stops sending requests to a failing database and retries after a timeout.

### Streaming Cursors

```js
const stream = pool.query('SELECT * FROM large_table').stream({ highWaterMark: 100 });
stream.on('data', (row) => console.log(row));
stream.on('end', () => console.log('done'));
```

### Schema Validation

```js
import { validateSchema } from 'jasdbx/schema';

const schema = {
  users: {
    fields: {
      id: { type: 'number', required: true },
      name: { type: 'string', required: true, maxLength: 100 },
      email: { type: 'string', unique: true }
    }
  }
};
const result = validateSchema(schema, actualSchema);
```

### Migrations

```js
import { diffSchema } from 'jasdbx/migration';

const changes = diffSchema(oldSchema, newSchema);
// Returns: [{ type: 'add_table', table: 'orders' }, { type: 'add_column', table: 'users', column: 'email' }]
```

## Peer Dependencies

These are optional — install only the databases you need:

```bash
npm install jasdbx mysql2 mongodb pg better-sqlite3
```

## Requirements

- Node.js >= 18.0.0

## License

Apache-2.0
