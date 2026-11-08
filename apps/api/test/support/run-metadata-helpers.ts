import { randomUUID } from 'node:crypto';
import {
  Prisma,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
  type PrismaClient,
  type Role,
} from '../../src/prisma/generated/client.js';
import { RUN_EVALUATION_VERSION } from '../../src/runs/run-domain.js';
import { SIMULATOR_VERSION } from '../../src/simulator/index.js';
import { createTestUser, type TestUser } from './auth-helpers.js';
import type { PublishedRunFixture } from './run-helpers.js';

export const RUN_METADATA_TEST_EMAIL_PREFIX = 'run-metadata-e2e-';
export const RUN_METADATA_PROFILE_CODE_PREFIX = 'run-metadata-e2e-profile-';

export function createRunMetadataTestUser(
  prisma: PrismaClient,
  role: Role,
): Promise<TestUser> {
  return createTestUser(prisma, {
    role,
    email: `${RUN_METADATA_TEST_EMAIL_PREFIX}${randomUUID()}@example.test`,
    password: 'Run-Metadata-E2E-Password-9',
  });
}

export function createRunMetadataTestProfile(prisma: PrismaClient): Promise<{
  id: string;
  code: string;
  name: string;
  description: string | null;
}> {
  return prisma.deviceProfile.create({
    data: {
      code: `${RUN_METADATA_PROFILE_CODE_PREFIX}${randomUUID()}`,
      name: 'Run Metadata E2E Profile',
      description: 'Fixture profile for run metadata tests',
    },
    select: { id: true, code: true, name: true, description: true },
  });
}

export function createRunMetadataTestDevice(
  prisma: PrismaClient,
  input: {
    deviceProfileId: string;
    createdById: string;
    name?: string;
    serialNumber?: string;
    archivedAt?: Date | null;
  },
) {
  const serialNumber = (
    input.serialNumber ?? `RUNMETA-${randomUUID().slice(0, 8)}`
  ).trim();
  const name = (input.name ?? 'Bench Power Module').trim();

  return prisma.device.create({
    data: {
      deviceProfileId: input.deviceProfileId,
      createdById: input.createdById,
      name,
      serialNumber,
      serialNumberKey: serialNumber.toUpperCase(),
      archivedAt: input.archivedAt ?? null,
    },
  });
}

/**
 * Inserts a terminal run with metadata directly. History/filter and comparison
 * tests need several startedAt values, which the immutable start path cannot
 * vary after insertion.
 */
export async function seedMetadataRun(
  prisma: PrismaClient,
  input: {
    fixture: PublishedRunFixture;
    requestedById: string;
    startedAt: string;
    device?: {
      id: string;
      name: string;
      serialNumber: string;
      deviceProfileId: string;
    } | null;
    batchNumber?: string | null;
    scenario?: RunScenario;
    status?: RunStatus;
    outcome?: RunOutcome | null;
  },
): Promise<{ id: string; startedAt: string }> {
  const device = input.device ?? null;
  const batchNumber = input.batchNumber ?? null;
  const expectedSampleCount = input.fixture.steps.reduce(
    (total, step) => total + step.sampleCount,
    0,
  );
  const status = input.status ?? RunStatus.COMPLETED;
  const outcome =
    input.outcome === undefined ? RunOutcome.PASSED : input.outcome;

  const run = await prisma.testRun.create({
    data: {
      planId: input.fixture.planId,
      planRevisionId: input.fixture.revisionId,
      planNameSnapshot: input.fixture.planName,
      versionNumberSnapshot: input.fixture.versionNumber,
      profileSnapshot: input.fixture.profile,
      deviceId: device?.id ?? null,
      deviceSnapshot: device ?? Prisma.DbNull,
      batchNumber,
      batchNumberKey: batchNumber === null ? null : batchNumber.toUpperCase(),
      status,
      outcome,
      requestedById: input.requestedById,
      scenario: input.scenario ?? RunScenario.NORMAL,
      seed: 42n,
      simulatorVersion: SIMULATOR_VERSION,
      evaluationVersion: RUN_EVALUATION_VERSION,
      idempotencyKey: `run-metadata-seed-${randomUUID()}`,
      requestHash: randomUUID().replaceAll('-', ''),
      eventSequence: 0,
      expectedSampleCount,
      recordedSampleCount: expectedSampleCount,
      startedAt: new Date(input.startedAt),
      finishedAt: new Date(input.startedAt),
    },
    select: { id: true },
  });

  await prisma.runStep.createMany({
    data: input.fixture.steps.map((step) => ({
      runId: run.id,
      logicalStepId: step.logicalStepId,
      position: step.position,
      name: step.name,
      unit: step.unit,
      minimum: step.minimum,
      maximum: step.maximum,
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
      status: RunStepStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      recordedCount: step.sampleCount,
      outOfToleranceCount: 0,
      firstFailureSampleIndex: null,
    })),
  });

  return { id: run.id, startedAt: input.startedAt };
}

/** Removes only runs requested by this suite's users, preserving fixtures. */
export async function deleteRunMetadataRuns(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: RUN_METADATA_TEST_EMAIL_PREFIX } },
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
}

/** Removes devices created by this suite's users, after their runs are gone. */
export async function deleteRunMetadataDevices(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: RUN_METADATA_TEST_EMAIL_PREFIX } },
    select: { id: true },
  });

  await prisma.device.deleteMany({
    where: { createdById: { in: users.map((user) => user.id) } },
  });
}

/**
 * Polls PostgreSQL for an active statement waiting on a lock whose text
 * contains the supplied fragment. This is used by the real two-connection
 * start/archive race test instead of a timing-based sleep.
 */
export async function waitForLockWaiter(
  prisma: PrismaClient,
  queryFragment: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS "waiting"
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND state = 'active'
        AND wait_event_type = 'Lock'
        AND query LIKE ${`%${queryFragment}%`}
        AND pid <> pg_backend_pid()
    `;

    if ((rows[0]?.waiting ?? 0) > 0) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Timed out waiting for a PostgreSQL lock waiter containing "${queryFragment}".`,
  );
}

/**
 * Removes everything this suite creates. Runs are deleted before their device,
 * and plan immutability triggers are disabled only for fixture cleanup, as in
 * the existing run suites.
 */
export async function deleteRunMetadataTestData(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: RUN_METADATA_TEST_EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_steps" DISABLE TRIGGER USER',
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_revisions" DISABLE TRIGGER USER',
  );

  try {
    const runs = await prisma.testRun.findMany({
      where: { requestedById: { in: userIds } },
      select: { id: true },
    });
    const runIds = runs.map((run) => run.id);

    await prisma.measurement.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.runEvent.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.runStep.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.testRun.deleteMany({ where: { id: { in: runIds } } });

    const plans = await prisma.testPlan.findMany({
      where: { createdById: { in: userIds } },
      select: { id: true },
    });
    const planIds = plans.map((plan) => plan.id);

    await prisma.planStep.deleteMany({ where: { planId: { in: planIds } } });
    await prisma.planRevision.deleteMany({
      where: { planId: { in: planIds } },
    });
    await prisma.stepIdentity.deleteMany({
      where: { planId: { in: planIds } },
    });
    await prisma.testPlan.deleteMany({ where: { id: { in: planIds } } });

    await prisma.device.deleteMany({
      where: { createdById: { in: userIds } },
    });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.deviceProfile.deleteMany({
      where: { code: { startsWith: RUN_METADATA_PROFILE_CODE_PREFIX } },
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
