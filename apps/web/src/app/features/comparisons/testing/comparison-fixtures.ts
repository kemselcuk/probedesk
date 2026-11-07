import type { RunSnapshotStep } from '../../runs/runs-api.types';
import type {
  ComparisonChangedField,
  ComparisonResult,
  ComparisonRunSummary,
} from '../comparisons-api.types';

export const COMPARE_PLAN_ID = '11111111-1111-4111-8111-111111111111';
export const LEFT_VERSION_ID = '22222222-2222-4222-8222-222222222222';
export const RIGHT_VERSION_ID = '33333333-3333-4333-8333-333333333333';
export const LEFT_RUN_ID = '44444444-4444-4444-8444-444444444444';
export const RIGHT_RUN_ID = '55555555-5555-4555-8555-555555555555';
export const VOLTAGE_STEP_ID = '66666666-6666-4666-8666-666666666666';
export const CURRENT_STEP_ID = '77777777-7777-4777-8777-777777777777';
export const TEMPERATURE_STEP_ID = '88888888-8888-4888-8888-888888888888';
export const ADDED_STEP_ID = '99999999-9999-4999-8999-999999999999';
export const REMOVED_STEP_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const PROFILE_ID = 'abababab-abab-4bab-8bab-abababababab';
export const USER_ID = 'acacacac-acac-4cac-8cac-acacacacacac';

export function comparisonRun(overrides: Partial<ComparisonRunSummary> = {}): ComparisonRunSummary {
  return {
    id: LEFT_RUN_ID,
    planId: COMPARE_PLAN_ID,
    planVersionId: LEFT_VERSION_ID,
    planName: 'Power rail verification',
    deviceId: null,
    deviceSnapshot: null,
    batchNumber: null,
    versionNumber: 3,
    profile: {
      id: PROFILE_ID,
      code: 'DC_POWER_MODULE',
      name: 'DC Power Module',
      description: null,
    },
    scenario: 'NORMAL',
    seed: 42,
    errorProbability: null,
    failureStepId: null,
    simulatorVersion: 'mulberry32-v1',
    evaluationVersion: 'decimal-v1',
    status: 'COMPLETED',
    outcome: 'PASSED',
    startedAt: '2026-11-03T10:00:00.000Z',
    finishedAt: '2026-11-03T10:00:04.000Z',
    requestedBy: {
      id: USER_ID,
      email: 'operator@probedesk.local',
      role: 'OPERATOR',
    },
    reasonCode: null,
    expectedSampleCount: 8,
    recordedSampleCount: 8,
    outOfToleranceCount: 0,
    stepCount: 4,
    partial: false,
    ...overrides,
  };
}

export function comparisonStep(overrides: Partial<RunSnapshotStep> = {}): RunSnapshotStep {
  return {
    runStepId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    logicalStepId: VOLTAGE_STEP_ID,
    position: 1,
    name: 'Output voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 3,
    intervalMs: 500,
    status: 'COMPLETED',
    outcome: 'PASSED',
    recordedCount: 3,
    outOfToleranceCount: 0,
    firstFailureSampleIndex: null,
    hasOutOfTolerance: false,
    statistics: {
      minimum: '4.980000',
      maximum: '5.100000',
      average: '5.030000',
      sampleCount: 3,
    },
    measurements: [
      {
        sampleIndex: 0,
        value: '5.000000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:00:00.500Z',
        elapsedMs: 500,
      },
      {
        sampleIndex: 1,
        value: '5.100000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:00:01.000Z',
        elapsedMs: 1000,
      },
      {
        sampleIndex: 2,
        value: '4.990000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:00:01.500Z',
        elapsedMs: 1500,
      },
    ],
    ...overrides,
  };
}

