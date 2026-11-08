import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { requireIsolatedApplicationDatabase } from '../../src/common/database/test-database-guard.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/common/bootstrap/configure-app.js';
import { APP_CONFIG, loadEnv, type AppConfig } from '../../src/config/env.js';
import {
  PlanRevisionState,
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

export const ANALYTICS_TEST_EMAIL_PREFIX = 'analytics-e2e-';
export const ANALYTICS_PROFILE_CODE_PREFIX = 'analytics-e2e-profile-';

export interface AnalyticsProfileFixture {
  id: string;
  code: string;
  name: string;
  description: string | null;
}

export interface AnalyticsStepInput {
  /** Reuse a logical identity when publishing another version of the plan. */
  logicalStepId?: string;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

export interface AnalyticsStepFixture {
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

export interface AnalyticsRevisionFixture {
  planId: string;
  revisionId: string;
  planName: string;
  versionNumber: number;
  profile: AnalyticsProfileFixture;
  steps: AnalyticsStepFixture[];
}

export interface AnalyticsDeviceSnapshotInput {
  id: string;
  name: string;
  serialNumber: string;
  deviceProfileId: string;
}

export interface AnalyticsRunStepSeed {
  status: RunStepStatus;
  outcome: RunOutcome | null;
  recordedCount?: number;
}

export interface AnalyticsRunSeedInput {
  fixture: AnalyticsRevisionFixture;
  requestedById: string;
  status: RunStatus;
  outcome?: RunOutcome | null;
  startedAt: string;
  finishedAt?: string | null;
  device?: AnalyticsDeviceSnapshotInput | null;
  batchNumber?: string | null;
  scenario?: RunScenario;
  stepStatuses?: readonly AnalyticsRunStepSeed[];
}

export function createAnalyticsTestUser(
  prisma: PrismaClient,
  role: Role,
): Promise<TestUser> {
  return createTestUser(prisma, {
    role,
    email: `${ANALYTICS_TEST_EMAIL_PREFIX}${randomUUID()}@example.test`,
    password: 'Analytics-E2E-Password-9',
  });
}

export function createAnalyticsTestProfile(
  prisma: PrismaClient,
): Promise<AnalyticsProfileFixture> {
  return prisma.deviceProfile.create({
    data: {
      code: `${ANALYTICS_PROFILE_CODE_PREFIX}${randomUUID()}`,
      name: 'Analytics E2E Profile',
      description: 'Fixture profile for analytics overview tests',
    },
    select: { id: true, code: true, name: true, description: true },
  });
}

export async function createAnalyticsTestDevice(
  prisma: PrismaClient,
  input: {
    deviceProfileId: string;
    createdById: string;
    name?: string;
    serialNumber?: string;
  },
): Promise<AnalyticsDeviceSnapshotInput> {
  const serialNumber = (
    input.serialNumber ?? `ANALYTICS-${randomUUID().slice(0, 12)}`
  ).trim();
  const device = await prisma.device.create({
    data: {
      deviceProfileId: input.deviceProfileId,
      createdById: input.createdById,
      name: (input.name ?? 'Analytics Bench Module').trim(),
      serialNumber,
      serialNumberKey: serialNumber.toUpperCase(),
    },
    select: {
      id: true,
      name: true,
      serialNumber: true,
      deviceProfileId: true,
    },
  });

  return device;
}

export function createAnalyticsPlan(
  prisma: PrismaClient,
  plannerId: string,
  profileId: string,
): Promise<{ id: string }> {
  return prisma.testPlan.create({
    data: { createdById: plannerId, deviceProfileId: profileId },
    select: { id: true },
  });
}

/**
 * Publishes one immutable revision through the allowed DRAFT -> PUBLISHED
 * transition. Reusing a logicalStepId from an earlier revision of the same plan
 * keeps the step identity stable across versions.
 */
export async function publishAnalyticsRevision(
  prisma: PrismaClient,
  input: {
    planId: string;
    plannerId: string;
    profile: AnalyticsProfileFixture;
    planName: string;
    versionNumber: number;
    steps: readonly AnalyticsStepInput[];
  },
): Promise<AnalyticsRevisionFixture> {
  const steps: AnalyticsStepFixture[] = [];

  for (const [index, step] of input.steps.entries()) {
    const logicalStepId =
      step.logicalStepId ??
      (
        await prisma.stepIdentity.create({
          data: { planId: input.planId },
          select: { id: true },
        })
      ).id;

    steps.push({
      logicalStepId,
      position: index + 1,
      name: step.name,
      unit: step.unit,
      minimum: step.minimum,
      maximum: step.maximum,
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
    });
  }

  const draft = await prisma.planRevision.create({
    data: {
      planId: input.planId,
      state: PlanRevisionState.DRAFT,
      name: input.planName,
      editRevision: 1,
    },
  });

  await prisma.planStep.createMany({
    data: steps.map((step) => ({
      planId: input.planId,
      revisionId: draft.id,
      logicalStepId: step.logicalStepId,
      position: step.position,
      name: step.name,
      unit: step.unit,
      minimum: step.minimum,
      maximum: step.maximum,
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
    })),
  });

  const published = await prisma.planRevision.update({
    where: { id: draft.id },
    data: {
      state: PlanRevisionState.PUBLISHED,
      versionNumber: input.versionNumber,
      publishedById: input.plannerId,
      publishedAt: new Date('2026-10-01T00:00:00.000Z'),
    },
    select: { id: true, name: true, versionNumber: true },
  });

  return {
    planId: input.planId,
    revisionId: published.id,
    planName: published.name,
    versionNumber: published.versionNumber ?? input.versionNumber,
    profile: input.profile,
    steps,
  };
}

/**
 * Inserts a run and its immutable step snapshots directly. Analytics tests need
 * exact startedAt/status combinations; the start endpoint cannot vary a
 * finished run's timestamps or create a second RUNNING row.
 */
export async function seedAnalyticsRun(
  prisma: PrismaClient,
  input: AnalyticsRunSeedInput,
): Promise<{ id: string; startedAt: string; stepIds: string[] }> {
  const stepSeeds = input.stepStatuses ?? defaultStepSeeds(input.status);
  if (stepSeeds.length !== input.fixture.steps.length) {
    throw new Error(
      'stepStatuses must contain one entry for every fixture step.',
    );
  }

  const outcome =
    input.outcome === undefined
      ? input.status === RunStatus.COMPLETED
        ? RunOutcome.PASSED
        : null
      : input.outcome;
  const scenario = input.scenario ?? RunScenario.NORMAL;
  const failureStepId =
    scenario === RunScenario.FORCED_FAILURE
      ? input.fixture.steps[0]!.logicalStepId
      : null;
  const errorProbability = scenario === RunScenario.RANDOM ? '0.050000' : null;
  const batchNumber = input.batchNumber?.trim() ?? null;
  const expectedSampleCount = input.fixture.steps.reduce(
    (total, step) => total + step.sampleCount,
    0,
  );
  const recordedSampleCount = stepSeeds.reduce(
    (total, seed, index) =>
      total +
      (seed.recordedCount ??
        (seed.status === RunStepStatus.COMPLETED
          ? input.fixture.steps[index]!.sampleCount
          : 0)),
    0,
  );
  const finishedAt =
    input.status === RunStatus.RUNNING
      ? null
      : (input.finishedAt ?? input.startedAt);
  const device = input.device ?? null;
  const profileSnapshot: Prisma.InputJsonObject = {
    id: input.fixture.profile.id,
    code: input.fixture.profile.code,
    name: input.fixture.profile.name,
    description: input.fixture.profile.description,
  };

  const run = await prisma.testRun.create({
    data: {
      planId: input.fixture.planId,
      planRevisionId: input.fixture.revisionId,
      planNameSnapshot: input.fixture.planName,
      versionNumberSnapshot: input.fixture.versionNumber,
      profileSnapshot,
      deviceId: device?.id ?? null,
      deviceSnapshot:
        device === null
          ? Prisma.DbNull
          : {
              id: device.id,
              name: device.name,
              serialNumber: device.serialNumber,
              deviceProfileId: device.deviceProfileId,
            },
      batchNumber,
      batchNumberKey: batchNumber === null ? null : batchNumber.toUpperCase(),
      status: input.status,
      outcome,
      requestedById: input.requestedById,
      scenario,
      seed: 42n,
      errorProbability,
      failureStepId,
      simulatorVersion: SIMULATOR_VERSION,
      evaluationVersion: RUN_EVALUATION_VERSION,
      idempotencyKey: `analytics-seed-${randomUUID()}`,
      requestHash: randomUUID().replaceAll('-', ''),
      eventSequence: 0,
      expectedSampleCount,
      recordedSampleCount,
      startedAt: new Date(input.startedAt),
      finishedAt: finishedAt === null ? null : new Date(finishedAt),
    },
    select: { id: true },
  });

  const stepIds: string[] = [];
  for (const [index, step] of input.fixture.steps.entries()) {
    const seed = stepSeeds[index]!;
    const created = await prisma.runStep.create({
      data: {
        runId: run.id,
        logicalStepId: step.logicalStepId,
        position: step.position,
        name: step.name,
        unit: step.unit,
        minimum: step.minimum,
        maximum: step.maximum,
        sampleCount: step.sampleCount,
        intervalMs: step.intervalMs,
        status: seed.status,
        outcome: seed.outcome,
        recordedCount:
          seed.recordedCount ??
          (seed.status === RunStepStatus.COMPLETED ? step.sampleCount : 0),
        outOfToleranceCount:
          seed.outcome === RunOutcome.FAILED ? step.sampleCount : 0,
        firstFailureSampleIndex: seed.outcome === RunOutcome.FAILED ? 0 : null,
        startedAt: new Date(input.startedAt),
        finishedAt:
          seed.status === RunStepStatus.COMPLETED
            ? new Date(finishedAt ?? input.startedAt)
            : null,
      },
      select: { id: true },
    });
    stepIds.push(created.id);
  }

  return { id: run.id, startedAt: input.startedAt, stepIds };
}

export async function seedAnalyticsMeasurement(
  prisma: PrismaClient,
  input: {
    runId: string;
    runStepId: string;
    recordedAt: string;
    value?: string;
  },
): Promise<void> {
  await prisma.measurement.create({
    data: {
      runId: input.runId,
      runStepId: input.runStepId,
      sampleIndex: 0,
      value: input.value ?? '5.000000',
      isWithinTolerance: true,
      recordedAt: new Date(input.recordedAt),
      elapsedMs: 200,
    },
  });
}

export async function createAnalyticsTestApplication(): Promise<INestApplication> {
  requireIsolatedApplicationDatabase(process.env);
  const config: AppConfig = Object.freeze({ ...loadEnv(process.env) });
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .compile();

  const app = moduleFixture.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();

  return app;
}

/** Removes only runs requested by this suite's users, preserving fixtures. */
export async function deleteAnalyticsRuns(prisma: PrismaClient): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: ANALYTICS_TEST_EMAIL_PREFIX } },
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

/** Full suite cleanup, including published fixture plans and devices. */
export async function deleteAnalyticsTestData(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: ANALYTICS_TEST_EMAIL_PREFIX } },
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
    await deleteAnalyticsRuns(prisma);

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
      where: { code: { startsWith: ANALYTICS_PROFILE_CODE_PREFIX } },
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

function defaultStepSeeds(status: RunStatus): AnalyticsRunStepSeed[] {
  switch (status) {
    case RunStatus.COMPLETED:
      return [{ status: RunStepStatus.COMPLETED, outcome: RunOutcome.PASSED }];
    case RunStatus.CANCELLED:
      return [{ status: RunStepStatus.CANCELLED, outcome: null }];
    case RunStatus.INTERRUPTED:
      return [{ status: RunStepStatus.INTERRUPTED, outcome: null }];
    case RunStatus.ERROR:
      return [{ status: RunStepStatus.ERROR, outcome: null }];
    case RunStatus.RUNNING:
      return [{ status: RunStepStatus.RUNNING, outcome: null }];
  }
}
