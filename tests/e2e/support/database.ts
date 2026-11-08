import { Client } from "pg";

/**
 * Shared PostgreSQL fixture/cleanup support for the Playwright suite.
 *
 * The E2E tests talk to a real API backed by a real PostgreSQL database. That
 * database must be dedicated to this suite: the cleanup below deletes plan,
 * run, device, copy-provenance and session rows, and the application-wide
 * "one active run" rule makes a shared database with another test process
 * flaky.
 *
 * Safety rules enforced here:
 * - `E2E_DATABASE_URL` is mandatory. There is no silent no-op when it is
 *   missing because that would leave created rows behind.
 * - Destructive cleanup is refused unless the database name ends with `_test`
 *   or the operator explicitly sets `E2E_ALLOW_DATABASE_CLEANUP=1`.
 * - Even with the explicit override, the E2E database may never be the same
 *   database as `DATABASE_URL` (the development database).
 * - Cleanup deletes only plan ids collected by the test, plan names that the
 *   test generated, device fixture ids/names that the test created, explicit
 *   copy-request ids, and sessions created after that test's baseline. It never
 *   deletes every row matching a shared demo account or an unrelated device.
 * - The fixed demo devices from the additive seed are shared fixture data and
 *   are never deleted by cleanup, even if a caller names one by mistake.
 */

const TEST_DATABASE_NAME = /_test$/i;
const REQUIRED_ENV = "E2E_DATABASE_URL";

/**
 * Fixed ids from `apps/api/prisma/seed-data.ts`. These two rows are the shared
 * demo devices that `prepare`/`seed-check` expect, so preserving them is part
 * of the E2E baseline contract.
 */
const DEMO_DEVICE_FIXTURE_IDS: readonly string[] = [
  "5f0d3c1e-2a4b-4c6d-8e9f-000000000001",
  "5f0d3c1e-2a4b-4c6d-8e9f-000000000002",
];

/** Tables whose user triggers (immutability/append-only guards) block cleanup. */
const CLEANUP_TRIGGER_TABLES = [
  "run_events",
  "measurements",
  "run_steps",
  "test_runs",
  "plan_steps",
  "plan_revisions",
] as const;

export interface E2eDatabaseBaseline {
  /** Session ids that existed before the test created any browser/API session. */
  readonly sessionIds: readonly string[];
  readonly plans: number;
  readonly runs: number;
  readonly sessions: number;
  readonly activeRuns: number;
  readonly demoUsers: number;
  readonly demoProfiles: number;
  readonly devices: number;
  readonly demoDevices: number;
  readonly planCopyRequests: number;
  readonly devicesDigest: string;
  readonly planCopyRequestsDigest: string;
}

export interface E2eCleanupOptions {
  readonly planIds?: readonly string[];
  readonly planNames?: readonly string[];
  /** Explicit device ids created by this test. */
  readonly deviceIds?: readonly string[];
  /** Explicit, test-generated device names; resolved to ids before deletion. */
  readonly deviceNames?: readonly string[];
  /** Extra provenance ids when the target/source plan ids are not tracked. */
  readonly planCopyRequestIds?: readonly string[];
  readonly sessionBaseline: readonly string[];
  readonly userEmails: readonly string[];
  readonly activeRunTimeoutMs?: number;
}

export interface E2eCleanupSummary {
  readonly planIds: number;
  readonly plans: number;
  readonly planRevisions: number;
  readonly planSteps: number;
  readonly stepIdentities: number;
  readonly planCopyRequests: number;
  readonly devices: number;
  readonly runs: number;
  readonly runSteps: number;
  readonly measurements: number;
  readonly runEvents: number;
  readonly sessions: number;
  readonly activeRunsAfter: number;
  readonly remainingPlanIds: number;
  readonly remainingRunIds: number;
  readonly remainingDeviceIds: number;
  readonly remainingPlanCopyRequests: number;
  readonly remainingSessions: number;
}

