# JasDBX Docker Test Environment

Test jasdbx against real MySQL, MongoDB, and PostgreSQL databases.

## Quick Start

### 1. Start Docker containers
```bash
docker-compose up -d
```

### 2. Wait for databases to be ready
```bash
docker-compose logs -f
# Wait until all healthchecks pass
```

### 3. Run tests
```bash
npm install
npm run test
```

### 4. Stop containers
```bash
docker-compose down
```

## Services

| Service | Port | Credentials |
|---------|------|-------------|
| MySQL | 3309 | root / jsdbproof |
| MongoDB | 27019 | no auth |
| PostgreSQL | 5435 | root / jsdbproof |

## Environment Variables

You can override ports/host via environment variables:

```bash
PROOF_MYSQL_HOST=localhost
PROOF_MYSQL_PORT=3309
PROOF_MONGO_URI=mongodb://localhost:27019/jsdb_proof
PROOF_PG_HOST=localhost
PROOF_PG_PORT=5435
```

## Run Unit Tests (no Docker)

```bash
cd ..
npx vitest run tests/proof/
```

## Run Full Test Suite

```bash
npm run test:all
```