export function comparisonResult(overrides: Partial<ComparisonResult> = {}): ComparisonResult {
  const leftRun = comparisonRun();
  const rightRun = comparisonRun({
    id: RIGHT_RUN_ID,
    planVersionId: RIGHT_VERSION_ID,
    versionNumber: 4,
    outcome: 'FAILED',
    expectedSampleCount: 10,
    recordedSampleCount: 10,
    outOfToleranceCount: 1,
    stepCount: 5,
    finishedAt: '2026-11-03T10:05:00.000Z',
  });

  const voltageLeft = comparisonStep();
  const voltageRight = comparisonStep({
    runStepId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    measurements: [
      {
        sampleIndex: 0,
        value: '5.100000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:04:00.400Z',
        elapsedMs: 400,
      },
      {
        sampleIndex: 1,
        value: '5.600000',
        isWithinTolerance: false,
        recordedAt: '2026-11-03T10:04:00.900Z',
        elapsedMs: 900,
      },
      {
        sampleIndex: 2,
        value: '5.200000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:04:01.400Z',
        elapsedMs: 1400,
      },
    ],
    outOfToleranceCount: 1,
    firstFailureSampleIndex: 1,
    hasOutOfTolerance: true,
    statistics: {
      minimum: '5.100000',
      maximum: '5.600000',
      average: '5.300000',
      sampleCount: 3,
    },
  });

  const currentLeft = comparisonStep({
    runStepId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    logicalStepId: CURRENT_STEP_ID,
    position: 2,
    name: 'Current draw',
    unit: 'A',
    minimum: '0.100000',
    maximum: '0.550000',
    sampleCount: 2,
    intervalMs: 500,
    statistics: {
      minimum: '0.200000',
      maximum: '0.300000',
      average: '0.250000',
      sampleCount: 2,
    },
    measurements: [
      {
        sampleIndex: 0,
        value: '0.200000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:00:02.000Z',
        elapsedMs: 2000,
      },
      {
        sampleIndex: 1,
        value: '0.300000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:00:02.500Z',
        elapsedMs: 2500,
      },
    ],
  });

  const currentRight = comparisonStep({
    runStepId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    logicalStepId: CURRENT_STEP_ID,
    position: 3,
    name: 'Current draw (renamed)',
    unit: 'A',
    minimum: '0.120000',
    maximum: '0.500000',
    sampleCount: 3,
    intervalMs: 750,
    statistics: {
      minimum: '0.150000',
      maximum: '0.400000',
      average: '0.283333',
      sampleCount: 3,
    },
    measurements: [
      {
        sampleIndex: 0,
        value: '0.150000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:05:02.000Z',
        elapsedMs: 2000,
      },
      {
        sampleIndex: 1,
        value: '0.400000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:05:02.750Z',
        elapsedMs: 2750,
      },
      {
        sampleIndex: 2,
        value: '0.300000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:05:03.500Z',
        elapsedMs: 3500,
      },
    ],
  });

  const temperatureLeft = comparisonStep({
    runStepId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    logicalStepId: TEMPERATURE_STEP_ID,
    position: 3,
    name: 'Temperature',
    unit: '°C',
    minimum: '-10.000000',
    maximum: '40.000000',
    sampleCount: 2,
    intervalMs: 500,
    statistics: {
      minimum: '20.000000',
      maximum: '25.000000',
      average: '22.500000',
      sampleCount: 2,
    },
    measurements: [
      {
        sampleIndex: 0,
        value: '20.000000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:00:03.000Z',
        elapsedMs: 3000,
      },
      {
        sampleIndex: 1,
        value: '25.000000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:00:03.500Z',
        elapsedMs: 3500,
      },
    ],
  });

  const temperatureRight = comparisonStep({
    runStepId: '12121212-1212-4212-8212-121212121212',
    logicalStepId: TEMPERATURE_STEP_ID,
    position: 4,
    name: 'Temperature',
    unit: '°F',
    minimum: '14.000000',
    maximum: '104.000000',
    sampleCount: 2,
    intervalMs: 600,
    statistics: {
      minimum: '68.000000',
      maximum: '77.000000',
      average: '72.500000',
      sampleCount: 2,
    },
    measurements: [
      {
        sampleIndex: 0,
        value: '68.000000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:05:04.000Z',
        elapsedMs: 4000,
      },
      {
        sampleIndex: 1,
        value: '77.000000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:05:04.600Z',
        elapsedMs: 4600,
      },
    ],
  });

  const humidityRight = comparisonStep({
    runStepId: '13131313-1313-4313-8313-131313131313',
    logicalStepId: ADDED_STEP_ID,
    position: 5,
    name: 'Humidity',
    unit: '%RH',
    minimum: '20.000000',
    maximum: '80.000000',
    sampleCount: 2,
    intervalMs: 500,
    statistics: {
      minimum: '41.000000',
      maximum: '43.000000',
      average: '42.000000',
      sampleCount: 2,
    },
    measurements: [
      {
        sampleIndex: 0,
        value: '41.000000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:05:05.000Z',
        elapsedMs: 5000,
      },
      {
        sampleIndex: 1,
        value: '43.000000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:05:05.500Z',
        elapsedMs: 5500,
      },
    ],
  });

  const leakageLeft = comparisonStep({
    runStepId: '14141414-1414-4414-8414-141414141414',
    logicalStepId: REMOVED_STEP_ID,
    position: 4,
    name: 'Leakage current',
    unit: 'µA',
    minimum: '0.000000',
    maximum: '10.000000',
    sampleCount: 1,
    intervalMs: 500,
    statistics: {
      minimum: '2.000000',
      maximum: '2.000000',
      average: '2.000000',
      sampleCount: 1,
    },
    measurements: [
      {
        sampleIndex: 0,
        value: '2.000000',
        isWithinTolerance: true,
        recordedAt: '2026-11-03T10:00:04.000Z',
        elapsedMs: 4000,
      },
    ],
  });

  return {
    planId: COMPARE_PLAN_ID,
    versionDifference: {
      sameVersion: false,
      leftVersionNumber: 3,
      rightVersionNumber: 4,
    },
    leftRun,
    rightRun,
    matchedSteps: [
      {
        logicalStepId: VOLTAGE_STEP_ID,
        left: voltageLeft,
        right: voltageRight,
        changedFields: [],
        numericComparison: {
          comparable: true,
          reason: 'SAME_UNIT',
          statistics: {
            minimum: { left: '4.980000', right: '5.100000', delta: '0.120000' },
            maximum: { left: '5.100000', right: '5.600000', delta: '0.500000' },
            average: { left: '5.030000', right: '5.300000', delta: '0.270000' },
            sampleCount: { left: 3, right: 3, delta: 0 },
          },
        },
      },
      {
        logicalStepId: CURRENT_STEP_ID,
        left: currentLeft,
        right: currentRight,
        changedFields: [
          { field: 'name', left: 'Current draw', right: 'Current draw (renamed)' },
          { field: 'position', left: 2, right: 3 },
          { field: 'minimum', left: '0.100000', right: '0.120000' },
          { field: 'maximum', left: '0.550000', right: '0.500000' },
          { field: 'sampleCount', left: 2, right: 3 },
          { field: 'intervalMs', left: 500, right: 750 },
        ],
        numericComparison: {
          comparable: true,
          reason: 'SAME_UNIT',
          statistics: {
            minimum: { left: '0.200000', right: '0.150000', delta: '-0.050000' },
            maximum: { left: '0.300000', right: '0.400000', delta: '0.100000' },
            average: { left: '0.250000', right: '0.283333', delta: '0.033333' },
            sampleCount: { left: 2, right: 3, delta: 1 },
          },
        },
      },
      {
        logicalStepId: TEMPERATURE_STEP_ID,
        left: temperatureLeft,
        right: temperatureRight,
        changedFields: [
          { field: 'unit', left: '°C', right: '°F' },
          { field: 'position', left: 3, right: 4 },
          { field: 'minimum', left: '-10.000000', right: '14.000000' },
          { field: 'maximum', left: '40.000000', right: '104.000000' },
        ],
        numericComparison: {
          comparable: false,
          reason: 'UNIT_MISMATCH',
          statistics: null,
        },
      },
    ],
    addedSteps: [humidityRight],
    removedSteps: [leakageLeft],
    ...overrides,
  };
}

export function changedField(
  field: ComparisonChangedField['field'],
  left: string | number,
  right: string | number,
): ComparisonChangedField {
  return { field, left, right };
}