interface ParsedDatabaseUrl {
  readonly url: URL;
  readonly database: string;
  readonly identity: string;
  readonly display: string;
}

function parseDatabaseUrl(value: string, name: string): ParsedDatabaseUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid PostgreSQL connection URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `${name} must use the postgres:// or postgresql:// scheme.`,
    );
  }

  const database = decodeURIComponent(url.pathname)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (!database) {
    throw new Error(`${name} must include a database name.`);
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
    display: `${url.host}/${database}`,
  };
}

function connectionIdentity(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return parseDatabaseUrl(value, "DATABASE_URL").identity;
  } catch {
    return undefined;
  }
}

/**
 * Returns the validated E2E database URL. It deliberately reads the
 * environment on every call so a test can set it in `beforeAll` without import
 * order surprises.
 */
export function requireE2eDatabaseUrl(): string {
  const raw = process.env[REQUIRED_ENV];
  if (!raw) {
    throw new Error(
      `${REQUIRED_ENV} is required for the Playwright suite. Point it at the dedicated ` +
        `E2E database (for example probedesk_e2e_test on the test PostgreSQL container) ` +
        `and make sure the API under test uses the same URL.`,
    );
  }

  return raw;
}

export function describeE2eDatabase(
  connectionString = requireE2eDatabaseUrl(),
): string {
  return parseDatabaseUrl(connectionString, REQUIRED_ENV).display;
}

/**
 * Rejects destructive cleanup on anything that is not clearly a test database.
 * This is called before the suite creates data and again immediately before it
 * deletes rows.
 */
export function assertE2eCleanupAllowed(
  connectionString = requireE2eDatabaseUrl(),
): ParsedDatabaseUrl {
  const parsed = parseDatabaseUrl(connectionString, REQUIRED_ENV);
  const explicitOverride = process.env.E2E_ALLOW_DATABASE_CLEANUP === "1";

  if (!TEST_DATABASE_NAME.test(parsed.database) && !explicitOverride) {
    throw new Error(
      `Refusing destructive E2E cleanup: ${REQUIRED_ENV} points at "${parsed.database}", ` +
        `which does not end with "_test". Use a dedicated test database or set ` +
        `E2E_ALLOW_DATABASE_CLEANUP=1 explicitly.`,
    );
  }

  const developmentIdentity = connectionIdentity(
    process.env.DATABASE_URL ?? "",
  );
  if (developmentIdentity && developmentIdentity === parsed.identity) {
    throw new Error(
      `Refusing destructive E2E cleanup: ${REQUIRED_ENV} points at the development ` +
        `database (${parsed.identity}). Use a dedicated E2E database.`,
    );
  }

  if (explicitOverride && !TEST_DATABASE_NAME.test(parsed.database)) {
    console.warn(
      `[e2e-db] E2E_ALLOW_DATABASE_CLEANUP=1 allows cleanup on non-test database ` +
        `${parsed.display}. This must be a disposable environment.`,
    );
  }

  return parsed;
}

/**
 * Guards the shared-session cleanup strategy. Two Playwright workers would
 * delete each other's sessions and compete for the single active run, so the
 * shared demo database must be used with one worker.
 */
export function assertE2eSerialExecution(workers: number): void {
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`Invalid Playwright worker count: ${String(workers)}.`);
  }

  if (workers !== 1) {
    throw new Error(
      `The shared E2E database requires exactly one Playwright worker; received ${workers}. ` +
        `Run with "--workers=1" or give each worker its own database.`,
    );
  }
}

