#!/usr/bin/env node
/**
 * P7-05 — isolated E2E database runner.
 *
 * The Playwright suite creates real plans, runs, devices, copy provenance and
 * sessions. It must not use the development database (or the integration-test
 * database while that suite is running). This script creates/uses a dedicated
 * `probedesk_e2e_test` database on the existing test PostgreSQL container,
 * applies migrations through the repository guard and the additive demo seed,
 * and prints the commands that start the API and web app against that database.
 *
 * It never drops a database and never resets user data. Migrations only go
 * through `npm run db:migrate:test --workspace apps/api`, which requires both
 * the original development URL and the dedicated test URL and refuses unsafe
 * targets. The seed and API bootstrap always receive the isolated URL as an
 * explicit DATABASE_URL.
 *
 * Usage:
 *   set -a; source .env; set +a
 *   export E2E_DATABASE_URL="${TEST_DATABASE_URL%/*}/probedesk_e2e_test"
 *   node scripts/e2e-isolated.mjs prepare
 *   node scripts/e2e-isolated.mjs seed-check
 *   node scripts/e2e-isolated.mjs status
 *   node scripts/e2e-isolated.mjs assert-baseline
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";
import { Client } from "pg";

const root = fileURLToPath(new URL("..", import.meta.url));
const dedicatedDatabaseName = "probedesk_e2e_test";
const DEMO_USER_EMAILS = [
  "planner@probedesk.local",
  "operator@probedesk.local",
  "viewer@probedesk.local",
];
const DEMO_PLAN_NAME = "Power Supply Validation";
const DEMO_PROFILE_CODE = "DC_POWER_MODULE";
/**
 * Fixed ids from apps/api/prisma/seed-data.ts. These are the two additive demo
 * devices. Other test-created devices are deliberately not part of the
 * expected baseline.
 */
const DEMO_DEVICE_IDS = [
  "5f0d3c1e-2a4b-4c6d-8e9f-000000000001",
  "5f0d3c1e-2a4b-4c6d-8e9f-000000000002",
];

loadDotEnv({ path: [`${root}.env`], quiet: true });

function fail(message) {
  console.error(`[e2e-isolated] ${message}`);
  process.exitCode = 1;
}

function databaseName(connectionString) {
  const url = new URL(connectionString);
  return decodeURIComponent(url.pathname)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function parseConnection(connectionString, label) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${label} is not a valid PostgreSQL connection URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${label} must use postgres:// or postgresql://.`);
  }

  const database = databaseName(connectionString);
  if (!database) {
    throw new Error(`${label} must include a database name.`);
  }

  const host = url.hostname.toLowerCase();
  const normalisedHost =
    host === "127.0.0.1" || host === "::1" || host === "[::1]"
      ? "localhost"
      : host;
  const port = url.port || "5432";

  return {
    url,
    database,
    identity: `${normalisedHost}:${port}/${database}`,
  };
}

function resolveDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) {
    return process.env.E2E_DATABASE_URL;
  }

  if (process.env.TEST_DATABASE_URL) {
    // Credentials are intentionally taken from the integration test URL, not
    // from the application's development database.
    const derived = new URL(process.env.TEST_DATABASE_URL);
    derived.pathname = `/${dedicatedDatabaseName}`;
    return derived.toString();
  }

  throw new Error(
    "E2E_DATABASE_URL (or TEST_DATABASE_URL to derive it from) is required. " +
      "Source the repository .env first.",
  );
}

function resolveDevelopmentUrl(connectionString) {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  if (process.env.TEST_DATABASE_URL) {
    return process.env.TEST_DATABASE_URL;
  }

  // CI starts a disposable PostgreSQL service with only E2E_DATABASE_URL.
  // There is no development database to identify, so use a sibling database
  // name on the same server as the guard identity. This URL is never connected
  // to; the guard only needs a stable, different identity.
  const derived = new URL(connectionString);
  derived.pathname = "/probedesk_test";
  console.warn(
    "[e2e-isolated] DATABASE_URL/TEST_DATABASE_URL are not set; using a derived " +
      "non-target guard identity for the migration check.",
  );
  return derived.toString();
}

