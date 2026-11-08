import type { RunSnapshotRow } from '../runs/run-snapshot-read.js';
import {
  readDeviceSnapshot,
  readProfileSnapshot,
  readSeed,
  readStoredStatistics,
  toMeasurementDto,
  toRequestedBy,
} from '../runs/run-snapshot-read.js';
import type { RunReportDto } from './dto/run-report.dto.js';

/** The report projection has its own version, independent of the run schema. */
export const RUN_REPORT_SCHEMA_VERSION = 1;

/**
 * Builds the public terminal-run report from the immutable snapshot select.
 * It intentionally does not join the live plan or the live device: every rule,
 * device and batch value below is the copy taken when the run started.
 *
 * Decimal values stay decimal strings with exactly six fractional digits. No
 * verdict, statistic or missing sample is recalculated here.
 */
export function buildRunReport(
  run: RunSnapshotRow,
  generatedAt: Date,
): RunReportDto {
  return {
    schemaVersion: RUN_REPORT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
    runId: run.id,
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
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    status: run.status,
    outcome: run.outcome,
    reasonCode: run.reasonCode,
    expectedSampleCount: run.expectedSampleCount,
    recordedSampleCount: run.recordedSampleCount,
    requestedBy: toRequestedBy(run.requestedBy),
    steps: run.steps.map((step) => ({
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
    })),
  };
}
