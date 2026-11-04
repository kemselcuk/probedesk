import { randomUUID } from 'node:crypto';
import {
  PlanRevisionState,
  type PrismaClient,
  type Role,
} from '../../src/prisma/generated/client.js';
import { createTestUser, type TestUser } from './auth-helpers.js';

export const RUN_TEST_EMAIL_PREFIX = 'runs-api-e2e-';
export const RUN_TEST_PROFILE_CODE_PREFIX = 'runs-api-e2e-profile-';

export interface RunFixtureStep {
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

export interface PublishedRunFixture {
  planId: string;
  revisionId: string;
  planName: string;
  versionNumber: number;
  profile: {
    id: string;
    code: string;
    name: string;
    description: string | null;
  };
  steps: RunFixtureStep[];
}

export interface RunFixtureStepTemplate {
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

const DEFAULT_STEP_TEMPLATES: readonly RunFixtureStepTemplate[] = [
  {
    name: 'Output Voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 2,
    intervalMs: 200,
  },
  {
    name: 'Current Draw',
    unit: 'A',
    minimum: '0.450000',
    maximum: '0.550000',
    sampleCount: 3,
    intervalMs: 250,
  },
  {
    name: 'Case Temperature',
    unit: '°C',
    minimum: '20.000000',
    maximum: '60.000000',
    sampleCount: 1,
    intervalMs: 500,
  },
];

export async function createRunTestUser(
  prisma: PrismaClient,
  role: Role,
): Promise<TestUser> {
  return createTestUser(prisma, {
    role,
    email: `${RUN_TEST_EMAIL_PREFIX}${randomUUID()}@example.test`,
    password: 'Run-Start-E2E-Password-9',
  });
}

export async function createRunTestProfile(
  prisma: PrismaClient,
): Promise<PublishedRunFixture['profile']> {
  return prisma.deviceProfile.create({
    data: {
      code: `${RUN_TEST_PROFILE_CODE_PREFIX}${randomUUID()}`,
      name: 'Run Start E2E Device',
      description: 'Fixture profile for run start tests',
    },
    select: { id: true, code: true, name: true, description: true },
  });
}

/**
 * Creates one published revision directly through the allowed draft ->
 * published transition. Published content cannot be inserted as PUBLISHED.
 */
export async function createPublishedRunFixture(
  prisma: PrismaClient,
  plannerId: string,
  profile: PublishedRunFixture['profile'],
  options: {
    planName?: string;
    versionNumber?: number;
    steps?: readonly RunFixtureStepTemplate[];
  } = {},
): Promise<PublishedRunFixture> {
  const planName = options.planName ?? 'Run start fixture';
  const versionNumber = options.versionNumber ?? 1;
  const stepTemplates = options.steps ?? DEFAULT_STEP_TEMPLATES;
  const plan = await prisma.testPlan.create({
    data: { createdById: plannerId, deviceProfileId: profile.id },
  });

  const identities = await Promise.all(
    stepTemplates.map(() =>
      prisma.stepIdentity.create({ data: { planId: plan.id } }),
    ),
  );

  const draft = await prisma.planRevision.create({
    data: {
      planId: plan.id,
      state: PlanRevisionState.DRAFT,
      name: planName,
      editRevision: 1,
    },
  });

  await prisma.planStep.createMany({
    data: stepTemplates.map((step, index) => ({
      planId: plan.id,
      revisionId: draft.id,
      logicalStepId: identities[index]!.id,
      position: index + 1,
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
      versionNumber,
      publishedById: plannerId,
      publishedAt: new Date('2026-11-03T12:00:00.000Z'),
    },
  });

  const steps = await prisma.planStep.findMany({
    where: { revisionId: published.id },
    orderBy: { position: 'asc' },
  });

  return {
    planId: plan.id,
    revisionId: published.id,
    planName: published.name,
    versionNumber,
    profile,
    steps: steps.map((step) => ({
      logicalStepId: step.logicalStepId,
      position: step.position,
      name: step.name,
      unit: step.unit,
      minimum: step.minimum.toFixed(6),
      maximum: step.maximum.toFixed(6),
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
    })),
  };
}

/** A plan with content that has never been published. */
export async function createDraftOnlyRunFixture(
  prisma: PrismaClient,
  plannerId: string,
  profileId: string,
  planName = 'Run start draft only',
): Promise<{ planId: string; revisionId: string }> {
  const plan = await prisma.testPlan.create({
    data: { createdById: plannerId, deviceProfileId: profileId },
  });
  const revision = await prisma.planRevision.create({
    data: {
      planId: plan.id,
      state: PlanRevisionState.DRAFT,
      name: planName,
      editRevision: 1,
    },
  });

  return { planId: plan.id, revisionId: revision.id };
}

/** Deletes only runs requested by this suite's users. */
export async function deleteRunTestRuns(prisma: PrismaClient): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: RUN_TEST_EMAIL_PREFIX } },
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

/**
 * Full suite cleanup. Deleting published plan content requires temporarily
 * disabling the immutability triggers as the schema owner; application
 * connections never have that escape hatch.
 */
export async function deleteRunTestData(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_steps" DISABLE TRIGGER USER',
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "plan_revisions" DISABLE TRIGGER USER',
  );

  try {
    await deleteRunTestRuns(prisma);

    const users = await prisma.user.findMany({
      where: { email: { startsWith: RUN_TEST_EMAIL_PREFIX } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
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
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.deviceProfile.deleteMany({
      where: { code: { startsWith: RUN_TEST_PROFILE_CODE_PREFIX } },
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