function assertSafeDatabase(connectionString) {
  const target = parseConnection(connectionString, "E2E_DATABASE_URL");

  if (!/_test$/i.test(target.database)) {
    throw new Error(
      `Refusing to prepare E2E database "${target.database}": its name must end with "_test".`,
    );
  }

  const developmentUrl = resolveDevelopmentUrl(connectionString);
  const development = parseConnection(developmentUrl, "DATABASE_URL");
  if (development.identity === target.identity) {
    throw new Error(
      "Refusing to prepare the development database as the E2E database.",
    );
  }

  if (process.env.TEST_DATABASE_URL) {
    const integration = parseConnection(
      process.env.TEST_DATABASE_URL,
      "TEST_DATABASE_URL",
    );
    if (integration.identity === target.identity) {
      console.warn(
        `[e2e-isolated] "${target.database}" is also TEST_DATABASE_URL. Prefer a ` +
          `dedicated "${dedicatedDatabaseName}" database so the integration suite ` +
          `cannot race the E2E suite.`,
      );
    }
  }

  return { ...target, developmentUrl };
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe database identifier: "${value}".`);
  }
  return `"${value.replaceAll('"', '""')}"`;
}

async function ensureDatabase(connectionString, database) {
  if (database === "postgres") {
    throw new Error(
      "Refusing to use the PostgreSQL maintenance database as the E2E database.",
    );
  }

  const maintenance = new URL(connectionString);
  maintenance.pathname = "/postgres";
  const client = new Client({
    connectionString: maintenance.toString(),
    application_name: "probedesk-e2e-prepare",
    connectionTimeoutMillis: 5000,
  });
  await client.connect();

  try {
    const existing = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database],
    );
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
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
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

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * Migrations always go through the repository guard. It receives the original
 * development URL for identity comparison and the dedicated test URL as the
 * only migration target; its child Prisma process rewrites DATABASE_URL
 * internally to the validated test URL.
 */
async function migrate(connectionString, developmentUrl) {
  console.log(
    "[e2e-isolated] applying migrations with guarded db:migrate:test",
  );
  await run(
    npmCommand(),
    ["run", "db:migrate:test", "--workspace", "apps/api"],
    {
      cwd: root,
      label: "db:migrate:test",
      env: {
        ...process.env,
        NODE_ENV: "test",
        DATABASE_URL: developmentUrl,
        TEST_DATABASE_URL: connectionString,
        PROBEDESK_SKIP_DOTENV: "1",
      },
    },
  );
}

/**
 * The seed script is not the Nest application, but it still gets the isolated
 * URL explicitly. Dotenv is skipped so no original .env database can win.
 */
async function seed(connectionString) {
  console.log(
    "[e2e-isolated] running additive demo seed against the isolated database",
  );
  const environment = {
    ...process.env,
    NODE_ENV:
      process.env.NODE_ENV === "production" ? "production" : "development",
    DATABASE_URL: connectionString,
    PROBEDESK_SKIP_DOTENV: "1",
  };
  delete environment.TEST_DATABASE_URL;
  delete environment.E2E_DATABASE_URL;

  await run(npmCommand(), ["run", "demo:seed", "--workspace", "apps/api"], {
    cwd: root,
    label: "demo:seed",
    env: environment,
  });
}

function countValue(row, key) {
  return Number(row[key] ?? 0);
}

function combineDigests(parts) {
  return createHash("md5").update(parts.join("|")).digest("hex");
}