async function connect(
  connectionString: string,
  applicationName: string,
): Promise<Client> {
  const client = new Client({
    connectionString,
    application_name: applicationName,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  return client;
}

async function count(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<number> {
  const result = await client.query<{ count: string }>(sql, [...values]);
  return Number(result.rows[0]?.count ?? 0);
}

async function digest(
  client: Client,
  sql: string,
  values: readonly unknown[] = [],
): Promise<string> {
  const result = await client.query<{ digest: string }>(sql, [...values]);
  return String(result.rows[0]?.digest ?? "");
}

/**
 * Reads the state a test must restore. It also fails early when the connection
 * is not the expected dedicated database, when demo fixtures are missing, or
 * when another run is already active (which would make run creation return 409
 * for reasons unrelated to the test).
 */
export async function prepareE2eDatabase(): Promise<E2eDatabaseBaseline> {
  const connectionString = requireE2eDatabaseUrl();
  const parsed = assertE2eCleanupAllowed(connectionString);
  const client = await connect(connectionString, "probedesk-e2e-baseline");

  try {
    const currentDatabase = await client.query<{ current_database: string }>(
      "SELECT current_database()",
    );
    if (currentDatabase.rows[0]?.current_database !== parsed.database) {
      throw new Error(
        `${REQUIRED_ENV} names "${parsed.database}" but PostgreSQL connected to ` +
          `"${currentDatabase.rows[0]?.current_database ?? "unknown"}".`,
      );
    }

    const sessionResult = await client.query<{ id: string }>(
      "SELECT id FROM sessions",
    );
    const demoDeviceIds = await client.query<{ id: string }>(
      "SELECT id FROM devices WHERE id = ANY($1::uuid[])",
      [DEMO_DEVICE_FIXTURE_IDS],
    );
    const baseline: E2eDatabaseBaseline = {
      sessionIds: sessionResult.rows.map((row) => row.id),
      plans: await count(client, "SELECT count(*) FROM test_plans"),
      runs: await count(client, "SELECT count(*) FROM test_runs"),
      sessions: sessionResult.rowCount ?? 0,
      activeRuns: await count(
        client,
        `SELECT count(*) FROM test_runs WHERE status = 'RUNNING'`,
      ),
      demoUsers: await count(
        client,
        `SELECT count(*) FROM users WHERE email = ANY($1)`,
        [
          [
            "planner@probedesk.local",
            "operator@probedesk.local",
            "viewer@probedesk.local",
          ],
        ],
      ),
      demoProfiles: await count(
        client,
        `SELECT count(*) FROM device_profiles WHERE code = 'DC_POWER_MODULE'`,
      ),
      devices: await count(client, "SELECT count(*) FROM devices"),
      demoDevices: demoDeviceIds.rowCount ?? 0,
      planCopyRequests: await count(
        client,
        "SELECT count(*) FROM plan_copy_requests",
      ),
      devicesDigest: await digest(
        client,
        `SELECT coalesce(md5(string_agg(to_jsonb(d)::text, ',' ORDER BY d.id)), '') AS digest
           FROM devices d`,
      ),
      planCopyRequestsDigest: await digest(
        client,
        `SELECT coalesce(md5(string_agg(to_jsonb(c)::text, ',' ORDER BY c.id)), '') AS digest
           FROM plan_copy_requests c`,
      ),
    };

    if (
      baseline.demoUsers !== 3 ||
      baseline.demoProfiles !== 1 ||
      baseline.demoDevices !== 2
    ) {
      throw new Error(
        `The E2E database is not seeded: found ${baseline.demoUsers}/3 demo users, ` +
          `${baseline.demoProfiles}/1 DC_POWER_MODULE profile and ` +
          `${baseline.demoDevices}/2 demo devices. Run ` +
          `"node scripts/e2e-isolated.mjs prepare" first.`,
      );
    }

    if (baseline.activeRuns > 0) {
      throw new Error(
        `The E2E database already has ${baseline.activeRuns} RUNNING run(s). Start the API ` +
          `once so recovery marks interrupted runs, or reset the dedicated E2E database.`,
      );
    }

    console.log(
      `[e2e-db] baseline ${parsed.display}: plans=${baseline.plans} runs=${baseline.runs} ` +
        `sessions=${baseline.sessions} activeRuns=${baseline.activeRuns} ` +
        `devices=${baseline.devices} demoDevices=${baseline.demoDevices} ` +
        `planCopyRequests=${baseline.planCopyRequests}`,
    );
    return baseline;
  } finally {
    await client.end();
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function deleteRows(
  client: Client,
  sql: string,
  values: readonly unknown[],
): Promise<number> {
  const result = await client.query(sql, [...values]);
  return result.rowCount ?? 0;
}

async function resolveDeviceIds(
  client: Client,
  options: E2eCleanupOptions,
): Promise<string[]> {
  const ids = new Set<string>(options.deviceIds?.filter(Boolean) ?? []);
  const names = options.deviceNames?.filter(Boolean) ?? [];

  if (names.length > 0) {
    const named = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM devices WHERE name = ANY($1)",
      [names],
    );
    for (const name of names) {
      if (named.rows.filter((row) => row.name === name).length > 1)
        throw new Error(
          "Ambiguous device cleanup name; pass explicit device IDs instead.",
        );
    }
    for (const row of named.rows) {
      ids.add(row.id);
    }
  }

  for (const id of ids) {
    if (DEMO_DEVICE_FIXTURE_IDS.includes(id)) {
      throw new Error(
        "Refusing to delete a shared demo device fixture; E2E cleanup only removes " +
          "devices created by the test.",
      );
    }
  }

  return [...ids];
}

/**
 * Deletes the data a single test created and restores the session baseline.
 * Triggers are disabled inside one transaction and re-enabled in the same
 * transaction; a rollback restores their state if any statement fails.
 *
 * Order follows the restrictive foreign keys:
 * run children -> runs -> devices -> plan_copy_requests -> revisions/plans.
 */
export async function cleanupE2eData(
  options: E2eCleanupOptions,
): Promise<E2eCleanupSummary> {
  const connectionString = requireE2eDatabaseUrl();
  const parsed = assertE2eCleanupAllowed(connectionString);
  const client = await connect(connectionString, "probedesk-e2e-cleanup");

  const planIds = new Set(options.planIds?.filter(Boolean) ?? []);
  const planNames = options.planNames?.filter(Boolean) ?? [];
  const explicitCopyRequestIds = [
    ...new Set(options.planCopyRequestIds?.filter(Boolean) ?? []),
  ];
  const sessionBaseline = [...new Set(options.sessionBaseline)];
  const userEmails = [...new Set(options.userEmails)];
  const timeoutMs = options.activeRunTimeoutMs ?? 20_000;

  try {
    if (planNames.length > 0) {
      const named = await client.query<{ planId: string }>(
        'SELECT DISTINCT "planId" FROM "plan_revisions" WHERE "name" = ANY($1)',
        [planNames],
      );
      for (const row of named.rows) planIds.add(row.planId);
    }

    const ids = [...planIds];
    const protectedPlans = await client.query(
      `SELECT p.id FROM test_plans p
      JOIN users u ON u.id = p."createdById"
      JOIN device_profiles d ON d.id = p."deviceProfileId"
      WHERE p.id = ANY($1::uuid[]) AND u.email = $2 AND d.code = $3
        AND EXISTS(SELECT 1 FROM plan_revisions r WHERE r."planId" = p.id AND r.name = $4)`,
      [
        ids,
        "planner@probedesk.local",
        "DC_POWER_MODULE",
        "Power Supply Validation",
      ],
    );
    if (protectedPlans.rowCount)
      throw new Error("Refusing to delete a shared demo plan fixture.");
    const deviceIds = await resolveDeviceIds(client, options);

    let runIds: string[] = [];
    if (ids.length > 0 || deviceIds.length > 0) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const active = await count(
          client,
          `SELECT count(*) FROM test_runs
            WHERE ("planId" = ANY($1::uuid[]) OR "deviceId" = ANY($2::uuid[]))
              AND status = 'RUNNING'`,
          [ids, deviceIds],
        );
        if (active === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const active = await count(
        client,
        `SELECT count(*) FROM test_runs
          WHERE ("planId" = ANY($1::uuid[]) OR "deviceId" = ANY($2::uuid[]))
            AND status = 'RUNNING'`,
        [ids, deviceIds],
      );
      if (active > 0) {
        throw new Error(
          `Refusing to delete E2E data while ${active} run(s) for the test plan(s)/device(s) ` +
            `are still RUNNING after ${timeoutMs} ms.`,
        );
      }

      const trackedRuns = await client.query<{ id: string }>(
        `SELECT id FROM test_runs
          WHERE "planId" = ANY($1::uuid[]) OR "deviceId" = ANY($2::uuid[])`,
        [ids, deviceIds],
      );
      runIds = trackedRuns.rows.map((row) => row.id);
    }

    let planRevisions = 0;
    let planSteps = 0;
    let stepIdentities = 0;
    let plans = 0;
    let planCopyRequests = 0;
    let devices = 0;
    let runs = 0;
    let runSteps = 0;
    let measurements = 0;
    let runEvents = 0;
    let sessions = 0;

    await client.query("BEGIN");
    try {
      for (const table of CLEANUP_TRIGGER_TABLES) {
        await client.query(
          `ALTER TABLE ${quoteIdentifier(table)} DISABLE TRIGGER USER`,
        );
      }

      if (runIds.length > 0) {
        runEvents = await deleteRows(
          client,
          `DELETE FROM "run_events" WHERE "runId" = ANY($1::uuid[])`,
          [runIds],
        );
        measurements = await deleteRows(
          client,
          `DELETE FROM "measurements" WHERE "runId" = ANY($1::uuid[])`,
          [runIds],
        );
        runSteps = await deleteRows(
          client,
          `DELETE FROM "run_steps" WHERE "runId" = ANY($1::uuid[])`,
          [runIds],
        );
        runs = await deleteRows(
          client,
          `DELETE FROM "test_runs" WHERE id = ANY($1::uuid[])`,
          [runIds],
        );
      }

      if (deviceIds.length > 0) {
        const stillReferenced = await count(
          client,
          `SELECT count(*) FROM test_runs WHERE "deviceId" = ANY($1::uuid[])`,
          [deviceIds],
        );
        if (stillReferenced > 0) {
          throw new Error(
            `Refusing to delete tracked device(s) while ${stillReferenced} run(s) still ` +
              `reference them. Pass the owning plan ids to cleanup.`,
          );
        }

        devices = await deleteRows(
          client,
          `DELETE FROM "devices" WHERE id = ANY($1::uuid[])`,
          [deviceIds],
        );
      }

      if (ids.length > 0 || explicitCopyRequestIds.length > 0) {
        planCopyRequests = await deleteRows(
          client,
          `DELETE FROM "plan_copy_requests"
            WHERE id = ANY($1::uuid[])
               OR "targetPlanId" = ANY($2::uuid[])
               OR "sourceVersionId" IN (
                 SELECT id FROM "plan_revisions" WHERE "planId" = ANY($2::uuid[])
               )`,
          [explicitCopyRequestIds, ids],
        );
      }

      if (ids.length > 0) {
        planSteps = await deleteRows(
          client,
          `DELETE FROM "plan_steps" WHERE "planId" = ANY($1::uuid[])`,
          [ids],
        );
        planRevisions = await deleteRows(
          client,
          `DELETE FROM "plan_revisions" WHERE "planId" = ANY($1::uuid[])`,
          [ids],
        );
        stepIdentities = await deleteRows(
          client,
          `DELETE FROM "step_identities" WHERE "planId" = ANY($1::uuid[])`,
          [ids],
        );
        plans = await deleteRows(
          client,
          `DELETE FROM "test_plans" WHERE id = ANY($1::uuid[])`,
          [ids],
        );
      }

      if (userEmails.length > 0) {
        sessions = await deleteRows(
          client,
          `DELETE FROM "sessions"
             WHERE "userId" IN (SELECT id FROM "users" WHERE email = ANY($1))
               AND id <> ALL($2::uuid[])`,
          [userEmails, sessionBaseline],
        );
      }

      for (const table of CLEANUP_TRIGGER_TABLES) {
        await client.query(
          `ALTER TABLE ${quoteIdentifier(table)} ENABLE TRIGGER USER`,
        );
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const activeRunsAfter =
      ids.length === 0 && deviceIds.length === 0
        ? 0
        : await count(
            client,
            `SELECT count(*) FROM test_runs
              WHERE ("planId" = ANY($1::uuid[]) OR "deviceId" = ANY($2::uuid[]))
                AND status = 'RUNNING'`,
            [ids, deviceIds],
          );
    const remainingPlanIds =
      ids.length === 0
        ? 0
        : await count(
            client,
            `SELECT count(*) FROM test_plans WHERE id = ANY($1::uuid[])`,
            [ids],
          );
    const remainingRunIds =
      ids.length === 0 && deviceIds.length === 0
        ? 0
        : await count(
            client,
            `SELECT count(*) FROM test_runs
              WHERE "planId" = ANY($1::uuid[]) OR "deviceId" = ANY($2::uuid[])`,
            [ids, deviceIds],
          );
    const remainingDeviceIds =
      deviceIds.length === 0
        ? 0
        : await count(
            client,
            `SELECT count(*) FROM "devices" WHERE id = ANY($1::uuid[])`,
            [deviceIds],
          );
    const remainingPlanCopyRequests =
      ids.length === 0 && explicitCopyRequestIds.length === 0
        ? 0
        : await count(
            client,
            `SELECT count(*) FROM "plan_copy_requests"
              WHERE id = ANY($1::uuid[])
                 OR "targetPlanId" = ANY($2::uuid[])
                 OR "sourceVersionId" IN (
                   SELECT id FROM "plan_revisions" WHERE "planId" = ANY($2::uuid[])
                 )`,
            [explicitCopyRequestIds, ids],
          );
    const remainingSessions =
      userEmails.length === 0
        ? 0
        : await count(
            client,
            `SELECT count(*) FROM "sessions"
               WHERE "userId" IN (SELECT id FROM "users" WHERE email = ANY($1))
                 AND id <> ALL($2::uuid[])`,
            [userEmails, sessionBaseline],
          );

    const summary: E2eCleanupSummary = {
      planIds: ids.length,
      plans,
      planRevisions,
      planSteps,
      stepIdentities,
      planCopyRequests,
      devices,
      runs,
      runSteps,
      measurements,
      runEvents,
      sessions,
      activeRunsAfter,
      remainingPlanIds,
      remainingRunIds,
      remainingDeviceIds,
      remainingPlanCopyRequests,
      remainingSessions,
    };

    if (
      remainingPlanIds > 0 ||
      remainingRunIds > 0 ||
      remainingDeviceIds > 0 ||
      remainingPlanCopyRequests > 0 ||
      remainingSessions > 0 ||
      activeRunsAfter > 0
    ) {
      throw new Error(
        `E2E cleanup left data behind on ${parsed.display}: ` +
          `plans=${remainingPlanIds} runs=${remainingRunIds} devices=${remainingDeviceIds} ` +
          `planCopyRequests=${remainingPlanCopyRequests} sessions=${remainingSessions} ` +
          `activeRuns=${activeRunsAfter}.`,
      );
    }

    console.log(
      `[e2e-db] cleanup ${parsed.display}: plans=${plans} revisions=${planRevisions} ` +
        `planSteps=${planSteps} stepIdentities=${stepIdentities} ` +
        `planCopyRequests=${planCopyRequests} devices=${devices} runs=${runs} ` +
        `runSteps=${runSteps} measurements=${measurements} runEvents=${runEvents} ` +
        `sessions=${sessions} activeRuns=${activeRunsAfter}`,
    );
    return summary;
  } finally {
    await client.end();
  }
}
