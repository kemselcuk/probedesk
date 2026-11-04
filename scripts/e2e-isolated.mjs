#!/usr/bin/env node
/**
 * P7-05 — isolated E2E database runner.
 *
 * The Playwright suite creates real plans, runs and sessions. It must not use
 * the development database (or the integration-test database while that suite
 * is running). This script creates/uses a dedicated `probedesk_e2e_test`
 * database on the existing test PostgreSQL container, applies migrations and
 * the additive demo seed, and prints the commands that start the API and web
 * app against that database.
 *
 * It never drops a database and never resets user data.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   export E2E_DATABASE_URL="${TEST_DATABASE_URL%/*}/probedesk_e2e_test"
 *   node scripts/e2e-isolated.mjs prepare
 *   node scripts/e2e-isolated.mjs seed-check
 *   node scripts/e2e-isolated.mjs status
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';
import { Client } from 'pg';

const root = fileURLToPath(new URL('..', import.meta.url));
const apiRoot = fileURLToPath(new URL('../apps/api/', import.meta.url));
const require = createRequire(import.meta.url);
const prismaCli = require.resolve('prisma/build/index.js');
const dedicatedDatabaseName = 'probedesk_e2e_test';

loadDotEnv({ path: [`${root}.env`], quiet: true });

function fail(message) {
  console.error(`[e2e-isolated] ${message}`);
  process.exitCode = 1;
}

function databaseName(connectionString) {
  const url = new URL(connectionString);
  return decodeURIComponent(url.pathname).replace(/^\/+/, '').replace(/\/+$/, '');
}

function resolveDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) {
    return process.env.E2E_DATABASE_URL;
  }

  if (process.env.TEST_DATABASE_URL) {
    const derived = new URL(process.env.TEST_DATABASE_URL);
    derived.pathname = `/${dedicatedDatabaseName}`;
    return derived.toString();
  }

  throw new Error(
    'E2E_DATABASE_URL (or TEST_DATABASE_URL to derive it from) is required. ' +
      'Source the repository .env first.',
  );
}

function assertSafeDatabase(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error('E2E_DATABASE_URL is not a valid URL.');
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('E2E_DATABASE_URL must use postgres:// or postgresql://.');
  }

  const database = databaseName(connectionString);
  if (!database) {
    throw new Error('E2E_DATABASE_URL must include a database name.');
  }
  if (!/_test$/i.test(database)) {
    throw new Error(
      `Refusing to prepare E2E database "${database}": its name must end with "_test".`,
    );
  }

  if (process.env.DATABASE_URL) {
    const development = new URL(process.env.DATABASE_URL);
    if (
      development.hostname === url.hostname &&
      (development.port || '5432') === (url.port || '5432') &&
      databaseName(development.toString()) === database
    ) {
      throw new Error('Refusing to prepare the development database as the E2E database.');
    }
  }

  const integrationDatabase = process.env.TEST_DATABASE_URL
    ? databaseName(process.env.TEST_DATABASE_URL)
    : undefined;
  if (integrationDatabase === database) {
    console.warn(
      `[e2e-isolated] "${database}" is also TEST_DATABASE_URL. Prefer a dedicated ` +
        `"${dedicatedDatabaseName}" database so the integration suite cannot race the E2E suite.`,
    );
  }

  return { url, database };
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe database identifier: "${value}".`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

async function ensureDatabase(connectionString, database) {
  const maintenance = new URL(connectionString);
  maintenance.pathname = '/postgres';
  const client = new Client({
    connectionString: maintenance.toString(),
    application_name: 'probedesk-e2e-prepare',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();

  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      database,
    ]);
    if (existing.rowCount === 0) {
      console.log(`[e2e-isolated] creating database ${database}`);
      await client.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
    } else {
      console.log(`[e2e-isolated] using existing database ${database}`);
    }
  } finally {
    await client.end();
  }
}

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${options.label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}.`,
        ),
      );
    });
  });
}

async function migrate(connectionString) {
  console.log('[e2e-isolated] applying migrations with prisma migrate deploy');
  await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiRoot,
    label: 'migrate deploy',
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      NODE_ENV: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    },
  });
}

async function seed(connectionString) {
  console.log('[e2e-isolated] running additive demo seed');
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'demo:seed', '--workspace', 'apps/api'], {
    cwd: root,
    label: 'demo:seed',
    env: {
      ...process.env,
      DATABASE_URL: connectionString,
      NODE_ENV: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    },
  });
}

function countValue(row, key) {
  return Number(row[key] ?? 0);
}

async function snapshot(connectionString, applicationName = 'probedesk-e2e-status') {
  const client = new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();

  try {
    const result = await client.query(`
      SELECT
        (SELECT count(*) FROM test_plans) AS plans,
        (SELECT count(*) FROM test_runs) AS runs,
        (SELECT count(*) FROM test_runs WHERE status = 'RUNNING') AS active_runs,
        (SELECT count(*) FROM sessions) AS sessions,
        (SELECT count(*) FROM plan_revisions) AS plan_revisions,
        (SELECT count(*) FROM users WHERE email = ANY(ARRAY[
          'planner@probedesk.local', 'operator@probedesk.local', 'viewer@probedesk.local'
        ])) AS demo_users,
        (SELECT count(*) FROM device_profiles WHERE code = 'DC_POWER_MODULE') AS demo_profiles,
        (SELECT coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '') FROM test_plans) AS plans_digest,
        (SELECT coalesce(md5(string_agg(id::text || ':' || "status"::text || ':' || coalesce("outcome"::text, '-'), ',' ORDER BY id)), '') FROM test_runs) AS runs_digest,
        (SELECT coalesce(md5(string_agg(id::text || ':' || "state"::text || ':' || coalesce("versionNumber"::text, '-'), ',' ORDER BY id)), '') FROM plan_revisions) AS revisions_digest,
        (SELECT coalesce(md5(string_agg("email" || ':' || "role"::text || ':' || "passwordHash", ',' ORDER BY "email")), '') FROM users
          WHERE "email" = ANY(ARRAY['planner@probedesk.local', 'operator@probedesk.local', 'viewer@probedesk.local'])) AS demo_users_digest
    `);

    const row = result.rows[0];
    return {
      plans: countValue(row, 'plans'),
      runs: countValue(row, 'runs'),
      activeRuns: countValue(row, 'active_runs'),
      sessions: countValue(row, 'sessions'),
      planRevisions: countValue(row, 'plan_revisions'),
      demoUsers: countValue(row, 'demo_users'),
      demoProfiles: countValue(row, 'demo_profiles'),
      plansDigest: String(row.plans_digest ?? ''),
      runsDigest: String(row.runs_digest ?? ''),
      revisionsDigest: String(row.revisions_digest ?? ''),
      demoUsersDigest: String(row.demo_users_digest ?? ''),
    };
  } finally {
    await client.end();
  }
}

function printSnapshot(label, value) {
  console.log(
    `[e2e-isolated] ${label}: plans=${value.plans} revisions=${value.planRevisions} ` +
      `runs=${value.runs} activeRuns=${value.activeRuns} sessions=${value.sessions} ` +
      `demoUsers=${value.demoUsers} demoProfiles=${value.demoProfiles}`,
  );
}

function assertSameHistory(before, after, label) {
  const unchanged =
    before.plans === after.plans &&
    before.planRevisions === after.planRevisions &&
    before.runs === after.runs &&
    before.plansDigest === after.plansDigest &&
    before.runsDigest === after.runsDigest &&
    before.revisionsDigest === after.revisionsDigest &&
    before.demoUsersDigest === after.demoUsersDigest &&
    before.demoUsers === after.demoUsers &&
    before.demoProfiles === after.demoProfiles;

  if (!unchanged) {
    throw new Error(`${label} changed plans, revisions, runs, demo users or profiles.`);
  }

  console.log(`[e2e-isolated] ${label}: history and demo fixture digests unchanged`);
}

async function assertBaseline() {
  const connectionString = resolveDatabaseUrl();
  const { database } = assertSafeDatabase(connectionString);
  const counts = await snapshot(connectionString, 'probedesk-e2e-baseline');
  const expected = {
    plans: 1,
    planRevisions: 2,
    runs: 4,
    activeRuns: 0,
    sessions: 0,
    demoUsers: 3,
    demoProfiles: 1,
  };
  const mismatches = Object.entries(expected).filter(
    ([key, value]) => counts[key] !== value,
  );
  if (mismatches.length > 0) {
    throw new Error(
      `[e2e-isolated] ${database} is not at the seeded baseline: ` +
        mismatches
          .map(([key, value]) => `${key} expected ${value}, got ${counts[key]}`)
          .join('; '),
    );
  }
  console.log(`[e2e-isolated] ${database}: seeded baseline unchanged`);
}

async function prepare() {
  const connectionString = resolveDatabaseUrl();
  const { url, database } = assertSafeDatabase(connectionString);

  await ensureDatabase(connectionString, database);
  await migrate(connectionString);
  await seed(connectionString);

  const value = await snapshot(connectionString, 'probedesk-e2e-prepare');
  printSnapshot('baseline', value);
  if (value.demoUsers !== 3 || value.demoProfiles !== 1) {
    throw new Error('Demo seed did not create the three accounts and one profile.');
  }

  console.log('');
  console.log(`[e2e-isolated] E2E database ready: ${url.host}/${database}`);
  console.log('[e2e-isolated] Start the API against the same URL, for example:');
  console.log(
    '  DATABASE_URL="$E2E_DATABASE_URL" PORT=3101 NODE_ENV=development ' +
      'npm run start:prod --workspace apps/api',
  );
  console.log('[e2e-isolated] Start the web app with a proxy to that API (new terminal):');
  console.log(
    '  printf \'{"\\/api":{"target":"http://127.0.0.1:3101","secure":false,' +
      '"changeOrigin":false,"logLevel":"warn"}}\\n\' > "$TMPDIR/probedesk-e2e-proxy.json"',
  );
  console.log(
    '  npm run start --workspace apps/web -- --port 4300 --host 127.0.0.1 ' +
      '--proxy-config "$TMPDIR/probedesk-e2e-proxy.json"',
  );
  console.log('[e2e-isolated] Then run Playwright with the same environment:');
  console.log(
    '  E2E_DATABASE_URL="$E2E_DATABASE_URL" E2E_API_URL=http://127.0.0.1:3101 ' +
      'E2E_BASE_URL=http://127.0.0.1:4300 npm run test:e2e',
  );
}

async function seedCheck() {
  const connectionString = resolveDatabaseUrl();
  assertSafeDatabase(connectionString);

  const before = await snapshot(connectionString, 'probedesk-e2e-seed-check');
  printSnapshot('before seed', before);
  if (before.demoUsers !== 3 || before.demoProfiles !== 1) {
    throw new Error(
      'The database is not seeded yet. Run "node scripts/e2e-isolated.mjs prepare" first.',
    );
  }

  await seed(connectionString);
  const afterFirst = await snapshot(connectionString, 'probedesk-e2e-seed-check');
  printSnapshot('after first seed ', afterFirst);
  assertSameHistory(before, afterFirst, 'first seed');

  await seed(connectionString);
  const afterSecond = await snapshot(connectionString, 'probedesk-e2e-seed-check');
  printSnapshot('after second seed', afterSecond);
  assertSameHistory(afterFirst, afterSecond, 'second seed');
}

async function status() {
  const connectionString = resolveDatabaseUrl();
  const { url, database } = assertSafeDatabase(connectionString);
  const value = await snapshot(connectionString);
  console.log(`[e2e-isolated] ${url.host}/${database}`);
  printSnapshot('status', value);
  if (value.activeRuns > 0) {
    throw new Error(`The E2E database has ${value.activeRuns} active run(s).`);
  }
}

const command = process.argv[2] ?? 'prepare';

try {
  if (command === 'prepare') {
    await prepare();
  } else if (command === 'seed-check') {
    await seedCheck();
  } else if (command === 'status') {
    await status();
  } else if (command === 'assert-baseline') {
    await assertBaseline();
  } else {
    fail(
      `Unknown command "${command}". Use prepare, seed-check, status or assert-baseline.`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