async function snapshot(
  connectionString,
  applicationName = "probedesk-e2e-status",
) {
  const client = new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();

  try {
    const result = await client.query(
      `
      WITH demo_users AS (
        SELECT * FROM users WHERE email = ANY($1::text[])
      ),
      demo_plans AS (
        SELECT p.*
        FROM test_plans p
        WHERE p."createdById" = (
          SELECT id FROM demo_users WHERE email = 'planner@probedesk.local'
        )
          AND EXISTS (
            SELECT 1
            FROM plan_revisions r
            WHERE r."planId" = p.id AND r."name" = $2
          )
      ),
      demo_revisions AS (
        SELECT r.* FROM plan_revisions r JOIN demo_plans p ON p.id = r."planId"
      ),
      demo_runs AS (
        SELECT tr.* FROM test_runs tr JOIN demo_plans p ON p.id = tr."planId"
      )
      SELECT
        (SELECT count(*) FROM test_plans) AS plans,
        (SELECT count(*) FROM test_runs) AS runs,
        (SELECT count(*) FROM test_runs WHERE status = 'RUNNING') AS active_runs,
        (SELECT count(*) FROM sessions) AS sessions,
        (SELECT count(*) FROM plan_revisions) AS plan_revisions,
        (SELECT count(*) FROM users WHERE email = ANY($1::text[])) AS demo_users,
        (SELECT count(*) FROM device_profiles WHERE code = $3) AS demo_profiles,
        (SELECT count(*) FROM devices) AS devices,
        (SELECT count(*) FROM devices WHERE id = ANY($4::uuid[])) AS demo_devices,
        (SELECT count(*) FROM plan_copy_requests) AS plan_copy_requests,
        (SELECT count(*) FROM demo_runs) AS demo_runs,
        (SELECT coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '') FROM test_plans) AS plans_digest,
        (SELECT coalesce(md5(string_agg(id::text || ':' || "status"::text || ':' || coalesce("outcome"::text, '-'), ',' ORDER BY id)), '') FROM test_runs) AS runs_digest,
        (SELECT coalesce(md5(string_agg(id::text || ':' || "state"::text || ':' || coalesce("versionNumber"::text, '-'), ',' ORDER BY id)), '') FROM plan_revisions) AS revisions_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(u)::text, ',' ORDER BY u.email)), '') FROM demo_users u) AS demo_users_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(d)::text, ',' ORDER BY d.id)), '') FROM devices d) AS devices_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(c)::text, ',' ORDER BY c.id)), '') FROM plan_copy_requests c) AS copy_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(dp)::text, ',' ORDER BY dp.code)), '') FROM device_profiles dp WHERE dp.code = $3) AS demo_profiles_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(p)::text, ',' ORDER BY p.id)), '') FROM demo_plans p) AS demo_plans_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(r)::text, ',' ORDER BY r.id)), '') FROM demo_revisions r) AS demo_revisions_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(s)::text, ',' ORDER BY s.id)), '')
           FROM plan_steps s WHERE s."planId" IN (SELECT id FROM demo_plans)) AS demo_plan_steps_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(si)::text, ',' ORDER BY si.id)), '')
           FROM step_identities si WHERE si."planId" IN (SELECT id FROM demo_plans)) AS demo_step_identities_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(dv)::text, ',' ORDER BY dv.id)), '') FROM devices dv WHERE dv.id = ANY($4::uuid[])) AS demo_devices_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(tr)::text, ',' ORDER BY tr.id)), '') FROM demo_runs tr) AS demo_runs_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(rs)::text, ',' ORDER BY rs.id)), '')
           FROM run_steps rs WHERE rs."runId" IN (SELECT id FROM demo_runs)) AS demo_run_steps_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(m)::text, ',' ORDER BY m.id)), '')
           FROM measurements m WHERE m."runId" IN (SELECT id FROM demo_runs)) AS demo_measurements_digest,
        (SELECT coalesce(md5(string_agg(to_jsonb(e)::text, ',' ORDER BY e.id)), '')
           FROM run_events e WHERE e."runId" IN (SELECT id FROM demo_runs)) AS demo_events_digest
      `,
      [DEMO_USER_EMAILS, DEMO_PLAN_NAME, DEMO_PROFILE_CODE, DEMO_DEVICE_IDS],
    );

    const row = result.rows[0];
    const fixtureDigest = combineDigests([
      String(row.demo_users_digest ?? ""),
      String(row.demo_profiles_digest ?? ""),
      String(row.demo_devices_digest ?? ""),
      String(row.demo_plans_digest ?? ""),
      String(row.demo_revisions_digest ?? ""),
      String(row.demo_plan_steps_digest ?? ""),
      String(row.demo_step_identities_digest ?? ""),
      String(row.demo_runs_digest ?? ""),
      String(row.demo_run_steps_digest ?? ""),
      String(row.demo_measurements_digest ?? ""),
      String(row.demo_events_digest ?? ""),
      String(row.copy_digest ?? ""),
    ]);

    return {
      plans: countValue(row, "plans"),
      runs: countValue(row, "runs"),
      activeRuns: countValue(row, "active_runs"),
      sessions: countValue(row, "sessions"),
      planRevisions: countValue(row, "plan_revisions"),
      demoUsers: countValue(row, "demo_users"),
      demoProfiles: countValue(row, "demo_profiles"),
      devices: countValue(row, "devices"),
      demoDevices: countValue(row, "demo_devices"),
      planCopyRequests: countValue(row, "plan_copy_requests"),
      demoRuns: countValue(row, "demo_runs"),
      plansDigest: String(row.plans_digest ?? ""),
      runsDigest: String(row.runs_digest ?? ""),
      revisionsDigest: String(row.revisions_digest ?? ""),
      demoUsersDigest: String(row.demo_users_digest ?? ""),
      devicesDigest: String(row.devices_digest ?? ""),
      copyDigest: String(row.copy_digest ?? ""),
      fixtureDigest,
    };
  } finally {
    await client.end();
  }
}

