import type { Prisma } from '../prisma/generated/client.js';
import type { TestRunGetPayload } from '../prisma/generated/models/TestRun.js';
import {
  type RunDeviceSnapshotDto,
  type RunMeasurementDto,
  type RunRequestedByDto,
  RunSnapshotDto,
  type RunSnapshotStepDto,
  type RunStepStatisticsDto,
} from './dto/run-snapshot.dto.js';

/**
 * The immutable run read shape shared by the run snapshot and comparison
 * endpoints. Only copied run/step fields are selected; no query joins back to
 * the live plan or live device.
 */
export const RUN_SNAPSHOT_SELECT = {
  id: true,
  planId: true,
  planRevisionId: true,
  planNameSnapshot: true,
  versionNumberSnapshot: true,
  profileSnapshot: true,
  deviceId: true,
  deviceSnapshot: true,
  batchNumber: true,
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

export type RunSnapshotRow = TestRunGetPayload<{
  select: typeof RUN_SNAPSHOT_SELECT;
}>;

export type RunSnapshotStepRow = RunSnapshotRow['steps'][number];
export type RunSnapshotMeasurementRow =
  RunSnapshotStepRow['measurements'][number];

const CANONICAL_DECIMAL = /^-?\d+\.\d{6}$/;

export function toRunSnapshotDto(run: RunSnapshotRow): RunSnapshotDto {
  return {
    id: run.id,
    planId: run.planId,
    planVersionId: run.planRevisionId,
    planName: run.planNameSnapshot,
    versionNumber: run.versionNumberSnapshot,
    profile: readProfileSnapshot(run.profileSnapshot),
    deviceId: run.deviceId,
    deviceSnapshot: readDeviceSnapshot(run.deviceSnapshot),
    batchNumber: run.batchNumber,
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
    steps: run.steps.map(toRunStepDto),
  };
}

export function toRunStepDto(step: RunSnapshotStepRow): RunSnapshotStepDto {
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
    statistics: readStoredStatistics(step.statistics),
    measurements: step.measurements.map(toMeasurementDto),
  };
}

export function toMeasurementDto(
  measurement: RunSnapshotMeasurementRow,
): RunMeasurementDto {
  return {
    sampleIndex: measurement.sampleIndex,
    value: measurement.value.toFixed(6),
    isWithinTolerance: measurement.isWithinTolerance,
    recordedAt: measurement.recordedAt.toISOString(),
    elapsedMs: measurement.elapsedMs,
  };
}

export function toRequestedBy(user: {
  id: string;
  email: string;
  role: RunRequestedByDto['role'];
}): RunRequestedByDto {
  return { id: user.id, email: user.email, role: user.role };
}

export function readSeed(seed: bigint): number {
  const value = Number(seed);

  // The database constrains the seed to uint32; fail closed if a corrupt row
  // could not be represented exactly in JSON.
  if (!Number.isSafeInteger(value)) {
    throw new Error('The stored run seed is outside the JSON integer range.');
  }

  return value;
}

export function readProfileSnapshot(value: Prisma.JsonValue): {
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
 * Reads the device values copied at start. A SQL NULL (legacy or device-less
 * run) is an explicit null; a corrupt JSON object fails closed.
 */
export function readDeviceSnapshot(
  value: Prisma.JsonValue | null,
): RunDeviceSnapshotDto | null {
  if (value === null) {
    return null;
  }

  if (!isJsonObject(value)) {
    throw new Error('The stored run device snapshot is not a JSON object.');
  }

  const { id, name, serialNumber, deviceProfileId } = value;

  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof serialNumber !== 'string' ||
    typeof deviceProfileId !== 'string'
  ) {
    throw new Error('The stored run device snapshot is incomplete.');
  }

  return { id, name, serialNumber, deviceProfileId };
}

/**
 * Reads the summary written by the executor. A partial step has no stored
 * summary; each numeric member is then null. Values are validated as canonical
 * six-place decimals so a corrupt JSON blob cannot leak an invalid number.
 */
export function readStoredStatistics(
  value: Prisma.JsonValue | null,
): RunStepStatisticsDto {
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
