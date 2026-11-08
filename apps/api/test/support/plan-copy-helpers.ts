import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../src/prisma/generated/client.js';
import { PLAN_TEST_EMAIL_PREFIX, deletePlanTestData } from './plan-helpers.js';

/**
 * Removes copy provenance and run history before the shared plan cleanup
 * removes targets, revisions and users. The PlanCopyRequest and TestRun foreign
 * keys are RESTRICT, so a leftover row would otherwise block cleanup of an
 * earlier failed run.
 */
export async function deletePlanCopyTestData(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: PLAN_TEST_EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const plans = await prisma.testPlan.findMany({
    where: { createdById: { in: userIds } },
    select: { id: true },
  });
  const planIds = plans.map((plan) => plan.id);

  const runs = await prisma.testRun.findMany({
    where: {
      OR: [{ planId: { in: planIds } }, { requestedById: { in: userIds } }],
    },
    select: { id: true },
  });
  const runIds = runs.map((run) => run.id);

  await prisma.measurement.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.runEvent.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.runStep.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.testRun.deleteMany({ where: { id: { in: runIds } } });

  await prisma.planCopyRequest.deleteMany({
    where: {
      OR: [
        { requestedById: { in: userIds } },
        { targetPlanId: { in: planIds } },
        { sourceVersion: { planId: { in: planIds } } },
      ],
    },
  });

  await deletePlanTestData(prisma);
}

export const PLAN_COPY_FAILURE_FUNCTION =
  'probedesk_test_force_plan_copy_failure';
export const PLAN_COPY_FAILURE_TRIGGER =
  'probedesk_test_force_plan_copy_failure';

/**
 * Installs a temporary trigger that aborts every PlanCopyRequest insert. The
 * test uses it to prove that a failure after the plan, revision, identity and
 * step inserts rolls the whole transaction back.
 */
export async function installPlanCopyFailureTrigger(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "${PLAN_COPY_FAILURE_FUNCTION}"()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'forced plan copy failure';
    END;
    $$
  `);
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS "${PLAN_COPY_FAILURE_TRIGGER}"
    ON "plan_copy_requests"
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER "${PLAN_COPY_FAILURE_TRIGGER}"
    BEFORE INSERT ON "plan_copy_requests"
    FOR EACH ROW
    EXECUTE FUNCTION "${PLAN_COPY_FAILURE_FUNCTION}"()
  `);
}

export async function removePlanCopyFailureTrigger(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS "${PLAN_COPY_FAILURE_TRIGGER}"
    ON "plan_copy_requests"
  `);
  await prisma.$executeRawUnsafe(
    `DROP FUNCTION IF EXISTS "${PLAN_COPY_FAILURE_FUNCTION}"()`,
  );
}

/**
 * Digests of every row that makes up a published source plan's identity and
 * real run history. The copy test compares these before and after the copy
 * transaction; a count of runs alone would not prove that step rules,
 * measurements, events and stored request hashes were untouched.
 *
 * Only the derived digests are returned. The raw request hash and run rows are
 * never printed by the test.
 */
export interface PlanSourceFingerprint {
  readonly plan: string;
  readonly revisions: string;
  readonly planSteps: string;
  readonly stepIdentities: string;
  readonly runs: string;
  readonly runSteps: string;
  readonly measurements: string;
  readonly runEvents: string;
  readonly runRequest: string;
}

export async function capturePlanSourceFingerprint(
  prisma: PrismaClient,
  planId: string,
): Promise<PlanSourceFingerprint> {
  const plan = await prisma.testPlan.findUniqueOrThrow({
    where: { id: planId },
  });
  const revisions = await prisma.planRevision.findMany({
    where: { planId },
    orderBy: { id: 'asc' },
  });
  const planSteps = await prisma.planStep.findMany({
    where: { planId },
    orderBy: { id: 'asc' },
  });
  const stepIdentities = await prisma.stepIdentity.findMany({
    where: { planId },
    orderBy: { id: 'asc' },
  });
  const runs = await prisma.testRun.findMany({
    where: { planId },
    orderBy: { id: 'asc' },
  });
  const runIds = runs.map((run) => run.id);
  const runSteps = await prisma.runStep.findMany({
    where: { runId: { in: runIds } },
    orderBy: { id: 'asc' },
  });
  const measurements = await prisma.measurement.findMany({
    where: { runId: { in: runIds } },
    orderBy: { id: 'asc' },
  });
  const runEvents = await prisma.runEvent.findMany({
    where: { runId: { in: runIds } },
    orderBy: { id: 'asc' },
  });

  return {
    plan: hashRows([plan]),
    revisions: hashRows(revisions),
    planSteps: hashRows(planSteps),
    stepIdentities: hashRows(stepIdentities),
    runs: hashRows(runs),
    runSteps: hashRows(runSteps),
    measurements: hashRows(measurements),
    runEvents: hashRows(runEvents),
    runRequest: hashRows(
      runs.map((run) => ({
        id: run.id,
        idempotencyKey: run.idempotencyKey,
        requestHash: run.requestHash,
        status: run.status,
        outcome: run.outcome,
        expectedSampleCount: run.expectedSampleCount,
        recordedSampleCount: run.recordedSampleCount,
      })),
    ),
  };
}

function hashRows(rows: readonly unknown[]): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(rows)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'toFixed' in value &&
    typeof value.toFixed === 'function'
  ) {
    return value.toFixed(6);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }

  return value;
}
