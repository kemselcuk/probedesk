import { parseScaledDecimal } from '../plans/plan-decimal.js';
import {
  type RunSnapshotRow,
  type RunSnapshotStepRow,
  readProfileSnapshot,
  readSeed,
  readStoredStatistics,
  toRequestedBy,
  toRunStepDto,
} from '../runs/run-snapshot-read.js';
import type { RunSnapshotStepDto } from '../runs/dto/run-snapshot.dto.js';
import {
  ComparisonCountValueDto,
  ComparisonDecimalValueDto,
  ComparisonMatchedStepDto,
  ComparisonNumericComparisonDto,
  ComparisonRuleChangeDto,
  ComparisonRunSummaryDto,
  RunComparisonDto,
} from './dto/comparison.dto.js';

const SCALE_FACTOR = 1_000_000n;

/**
 * Builds the comparison from two already-validated terminal runs of the same
 * plan. Matching uses only the persistent logicalStepId, so renames and
 * reorders keep the same logical step; removed identities are never reused.
 *
 * Each side keeps the rules and statistics copied when its run started. No
 * value is read from the live plan, re-evaluated, zero-filled, interpolated or
 * index-aligned across the two measurement series.
 */
export function buildRunComparison(
  left: RunSnapshotRow,
  right: RunSnapshotRow,
): RunComparisonDto {
  const leftSteps = orderSteps(left.steps);
  const rightSteps = orderSteps(right.steps);
  const rightByLogicalId = new Map(
    rightSteps.map((step) => [step.logicalStepId, step]),
  );
  const leftLogicalIds = new Set(
    leftSteps.map((step) => step.logicalStepId),
  );

  const matchedSteps: ComparisonMatchedStepDto[] = [];
  const removedSteps: RunSnapshotStepDto[] = [];

  for (const leftStep of leftSteps) {
    const rightStep = rightByLogicalId.get(leftStep.logicalStepId);

    if (!rightStep) {
      removedSteps.push(toRunStepDto(leftStep));
      continue;
    }

    matchedSteps.push({
      logicalStepId: leftStep.logicalStepId,
      changedFields: compareRules(leftStep, rightStep),
      numericComparison: compareStatistics(leftStep, rightStep),
      left: toRunStepDto(leftStep),
      right: toRunStepDto(rightStep),
    });
  }

  const addedSteps = rightSteps
    .filter((step) => !leftLogicalIds.has(step.logicalStepId))
    .map(toRunStepDto);

  return {
    planId: left.planId,
    versionDifference: {
      sameVersion:
        left.versionNumberSnapshot === right.versionNumberSnapshot,
      leftVersionNumber: left.versionNumberSnapshot,
      rightVersionNumber: right.versionNumberSnapshot,
    },
    leftRun: toRunSummary(left),
    rightRun: toRunSummary(right),
    matchedSteps,
    addedSteps,
    removedSteps,
  };
}

/** Stable order: position, then the persistent id as a deterministic tie-break. */
function orderSteps(
  steps: readonly RunSnapshotStepRow[],
): RunSnapshotStepRow[] {
  return [...steps].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }
    if (left.logicalStepId < right.logicalStepId) {
      return -1;
    }
    if (left.logicalStepId > right.logicalStepId) {
      return 1;
    }
    return 0;
  });
}

function toRunSummary(run: RunSnapshotRow): ComparisonRunSummaryDto {
  const steps = orderSteps(run.steps);
  const expectedSampleCount = steps.reduce(
    (total, step) => total + step.sampleCount,
    0,
  );
  const recordedSampleCount = steps.reduce(
    (total, step) => total + step.recordedCount,
    0,
  );
  const outOfToleranceCount = steps.reduce(
    (total, step) => total + step.outOfToleranceCount,
    0,
  );

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
    expectedSampleCount,
    recordedSampleCount,
    outOfToleranceCount,
    stepCount: steps.length,
    // Missing measurement data only; a terminal run that recorded every
    // expected sample is not partial even when it stopped before completion.
    partial: recordedSampleCount < expectedSampleCount,
  };
}

