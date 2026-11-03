import { Inject, Injectable } from '@nestjs/common';
import { Prisma, RunStatus } from '../prisma/generated/client.js';
import type { TestRunGetPayload } from '../prisma/generated/models/TestRun.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  RunActiveDto,
  type RunMeasurementDto,
  type RunRequestedByDto,
  RunSnapshotDto,
  type RunSnapshotStepDto,
  type RunStepStatisticsDto,
} from './dto/run-snapshot.dto.js';

/** A single run read must never take longer than a normal API request. */
const SNAPSHOT_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10_000,
  maxWait: 5_000,
} as const;

const CANONICAL_DECIMAL = /^-?\d+\.\d{6}$/;

/**
 * Reads the immutable run snapshot. The run, its steps, every measurement and
 * the event cursor are loaded inside one REPEATABLE READ transaction, so a
 * concurrent executor commit cannot produce a half-updated response.
 *
 * No query joins back to the live plan: names, bounds and settings come only
 * from the rows copied when the run started.
 */
const SNAPSHOT_SELECT = {
  id: true,
  planId: true,
  planRevisionId: true,
  planNameSnapshot: true,
  versionNumberSnapshot: true,
  profileSnapshot: true,
  scenario: true,
  seed: true,
  errorProbability: true,
  failureStepId: true,
  simulatorVersion: true,
  evaluationVersion: true,
  status: true,
  outcome: true,
  reasonCode: true,
  expectedSampleCount: true,
  recordedSampleCount: true,
  eventSequence: true,
  startedAt: true,
  finishedAt: true,
  requestedBy: {
    select: { id: true, email: true, role: true },
  },
  steps: {
    orderBy: { position: 'asc' },
    select: {
      id: true,
      logicalStepId: true,
      position: true,
      name: true,
      unit: true,
      minimum: true,
      maximum: true,
      sampleCount: true,
      intervalMs: true,
      status: true,
      outcome: true,
      recordedCount: true,
      outOfToleranceCount: true,
      firstFailureSampleIndex: true,
      statistics: true,
      measurements: {
        orderBy: { sampleIndex: 'asc' },
        select: {
          sampleIndex: true,
          value: true,
          isWithinTolerance: true,
          recordedAt: true,
          elapsedMs: true,
        },
      },
    },
  },
} satisfies Prisma.TestRunSelect;

type SnapshotRow = TestRunGetPayload<{ select: typeof SNAPSHOT_SELECT }>;
type SnapshotStepRow = SnapshotRow['steps'][number];
type SnapshotMeasurementRow = SnapshotStepRow['measurements'][number];

const ACTIVE_SELECT = {
  id: true,
  planNameSnapshot: true,
  versionNumberSnapshot: true,
  status: true,
  expectedSampleCount: true,
  recordedSampleCount: true,
  startedAt: true,
  scenario: true,
} satisfies Prisma.TestRunSelect;

type ActiveRow = TestRunGetPayload<{ select: typeof ACTIVE_SELECT }>;

@Injectable()
export class RunSnapshotService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Returns the single RUNNING run summary, or an explicit null when idle.
   * PostgreSQL holds at most one RUNNING row through its partial unique index.
   */
  async findActive(): Promise<RunActiveDto | null> {
    const run = await this.prisma.testRun.findFirst({
      where: { status: RunStatus.RUNNING },
      orderBy: { startedAt: 'desc' },
      select: ACTIVE_SELECT,
    });

    return run ? toActiveDto(run) : null;
  }

  /** Returns null for an unknown id; the controller maps that to a safe 404. */
  async findById(runId: string): Promise<RunSnapshotDto | null> {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.testRun.findUnique({
        where: { id: runId },
        select: SNAPSHOT_SELECT,
      });

      return run ? toSnapshotDto(run) : null;
    }, SNAPSHOT_TRANSACTION_OPTIONS);
  }
}

function toActiveDto(run: ActiveRow): RunActiveDto {
  return {
    runId: run.id,
    planName: run.planNameSnapshot,
    versionNumber: run.versionNumberSnapshot,
    status: run.status,
    expectedSampleCount: run.expectedSampleCount,
    recordedSampleCount: run.recordedSampleCount,
    startedAt: run.startedAt.toISOString(),
    scenario: run.scenario,
  };
}

