#!/usr/bin/env node
// ================================================================
// JSDB Proof Runner
// Usage:
//   node scripts/run-proof.mjs          → Tier 1 only (in-memory)
//   node scripts/run-proof.mjs --docker → Tier 1 + 2 (real DBs)
//
// With --docker flag:
//   1. Starts docker-compose.proof.yml containers
//   2. Waits for all healthchecks to pass
//   3. Runs the full proof suite with PROOF_USE_DOCKER=1
//   4. Stops and removes containers
// ================================================================

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const useDocker = process.argv.includes('--docker');

const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function log(msg)   { console.log(`${CYAN}[proof]${RESET} ${msg}`); }
function ok(msg)    { console.log(`${GREEN}[proof]${RESET} ${msg}`); }
function warn(msg)  { console.log(`${YELLOW}[proof]${RESET} ${msg}`); }
function fail(msg)  { console.error(`${RED}[proof]${RESET} ${msg}`); }

function run(cmd, opts = {}) {
  log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts });
}

function runSilent(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8' });
}

async function waitForHealth(serviceName, maxWaitSecs = 90) {
  const start = Date.now();
  log(`Waiting for ${serviceName} to be healthy...`);
  while ((Date.now() - start) / 1000 < maxWaitSecs) {
    try {
      const out = runSilent(
        `docker compose -f docker-compose.proof.yml ps --format json ${serviceName}`
      ).trim();
      // May be multiple JSON objects; find any with health=healthy
      const lines = out.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          const health = (obj.Health ?? obj.Status ?? '').toLowerCase();
          if (health === 'healthy' || health.includes('running')) {
            ok(`${serviceName} is healthy`);
            return true;
          }
        } catch {}
      }
    } catch {}
    await new Promise(r => setTimeout(r, 3000));
    process.stdout.write('.');
  }
  console.log('');
  fail(`${serviceName} did not become healthy within ${maxWaitSecs}s`);
  return false;
}

async function main() {
  console.log(`\n${BOLD}${CYAN}╔══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}║       JSDB PROOF TEST RUNNER             ║${RESET}`);
  console.log(`${BOLD}${CYAN}╚══════════════════════════════════════════╝${RESET}\n`);

  if (useDocker) {
    log('Mode: DOCKER (Tier 1 in-memory + Tier 2 real databases)');
  } else {
    log('Mode: IN-MEMORY only (Tier 1)');
    warn('Run with --docker flag to also test against real MySQL/MongoDB/PostgreSQL');
  }

  // ── Step 1: Build ──────────────────────────────────────────────
  console.log(`\n${BOLD}Step 1: Build JSDB${RESET}`);
  run('npm run build');
  ok('Build complete');

  // ── Step 2: Start Docker (optional) ───────────────────────────
  if (useDocker) {
    console.log(`\n${BOLD}Step 2: Start Docker containers${RESET}`);
    run('docker compose -f docker-compose.proof.yml up -d');

    log('Waiting for containers to be healthy (up to 90 seconds)...');
    const services = ['proof-mysql', 'proof-mongodb', 'proof-postgres'];
    const results = await Promise.all(services.map(s => waitForHealth(s)));
    if (results.some(r => !r)) {
      fail('One or more containers failed to become healthy. Tearing down...');
      try { run('docker compose -f docker-compose.proof.yml down -v'); } catch {}
      process.exit(1);
    }
    ok('All containers healthy');
  } else {
    console.log(`\n${BOLD}Step 2: Docker containers skipped (no --docker flag)${RESET}`);
  }

  // ── Step 3: Run proof tests ────────────────────────────────────
  console.log(`\n${BOLD}Step 3: Run proof tests${RESET}`);
  let exitCode = 0;
  try {
    const env = {
      ...process.env,
      ...(useDocker ? {
        PROOF_USE_DOCKER: '1',
        PROOF_MYSQL_HOST: 'localhost',
        PROOF_MYSQL_PORT: '3309',
        PROOF_MYSQL_USER: 'root',
        PROOF_MYSQL_PASSWORD: 'jsdbproof',
        PROOF_MYSQL_DB: 'jsdb_proof',
        PROOF_MONGO_URI: 'mongodb://localhost:27019/jsdb_proof',
        PROOF_MONGO_DB: 'jsdb_proof',
        PROOF_PG_HOST: 'localhost',
        PROOF_PG_PORT: '5435',
        PROOF_PG_USER: 'root',
        PROOF_PG_PASSWORD: 'jsdbproof',
        PROOF_PG_DB: 'jsdb_proof',
      } : {}),
    };

    execSync(
      'npx vitest run --config vitest.proof.config.ts',
      { stdio: 'inherit', cwd: ROOT, env }
    );
    ok('All proof tests passed');
  } catch (err) {
    fail('Proof tests failed');
    exitCode = 1;
  }

  // ── Step 4: Tear down Docker ───────────────────────────────────
  if (useDocker) {
    console.log(`\n${BOLD}Step 4: Tear down Docker containers${RESET}`);
    try {
      run('docker compose -f docker-compose.proof.yml down -v');
      ok('Containers removed');
    } catch {
      warn('Failed to remove containers — run manually: docker compose -f docker-compose.proof.yml down -v');
    }
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log(`\n${BOLD}${exitCode === 0 ? GREEN : RED}══════════════════════════════════════════${RESET}`);
  if (exitCode === 0) {
    console.log(`${BOLD}${GREEN}  PROOF COMPLETE — all tests passed${RESET}`);
    if (!useDocker) {
      console.log(`${YELLOW}  Tier 1 (in-memory) only. Add --docker for full proof.${RESET}`);
    }
  } else {
    console.log(`${BOLD}${RED}  PROOF FAILED — see output above${RESET}`);
  }
  console.log(`${BOLD}${exitCode === 0 ? GREEN : RED}══════════════════════════════════════════${RESET}\n`);

  process.exit(exitCode);
}

main().catch(err => {
  fail(`Unexpected error: ${err.message}`);
  process.exit(1);
});
