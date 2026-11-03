import {
  MAX_STEPS,
  MAX_TOTAL_DURATION_MS,
  MAX_TOTAL_SAMPLES,
} from '../plans/plan-limits.js';
import { parseScaledDecimal } from '../plans/plan-decimal.js';
import {
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../prisma/generated/enums.js';
import { MAX_RUN_SEED } from './run-domain.js';

/** Minimal structural shape of a Prisma Decimal (or a test double). */
export interface ScaledDecimalValue {
  toFixed(digits: number): string;
}

export interface RunProfileSnapshot {
  id: string;
  code: string;
  name: string;
  description: string | null;
  [key: string]: string | null;
}

export interface RunSnapshotSourceStep {
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: ScaledDecimalValue;
  maximum: ScaledDecimalValue;
  sampleCount: number;
  intervalMs: number;
}

/**
 * A published revision and its ordered steps. The builder copies only these
 * rule fields; revision/plan relationships are kept for traceability, never
 * read back to recalculate a finished run.
 */
export interface RunSnapshotSource {
  planId: string;
  revisionId: string;
  planName: string;
  versionNumber: number;
  profile: RunProfileSnapshot;
  steps: readonly RunSnapshotSourceStep[];
}

export interface RunSnapshotSettings {
  scenario: RunScenario;
  seed: bigint;
  errorProbability?: string | null;
  failureStepId?: string | null;
  simulatorVersion: string;
  evaluationVersion: string;
}

export interface RunSnapshotContext {
  requestedById: string;
  idempotencyKey: string;
  requestHash: string;
  startedAt: Date;
}

export interface RunSnapshotStepRow {
  logicalStepId: string;
  position: number;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
  status: RunStepStatus;
  outcome: null;
  recordedCount: number;
  outOfToleranceCount: number;
  firstFailureSampleIndex: null;
  startedAt: null;
  finishedAt: null;
}

export interface RunSnapshotRunRow {
  planId: string;
  planRevisionId: string;
  planNameSnapshot: string;
  versionNumberSnapshot: number;
  profileSnapshot: RunProfileSnapshot;
  status: RunStatus;
  outcome: null;
  requestedById: string;
  scenario: RunScenario;
  seed: bigint;
  errorProbability: string | null;
  failureStepId: string | null;
  simulatorVersion: string;
  evaluationVersion: string;
  idempotencyKey: string;
  requestHash: string;
  eventSequence: number;
  expectedSampleCount: number;
  recordedSampleCount: number;
  startedAt: Date;
  finishedAt: null;
  cancelledById: null;
  reasonCode: null;
}

export interface RunSnapshotRows {
  run: RunSnapshotRunRow;
  steps: RunSnapshotStepRow[];
}

export interface RunSnapshotIssue {
  path: string;
  message: string;
}

/** Raised before any database write when a snapshot source violates the rules. */
export class RunSnapshotValidationError extends Error {
  override readonly name = 'RunSnapshotValidationError';

  constructor(readonly issues: readonly RunSnapshotIssue[]) {
    super(
      issues.length === 0
        ? 'The run snapshot is invalid.'
        : `The run snapshot is invalid: ${issues
            .map((issue) => `${issue.path} ${issue.message}`)
            .join('; ')}`,
    );
  }
}

interface NormalizedStep {
  source: RunSnapshotSourceStep;
  minimum: string;
  maximum: string;
}

const MAX_ABSOLUTE_SCALED = 1_000_000_000n * 1_000_000n;

/**
 * Copies a published revision and its steps into the rows inserted at start.
 *
 * The caller wraps the run and nested step inserts in one transaction; this
 * function performs no I/O. It deliberately has no fallback to the live plan,
 * so every displayed/derived rule for this run comes from the returned copies.
 */
export function buildRunSnapshot(
  source: RunSnapshotSource,
  settings: RunSnapshotSettings,
  context: RunSnapshotContext,
): RunSnapshotRows {
  const issues: RunSnapshotIssue[] = [];

  if (!source.planId) {
    issues.push({ path: 'planId', message: 'is required' });
  }
  if (!source.revisionId) {
    issues.push({ path: 'revisionId', message: 'is required' });
  }

  const planNameLength = source.planName.trim().length;
  if (planNameLength < 1 || planNameLength > 100) {
    issues.push({
      path: 'planName',
      message: 'must be 1 to 100 characters after trimming',
    });
  }

  if (!Number.isInteger(source.versionNumber) || source.versionNumber < 1) {
    issues.push({
      path: 'versionNumber',
      message: 'must be a positive integer',
    });
  }

  validateProfile(source.profile, issues);

  const orderedSteps = [...source.steps].sort(
    (left, right) => left.position - right.position,
  );
  if (orderedSteps.length < 1 || orderedSteps.length > MAX_STEPS) {
    issues.push({
      path: 'steps',
      message: `must contain 1 to ${MAX_STEPS} steps`,
    });
  }

  const logicalStepIds = new Set<string>();
  const normalizedSteps: NormalizedStep[] = [];

  for (const [index, step] of orderedSteps.entries()) {
    const path = `steps.${index}`;

    if (step.position !== index + 1) {
      issues.push({
        path: `${path}.position`,
        message: 'steps must be ordered from 1 without gaps or duplicates',
      });
    }

    if (!step.logicalStepId) {
      issues.push({ path: `${path}.logicalStepId`, message: 'is required' });
    } else if (logicalStepIds.has(step.logicalStepId)) {
      issues.push({
        path: `${path}.logicalStepId`,
        message: 'must be unique inside the run',
      });
    } else {
      logicalStepIds.add(step.logicalStepId);
    }

    const nameLength = step.name.trim().length;
    if (nameLength < 1 || nameLength > 100) {
      issues.push({
        path: `${path}.name`,
        message: 'must be 1 to 100 characters after trimming',
      });
    }

    const unitLength = step.unit.trim().length;
    if (unitLength < 1 || unitLength > 16) {
      issues.push({
        path: `${path}.unit`,
        message: 'must be 1 to 16 characters after trimming',
      });
    }

    if (
      !Number.isInteger(step.sampleCount) ||
      step.sampleCount < 1 ||
      step.sampleCount > 1000
    ) {
      issues.push({
        path: `${path}.sampleCount`,
        message: 'must be an integer between 1 and 1000',
      });
    }

    if (
      !Number.isInteger(step.intervalMs) ||
      step.intervalMs < 100 ||
      step.intervalMs > 5000
    ) {
      issues.push({
        path: `${path}.intervalMs`,
        message: 'must be an integer between 100 and 5000',
      });
    }

    const minimum = readDecimal(step.minimum, `${path}.minimum`, issues);
    const maximum = readDecimal(step.maximum, `${path}.maximum`, issues);

    if (minimum !== null && maximum !== null) {
      const minimumScaled = parseScaledDecimal(minimum);
      const maximumScaled = parseScaledDecimal(maximum);

      if (
        minimumScaled !== null &&
        maximumScaled !== null &&
        minimumScaled > maximumScaled
      ) {
        issues.push({
          path: `${path}.maximum`,
          message: 'must be greater than or equal to minimum',
        });
      }

      normalizedSteps.push({ source: step, minimum, maximum });
    }
  }

  const expectedSampleCount = normalizedSteps.reduce(
    (total, step) => total + step.source.sampleCount,
    0,
  );
  if (expectedSampleCount > MAX_TOTAL_SAMPLES) {
    issues.push({
      path: 'steps',
      message: `must not exceed ${MAX_TOTAL_SAMPLES} total samples`,
    });
  }

  const expectedDurationMs = normalizedSteps.reduce(
    (total, step) => total + step.source.sampleCount * step.source.intervalMs,
    0,
  );
  if (expectedDurationMs > MAX_TOTAL_DURATION_MS) {
    issues.push({
      path: 'steps',
      message: `must not exceed ${MAX_TOTAL_DURATION_MS} ms of nominal duration`,
    });
  }

  if (typeof settings.seed !== 'bigint') {
    issues.push({ path: 'seed', message: 'must be an integer' });
  } else if (settings.seed < 0n || settings.seed > MAX_RUN_SEED) {
    issues.push({
      path: 'seed',
      message: `must be between 0 and ${MAX_RUN_SEED.toString()}`,
    });
  }

  const errorProbability = resolveScenarioSettings(
    settings,
    logicalStepIds,
    issues,
  );

  if (!context.requestedById) {
    issues.push({ path: 'requestedById', message: 'is required' });
  }
  if (!context.idempotencyKey) {
    issues.push({ path: 'idempotencyKey', message: 'is required' });
  }
  if (!context.requestHash) {
    issues.push({ path: 'requestHash', message: 'is required' });
  }
  if (
    !(context.startedAt instanceof Date) ||
    Number.isNaN(context.startedAt.getTime())
  ) {
    issues.push({ path: 'startedAt', message: 'must be a valid date' });
  }
  if (!settings.simulatorVersion) {
    issues.push({ path: 'simulatorVersion', message: 'is required' });
  }
  if (!settings.evaluationVersion) {
    issues.push({ path: 'evaluationVersion', message: 'is required' });
  }

  if (issues.length > 0) {
    throw new RunSnapshotValidationError(issues);
  }

  return {
    run: {
      planId: source.planId,
      planRevisionId: source.revisionId,
      planNameSnapshot: source.planName,
      versionNumberSnapshot: source.versionNumber,
      profileSnapshot: {
        id: source.profile.id,
        code: source.profile.code,
        name: source.profile.name,
        description: source.profile.description,
      },
      status: RunStatus.RUNNING,
      outcome: null,
      requestedById: context.requestedById,
      scenario: settings.scenario,
      seed: settings.seed,
      errorProbability,
      failureStepId: settings.failureStepId ?? null,
      simulatorVersion: settings.simulatorVersion,
      evaluationVersion: settings.evaluationVersion,
      idempotencyKey: context.idempotencyKey,
      requestHash: context.requestHash,
      eventSequence: 0,
      expectedSampleCount,
      recordedSampleCount: 0,
      startedAt: context.startedAt,
      finishedAt: null,
      cancelledById: null,
      reasonCode: null,
    },
    steps: normalizedSteps.map(({ source: step, minimum, maximum }) => ({
      logicalStepId: step.logicalStepId,
      position: step.position,
      name: step.name,
      unit: step.unit,
      minimum,
      maximum,
      sampleCount: step.sampleCount,
      intervalMs: step.intervalMs,
      status: RunStepStatus.PENDING,
      outcome: null,
      recordedCount: 0,
      outOfToleranceCount: 0,
      firstFailureSampleIndex: null,
      startedAt: null,
      finishedAt: null,
    })),
  };
}

function validateProfile(
  profile: RunProfileSnapshot,
  issues: RunSnapshotIssue[],
): void {
  if (!profile.id) {
    issues.push({ path: 'profile.id', message: 'is required' });
  }
  if (!profile.code) {
    issues.push({ path: 'profile.code', message: 'is required' });
  }
  if (!profile.name.trim()) {
    issues.push({ path: 'profile.name', message: 'is required' });
  }
  if (profile.description !== null && typeof profile.description !== 'string') {
    issues.push({
      path: 'profile.description',
      message: 'must be a string or null',
    });
  }
}

/** Reads a decimal at six fixed places, rejecting values outside the contract. */
function readDecimal(
  value: ScaledDecimalValue,
  path: string,
  issues: RunSnapshotIssue[],
): string | null {
  const text = value.toFixed(6);
  const scaled = parseScaledDecimal(text);

  if (scaled === null) {
    issues.push({
      path,
      message:
        'must be a decimal with at most 6 places and |value| <= 1000000000',
    });
    return null;
  }

  if (scaled > MAX_ABSOLUTE_SCALED || scaled < -MAX_ABSOLUTE_SCALED) {
    issues.push({ path, message: 'is outside the accepted tolerance range' });
    return null;
  }

  return text;
}

/**
 * Enforces the scenario-specific settings from simulation.md. RANDOM keeps a
 * canonical six-place probability; NORMAL/FORCED_FAILURE store null.
 */
function resolveScenarioSettings(
  settings: RunSnapshotSettings,
  logicalStepIds: ReadonlySet<string>,
  issues: RunSnapshotIssue[],
): string | null {
  const errorProbability = settings.errorProbability ?? null;
  const failureStepId = settings.failureStepId ?? null;

  switch (settings.scenario) {
    case RunScenario.NORMAL: {
      if (errorProbability !== null) {
        issues.push({
          path: 'errorProbability',
          message: 'must be null for the NORMAL scenario',
        });
      }
      if (failureStepId !== null) {
        issues.push({
          path: 'failureStepId',
          message: 'must be null for the NORMAL scenario',
        });
      }
      return null;
    }

    case RunScenario.FORCED_FAILURE: {
      if (errorProbability !== null) {
        issues.push({
          path: 'errorProbability',
          message: 'must be null for the FORCED_FAILURE scenario',
        });
      }
      if (failureStepId === null) {
        issues.push({
          path: 'failureStepId',
          message: 'is required for the FORCED_FAILURE scenario',
        });
      } else if (!logicalStepIds.has(failureStepId)) {
        issues.push({
          path: 'failureStepId',
          message: 'must reference a step of the run snapshot',
        });
      }
      return null;
    }

    case RunScenario.RANDOM: {
      if (failureStepId !== null) {
        issues.push({
          path: 'failureStepId',
          message: 'must be null for the RANDOM scenario',
        });
      }
      if (errorProbability === null) {
        issues.push({
          path: 'errorProbability',
          message: 'is required for the RANDOM scenario',
        });
        return null;
      }

      const scaled = parseScaledDecimal(errorProbability);
      if (scaled === null || scaled < 0n || scaled > 1_000_000n) {
        issues.push({
          path: 'errorProbability',
          message: 'must be a decimal between 0 and 1 with at most 6 places',
        });
        return null;
      }

      return formatScaled(scaled);
    }

    default: {
      issues.push({ path: 'scenario', message: 'is not a known scenario' });
      return null;
    }
  }
}

function formatScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const integerPart = magnitude / 1_000_000n;
  const fractionPart = (magnitude % 1_000_000n).toString().padStart(6, '0');

  return `${negative ? '-' : ''}${integerPart.toString()}.${fractionPart}`;
}
