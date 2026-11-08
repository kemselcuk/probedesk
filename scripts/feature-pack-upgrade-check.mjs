#!/usr/bin/env node
/**
 * EX-02 M-1 upgrade rehearsal for feature pack 1.
 *
 * This script builds a database from the pre-feature schema, migrations and
 * seed source, copies that real seed/run database, upgrades the copy through
 * the current guarded test migration command, and compares canonical
 * fingerprints before and after. It never uses `prisma migrate reset`,
 * `prisma migrate deploy` directly, or any development/delivery database.
 *
 * Required environment variables (both are explicit; no dotenv fallback):
 *   DATABASE_URL       Development connection identity used only by the test
 *                      database guard. It is never connected to.
 *   TEST_DATABASE_URL  Base loopback connection used to create sibling test
 *                      databases. Its database name must end with "_test".
 *
 * The script refuses any TEST_DATABASE_URL that is not loopback port 5433,
 * does not end in "_test", or points at the same database as DATABASE_URL.
 * It creates two uniquely named databases and drops only those two databases
 * in its cleanup path. Run it as:
 *
 *   node scripts/feature-pack-upgrade-check.mjs \
 *     --old-commit=e46b740c6ba5fd35326a95326b0427d6a5bf43db
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const currentMigrationsDir = path.join(
  repoRoot,
  "apps",
  "api",
  "prisma",
  "migrations",
);
const defaultOldCommit = "e46b740c6ba5fd35326a95326b0427d6a5bf43db";

const expectedNewMigrations = [
  "20261106120000_devices_and_copy_requests",
  "20261107120000_analytics_query_indexes",
];

const fingerprintTables = [
  "users",
  "device_profiles",
  "test_plans",
  "plan_revisions",
  "step_identities",
  "plan_steps",
  "test_runs",
  "run_steps",
  "measurements",
  "run_events",
];

function parseArguments(argv) {
  const options = { oldCommit: defaultOldCommit, keep: false, prefix: null };
  for (const argument of argv) {
    if (argument === "--keep") {
      options.keep = true;
    } else if (argument.startsWith("--old-commit=")) {
      options.oldCommit = argument.slice("--old-commit=".length);
    } else if (argument.startsWith("--prefix=")) {
      options.prefix = argument.slice("--prefix=".length);
    } else if (argument === "--help") {
      console.log(
        "Usage: node scripts/feature-pack-upgrade-check.mjs [--old-commit=<sha>] [--prefix=<name>] [--keep]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normaliseHost(hostname) {
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "::1" || host === "[::1]"
    ? "localhost"
    : host;
}

function databaseName(url) {
  return decodeURIComponent(url.pathname)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

function identity(url) {
  return `${normaliseHost(url.hostname)}:${url.port || "5432"}/${databaseName(url)}`;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function urlForDatabase(baseUrl, name) {
  const url = new URL(baseUrl.toString());
  url.pathname = `/${name}`;
  return url;
}

function assertSafeBaseUrl(baseUrl, devUrl) {
  if (!devUrl) {
    throw new Error(
      "DATABASE_URL is required so the test database guard can identify the development database.",
    );
  }
  if (!baseUrl) {
    throw new Error("TEST_DATABASE_URL is required.");
  }
  for (const [name, value] of [
    ["DATABASE_URL", devUrl],
    ["TEST_DATABASE_URL", baseUrl.toString()],
  ]) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${name} is not a valid URL.`);
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error(`${name} must use a postgres:// or postgresql:// URL.`);
    }
  }

  const parsed = new URL(baseUrl.toString());
  const host = normaliseHost(parsed.hostname);
  const port = parsed.port || "5432";
  const name = databaseName(parsed);

  if (host !== "localhost") {
    throw new Error(
      `Refusing to use TEST_DATABASE_URL because ${host} is not loopback.`,
    );
  }
  if (port !== "5433") {
    throw new Error(
      `Refusing to use TEST_DATABASE_URL because port ${port} is not the allocated test port 5433.`,
    );
  }
  if (!/_test$/i.test(name)) {
    throw new Error(
      'Refusing to use TEST_DATABASE_URL because its database name must end with "_test".',
    );
  }
  if (name === "postgres" || name === "template0" || name === "template1") {
    throw new Error(
      "Refusing to use a PostgreSQL maintenance database as a base URL.",
    );
  }
  if (identity(parsed) === identity(new URL(devUrl))) {
    throw new Error(
      "Refusing to run because TEST_DATABASE_URL points at DATABASE_URL.",
    );
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    throw result.error;
  }
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (options.print !== false) {
    process.stdout.write(output);
  }
  if (result.status !== 0) {
    throw new Error(
      `${path.basename(command)} exited with status ${result.status}.`,
    );
  }
  return { status: result.status, output };
}

async function withClient(connectionUrl, callback) {
  const client = new Client({ connectionString: connectionUrl.toString() });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function createDatabase(adminClient, name, template = null) {
  const existing = await adminClient.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [name],
  );
  if (existing.rowCount !== 0) {
    throw new Error(`Refusing to overwrite existing database ${name}.`);
  }
  const templateSql = template ? ` TEMPLATE ${quoteIdentifier(template)}` : "";
  await adminClient.query(
    `CREATE DATABASE ${quoteIdentifier(name)}${templateSql}`,
  );
}

async function dropDatabase(adminClient, name) {
  await adminClient.query(
    `DROP DATABASE IF EXISTS ${quoteIdentifier(name)} WITH (FORCE)`,
  );
}

async function applyOldMigrations(connectionUrl, migrationsDir) {
  const migrationNames = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (migrationNames.length === 0) {
    throw new Error(`No old migrations found in ${migrationsDir}.`);
  }
  if (migrationNames.some((name) => expectedNewMigrations.includes(name))) {
    throw new Error(
      "The old migration directory unexpectedly contains a feature-pack migration.",
    );
  }

  await withClient(connectionUrl, async (client) => {
    await client.query(`
      CREATE TABLE "_prisma_migrations" (
        "id" VARCHAR(36) NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0,
        CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
      )
    `);

    for (const migrationName of migrationNames) {
      const migrationSql = fs.readFileSync(
        path.join(migrationsDir, migrationName, "migration.sql"),
        "utf8",
      );
      const checksum = sha256(migrationSql);
      await client.query("BEGIN");
      try {
        await client.query(migrationSql);
        await client.query(
          `INSERT INTO "_prisma_migrations"
             ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
           VALUES ($1, $2, now(), $3, 1)`,
          [randomUUID(), checksum, migrationName],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log(`Applied pre-feature migration ${migrationName}`);
    }
  });

  return migrationNames;
}

async function readTableColumns(client, tables) {
  const columnsByTable = {};
  for (const table of tables) {
    const result = await client.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position`,
      [table],
    );
    if (result.rowCount === 0) {
      throw new Error(`Expected table ${table} is missing.`);
    }
    columnsByTable[table] = result.rows.map((row) => row.column_name);
  }
  return columnsByTable;
}

async function fingerprintDatabase(client, columnsByTable) {
  const tables = [];

  for (const [table, columns] of Object.entries(columnsByTable)) {
    const selectList = columns
      .map(
        (column) =>
          `${quoteIdentifier(column)}::text AS ${quoteIdentifier(column)}`,
      )
      .join(", ");
    const orderBy = columns.includes("id")
      ? `${quoteIdentifier("id")}::text`
      : columns.map((column) => `${quoteIdentifier(column)}::text`).join(", ");

    const result = await client.query(
      `SELECT ${selectList} FROM ${quoteIdentifier(table)} ORDER BY ${orderBy}`,
    );
    const payload = JSON.stringify({ table, columns, rows: result.rows });
    tables.push({
      table,
      columns: columns.length,
      rows: result.rowCount,
      sha256: sha256(payload),
    });
  }

  return {
    tables,
    sha256: sha256(JSON.stringify(tables)),
  };
}

async function summarizeDatabase(client) {
  const counts = {};
  for (const table of fingerprintTables) {
    const result = await client.query(
      `SELECT count(*)::int AS count FROM ${quoteIdentifier(table)}`,
    );
    counts[table] = result.rows[0].count;
  }

  const runs = await client.query(
    `SELECT "id"::text AS id,
            "idempotencyKey",
            "requestHash",
            "status"::text AS status,
            "outcome"::text AS outcome,
            "scenario"::text AS scenario,
            "planNameSnapshot",
            "versionNumberSnapshot",
            "expectedSampleCount",
            "recordedSampleCount",
            "eventSequence",
            "startedAt"::text AS "startedAt",
            "finishedAt"::text AS "finishedAt"
       FROM "test_runs"
      ORDER BY "startedAt", "id"`,
  );
  const runIdentity = runs.rows.map((row) => ({
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
  }));

  const versions = await client.query(
    `SELECT "versionNumber"
       FROM "plan_revisions"
      WHERE "state" = 'PUBLISHED'
      ORDER BY "versionNumber"`,
  );

  const migrationHistory = await client.query(
    `SELECT "migration_name", "checksum", "finished_at" IS NOT NULL AS finished
       FROM "_prisma_migrations"
      ORDER BY "started_at", "migration_name"`,
  );

  return {
    counts,
    runs: runs.rows,
    runIdentitySha256: sha256(JSON.stringify(runIdentity)),
    publishedVersions: versions.rows.map((row) => row.versionNumber),
    migrations: migrationHistory.rows,
  };
}

async function assertUpgradedSchema(client, oldColumns, before, after) {
  const assertions = [];
  const check = (name, passed, detail) => {
    assertions.push({ name, passed, detail });
    if (!passed) {
      throw new Error(`Upgrade assertion failed: ${name} (${detail})`);
    }
  };

  check(
    "fingerprint matches the pre-migration copy",
    before.sha256 === after.sha256,
    `${before.sha256} -> ${after.sha256}`,
  );

  for (const beforeTable of before.tables) {
    const afterTable = after.tables.find(
      (entry) => entry.table === beforeTable.table,
    );
    check(
      `${beforeTable.table} rows and canonical hash unchanged`,
      Boolean(afterTable) &&
        afterTable.rows === beforeTable.rows &&
        afterTable.sha256 === beforeTable.sha256,
      `${beforeTable.rows} rows`,
    );
  }

  const newColumnSpecs = [
    ["deviceId", "uuid"],
    ["deviceSnapshot", "jsonb"],
    ["batchNumber", "text"],
    ["batchNumberKey", "text"],
  ];

  for (const [column, dataType] of newColumnSpecs) {
    check(
      `test_runs.${column} exists and is nullable`,
      oldColumns.test_runs !== undefined &&
        !oldColumns.test_runs.includes(column),
      "column was absent in the pre-feature schema",
    );
    const definition = await client.query(
      `SELECT data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'test_runs'
          AND column_name = $1`,
      [column],
    );
    check(
      `test_runs.${column} is ${dataType} nullable`,
      definition.rowCount === 1 &&
        definition.rows[0].data_type === dataType &&
        definition.rows[0].is_nullable === "YES",
      JSON.stringify(definition.rows[0] ?? null),
    );
    const nulls = await client.query(
      `SELECT count(*)::int AS count
         FROM "test_runs"
        WHERE ${quoteIdentifier(column)} IS NOT NULL`,
    );
    check(
      `pre-feature runs keep ${column} NULL`,
      nulls.rows[0].count === 0,
      `${nulls.rows[0].count} non-null rows`,
    );
  }

  for (const table of ["devices", "plan_copy_requests"]) {
    const result = await client.query(
      `SELECT count(*)::int AS count FROM ${quoteIdentifier(table)}`,
    );
    check(
      `${table} exists and is empty after the additive upgrade`,
      result.rows[0].count === 0,
      `${result.rows[0].count} rows`,
    );
  }

  const requiredIndexes = [
    "devices_deviceProfileId_serialNumberKey_key",
    "devices_createdById_idx",
    "plan_copy_requests_requestedById_idempotencyKey_key",
    "plan_copy_requests_sourceVersionId_idx",
    "plan_copy_requests_targetPlanId_idx",
    "test_runs_deviceId_startedAt_id_idx",
    "test_runs_batchNumberKey_startedAt_id_idx",
    "test_runs_planId_startedAt_id_idx",
    "test_runs_startedAt_id_idx",
    "test_runs_planRevisionId_idx",
    "test_runs_status_idx",
  ];
  const uniqueIndexes = [
    "devices_deviceProfileId_serialNumberKey_key",
    "plan_copy_requests_requestedById_idempotencyKey_key",
  ];
  const indexResult = await client.query(
    `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`,
  );
  const indexes = new Map(
    indexResult.rows.map((row) => [row.indexname, row.indexdef]),
  );
  for (const index of requiredIndexes) {
    check(
      `index ${index} exists`,
      indexes.has(index),
      indexes.get(index) ?? "missing",
    );
  }
  for (const index of uniqueIndexes) {
    check(
      `unique index ${index} is unique`,
      indexes.get(index)?.startsWith("CREATE UNIQUE INDEX") === true,
      indexes.get(index) ?? "missing",
    );
  }
  check(
    "redundant devices_deviceProfileId_idx was removed",
    !indexes.has("devices_deviceProfileId_idx"),
    indexes.has("devices_deviceProfileId_idx") ? "still present" : "absent",
  );

  const constraintResult = await client.query(
    `SELECT conname, contype, confdeltype,
            pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace
        AND conrelid IN (
          'test_runs'::regclass,
          'devices'::regclass,
          'plan_copy_requests'::regclass
        )`,
  );
  const constraints = new Map(
    constraintResult.rows.map((row) => [row.conname, row]),
  );
  for (const [name, type, deleteAction] of [
    ["devices_deviceProfileId_fkey", "f", "r"],
    ["devices_createdById_fkey", "f", "r"],
    ["test_runs_deviceId_fkey", "f", "r"],
    ["plan_copy_requests_requestedById_fkey", "f", "r"],
    ["plan_copy_requests_sourceVersionId_fkey", "f", "r"],
    ["plan_copy_requests_targetPlanId_fkey", "f", "r"],
  ]) {
    const constraint = constraints.get(name);
    check(
      `${name} is a RESTRICT foreign key`,
      Boolean(constraint) &&
        constraint.contype === type &&
        constraint.confdeltype === deleteAction,
      JSON.stringify(constraint ?? null),
    );
  }
  for (const name of [
    "test_runs_device_metadata_check",
    "test_runs_device_snapshot_check",
    "test_runs_batch_metadata_check",
    "test_runs_batchNumber_check",
    "test_runs_batchNumberKey_check",
  ]) {
    check(
      `constraint ${name} exists`,
      constraints.has(name),
      constraints.get(name)?.definition ?? "missing",
    );
  }

  const trigger = await client.query(
    `SELECT pg_get_functiondef('probedesk_test_runs_snapshot_immutable'::regproc) AS definition`,
  );
  const triggerDefinition = trigger.rows[0]?.definition ?? "";
  const frozenFields = [
    "planId",
    "planRevisionId",
    "planNameSnapshot",
    "versionNumberSnapshot",
    "profileSnapshot",
    "deviceId",
    "deviceSnapshot",
    "batchNumber",
    "batchNumberKey",
    "requestedById",
    "scenario",
    "seed",
    "errorProbability",
    "failureStepId",
    "simulatorVersion",
    "evaluationVersion",
    "idempotencyKey",
    "requestHash",
    "expectedSampleCount",
    "startedAt",
  ];
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const field of frozenFields) {
    const comparison = new RegExp(
      `NEW\\."${escapeRegex(field)}"\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\."${escapeRegex(field)}"`,
    );
    check(
      `immutability trigger still freezes ${field}`,
      comparison.test(triggerDefinition),
      comparison.test(triggerDefinition)
        ? "comparison present"
        : "comparison missing",
    );
  }
  const terminalRule =
    /OLD\."status"\s*<>\s*'RUNNING'\s+AND\s+NEW\."status"\s*<>\s*OLD\."status"/.test(
      triggerDefinition,
    );
  check(
    "immutability trigger keeps the terminal-status rule",
    terminalRule,
    terminalRule ? "terminal rule present" : "terminal rule missing",
  );

  const oldRun = await client.query(
    `SELECT "id"::text AS id FROM "test_runs" ORDER BY "startedAt", "id" LIMIT 1`,
  );
  const runId = oldRun.rows[0]?.id;
  let immutabilityRejected = false;
  await client.query("BEGIN");
  try {
    await client.query(
      `UPDATE "test_runs" SET "batchNumber" = 'EX02-UPGRADE-SMOKE' WHERE "id" = $1`,
      [runId],
    );
  } catch (error) {
    immutabilityRejected = error?.code === "23514";
  } finally {
    await client.query("ROLLBACK");
  }
  check(
    "an upgraded pre-feature run still rejects metadata mutation",
    immutabilityRejected,
    immutabilityRejected
      ? "rejected with SQLSTATE 23514"
      : "update was not rejected with 23514",
  );

  const currentMigrations = fs
    .readdirSync(currentMigrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const applied = await client.query(
    `SELECT "migration_name", "checksum", "finished_at" IS NOT NULL AS finished
       FROM "_prisma_migrations"
      ORDER BY "started_at", "migration_name"`,
  );
  check(
    "every current migration is recorded exactly once",
    applied.rowCount === currentMigrations.length &&
      currentMigrations.every((name) =>
        applied.rows.some((row) => row.migration_name === name && row.finished),
      ),
    `${applied.rowCount} records for ${currentMigrations.length} migrations`,
  );
  for (const name of currentMigrations) {
    const expectedChecksum = sha256(
      fs.readFileSync(
        path.join(currentMigrationsDir, name, "migration.sql"),
        "utf8",
      ),
    );
    const record = applied.rows.find((row) => row.migration_name === name);
    check(
      `migration checksum ${name} matches the working tree`,
      record?.checksum === expectedChecksum,
      record?.checksum ?? "missing",
    );
  }

  return {
    assertions,
    appliedMigrations: applied.rows.map((row) => row.migration_name),
    triggerFieldCount: frozenFields.length,
  };
}

function parseAppliedMigrations(output) {
  return [...output.matchAll(/Applying migration `([^`]+)`/g)].map(
    (match) => match[1],
  );
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const devUrl = process.env.DATABASE_URL;
  const baseUrlValue = process.env.TEST_DATABASE_URL;

  if (!baseUrlValue) {
    throw new Error("TEST_DATABASE_URL is required.");
  }
  const baseUrl = new URL(baseUrlValue);
  assertSafeBaseUrl(baseUrl, devUrl);

  const suffix = randomBytes(4).toString("hex");
  const prefix = options.prefix ?? `probedesk_ex02_upgrade_${suffix}`;
  if (!/^[a-z0-9_]{1,48}$/.test(prefix)) {
    throw new Error(
      "The database prefix must contain 1–48 lowercase letters, digits or underscores.",
    );
  }
  const sourceName = `${prefix}_source_test`;
  const copyName = `${prefix}_copy_test`;
  const adminUrl = urlForDatabase(baseUrl, "postgres");
  const sourceUrl = urlForDatabase(baseUrl, sourceName);
  const copyUrl = urlForDatabase(baseUrl, copyName);

  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "probedesk-ex02-upgrade-"),
  );
  const oldArchive = path.join(temporaryRoot, "old.tar");
  const createdDatabases = [];
  let adminClient;
  const report = {
    oldCommit: options.oldCommit,
    currentHead: null,
    sourceDatabase: sourceName,
    copyDatabase: copyName,
    temporaryRoot,
    source: null,
    before: null,
    copyBeforeMigration: null,
    migration: null,
    after: null,
    schema: null,
    cleanup: null,
  };

  try {
    console.log(`Temporary old-source directory: ${temporaryRoot}`);
    console.log(`Old commit: ${options.oldCommit}`);
    console.log(`Test base database: ${identity(baseUrl)}`);

    report.currentHead = runCommand("git", ["rev-parse", "HEAD"], {
      print: false,
    }).output.trim();
    console.log(`Current HEAD: ${report.currentHead}`);

    runCommand(
      "git",
      [
        "archive",
        "--format=tar",
        `--output=${oldArchive}`,
        options.oldCommit,
        "apps/api",
      ],
      { print: false },
    );
    runCommand("tar", ["-xf", oldArchive, "-C", temporaryRoot], {
      print: false,
    });

    const oldApiRoot = path.join(temporaryRoot, "apps", "api");
    const oldMigrationsDir = path.join(oldApiRoot, "prisma", "migrations");
    const oldMigrationNames = fs
      .readdirSync(oldMigrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    if (oldMigrationNames.length !== 8) {
      throw new Error(
        `Expected 8 pre-feature migrations, found ${oldMigrationNames.length}.`,
      );
    }
    if (oldMigrationNames.at(-1) !== "20261103210000_run_history_index") {
      throw new Error(
        `Unexpected last pre-feature migration: ${oldMigrationNames.at(-1)}.`,
      );
    }
    report.oldMigrations = oldMigrationNames;

    fs.symlinkSync(
      path.join(repoRoot, "node_modules"),
      path.join(temporaryRoot, "node_modules"),
      "dir",
    );
    fs.symlinkSync(
      path.join(repoRoot, "apps", "api", "node_modules"),
      path.join(oldApiRoot, "node_modules"),
      "dir",
    );

    runCommand(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "prisma", "build", "index.js"),
        "generate",
        "--schema",
        "prisma/schema.prisma",
      ],
      {
        cwd: oldApiRoot,
        env: { ...process.env, PROBEDESK_SKIP_DOTENV: "1", NO_COLOR: "1" },
      },
    );

    adminClient = new Client({ connectionString: adminUrl.toString() });
    await adminClient.connect();

    await createDatabase(adminClient, sourceName);
    createdDatabases.push(sourceName);

    await applyOldMigrations(sourceUrl, oldMigrationsDir);

    runCommand(
      process.execPath,
      [
        path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
        "prisma/seed.ts",
      ],
      {
        cwd: oldApiRoot,
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: sourceUrl.toString(),
          PROBEDESK_SKIP_DOTENV: "1",
          SESSION_COOKIE_SECURE: "false",
          NO_COLOR: "1",
        },
      },
    );

    report.source = await withClient(sourceUrl, async (client) => {
      const oldColumns = await readTableColumns(client, fingerprintTables);
      const fingerprints = await fingerprintDatabase(client, oldColumns);
      const summary = await summarizeDatabase(client);
      return { columns: oldColumns, fingerprints, summary };
    });

    if (report.source.summary.migrations.length !== oldMigrationNames.length) {
      throw new Error(
        `The seeded source records ${report.source.summary.migrations.length} migrations instead of ${oldMigrationNames.length}.`,
      );
    }
    if (
      report.source.summary.counts.test_runs !== 4 ||
      report.source.summary.counts.measurements === 0 ||
      report.source.summary.counts.run_events === 0
    ) {
      throw new Error(
        `The old seed did not produce the expected real history (${JSON.stringify(report.source.summary.counts)}).`,
      );
    }

    // Create a real, separate copy before the upgrade. Template copying is the
    // local equivalent of a clean pg_dump/pg_restore for an idle database.
    await createDatabase(adminClient, copyName, sourceName);
    createdDatabases.push(copyName);
    console.log(`Created ${copyName} as a template copy of ${sourceName}`);

    report.copyBeforeMigration = await withClient(copyUrl, async (client) => {
      const fingerprints = await fingerprintDatabase(
        client,
        report.source.columns,
      );
      const summary = await summarizeDatabase(client);
      return { fingerprints, summary };
    });
    if (
      report.copyBeforeMigration.fingerprints.sha256 !==
      report.source.fingerprints.sha256
    ) {
      throw new Error(
        "The pre-migration copy does not match the seeded source.",
      );
    }

    const migration = runCommand(
      "npm",
      ["run", "db:migrate:test", "--workspace", "apps/api"],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: devUrl,
          TEST_DATABASE_URL: copyUrl.toString(),
          PROBEDESK_SKIP_DOTENV: "1",
          NO_COLOR: "1",
        },
      },
    );
    const appliedMigrations = parseAppliedMigrations(migration.output);
    report.migration = {
      exitCode: migration.status,
      appliedMigrations,
      output: migration.output,
    };
    if (
      JSON.stringify(appliedMigrations) !==
      JSON.stringify(expectedNewMigrations)
    ) {
      throw new Error(
        `Expected exactly ${expectedNewMigrations.join(", ")} to be applied; saw ${appliedMigrations.join(", ") || "none"}.`,
      );
    }
    if (!migration.output.includes("10 migrations found")) {
      throw new Error(
        "The guarded migration command did not report the expected 10 current migrations.",
      );
    }

    report.after = await withClient(copyUrl, async (client) => {
      const fingerprints = await fingerprintDatabase(
        client,
        report.source.columns,
      );
      const summary = await summarizeDatabase(client);
      return { fingerprints, summary };
    });

    report.schema = await withClient(copyUrl, async (client) =>
      assertUpgradedSchema(
        client,
        report.source.columns,
        report.source.fingerprints,
        report.after.fingerprints,
      ),
    );

    console.log("\nRow counts before -> after the upgrade:");
    for (const table of report.source.fingerprints.tables) {
      const afterTable = report.after.fingerprints.tables.find(
        (entry) => entry.table === table.table,
      );
      console.log(
        `  ${table.table}: ${table.rows} -> ${afterTable.rows}${table.rows === afterTable.rows ? " MATCH" : " MISMATCH"}`,
      );
    }

    console.log("\nCanonical fingerprints before and after the upgrade:");
    for (const table of report.source.fingerprints.tables) {
      const afterTable = report.after.fingerprints.tables.find(
        (entry) => entry.table === table.table,
      );
      console.log(
        `  ${table.table}: ${table.rows} rows, ${table.sha256} -> ${afterTable.sha256} ${table.sha256 === afterTable.sha256 ? "MATCH" : "MISMATCH"}`,
      );
    }
    console.log(
      `  aggregate: ${report.source.fingerprints.sha256} -> ${report.after.fingerprints.sha256}`,
    );

    console.log("\nDemo run identities preserved:");
    for (const run of report.source.summary.runs) {
      console.log(
        `  ${run.idempotencyKey} ${run.status}/${run.outcome ?? "-"} requestHash=${run.requestHash}`,
      );
    }

    console.log(
      `\nImmutability trigger fields: ${report.schema.triggerFieldCount}; applied migrations: ${report.schema.appliedMigrations.length}.`,
    );
    console.log("\nUpgrade assertions:");
    for (const assertion of report.schema.assertions) {
      console.log(`  PASS ${assertion.name} (${assertion.detail})`);
    }

    console.log("\nEX-02 M-1 upgrade check passed.");
  } finally {
    if (options.keep) {
      console.log(
        "Keeping databases and temporary source because --keep was set.",
      );
      report.cleanup = { dropped: [], kept: createdDatabases };
    } else {
      const dropped = [];
      if (adminClient) {
        for (const name of [...createdDatabases].reverse()) {
          try {
            await dropDatabase(adminClient, name);
            dropped.push(name);
            console.log(`Dropped ${name}`);
          } catch (error) {
            console.error(
              `Failed to drop ${name}: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        await adminClient.end();
      }
      report.cleanup = {
        dropped,
        kept: createdDatabases.filter((name) => !dropped.includes(name)),
      };
      if (report.cleanup.kept.length > 0) {
        process.exitCode = 1;
      }
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }

    const reportPath = path.join(
      os.tmpdir(),
      `probedesk-ex02-upgrade-report-${suffix}.json`,
    );
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`JSON report: ${reportPath}`);
  }
}

main().catch((error) => {
  console.error(`EX-02 M-1 upgrade check failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
