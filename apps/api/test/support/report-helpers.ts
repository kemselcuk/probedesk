import { randomUUID } from 'node:crypto';
import {
  Prisma,
  type PrismaClient,
  type Role,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../../src/prisma/generated/client.js';
import { RUN_EVALUATION_VERSION } from '../../src/runs/run-domain.js';
import { SIMULATOR_VERSION } from '../../src/simulator/index.js';
import { createTestUser, type TestUser } from './auth-helpers.js';
import type { PublishedRunFixture } from './run-helpers.js';

export const REPORT_TEST_EMAIL_PREFIX = 'report-export-e2e-';
export const REPORT_TEST_PROFILE_CODE_PREFIX = 'report-export-e2e-profile-';

export interface ReportTestDatabaseTarget {
  hostname: string;
  port: string;
  databaseName: string;
}

export class UnsafeReportTestDatabaseError extends Error {
  override readonly name = 'UnsafeReportTestDatabaseError';

  constructor(message: string) {
    super(message);
  }
}

/**
 * Extra guard for this suite before it creates any row. The shared test setup
 * already rejects a test URL that aliases the development database, but this
 * suite additionally proves it is talking to an isolated `_test` database.
 *
 * When REPORT_TEST_DATABASE_NAME is set (the dedicated local run), the exact
 * loopback host, port and database name must match as well. CI may expose its
 * test database on a different loopback port, so that exact check is opt-in.
 * Messages never echo credentials.
 */
export function assertReportTestDatabase(
  environment: Record<string, string | undefined> = process.env,
): ReportTestDatabaseTarget {
  if (environment.NODE_ENV !== 'test') {
    throw new UnsafeReportTestDatabaseError(
      'Refusing to mutate a database because NODE_ENV is not "test".',
    );
  }

  const rawDatabaseUrl = environment.DATABASE_URL;
  if (!rawDatabaseUrl) {
    throw new UnsafeReportTestDatabaseError(
      'Refusing to mutate a database because DATABASE_URL is not set.',
    );
  }

  const databaseUrl = parseDatabaseUrl(rawDatabaseUrl, 'DATABASE_URL');

  if (environment.TEST_DATABASE_URL) {
    const testUrl = parseDatabaseUrl(
      environment.TEST_DATABASE_URL,
      'TEST_DATABASE_URL',
    );

    if (databaseIdentity(databaseUrl) !== databaseIdentity(testUrl)) {
      throw new UnsafeReportTestDatabaseError(
        'Refusing to mutate a database because DATABASE_URL and TEST_DATABASE_URL do not identify the same database.',
      );
    }
  }

  if (!isLoopbackHost(databaseUrl.hostname)) {
    throw new UnsafeReportTestDatabaseError(
      'Refusing to mutate a database because the test database must be on a loopback host.',
    );
  }

  const databaseName = readDatabaseName(databaseUrl);

  if (!/_test$/i.test(databaseName)) {
    throw new UnsafeReportTestDatabaseError(
      'Refusing to mutate a database because the test database name must end with "_test".',
    );
  }

  const expectedName = environment.REPORT_TEST_DATABASE_NAME;

  if (expectedName !== undefined) {
    if (
      databaseUrl.hostname !== '127.0.0.1' ||
      databaseUrl.port !== '5433' ||
      databaseName !== expectedName
    ) {
      throw new UnsafeReportTestDatabaseError(
        'Refusing to mutate the dedicated report database because the exact loopback host, port and database name do not match REPORT_TEST_DATABASE_NAME.',
      );
    }
  }

  return {
    hostname: databaseUrl.hostname,
    port: databaseUrl.port,
    databaseName,
  };
}

export function createReportTestUser(
  prisma: PrismaClient,
  role: Role,
): Promise<TestUser> {
  return createTestUser(prisma, {
    role,
    email: `${REPORT_TEST_EMAIL_PREFIX}${randomUUID()}@example.test`,
    password: 'Report-Export-E2E-Password-9',
  });
}

export function createReportTestProfile(prisma: PrismaClient): Promise<{
  id: string;
  code: string;
  name: string;
  description: string | null;
}> {
  return prisma.deviceProfile.create({
    data: {
      code: `${REPORT_TEST_PROFILE_CODE_PREFIX}${randomUUID()}`,
      name: 'Report Export E2E Profile',
      description: 'Fixture profile for report and export tests',
    },
    select: { id: true, code: true, name: true, description: true },
  });
}

export interface ReportDeviceSnapshotInput {
  [key: string]: Prisma.InputJsonValue;
  id: string;
  name: string;
  serialNumber: string;
  deviceProfileId: string;
}

export function createReportTestDevice(
  prisma: PrismaClient,
  input: {
    deviceProfileId: string;
    createdById: string;
    name: string;
    serialNumber: string;
  },
): Promise<ReportDeviceSnapshotInput> {
  const name = input.name.trim();
  const serialNumber = input.serialNumber.trim();

  return prisma.device
    .create({
      data: {
        deviceProfileId: input.deviceProfileId,
        createdById: input.createdById,
        name,
        serialNumber,
        serialNumberKey: serialNumber.toUpperCase(),
      },
      select: {
        id: true,
        name: true,
        serialNumber: true,
        deviceProfileId: true,
      },
    })
    .then((device) => ({ ...device }));
}

export interface ReportStoredStatistics {
  [key: string]: Prisma.InputJsonValue;
  minimum: string;
  maximum: string;
  average: string;
  sampleCount: number;
}

export interface SeedReportMeasurement {
  sampleIndex: number;
  value: string;
  isWithinTolerance: boolean;
  elapsedMs: number;
  recordedAt: Date;
}

export interface SeedReportStep {
  status: RunStepStatus;
  outcome: RunOutcome | null;
  measurements: readonly SeedReportMeasurement[];
  statistics?: ReportStoredStatistics | null;
}

export interface SeedReportRunOptions {
  fixture: PublishedRunFixture;
  requestedById: string;
  status: RunStatus;
  outcome: RunOutcome | null;
  startedAt: string;
  finishedAt: string | null;
  planNameSnapshot?: string;
  device?: ReportDeviceSnapshotInput | null;
  batchNumber?: string | null;
  scenario?: RunScenario;
  seed?: bigint;
  errorProbability?: string | null;
  failureStepId?: string | null;
  reasonCode?: string | null;
  steps: readonly SeedReportStep[];
}

/**
 * Inserts a report fixture through the same write order the executor uses:
 * the run stays RUNNING while steps and measurements are appended, then both
 * the steps and the run are terminalized. This keeps the database immutability
 * triggers and terminal-only measurement rule active during the test.
 */
export async function seedReportRun(
  prisma: PrismaClient,
  options: SeedReportRunOptions,
): Promise<{ id: string }> {
  if (options.steps.length !== options.fixture.steps.length) {
    throw new Error('Every seeded step must match one fixture step.');
  }

  const expectedSampleCount = options.fixture.steps.reduce(
    (total, step) => total + step.sampleCount,
    0,
  );
  const recordedSampleCount = options.steps.reduce(
    (total, step) => total + step.measurements.length,
    0,
  );

  if (
    options.status === RunStatus.COMPLETED &&
    recordedSampleCount !== expectedSampleCount
  ) {
    throw new Error(
      'A completed seed run must record every expected sample exactly once.',
    );
  }

  const device = options.device ?? null;
  const batchNumber = options.batchNumber ?? null;

  const run = await prisma.testRun.create({
    data: {
      planId: options.fixture.planId,
      planRevisionId: options.fixture.revisionId,
      planNameSnapshot: options.planNameSnapshot ?? options.fixture.planName,
      versionNumberSnapshot: options.fixture.versionNumber,
      profileSnapshot: options.fixture.profile,
      deviceId: device?.id ?? null,
      deviceSnapshot: device === null ? Prisma.DbNull : device,
      batchNumber,
      batchNumberKey:
        batchNumber === null ? null : batchNumber.trim().toUpperCase(),
      status: RunStatus.RUNNING,
      outcome: null,
      requestedById: options.requestedById,
      scenario: options.scenario ?? RunScenario.NORMAL,
      seed: options.seed ?? 42n,
      errorProbability: options.errorProbability ?? null,
      failureStepId: options.failureStepId ?? null,
      simulatorVersion: SIMULATOR_VERSION,
      evaluationVersion: RUN_EVALUATION_VERSION,
      idempotencyKey: `report-export-e2e-${randomUUID()}`,
      requestHash: `report-export-e2e-hash-${randomUUID()}`,
      eventSequence: 0,
      expectedSampleCount,
      recordedSampleCount: 0,
      startedAt: new Date(options.startedAt),
      finishedAt: null,
      reasonCode: null,
    },
    select: { id: true },
  });

  for (const [index, stepInput] of options.steps.entries()) {
    const fixtureStep = options.fixture.steps[index]!;
    const sampleIndexes = new Set<number>();

    for (const measurement of stepInput.measurements) {
      if (
        !Number.isInteger(measurement.sampleIndex) ||
        measurement.sampleIndex < 0 ||
        measurement.sampleIndex >= fixtureStep.sampleCount
      ) {
        throw new Error('A seeded sampleIndex is outside the fixture step.');
      }

      if (sampleIndexes.has(measurement.sampleIndex)) {
        throw new Error('A seeded step contains a duplicate sampleIndex.');
      }

      sampleIndexes.add(measurement.sampleIndex);
    }

    const createdStep = await prisma.runStep.create({
      data: {
        runId: run.id,
        logicalStepId: fixtureStep.logicalStepId,
        position: fixtureStep.position,
        name: fixtureStep.name,
        unit: fixtureStep.unit,
        minimum: fixtureStep.minimum,
        maximum: fixtureStep.maximum,
        sampleCount: fixtureStep.sampleCount,
        intervalMs: fixtureStep.intervalMs,
        status: RunStepStatus.PENDING,
        outcome: null,
        recordedCount: 0,
        outOfToleranceCount: 0,
        firstFailureSampleIndex: null,
        statistics: Prisma.DbNull,
      },
      select: { id: true },
    });

    await createMeasurementsInChunks(
      prisma,
      run.id,
      createdStep.id,
      stepInput.measurements,
    );

    const failureIndexes = stepInput.measurements
      .filter((measurement) => !measurement.isWithinTolerance)
      .map((measurement) => measurement.sampleIndex);
    const firstFailureSampleIndex =
      failureIndexes.length === 0 ? null : Math.min(...failureIndexes);

    await prisma.runStep.update({
      where: { id: createdStep.id },
      data: {
        status: stepInput.status,
        outcome: stepInput.outcome,
        recordedCount: stepInput.measurements.length,
        outOfToleranceCount: failureIndexes.length,
        firstFailureSampleIndex,
        statistics:
          stepInput.statistics === undefined || stepInput.statistics === null
            ? Prisma.DbNull
            : stepInput.statistics,
      },
    });
  }

  if (options.status !== RunStatus.RUNNING) {
    await prisma.testRun.update({
      where: { id: run.id },
      data: {
        status: options.status,
        outcome: options.outcome,
        finishedAt:
          options.finishedAt === null ? null : new Date(options.finishedAt),
        reasonCode: options.reasonCode ?? null,
        recordedSampleCount,
        eventSequence: 1,
      },
    });
  }

  return run;
}

async function createMeasurementsInChunks(
  prisma: PrismaClient,
  runId: string,
  runStepId: string,
  measurements: readonly SeedReportMeasurement[],
): Promise<void> {
  const chunkSize = 1_000;

  for (let offset = 0; offset < measurements.length; offset += chunkSize) {
    const chunk = measurements.slice(offset, offset + chunkSize);

    await prisma.measurement.createMany({
      data: chunk.map((measurement) => ({
        runId,
        runStepId,
        sampleIndex: measurement.sampleIndex,
        value: measurement.value,
        isWithinTolerance: measurement.isWithinTolerance,
        recordedAt: measurement.recordedAt,
        elapsedMs: measurement.elapsedMs,
      })),
    });
  }
}

/**
 * Removes only the rows owned by this suite's users. Plan immutability
 * triggers are disabled temporarily for fixture cleanup, as in the existing
 * run suites; application paths never use that escape hatch.
 */
export async function deleteReportTestData(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: REPORT_TEST_EMAIL_PREFIX } },
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

    await prisma.runEvent.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.measurement.deleteMany({
      where: { runId: { in: runIds } },
    });
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
      where: { code: { startsWith: REPORT_TEST_PROFILE_CODE_PREFIX } },
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

function parseDatabaseUrl(value: string, name: string): URL {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new UnsafeReportTestDatabaseError(
      `${name} is not a valid connection URL.`,
    );
  }

  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new UnsafeReportTestDatabaseError(
      `${name} must use the postgres:// or postgresql:// scheme.`,
    );
  }

  return url;
}

function databaseIdentity(url: URL): string {
  return `${url.hostname.toLowerCase()}:${url.port || '5432'}${readDatabaseName(url)}`;
}

function readDatabaseName(url: URL): string {
  return decodeURIComponent(url.pathname)
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}