function printSnapshot(label, value) {
  console.log(
    `[e2e-isolated] ${label}: plans=${value.plans} revisions=${value.planRevisions} ` +
      `runs=${value.runs} activeRuns=${value.activeRuns} sessions=${value.sessions} ` +
      `demoUsers=${value.demoUsers} demoProfiles=${value.demoProfiles} ` +
      `devices=${value.devices} demoDevices=${value.demoDevices} ` +
      `copyRequests=${value.planCopyRequests} demoRuns=${value.demoRuns}`,
  );
}

const COUNTED_FIELDS = [
  "plans",
  "planRevisions",
  "runs",
  "activeRuns",
  "demoUsers",
  "demoProfiles",
  "devices",
  "demoDevices",
  "planCopyRequests",
  "demoRuns",
];
const DIGEST_FIELDS = [
  "plansDigest",
  "runsDigest",
  "revisionsDigest",
  "demoUsersDigest",
  "devicesDigest",
  "copyDigest",
  "fixtureDigest",
];

function assertSameHistory(before, after, label) {
  const changed = [
    ...COUNTED_FIELDS.filter((field) => before[field] !== after[field]),
    ...DIGEST_FIELDS.filter((field) => before[field] !== after[field]),
  ];

  if (changed.length > 0) {
    throw new Error(
      `${label} changed fixture state (${changed.join(", ")}); the seed must be additive.`,
    );
  }

  console.log(
    `[e2e-isolated] ${label}: counts and canonical fixture digests unchanged`,
  );
}

function baselineFilePath(connectionString, database) {
  if (process.env.E2E_BASELINE_FILE) {
    return process.env.E2E_BASELINE_FILE;
  }
  const server = new URL(connectionString);
  const safeServer =
    `${server.hostname.toLowerCase()}_${server.port || "5432"}`.replace(
      /[^a-z0-9_.-]/gi,
      "_",
    );
  return join(
    tmpdir(),
    `probedesk-e2e-baseline-${safeServer}-${database}.json`,
  );
}

function writeBaselineFile(connectionString, database, value) {
  const path = baselineFilePath(connectionString, database);
  const server = `${new URL(connectionString).hostname.toLowerCase()}:${
    new URL(connectionString).port || "5432"
  }`;
  writeFileSync(
    path,
    `${JSON.stringify({ database, server, fixtureDigest: value.fixtureDigest }, null, 2)}\n`,
    "utf8",
  );
}

function assertBaselineDigest(connectionString, database, value) {
  const path = baselineFilePath(connectionString, database);
  if (!existsSync(path)) {
    console.warn(
      "[e2e-isolated] prepare baseline digest was not found; falling back to the " +
        "count-only baseline check.",
    );
    return;
  }

  let stored;
  try {
    stored = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(
      `The prepare baseline digest file is not valid JSON: ${path}`,
    );
  }

  const server = `${new URL(connectionString).hostname.toLowerCase()}:${
    new URL(connectionString).port || "5432"
  }`;
  if (
    stored.database !== database ||
    stored.server !== server ||
    typeof stored.fixtureDigest !== "string"
  ) {
    throw new Error(
      "The prepare baseline digest file does not match this database server.",
    );
  }

  if (stored.fixtureDigest !== value.fixtureDigest) {
    throw new Error(
      `Canonical fixture fingerprint changed in ${database}; demo devices, copy ` +
        `provenance, plans, runs, steps, measurements or events were modified.`,
    );
  }

  console.log(
    "[e2e-isolated] canonical fixture fingerprint matches the prepare baseline",
  );
}

async function assertBaseline() {
  const connectionString = resolveDatabaseUrl();
  const { database } = assertSafeDatabase(connectionString);
  const counts = await snapshot(connectionString, "probedesk-e2e-baseline");
  const expected = {
    plans: 1,
    planRevisions: 2,
    runs: 4,
    activeRuns: 0,
    sessions: 0,
    demoUsers: 3,
    demoProfiles: 1,
    devices: 2,
    demoDevices: 2,
    planCopyRequests: 0,
    demoRuns: 4,
  };
  const mismatches = Object.entries(expected).filter(
    ([key, value]) => counts[key] !== value,
  );
  if (mismatches.length > 0) {
    throw new Error(
      `[e2e-isolated] ${database} is not at the seeded baseline: ` +
        mismatches
          .map(([key, value]) => `${key} expected ${value}, got ${counts[key]}`)
          .join("; "),
    );
  }

  assertBaselineDigest(connectionString, database, counts);
  console.log(`[e2e-isolated] ${database}: seeded baseline unchanged`);
}