/** Returns only the changed rules, in the documented comparison order. */
function compareRules(
  left: RunSnapshotStepRow,
  right: RunSnapshotStepRow,
): ComparisonRuleChangeDto[] {
  const changes: ComparisonRuleChangeDto[] = [];

  addTextChange(changes, 'name', left.name, right.name);
  addTextChange(changes, 'unit', left.unit, right.unit);
  addNumberChange(changes, 'position', left.position, right.position);
  addTextChange(
    changes,
    'minimum',
    left.minimum.toFixed(6),
    right.minimum.toFixed(6),
  );
  addTextChange(
    changes,
    'maximum',
    left.maximum.toFixed(6),
    right.maximum.toFixed(6),
  );
  addNumberChange(
    changes,
    'sampleCount',
    left.sampleCount,
    right.sampleCount,
  );
  addNumberChange(changes, 'intervalMs', left.intervalMs, right.intervalMs);

  return changes;
}

function addTextChange(
  changes: ComparisonRuleChangeDto[],
  field: 'name' | 'unit' | 'minimum' | 'maximum',
  left: string,
  right: string,
): void {
  if (left !== right) {
    changes.push({ field, left, right });
  }
}

function addNumberChange(
  changes: ComparisonRuleChangeDto[],
  field: 'position' | 'sampleCount' | 'intervalMs',
  left: number,
  right: number,
): void {
  if (left !== right) {
    changes.push({ field, left, right });
  }
}

/**
 * Produces numeric deltas only when the unit is unchanged. Different units
 * yield an explicit UNIT_MISMATCH and no statistics, so a caller cannot render
 * a meaningless number or a shared axis.
 */
function compareStatistics(
  left: RunSnapshotStepRow,
  right: RunSnapshotStepRow,
): ComparisonNumericComparisonDto {
  if (left.unit !== right.unit) {
    return {
      comparable: false,
      reason: 'UNIT_MISMATCH',
      statistics: null,
    };
  }

  const leftStatistics = readStoredStatistics(left.statistics);
  const rightStatistics = readStoredStatistics(right.statistics);

  return {
    comparable: true,
    reason: 'SAME_UNIT',
    statistics: {
      minimum: decimalComparison(
        leftStatistics.minimum,
        rightStatistics.minimum,
      ),
      maximum: decimalComparison(
        leftStatistics.maximum,
        rightStatistics.maximum,
      ),
      average: decimalComparison(
        leftStatistics.average,
        rightStatistics.average,
      ),
      sampleCount: countComparison(
        leftStatistics.sampleCount,
        rightStatistics.sampleCount,
      ),
    },
  };
}

function decimalComparison(
  left: string | null,
  right: string | null,
): ComparisonDecimalValueDto {
  return { left, right, delta: decimalDelta(left, right) };
}

function countComparison(
  left: number | null,
  right: number | null,
): ComparisonCountValueDto {
  return {
    left,
    right,
    delta: left === null || right === null ? null : right - left,
  };
}

/** Returns right - left as canonical six-place text, or null if either is absent. */
function decimalDelta(
  left: string | null,
  right: string | null,
): string | null {
  if (left === null || right === null) {
    return null;
  }

  const leftScaled = parseScaledDecimal(left);
  const rightScaled = parseScaledDecimal(right);
  if (leftScaled === null || rightScaled === null) {
    return null;
  }

  return formatScaled(rightScaled - leftScaled);
}

function formatScaled(scaled: bigint): string {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const integerPart = magnitude / SCALE_FACTOR;
  const fractionPart = (magnitude % SCALE_FACTOR)
    .toString()
    .padStart(6, '0');

  return `${negative ? '-' : ''}${integerPart.toString()}.${fractionPart}`;
}
