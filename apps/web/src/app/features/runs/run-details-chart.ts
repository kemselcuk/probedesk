import type { MeasurementSelection } from '../../shared/charts/measurement-chart.types';
import type { RunMeasurement, RunSnapshot, RunSnapshotStep } from './runs-api.types';

/** A recorded out-of-tolerance sample with its step identity for selection. */
export interface FailureSampleView {
  readonly logicalStepId: string;
  readonly runStepId: string;
  readonly stepPosition: number;
  readonly stepName: string;
  readonly unit: string;
  readonly sampleIndex: number;
  readonly value: string;
  readonly elapsedMs: number;
  readonly recordedAt: string;
  readonly isFirstFailure: boolean;
}

export interface SelectedMeasurementView {
  readonly step: RunSnapshotStep;
  readonly measurement: RunMeasurement;
}

/** DOM id shared by the chart table link and the Run Details focus handler. */
export function measurementsTableId(runStepId: string): string {
  return `measurements-table-${runStepId}`;
}

/** DOM id for one measurement row; sample indices are unique inside a step. */
export function measurementRowId(runStepId: string, sampleIndex: number): string {
  return `measurement-row-${runStepId}-${sampleIndex}`;
}

export function findStepByLogicalStepId(
  run: RunSnapshot,
  logicalStepId: string,
): RunSnapshotStep | null {
  return run.steps.find((step) => step.logicalStepId === logicalStepId) ?? null;
}

/** Resolves a selection only while the exact step/sample still exists. */
export function findSelectedMeasurement(
  run: RunSnapshot,
  selection: MeasurementSelection,
): SelectedMeasurementView | null {
  const step = findStepByLogicalStepId(run, selection.logicalStepId);
  if (step === null) {
    return null;
  }

  const measurement =
    step.measurements.find((sample) => sample.sampleIndex === selection.sampleIndex) ?? null;
  return measurement === null ? null : { step, measurement };
}

/**
 * Failure list for the Run Details summary, in step and sample order. The
 * `isFirstFailure` marker uses the stored first-failure index of each step; no
 * value comparison is performed here.
 */
export function collectFailureSamples(run: RunSnapshot): FailureSampleView[] {
  const failures: FailureSampleView[] = [];

  for (const step of run.steps) {
    for (const measurement of step.measurements) {
      if (measurement.isWithinTolerance) {
        continue;
      }

      failures.push({
        logicalStepId: step.logicalStepId,
        runStepId: step.runStepId,
        stepPosition: step.position,
        stepName: step.name,
        unit: step.unit,
        sampleIndex: measurement.sampleIndex,
        value: measurement.value,
        elapsedMs: measurement.elapsedMs,
        recordedAt: measurement.recordedAt,
        isFirstFailure: measurement.sampleIndex === step.firstFailureSampleIndex,
      });
    }
  }

  return failures;
}
