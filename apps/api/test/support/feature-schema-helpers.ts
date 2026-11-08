import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from 'pg';
import type { PrismaClient } from '../../src/prisma/generated/client.js';

export const FEATURE_SCHEMA_EMAIL_PREFIX = 'feature-schema-e2e-';
export const FEATURE_SCHEMA_PROFILE_CODE_PREFIX = 'feature-schema-e2e-profile-';
export const FEATURE_SCHEMA_MIGRATION_NAME =
  '20261106120000_devices_and_copy_requests';

const migrationsDirectory = fileURLToPath(
  new URL('../../prisma/migrations', import.meta.url),
);

export function listMigrationNames(): string[] {
  return readdirSync(migrationsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Applies committed migration SQL into an isolated PostgreSQL schema. This is
 * used only by the migration tests so a fresh install and an upgrade fixture can
 * be exercised without dropping the shared test database's public schema.
 */
export async function applyMigrationsToSchema(
  client: Client,
  schemaName: string,
  migrations: readonly string[],
): Promise<void> {
  await client.query(`CREATE SCHEMA "${schemaName}"`);
  await client.query(`SET search_path TO "${schemaName}", public`);

  for (const migration of migrations) {
    await applyMigrationSql(client, migration);
  }
}

export async function applyMigrationSql(
  client: Client,
  migration: string,
): Promise<void> {
  const sql = readFileSync(
    join(migrationsDirectory, migration, 'migration.sql'),
    'utf8',
  );
  await client.query(sql);
}

export async function dropIsolatedSchema(
  client: Client,
  schemaName: string,
): Promise<void> {
  await client.query('SET search_path TO public');
  await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
}

export interface LegacyFixtureIds {
  plannerId: string;
  profileId: string;
  planId: string;
  revisionId: string;
  runId: string;
  stepId: string;
}

/**
 * Inserts representative pre-feature data after the previous migration. The
 * run is first written as RUNNING (so a measurement is accepted), then moved to
 * its terminal state through the same updates the service uses.
 */
export async function seedLegacyUpgradeFixture(
  client: Client,
): Promise<LegacyFixtureIds> {
  const ids: LegacyFixtureIds = {
    plannerId: randomUUID(),
    profileId: randomUUID(),
    planId: randomUUID(),
    revisionId: randomUUID(),
    runId: randomUUID(),
    stepId: randomUUID(),
  };
  const identityId = randomUUID();
  const planStepId = randomUUID();
  const measurementId = randomUUID();
  const eventId = randomUUID();

  await client.query(
    `INSERT INTO "users" ("id", "email", "passwordHash", "role", "createdAt")
     VALUES ($1::uuid, $2, 'legacy-password-hash', 'PLANNER', '2026-11-01T08:00:00Z')`,
    [ids.plannerId, `upgrade-${ids.plannerId}@example.test`],
  );
  await client.query(
    `INSERT INTO "device_profiles" ("id", "code", "name", "description")
     VALUES ($1::uuid, $2, 'Legacy device profile', 'Upgrade fixture')`,
    [ids.profileId, `legacy-${ids.profileId}`],
  );
  await client.query(
    `INSERT INTO "test_plans" ("id", "deviceProfileId", "createdById", "createdAt")
     VALUES ($1::uuid, $2::uuid, $3::uuid, '2026-11-01T08:05:00Z')`,
    [ids.planId, ids.profileId, ids.plannerId],
  );
  await client.query(
    `INSERT INTO "step_identities" ("id", "planId", "createdAt")
     VALUES ($1::uuid, $2::uuid, '2026-11-01T08:06:00Z')`,
    [identityId, ids.planId],
  );
  await client.query(
    `INSERT INTO "plan_revisions" (
       "id", "planId", "state", "name", "versionNumber", "editRevision",
       "baseVersionId", "publishedById", "publishedAt"
     ) VALUES (
       $1::uuid, $2::uuid, 'DRAFT', 'Legacy upgrade plan', NULL, 1,
       NULL, NULL, NULL
     )`,
    [ids.revisionId, ids.planId],
  );
  await client.query(
    `INSERT INTO "plan_steps" (
       "id", "revisionId", "planId", "logicalStepId", "position", "name",
       "unit", "minimum", "maximum", "sampleCount", "intervalMs"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, 'Output voltage',
       'V', 4.750000, 5.250000, 1, 200
     )`,
    [planStepId, ids.revisionId, ids.planId, identityId],
  );
  await client.query(
    `UPDATE "plan_revisions"
     SET "state" = 'PUBLISHED', "versionNumber" = 1,
         "publishedById" = $1::uuid, "publishedAt" = '2026-11-01T08:10:00Z'
     WHERE "id" = $2::uuid`,
    [ids.plannerId, ids.revisionId],
  );

  await client.query(
    `INSERT INTO "test_runs" (
       "id", "planId", "planRevisionId", "planNameSnapshot",
       "versionNumberSnapshot", "profileSnapshot", "status", "outcome",
       "requestedById", "scenario", "seed", "errorProbability",
       "failureStepId", "simulatorVersion", "evaluationVersion",
       "idempotencyKey", "requestHash", "eventSequence",
       "expectedSampleCount", "recordedSampleCount", "startedAt",
       "finishedAt", "cancelledById", "reasonCode"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 'Legacy upgrade plan', 1,
       $4::jsonb, 'RUNNING', NULL, $5::uuid, 'NORMAL', 123456789, NULL,
       NULL, 'mulberry32-v1', 'decimal-v1', 'legacy-idempotency-key',
       'legacy-request-hash-9f0f', 1, 1, 0, '2026-11-01T10:00:00Z',
       NULL, NULL, NULL
     )`,
    [
      ids.runId,
      ids.planId,
      ids.revisionId,
      JSON.stringify({
        id: ids.profileId,
        code: `legacy-${ids.profileId}`,
        name: 'Legacy device profile',
      }),
      ids.plannerId,
    ],
  );
  await client.query(
    `INSERT INTO "run_steps" (
       "id", "runId", "logicalStepId", "position", "name", "unit",
       "minimum", "maximum", "sampleCount", "intervalMs", "status",
       "outcome", "recordedCount", "outOfToleranceCount",
       "firstFailureSampleIndex", "startedAt", "finishedAt", "statistics"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 1, 'Output voltage', 'V',
       4.750000, 5.250000, 1, 200, 'RUNNING', NULL, 0, 0,
       NULL, '2026-11-01T10:00:00Z', NULL, NULL
     )`,
    [ids.stepId, ids.runId, identityId],
  );
  await client.query(
    `INSERT INTO "measurements" (
       "id", "runId", "runStepId", "sampleIndex", "value",
       "isWithinTolerance", "recordedAt", "elapsedMs"
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, 0, 4.987500, true,
       '2026-11-01T10:00:00.200Z', 200
     )`,
    [measurementId, ids.runId, ids.stepId],
  );
  await client.query(
    `INSERT INTO "run_events" (
       "id", "runId", "sequence", "type", "schemaVersion", "occurredAt", "payload"
     ) VALUES (
       $1::uuid, $2::uuid, 1, 'run.started', 1,
       '2026-11-01T10:00:00Z', $3::jsonb
     )`,
    [eventId, ids.runId, JSON.stringify({ status: 'RUNNING' })],
  );
  await client.query(
    `UPDATE "run_steps"
     SET "status" = 'COMPLETED', "outcome" = 'PASSED',
         "recordedCount" = 1, "outOfToleranceCount" = 0,
         "finishedAt" = '2026-11-01T10:00:00.400Z',
         "statistics" = $1::jsonb
     WHERE "id" = $2::uuid`,
    [JSON.stringify({ minimum: 4.9875, maximum: 4.9875 }), ids.stepId],
  );
  await client.query(
    `UPDATE "test_runs"
     SET "status" = 'COMPLETED', "outcome" = 'PASSED',
         "recordedSampleCount" = 1,
         "finishedAt" = '2026-11-01T10:00:00.500Z'
     WHERE "id" = $1::uuid`,
    [ids.runId],
  );

  return ids;
}

export interface LegacyFingerprint {
  testRuns: string;
  runSteps: string;
  measurements: string;
  runEvents: string;
  planRevisions: string;
  planSteps: string;
  stepIdentities: string;
  testPlans: string;
}

/**
 * Hashes explicit pre-feature column lists so adding nullable columns cannot
 * change the comparison itself.
 */
export async function readLegacyFingerprint(
  client: Client,
): Promise<LegacyFingerprint> {
  const hash = async (sql: string): Promise<string> => {
    const result = await client.query<{ hash: string }>(sql);
    return result.rows[0]?.hash ?? '';
  };

  return {
    testRuns: await hash(`
      SELECT md5(string_agg(row_to_json(rows)::text, '|' ORDER BY rows."id")) AS hash
      FROM (
        SELECT "id", "planId", "planRevisionId", "planNameSnapshot",
               "versionNumberSnapshot", "profileSnapshot", "status", "outcome",
               "requestedById", "scenario", "seed", "errorProbability",
               "failureStepId", "simulatorVersion", "evaluationVersion",
               "idempotencyKey", "requestHash", "eventSequence",
               "expectedSampleCount", "recordedSampleCount", "startedAt",
               "finishedAt", "cancelledById", "reasonCode"
        FROM "test_runs"
      ) AS rows
    `),
    runSteps: await hash(`
      SELECT md5(string_agg(row_to_json(rows)::text, '|' ORDER BY rows."id")) AS hash
      FROM (
        SELECT "id", "runId", "logicalStepId", "position", "name", "unit",
               "minimum", "maximum", "sampleCount", "intervalMs", "status",
               "outcome", "recordedCount", "outOfToleranceCount",
               "firstFailureSampleIndex", "startedAt", "finishedAt", "statistics"
        FROM "run_steps"
      ) AS rows
    `),
    measurements: await hash(`
      SELECT md5(string_agg(row_to_json(rows)::text, '|' ORDER BY rows."id")) AS hash
      FROM (
        SELECT "id", "runId", "runStepId", "sampleIndex", "value",
               "isWithinTolerance", "recordedAt", "elapsedMs"
        FROM "measurements"
      ) AS rows
    `),
    runEvents: await hash(`
      SELECT md5(string_agg(row_to_json(rows)::text, '|' ORDER BY rows."id")) AS hash
      FROM (
        SELECT "id", "runId", "sequence", "type", "schemaVersion",
               "occurredAt", "payload"
        FROM "run_events"
      ) AS rows
    `),
    planRevisions: await hash(`
      SELECT md5(string_agg(row_to_json(rows)::text, '|' ORDER BY rows."id")) AS hash
      FROM (
        SELECT "id", "planId", "state", "name", "versionNumber", "editRevision",
               "baseVersionId", "publishedById", "publishedAt"
        FROM "plan_revisions"
      ) AS rows
    `),
    planSteps: await hash(`
      SELECT md5(string_agg(row_to_json(rows)::text, '|' ORDER BY rows."id")) AS hash
      FROM (
        SELECT "id", "revisionId", "planId", "logicalStepId", "position",
               "name", "unit", "minimum", "maximum", "sampleCount", "intervalMs"
        FROM "plan_steps"
      ) AS rows
    `),
    stepIdentities: await hash(`
      SELECT md5(string_agg(row_to_json(rows)::text, '|' ORDER BY rows."id")) AS hash
      FROM (
        SELECT "id", "planId", "createdAt"
        FROM "step_identities"
      ) AS rows
    `),
    testPlans: await hash(`
      SELECT md5(string_agg(row_to_json(rows)::text, '|' ORDER BY rows."id")) AS hash
      FROM (
        SELECT "id", "deviceProfileId", "createdById", "createdAt"
        FROM "test_plans"
      ) AS rows
    `),
  };
}

/**
 * Removes every row owned by this suite. Published revisions are deleted as the
 * schema owner only after USER triggers are disabled, matching the established
 * plan/runs cleanup pattern.
 */
export async function deleteFeatureSchemaTestData(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_steps" DISABLE TRIGGER USER',
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_revisions" DISABLE TRIGGER USER',
  );

  try {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: FEATURE_SCHEMA_EMAIL_PREFIX } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    const plans = await prisma.testPlan.findMany({
      where: { createdById: { in: userIds } },
      select: { id: true },
    });
    const planIds = plans.map((plan) => plan.id);

    await deleteFeatureRunsAndDevices(prisma);

    await prisma.planCopyRequest.deleteMany({
      where: {
        OR: [
          { requestedById: { in: userIds } },
          { targetPlanId: { in: planIds } },
        ],
      },
    });
    await prisma.planStep.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.planRevision.deleteMany({
      where: { planId: { in: planIds } },
    });
    await prisma.stepIdentity.deleteMany({
      where: { planId: { in: planIds } },
    });
    await prisma.testPlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.deviceProfile.deleteMany({
      where: { code: { startsWith: FEATURE_SCHEMA_PROFILE_CODE_PREFIX } },
    });
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "plan_revisions" ENABLE TRIGGER USER',
    );
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "plan_steps" ENABLE TRIGGER USER',
    );
  }
}

/**
 * Removes only run/device/copy rows so the next test starts without a stray
 * RUNNING run while shared fixture users and plans stay available.
 */
export async function deleteFeatureRunsAndDevices(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: FEATURE_SCHEMA_EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const runs = await prisma.testRun.findMany({
    where: { requestedById: { in: userIds } },
    select: { id: true },
  });
  const runIds = runs.map((run) => run.id);

  await prisma.measurement.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.runEvent.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.runStep.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.testRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.planCopyRequest.deleteMany({
    where: { requestedById: { in: userIds } },
  });
  await prisma.device.deleteMany({
    where: { createdById: { in: userIds } },
  });
}
