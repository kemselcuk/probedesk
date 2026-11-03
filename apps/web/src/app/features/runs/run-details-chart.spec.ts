import { describe, expect, it } from 'vitest';
import {
  collectFailureSamples,
  findSelectedMeasurement,
  findStepByLogicalStepId,
  measurementRowId,
  measurementsTableId,
} from './run-details-chart';
import { RUN_STEP_ID, STEP_ID, runSnapshot, runningStep } from './testing/run-fixtures';
import type { RunSnapshot } from './runs-api.types';

function snapshotWithMeasurements(): RunSnapshot {
  return runSnapshot({
    status: 'COMPLETED',
    outcome: 'FAILED',
    expectedSampleCount: 4,
    recordedSampleCount: 4,
    steps: [
      runningStep({
        status: 'COMPLETED',
        outcome: 'FAILED',
        recordedCount: 2,
        outOfToleranceCount: 1,
        firstFailureSampleIndex: 1,
        hasOutOfTolerance: true,
        measurements: [
          {
            sampleIndex: 0,
            value: '5.000000',
            isWithinTolerance: true,
            recordedAt: '2026-11-03T10:00:01.000Z',
            elapsedMs: 500,
          },
          {
            sampleIndex: 1,
            // The value is inside the numeric limits but the backend flag says
            // it is a failure. The UI must follow the flag, not compare floats.
            value: '5.100000',
            isWithinTolerance: false,
            recordedAt: '2026-11-03T10:00:02.000Z',
            elapsedMs: 1000,
          },
        ],
      }),
    ],
  });
}

describe('run details chart helpers', () => {
  it('builds stable table and row ids from the run step id', () => {
    expect(measurementsTableId(RUN_STEP_ID)).toBe(`measurements-table-${RUN_STEP_ID}`);
    expect(measurementRowId(RUN_STEP_ID, 3)).toBe(`measurement-row-${RUN_STEP_ID}-3`);
  });

  it('finds a step and an exact step/sample selection', () => {
    const run = snapshotWithMeasurements();

    expect(findStepByLogicalStepId(run, STEP_ID)?.runStepId).toBe(RUN_STEP_ID);
    expect(findStepByLogicalStepId(run, 'missing-step')).toBeNull();

    const selection = { logicalStepId: STEP_ID, sampleIndex: 1 };
    expect(findSelectedMeasurement(run, selection)?.measurement.value).toBe('5.100000');
    expect(findSelectedMeasurement(run, { logicalStepId: STEP_ID, sampleIndex: 99 })).toBeNull();
    expect(
      findSelectedMeasurement(run, { logicalStepId: 'missing-step', sampleIndex: 1 }),
    ).toBeNull();
  });

  it('lists failures in step/sample order using only backend flags', () => {
    const failures = collectFailureSamples(snapshotWithMeasurements());

    expect(failures).toEqual([
      {
        logicalStepId: STEP_ID,
        runStepId: RUN_STEP_ID,
        stepPosition: 1,
        stepName: 'Output voltage',
        unit: 'V',
        sampleIndex: 1,
        value: '5.100000',
        elapsedMs: 1000,
        recordedAt: '2026-11-03T10:00:02.000Z',
        isFirstFailure: true,
      },
    ]);
  });
});