function toSnapshotDto(run: SnapshotRow): RunSnapshotDto {
  return {
    id: run.id,
    planId: run.planId,
    planVersionId: run.planRevisionId,
    planName: run.planNameSnapshot,
    versionNumber: run.versionNumberSnapshot,
    profile: readProfileSnapshot(run.profileSnapshot),
    scenario: run.scenario,
    seed: readSeed(run.seed),
    errorProbability: run.errorProbability?.toFixed(6) ?? null,
    failureStepId: run.failureStepId,
    simulatorVersion: run.simulatorVersion,
    evaluationVersion: run.evaluationVersion,
    status: run.status,
    outcome: run.outcome,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    requestedBy: toRequestedBy(run.requestedBy),
    reasonCode: run.reasonCode,
    expectedSampleCount: run.expectedSampleCount,
    recordedSampleCount: run.recordedSampleCount,
    lastEventSequence: run.eventSequence,
    steps: run.steps.map(toStepDto),
  };
}

function toStepDto(step: SnapshotStepRow): RunSnapshotStepDto {
  return {
    runStepId: step.id,
    logicalStepId: step.logicalStepId,
    position: step.position,
    name: step.name,
    unit: step.unit,
    minimum: step.minimum.toFixed(6),
    maximum: step.maximum.toFixed(6),
    sampleCount: step.sampleCount,
    intervalMs: step.intervalMs,
    status: step.status,
    outcome: step.outcome,
    recordedCount: step.recordedCount,
    outOfToleranceCount: step.outOfToleranceCount,
    firstFailureSampleIndex: step.firstFailureSampleIndex,
    hasOutOfTolerance: step.outOfToleranceCount > 0,
    statistics: readStatistics(step.statistics),
    measurements: step.measurements.map(toMeasurementDto),
  };
}

function toMeasurementDto(
  measurement: SnapshotMeasurementRow,
): RunMeasurementDto {
  return {
    sampleIndex: measurement.sampleIndex,
    value: measurement.value.toFixed(6),
    isWithinTolerance: measurement.isWithinTolerance,
    recordedAt: measurement.recordedAt.toISOString(),
    elapsedMs: measurement.elapsedMs,
  };
}

function toRequestedBy(user: {
  id: string;
  email: string;
  role: RunRequestedByDto['role'];
}): RunRequestedByDto {
  return { id: user.id, email: user.email, role: user.role };
}

function readSeed(seed: bigint): number {
  const value = Number(seed);

  // The database constrains the seed to uint32; fail closed if a corrupt row
  // could not be represented exactly in JSON.
  if (!Number.isSafeInteger(value)) {
    throw new Error('The stored run seed is outside the JSON integer range.');
  }

  return value;
}

function readProfileSnapshot(value: Prisma.JsonValue): {
  id: string;
  code: string;
  name: string;
  description: string | null;
} {
  if (!isJsonObject(value)) {
    throw new Error('The stored run profile is not a JSON object.');
  }

  const { id, code, name, description } = value;

  if (
    typeof id !== 'string' ||
    typeof code !== 'string' ||
    typeof name !== 'string' ||
    (description !== undefined &&
      description !== null &&
      typeof description !== 'string')
  ) {
    throw new Error('The stored run profile is incomplete.');
  }

  return {
    id,
    code,
    name,
    description: typeof description === 'string' ? description : null,
  };
}

/**
 * Reads the summary written by the executor. A partial step has no stored
 * summary; each numeric member is then null. Values are validated as canonical
 * six-place decimals so a corrupt JSON blob cannot leak an invalid number.
 */
function readStatistics(value: Prisma.JsonValue | null): RunStepStatisticsDto {
  if (!isJsonObject(value)) {
    return {
      minimum: null,
      maximum: null,
      average: null,
      sampleCount: null,
    };
  }

  return {
    minimum: readCanonicalDecimal(value.minimum),
    maximum: readCanonicalDecimal(value.maximum),
    average: readCanonicalDecimal(value.average),
    sampleCount:
      typeof value.sampleCount === 'number' &&
      Number.isInteger(value.sampleCount) &&
      value.sampleCount >= 0
        ? value.sampleCount
        : null,
  };
}

function readCanonicalDecimal(
  value: Prisma.JsonValue | undefined,
): string | null {
  return typeof value === 'string' && CANONICAL_DECIMAL.test(value)
    ? value
    : null;
}

function isJsonObject(value: Prisma.JsonValue): value is Prisma.JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
