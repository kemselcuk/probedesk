import { createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PlanRevisionState,
  PrismaClient,
  RunEventType,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import { parseMeasurementDecimal } from '../src/runs/measurement-evaluation.js';
import { RUN_CANCELLED_REASON_CODE } from '../src/runs/run-domain.js';
import { deleteDemoSeedFixture } from '../prisma/seed-demo-cleanup.js';
import { runDemoSeed } from '../prisma/seed-demo.js';
import {
  DEMO_DEVICE_PROFILES,
  DEMO_PLAN_NAME,
  DEMO_PLAN_VERSIONS,
  DEMO_PLANNER_EMAIL,
  DEMO_RUNS,
  DEMO_USERS,
  DEMO_USER_EMAILS,
} from '../prisma/seed-data.js';

describe('demo data seed (e2e)', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be set for the demo data seed integration test.',
      );
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        application_name: 'probedesk-demo-data-seed-e2e',
        connectionTimeoutMillis: 2000,
      }),
    });

    await deleteDemoSeedFixture(prisma);
  });

  afterAll(async () => {
    if (!prisma) {
      return;
    }

    await deleteDemoSeedFixture(prisma);
    await prisma.$disconnect();
  });

  it('seeds three accounts, two published versions and inspectable run history', async () => {
    const summary = await runDemoSeed(prisma);

    expect(summary.users).toEqual({ created: 3, existing: 0, total: 3 });
    expect(summary.profiles).toEqual({ created: 1, existing: 0, total: 1 });
    expect(summary.plan).toMatchObject({
      createdPlan: true,
      name: DEMO_PLAN_NAME,
      createdRuns: 4,
      existingRuns: 0,
    });
    expect(
      summary.plan.versions.map((version) => version.versionNumber),
    ).toEqual([1, 2]);

    const users = await prisma.user.findMany({
      where: { email: { in: [...DEMO_USER_EMAILS] } },
      orderBy: { email: 'asc' },
    });
    expect(users).toHaveLength(3);

    for (const expectedUser of DEMO_USERS) {
      const user = users.find(
        (candidate) => candidate.email === expectedUser.email,
      );
      expect(user).toBeDefined();
      expect(user?.role).toBe(expectedUser.role);
      expect(user?.passwordHash).not.toContain(expectedUser.password);
      expect(
        await argon2.verify(user!.passwordHash, expectedUser.password),
      ).toBe(true);
    }

    const profile = await prisma.deviceProfile.findUniqueOrThrow({
      where: { code: DEMO_DEVICE_PROFILES[0]!.code },
    });
    expect(profile.name).toBe('DC Power Module');

    const plan = await prisma.testPlan.findFirst({
      where: {
        createdBy: { email: DEMO_PLANNER_EMAIL },
        revisions: { some: { name: DEMO_PLAN_NAME } },
      },
      include: {
        deviceProfile: true,
        revisions: {
          include: { steps: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (!plan) {
      throw new Error('The demo plan was not seeded.');
    }
    expect(plan.deviceProfile.code).toBe('DC_POWER_MODULE');

    const published = plan.revisions
      .filter((revision) => revision.state === PlanRevisionState.PUBLISHED)
      .sort(
        (left, right) => (left.versionNumber ?? 0) - (right.versionNumber ?? 0),
      );
    expect(published.map((revision) => revision.versionNumber)).toEqual([1, 2]);

    const [v1, v2] = published;
    if (!v1 || !v2) {
      throw new Error('Both published demo versions are required.');
    }

    expect(v1.steps.map(toPlanStepShape)).toEqual(
      DEMO_PLAN_VERSIONS[0]!.steps.map(toExpectedPlanStepShape),
    );
    expect(v2.steps.map(toPlanStepShape)).toEqual(
      DEMO_PLAN_VERSIONS[1]!.steps.map(toExpectedPlanStepShape),
    );
    expect(v1.steps.map((step) => step.logicalStepId)).toEqual(
      v2.steps.map((step) => step.logicalStepId),
    );

    const v1CurrentDraw = v1.steps.find(
      (step) => step.name === 'Current Draw',
    )!;
    const v2CurrentDraw = v2.steps.find(
      (step) => step.name === 'Current Draw',
    )!;
    expect(v1CurrentDraw.maximum.toFixed(6)).toBe('0.550000');
    expect(v2CurrentDraw.maximum.toFixed(6)).toBe('0.650000');
    expect(v1CurrentDraw.minimum.toFixed(6)).toBe('0.450000');
    expect(v2CurrentDraw.minimum.toFixed(6)).toBe('0.450000');

    const runs = await prisma.testRun.findMany({
      where: {
        idempotencyKey: {
          in: DEMO_RUNS.map((run) => run.idempotencyKey),
        },
      },
      include: {
        steps: {
          orderBy: { position: 'asc' },
          include: {
            measurements: { orderBy: { sampleIndex: 'asc' } },
          },
        },
      },
    });
    expect(runs).toHaveLength(4);

    const forced = requireRun(
      runs,
      DEMO_RUNS.find((run) => run.idempotencyKey.includes('forced-failure'))!
        .idempotencyKey,
    );
    expect(forced.status).toBe(RunStatus.COMPLETED);
    expect(forced.outcome).toBe(RunOutcome.FAILED);
    expect(forced.versionNumberSnapshot).toBe(1);
    expect(forced.scenario).toBe(RunScenario.FORCED_FAILURE);
    expect(forced.seed).toBe(42n);
    expect(forced.expectedSampleCount).toBe(90);
    expect(forced.recordedSampleCount).toBe(90);
    expect(forced.eventSequence).toBe(98);
    expect(forced.failureStepId).toBe(v1CurrentDraw.logicalStepId);

    const forcedCurrentDraw = forced.steps[1]!;
    expect(forcedCurrentDraw.name).toBe('Current Draw');
    expect(forcedCurrentDraw.maximum.toFixed(6)).toBe('0.550000');
    expect(forcedCurrentDraw.outcome).toBe(RunOutcome.FAILED);
    expect(forcedCurrentDraw.outOfToleranceCount).toBe(1);
    expect(forcedCurrentDraw.firstFailureSampleIndex).toBe(14);

    const failingSample = forcedCurrentDraw.measurements.find(
      (measurement) => measurement.sampleIndex === 14,
    );
    expect(failingSample?.value.toFixed(6)).toBe('0.600000');
    expect(failingSample?.isWithinTolerance).toBe(false);

    const normalV1 = requireRun(
      runs,
      DEMO_RUNS.find((run) => run.idempotencyKey.endsWith('v1:normal'))!
        .idempotencyKey,
    );
    expect(normalV1.status).toBe(RunStatus.COMPLETED);
    expect(normalV1.outcome).toBe(RunOutcome.PASSED);
    expect(normalV1.versionNumberSnapshot).toBe(1);

    const normalV2 = requireRun(
      runs,
      DEMO_RUNS.find((run) => run.idempotencyKey.endsWith('v2:normal'))!
        .idempotencyKey,
    );
    expect(normalV2.status).toBe(RunStatus.COMPLETED);
    expect(normalV2.outcome).toBe(RunOutcome.PASSED);
    expect(normalV2.versionNumberSnapshot).toBe(2);

    const v2CurrentDrawRun = normalV2.steps[1]!;
    expect(v2CurrentDrawRun.maximum.toFixed(6)).toBe('0.650000');
    expect(
      v2CurrentDrawRun.measurements.every(
        (measurement) => measurement.isWithinTolerance,
      ),
    ).toBe(true);

    const v1Max = parseMeasurementDecimal(v1CurrentDraw.maximum.toFixed(6))!;
    const v2Max = parseMeasurementDecimal(v2CurrentDraw.maximum.toFixed(6))!;
    const failingValue = parseMeasurementDecimal('0.600000')!;
    expect(v1Max < failingValue).toBe(true);
    expect(failingValue <= v2Max).toBe(true);
    expect(
      v2CurrentDrawRun.measurements.some(
        (measurement) =>
          parseMeasurementDecimal(measurement.value.toFixed(6))! > v1Max,
      ),
    ).toBe(true);

    const partial = requireRun(
      runs,
      DEMO_RUNS.find((run) => run.idempotencyKey.endsWith('v1:cancelled'))!
        .idempotencyKey,
    );
    expect(partial.status).toBe(RunStatus.CANCELLED);
    expect(partial.outcome).toBeNull();
    expect(partial.expectedSampleCount).toBe(90);
    expect(partial.recordedSampleCount).toBe(45);
    expect(partial.eventSequence).toBe(50);
    expect(partial.reasonCode).toBe(RUN_CANCELLED_REASON_CODE);
    expect(partial.cancelledById).not.toBeNull();
    expect(partial.steps.map((step) => step.status)).toEqual([
      RunStepStatus.COMPLETED,
      RunStepStatus.CANCELLED,
      RunStepStatus.NOT_RUN,
    ]);
    expect(partial.steps.map((step) => step.recordedCount)).toEqual([
      30, 15, 0,
    ]);
    expect(partial.steps[0]?.statistics).not.toBeNull();
    expect(partial.steps[1]?.statistics).toBeNull();
    expect(partial.steps[1]?.outcome).toBeNull();
    expect(partial.steps[1]?.firstFailureSampleIndex).toBeNull();
    expect(partial.steps[2]?.startedAt).toBeNull();

    for (const run of runs) {
      const events = await prisma.runEvent.findMany({
        where: { runId: run.id },
        orderBy: { sequence: 'asc' },
        select: { sequence: true, type: true },
      });
      expect(events).toHaveLength(run.eventSequence);
      expect(events.map((event) => event.sequence)).toEqual(
        Array.from({ length: run.eventSequence }, (_, index) => index + 1),
      );
      expect(events[0]?.type).toBe(RunEventType.RUN_STARTED);
      expect(events.at(-1)?.type).toBe(
        run.status === RunStatus.COMPLETED
          ? RunEventType.RUN_COMPLETED
          : RunEventType.RUN_CANCELLED,
      );

      const measurementCount = run.steps.reduce(
        (total, step) => total + step.measurements.length,
        0,
      );
      const recordedCount = run.steps.reduce(
        (total, step) => total + step.recordedCount,
        0,
      );
      const expectedCount = run.steps.reduce(
        (total, step) => total + step.sampleCount,
        0,
      );
      expect(measurementCount).toBe(run.recordedSampleCount);
      expect(recordedCount).toBe(run.recordedSampleCount);
      expect(expectedCount).toBe(run.expectedSampleCount);
    }
  });

  it('is idempotent and leaves every seeded row and outcome unchanged', async () => {
    const before = await captureDemoDigest(prisma);
    expect(before.counts).toEqual({
      users: 3,
      profiles: 1,
      plans: 1,
      revisions: 2,
      planSteps: 6,
      stepIdentities: 3,
      runs: 4,
      runSteps: 12,
      measurements: 315,
      events: 344,
    });

    const second = await runDemoSeed(prisma);
    expect(second.users).toEqual({ created: 0, existing: 3, total: 3 });
    expect(second.profiles).toEqual({ created: 0, existing: 1, total: 1 });
    expect(second.plan.createdPlan).toBe(false);
    expect(second.plan.createdRuns).toBe(0);
    expect(second.plan.existingRuns).toBe(4);
    expect(second.plan.runs.every((run) => run.created === false)).toBe(true);

    const after = await captureDemoDigest(prisma);
    expect(after).toEqual(before);
  });

  function requireRun<T extends { idempotencyKey: string }>(
    runs: readonly T[],
    idempotencyKey: string,
  ): T {
    const run = runs.find(
      (candidate) => candidate.idempotencyKey === idempotencyKey,
    );
    if (!run) {
      throw new Error(`The demo run ${idempotencyKey} was not seeded.`);
    }

    return run;
  }

  async function captureDemoDigest(client: PrismaClient): Promise<{
    counts: Record<string, number>;
    users: string;
    profiles: string;
    plans: string;
    revisions: string;
    planSteps: string;
    stepIdentities: string;
    runs: string;
    runSteps: string;
    measurements: string;
    events: string;
  }> {
    const users = await client.user.findMany({
      where: { email: { in: [...DEMO_USER_EMAILS] } },
      orderBy: { id: 'asc' },
    });
    const userIds = users.map((user) => user.id);
    const profiles = await client.deviceProfile.findMany({
      where: {
        code: { in: DEMO_DEVICE_PROFILES.map((profile) => profile.code) },
      },
      orderBy: { id: 'asc' },
    });
    const plans = await client.testPlan.findMany({
      where: {
        OR: [
          { createdById: { in: userIds } },
          { revisions: { some: { name: DEMO_PLAN_NAME } } },
        ],
      },
      orderBy: { id: 'asc' },
    });
    const planIds = plans.map((plan) => plan.id);
    const revisions = await client.planRevision.findMany({
      where: { planId: { in: planIds } },
      orderBy: { id: 'asc' },
    });
    const planSteps = await client.planStep.findMany({
      where: { planId: { in: planIds } },
      orderBy: { id: 'asc' },
    });
    const stepIdentities = await client.stepIdentity.findMany({
      where: { planId: { in: planIds } },
      orderBy: { id: 'asc' },
    });
    const runs = await client.testRun.findMany({
      where: {
        OR: [{ planId: { in: planIds } }, { requestedById: { in: userIds } }],
      },
      orderBy: { id: 'asc' },
    });
    const runIds = runs.map((run) => run.id);
    const runSteps = await client.runStep.findMany({
      where: { runId: { in: runIds } },
      orderBy: { id: 'asc' },
    });
    const measurements = await client.measurement.findMany({
      where: { runId: { in: runIds } },
      orderBy: { id: 'asc' },
    });
    const events = await client.runEvent.findMany({
      where: { runId: { in: runIds } },
      orderBy: { id: 'asc' },
    });

    return {
      counts: {
        users: users.length,
        profiles: profiles.length,
        plans: plans.length,
        revisions: revisions.length,
        planSteps: planSteps.length,
        stepIdentities: stepIdentities.length,
        runs: runs.length,
        runSteps: runSteps.length,
        measurements: measurements.length,
        events: events.length,
      },
      users: hashRows(users),
      profiles: hashRows(profiles),
      plans: hashRows(plans),
      revisions: hashRows(revisions),
      planSteps: hashRows(planSteps),
      stepIdentities: hashRows(stepIdentities),
      runs: hashRows(runs),
      runSteps: hashRows(runSteps),
      measurements: hashRows(measurements),
      events: hashRows(events),
    };
  }
});

function toPlanStepShape(step: {
  name: string;
  unit: string;
  minimum: { toFixed(digits: number): string };
  maximum: { toFixed(digits: number): string };
  sampleCount: number;
  intervalMs: number;
}): Record<string, string | number> {
  return {
    name: step.name,
    unit: step.unit,
    minimum: step.minimum.toFixed(6),
    maximum: step.maximum.toFixed(6),
    sampleCount: step.sampleCount,
    intervalMs: step.intervalMs,
  };
}

function toExpectedPlanStepShape(step: {
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}): Record<string, string | number> {
  return {
    name: step.name,
    unit: step.unit,
    minimum: step.minimum,
    maximum: step.maximum,
    sampleCount: step.sampleCount,
    intervalMs: step.intervalMs,
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
