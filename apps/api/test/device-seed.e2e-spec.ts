import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/prisma/generated/client.js';
import { deleteDemoSeedFixture } from '../prisma/seed-demo-cleanup.js';
import { runDemoSeed } from '../prisma/seed-demo.js';
import { DemoSeedConflictError } from '../prisma/seed-demo-plan.js';
import {
  DEMO_DEVICES,
  DEMO_DEVICE_PROFILES,
  DEMO_PLAN_NAME,
  DEMO_PLANNER_EMAIL,
  DEMO_RUNS,
} from '../prisma/seed-data.js';

interface DemoDigest {
  plans: string;
  revisions: string;
  planSteps: string;
  stepIdentities: string;
  runs: string;
  runSteps: string;
  measurements: string;
  events: string;
}

describe('demo device seed (e2e)', () => {
  const testDatabaseUrl = process.env.TEST_DATABASE_URL;
  let prisma: PrismaClient;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error(
        'TEST_DATABASE_URL must be set for the demo device seed integration test.',
      );
    }

    prisma = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: testDatabaseUrl,
        application_name: 'probedesk-demo-device-seed-e2e',
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

  it('adds two fixed devices without backfilling the four existing runs', async () => {
    const summary = await runDemoSeed(prisma);

    expect(summary.users).toEqual({ created: 3, existing: 0, total: 3 });
    expect(summary.profiles).toEqual({ created: 1, existing: 0, total: 1 });
    expect(summary.devices).toEqual({ created: 2, existing: 0, total: 2 });
    expect(summary.plan).toMatchObject({
      createdPlan: true,
      name: DEMO_PLAN_NAME,
      createdRuns: 4,
      existingRuns: 0,
    });

    const devices = await prisma.device.findMany({
      where: { id: { in: DEMO_DEVICES.map((device) => device.id) } },
      include: {
        deviceProfile: { select: { code: true } },
        createdBy: { select: { email: true } },
      },
      orderBy: { id: 'asc' },
    });
    expect(devices).toHaveLength(2);

    for (const fixture of DEMO_DEVICES) {
      const device = devices.find((candidate) => candidate.id === fixture.id);
      expect(device).toBeDefined();
      expect(device).toMatchObject({
        id: fixture.id,
        name: fixture.name,
        serialNumber: fixture.serialNumber,
        serialNumberKey: fixture.serialNumber.toUpperCase(),
        description: fixture.description,
        archivedAt: null,
        editRevision: 1,
        deviceProfile: { code: DEMO_DEVICE_PROFILES[0]!.code },
        createdBy: { email: DEMO_PLANNER_EMAIL },
      });
    }

    const runs = await prisma.testRun.findMany({
      where: {
        idempotencyKey: { in: DEMO_RUNS.map((run) => run.idempotencyKey) },
      },
      select: {
        idempotencyKey: true,
        deviceId: true,
        deviceSnapshot: true,
        batchNumber: true,
        batchNumberKey: true,
      },
    });
    expect(runs).toHaveLength(4);
    for (const run of runs) {
      expect(run).toMatchObject({
        deviceId: null,
        deviceSnapshot: null,
        batchNumber: null,
        batchNumberKey: null,
      });
    }
    expect(
      await prisma.testRun.count({ where: { deviceId: { not: null } } }),
    ).toBe(0);
  });

  it('is idempotent, preserves user edits and leaves demo plans and runs unchanged', async () => {
    const before = await captureDigest(prisma);
    const [firstFixture, secondFixture] = DEMO_DEVICES;

    const editedAt = new Date('2026-11-06T12:00:00.000Z');
    await prisma.device.update({
      where: { id: firstFixture!.id },
      data: {
        name: 'Operator renamed unit',
        serialNumber: 'EDITED-0001',
        serialNumberKey: 'EDITED-0001',
        description: null,
        archivedAt: editedAt,
        editRevision: 5,
      },
    });

    const second = await runDemoSeed(prisma);
    expect(second.devices).toEqual({ created: 0, existing: 2, total: 2 });
    expect(second.plan.createdPlan).toBe(false);
    expect(second.plan.createdRuns).toBe(0);
    expect(second.plan.existingRuns).toBe(4);
    expect(second.plan.runs.every((run) => run.created === false)).toBe(true);

    const edited = await prisma.device.findUniqueOrThrow({
      where: { id: firstFixture!.id },
    });
    expect(edited).toMatchObject({
      name: 'Operator renamed unit',
      serialNumber: 'EDITED-0001',
      serialNumberKey: 'EDITED-0001',
      description: null,
      archivedAt: editedAt,
      editRevision: 5,
    });

    const untouched = await prisma.device.findUniqueOrThrow({
      where: { id: secondFixture!.id },
    });
    expect(untouched).toMatchObject({
      name: secondFixture!.name,
      serialNumber: secondFixture!.serialNumber,
      editRevision: 1,
    });

    expect(await captureDigest(prisma)).toEqual(before);
  });

  it('fails safely when a demo serial belongs to another device id', async () => {
    const before = await captureDigest(prisma);
    const planner = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_PLANNER_EMAIL },
    });
    const profile = await prisma.deviceProfile.findUniqueOrThrow({
      where: { code: DEMO_DEVICE_PROFILES[0]!.code },
    });

    await prisma.device.deleteMany({
      where: { id: { in: DEMO_DEVICES.map((device) => device.id) } },
    });

    const conflicting = await prisma.device.create({
      data: {
        deviceProfileId: profile.id,
        createdById: planner.id,
        name: 'Conflicting owner',
        serialNumber: DEMO_DEVICES[0]!.serialNumber,
        serialNumberKey: DEMO_DEVICES[0]!.serialNumber.toUpperCase(),
        description: 'Owned by a different id',
      },
    });

    await expect(runDemoSeed(prisma)).rejects.toBeInstanceOf(
      DemoSeedConflictError,
    );

    expect(
      await prisma.device.count({
        where: { id: { in: DEMO_DEVICES.map((device) => device.id) } },
      }),
    ).toBe(0);

    const owner = await prisma.device.findUniqueOrThrow({
      where: { id: conflicting.id },
    });
    expect(owner).toMatchObject({
      name: 'Conflicting owner',
      serialNumber: DEMO_DEVICES[0]!.serialNumber,
      serialNumberKey: DEMO_DEVICES[0]!.serialNumber.toUpperCase(),
    });
    expect(await captureDigest(prisma)).toEqual(before);
  });

  it('cleans copy provenance before resetting demo plan and account records', async () => {
    const planner = await prisma.user.findUniqueOrThrow({
      where: { email: DEMO_PLANNER_EMAIL },
    });
    const source = await prisma.planRevision.findFirstOrThrow({
      where: { state: 'PUBLISHED', plan: { createdById: planner.id } },
      include: { plan: true },
    });
    const target = await prisma.testPlan.create({
      data: {
        createdById: planner.id,
        deviceProfileId: source.plan.deviceProfileId,
        revisions: { create: { state: 'DRAFT', name: 'Cleanup copy' } },
      },
    });
    await prisma.planCopyRequest.create({
      data: {
        requestedById: planner.id,
        idempotencyKey: 'device-seed-reset-copy',
        requestHash: 'device-seed-reset-copy-hash',
        sourceVersionId: source.id,
        targetPlanId: target.id,
      },
    });

    const cleaned = await deleteDemoSeedFixture(prisma);
    expect(cleaned.plans).toBe(2);
    expect(await prisma.planCopyRequest.count()).toBe(0);
    expect(
      await prisma.testPlan.findUnique({ where: { id: target.id } }),
    ).toBeNull();
    expect(
      await prisma.user.findUnique({ where: { id: planner.id } }),
    ).toBeNull();
  });

  async function captureDigest(client: PrismaClient): Promise<DemoDigest> {
    const planner = await client.user.findUniqueOrThrow({
      where: { email: DEMO_PLANNER_EMAIL },
      select: { id: true },
    });
    const plans = await client.testPlan.findMany({
      where: {
        createdById: planner.id,
        revisions: { some: { name: DEMO_PLAN_NAME } },
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
        idempotencyKey: { in: DEMO_RUNS.map((run) => run.idempotencyKey) },
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
