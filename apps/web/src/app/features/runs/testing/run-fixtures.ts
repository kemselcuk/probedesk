import type { RunEventEnvelope } from '../../../core/runs/run-event.types';
import type { RunSnapshot, RunSnapshotStep } from '../runs-api.types';

export const RUN_ID = '33333333-3333-4333-8333-333333333333';
export const PLAN_ID = '11111111-1111-4111-8111-111111111111';
export const VERSION_ID = '22222222-2222-4222-8222-222222222222';
export const STEP_ID = '44444444-4444-4444-8444-444444444444';
export const RUN_STEP_ID = '55555555-5555-4555-8555-555555555555';
export const PROFILE_ID = '66666666-6666-4666-8666-666666666666';
export const USER_ID = '77777777-7777-4777-8777-777777777777';

export function runningStep(overrides: Partial<RunSnapshotStep> = {}): RunSnapshotStep {
  return {
    runStepId: RUN_STEP_ID,
    logicalStepId: STEP_ID,
    position: 1,
    name: 'Output voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 4,
    intervalMs: 500,
    status: 'RUNNING',
    outcome: null,
    recordedCount: 0,
    outOfToleranceCount: 0,
    firstFailureSampleIndex: null,
    hasOutOfTolerance: false,
    statistics: {
      minimum: null,
      maximum: null,
      average: null,
      sampleCount: null,
    },
    measurements: [],
    ...overrides,
  };
}

export function runSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: RUN_ID,
    planId: PLAN_ID,
    planVersionId: VERSION_ID,
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
    simulatorVersion: 'sim-v1',
    evaluationVersion: 'decimal-v1',
    status: 'RUNNING',
    outcome: null,
    startedAt: '2026-11-03T10:00:00.000Z',
    finishedAt: null,
    requestedBy: {
      id: USER_ID,
      email: 'operator@probedesk.local',
      role: 'OPERATOR',
    },
    reasonCode: null,
    expectedSampleCount: 4,
    recordedSampleCount: 0,
    lastEventSequence: 3,
    steps: [runningStep()],
    ...overrides,
  };
}

export function measurementEvent(
  sequence: number,
  sampleIndex: number,
  isWithinTolerance = true,
): RunEventEnvelope {
  const outOfTolerance = isWithinTolerance ? 0 : 1;
  return {
    type: 'measurement.recorded',
    schemaVersion: 1,
    runId: RUN_ID,
    sequence,
    occurredAt: `2026-11-03T10:00:0${Math.min(sequence, 9)}.000Z`,
    payload: {
      stepId: RUN_STEP_ID,
      logicalStepId: STEP_ID,
      position: 1,
      sampleIndex,
      value: isWithinTolerance ? '5.000000' : '5.500000',
      isWithinTolerance,
      recordedAt: `2026-11-03T10:00:0${Math.min(sequence, 9)}.000Z`,
      elapsedMs: (sampleIndex + 1) * 500,
      recordedCount: sampleIndex + 1,
      outOfToleranceCount: outOfTolerance,
      firstFailureSampleIndex: isWithinTolerance ? null : sampleIndex,
      hasOutOfTolerance: !isWithinTolerance,
      recordedSampleCount: sampleIndex + 1,
      expectedSampleCount: 4,
    },
  };
}

export function cancelledEvent(sequence: number): RunEventEnvelope {
  return {
    type: 'run.cancelled',
    schemaVersion: 1,
    runId: RUN_ID,
    sequence,
    occurredAt: '2026-11-03T10:00:02.000Z',
    payload: {
      status: 'CANCELLED',
      reasonCode: 'USER_CANCELLED',
      cancelledById: USER_ID,
      recordedSampleCount: 1,
      expectedSampleCount: 4,
      cancelledStepCount: 1,
      notRunStepCount: 0,
      finishedAt: '2026-11-03T10:00:02.000Z',
    },
  };
}

export function completedEvent(sequence: number): RunEventEnvelope {
  return {
    type: 'run.completed',
    schemaVersion: 1,
    runId: RUN_ID,
    sequence,
    occurredAt: '2026-11-03T10:00:04.000Z',
    payload: {
      status: 'COMPLETED',
      outcome: 'FAILED',
      recordedSampleCount: 4,
      expectedSampleCount: 4,
      stepCount: 1,
      passedStepCount: 0,
      failedStepCount: 1,
      finishedAt: '2026-11-03T10:00:04.000Z',
    },
  };
}