async function prepare() {
  const connectionString = resolveDatabaseUrl();
  const { database, developmentUrl } = assertSafeDatabase(connectionString);

  await ensureDatabase(connectionString, database);
  await migrate(connectionString, developmentUrl);
  await seed(connectionString);

  const value = await snapshot(connectionString, "probedesk-e2e-prepare");
  printSnapshot("baseline", value);
  if (value.demoUsers !== 3 || value.demoProfiles !== 1) {
    throw new Error(
      "Demo seed did not create the three accounts and one profile.",
    );
  }
  if (value.demoDevices !== 2 || value.demoRuns !== 4) {
    throw new Error(
      `Demo seed did not create the two fixed devices and four demo runs ` +
        `(devices=${value.demoDevices}, demoRuns=${value.demoRuns}).`,
    );
  }
  if (value.activeRuns > 0) {
    throw new Error(`The E2E database has ${value.activeRuns} active run(s).`);
  }

  writeBaselineFile(connectionString, database, value);

  console.log("");
  console.log(
    `[e2e-isolated] E2E database ready: ${new URL(connectionString).host}/${database}`,
  );
  console.log(
    "[e2e-isolated] Start the API against the same URL, for example:",
  );
  console.log(
    '  DATABASE_URL="$E2E_DATABASE_URL" PORT=3101 NODE_ENV=development ' +
      "npm run start:prod --workspace apps/api",
  );
  console.log(
    "[e2e-isolated] Start the web app with a proxy to that API (new terminal):",
  );
  console.log(
    '  printf \'{"\\/api":{"target":"http://127.0.0.1:3101","secure":false,' +
      '"changeOrigin":false,"logLevel":"warn"}}\\n\' > "$TMPDIR/probedesk-e2e-proxy.json"',
  );
  console.log(
    "  npm run start --workspace apps/web -- --port 4300 --host 127.0.0.1 " +
      '--proxy-config "$TMPDIR/probedesk-e2e-proxy.json"',
  );
  console.log("[e2e-isolated] Then run Playwright with the same environment:");
  console.log(
    '  E2E_DATABASE_URL="$E2E_DATABASE_URL" E2E_API_URL=http://127.0.0.1:3101 ' +
      "E2E_BASE_URL=http://127.0.0.1:4300 npm run test:e2e",
  );
}

async function seedCheck() {
  const connectionString = resolveDatabaseUrl();
  assertSafeDatabase(connectionString);

  const before = await snapshot(connectionString, "probedesk-e2e-seed-check");
  printSnapshot("before seed", before);
  if (
    before.demoUsers !== 3 ||
    before.demoProfiles !== 1 ||
    before.demoDevices !== 2 ||
    before.demoRuns !== 4
  ) {
    throw new Error(
      'The database is not seeded yet. Run "node scripts/e2e-isolated.mjs prepare" first.',
    );
  }

  await seed(connectionString);
  const afterFirst = await snapshot(
    connectionString,
    "probedesk-e2e-seed-check",
  );
  printSnapshot("after first seed ", afterFirst);
  assertSameHistory(before, afterFirst, "first seed");

  await seed(connectionString);
  const afterSecond = await snapshot(
    connectionString,
    "probedesk-e2e-seed-check",
  );
  printSnapshot("after second seed", afterSecond);
  assertSameHistory(afterFirst, afterSecond, "second seed");
}

async function status() {
  const connectionString = resolveDatabaseUrl();
  const { database } = assertSafeDatabase(connectionString);
  const value = await snapshot(connectionString);
  console.log(`[e2e-isolated] ${new URL(connectionString).host}/${database}`);
  printSnapshot("status", value);
  if (value.activeRuns > 0) {
    throw new Error(`The E2E database has ${value.activeRuns} active run(s).`);
  }
}

const command = process.argv[2] ?? "prepare";

try {
  if (command === "prepare") {
    await prepare();
  } else if (command === "seed-check") {
    await seedCheck();
  } else if (command === "status") {
    await status();
  } else if (command === "assert-baseline") {
    await assertBaseline();
  } else {
    fail(
      `Unknown command "${command}". Use prepare, seed-check, status or assert-baseline.`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
