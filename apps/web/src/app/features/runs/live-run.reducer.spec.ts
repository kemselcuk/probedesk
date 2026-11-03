import { describe, expect, it } from 'vitest';
import type { RunEventEnvelope } from '../../core/runs/run-event.types';
import type { RunSnapshot, RunSnapshotStep } from './runs-api.types';
import {
  applyRunEvent,
  mergeRunSnapshot,
} from './live-run.reducer';
import type { LiveRunState } from './live-run.reducer';

const RUN_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_RUN_ID = '99999999-9999-4999-8999-999999999999';
const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const STEP_ID = '44444444-4444-4444-8444-444444444444';
const RUN_STEP_ID = '55555555-5555-4555-8555-555555555555';
const PROFILE_ID = '66666666-6666-4666-8666-666666666666';
const USER_ID = '77777777-7777-4777-8777-777777777777';

const STEP: RunSnapshotStep = {
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
};

function snapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    id: RUN_ID,
    planId: PLAN_ID,
    planVersionId: VERSION_ID,
    planName: 'Power rail verification',
    versionNumber: 1,
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
    steps: [STEP],
    ...overrides,
  };
}

function state(overrides: Partial<RunSnapshot> = {}): LiveRunState {
  const run = snapshot(overrides);
  return { run, lastEventSequence: run.lastEventSequence };
}

function measurement(
  sequence: number,
  sampleIndex: number,
  isWithinTolerance: boolean,
): RunEventEnvelope {
  return {
    type: 'measurement.recorded',
    schemaVersion: 1,
    runId: RUN_ID,
    sequence,
    occurredAt: '2026-11-03T10:00:01.000Z',
    payload: {
      stepId: RUN_STEP_ID,
      logicalStepId: STEP_ID,
      position: 1,
      sampleIndex,
      value: isWithinTolerance ? '5.000000' : '5.500000',
      isWithinTolerance,
      recordedAt: '2026-11-03T10:00:01.000Z',
      elapsedMs: 500,
      recordedCount: sampleIndex + 1,
      outOfToleranceCount: isWithinTolerance ? 0 : 1,
      firstFailureSampleIndex: isWithinTolerance ? null : sampleIndex,
      hasOutOfTolerance: !isWithinTolerance,
      recordedSampleCount: sampleIndex + 1,
      expectedSampleCount: 4,
    },
  };
}

function cancelled(sequence: number): RunEventEnvelope {
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

describe('applyRunEvent', () => {
  it('applies exactly the next sequence and advances the cursor', () => {
    const result = applyRunEvent(state(), measurement(4, 0, true));

    expect(result.kind).toBe('applied');
    if (result.kind !== 'applied') {
      return;
    }

    expect(result.state.lastEventSequence).toBe(4);
    expect(result.state.run.lastEventSequence).toBe(4);
    expect(result.state.run.recordedSampleCount).toBe(1);
    expect(result.state.run.steps[0]?.recordedCount).toBe(1);
    expect(result.state.run.steps[0]?.measurements).toHaveLength(1);
  });

  it('ignores a duplicate sequence without changing counters or samples', () => {
    const current = state();
    const result = applyRunEvent(current, measurement(3, 0, true));

    expect(result.kind).toBe('duplicate');
    expect(result.state).toBe(current);
  });

  it('moves a step from PENDING to RUNNING to COMPLETED with backend outcome and statistics', () => {
    const pending = state({
      steps: [{ ...STEP, status: 'PENDING' }],
    });

    const started: RunEventEnvelope = {
      type: 'step.started',
      schemaVersion: 1,
      runId: RUN_ID,
      sequence: 4,
      occurredAt: '2026-11-03T10:00:01.000Z',
      payload: {
        stepId: RUN_STEP_ID,
        logicalStepId: STEP_ID,
        position: 1,
        name: 'Output voltage',
        unit: 'V',
        minimum: '4.750000',
        maximum: '5.250000',
        sampleCount: 4,
        intervalMs: 500,
        status: 'RUNNING',
        startedAt: '2026-11-03T10:00:01.000Z',
        recordedSampleCount: 0,
        expectedSampleCount: 4,
      },
    };

    const running = applyRunEvent(pending, started);
    expect(running.kind).toBe('applied');
    if (running.kind !== 'applied') {
      return;
    }
    expect(running.state.run.steps[0]?.status).toBe('RUNNING');

    const completed: RunEventEnvelope = {
      type: 'step.completed',
      schemaVersion: 1,
      runId: RUN_ID,
      sequence: 5,
      occurredAt: '2026-11-03T10:00:03.000Z',
      payload: {
        stepId: RUN_STEP_ID,
        logicalStepId: STEP_ID,
        position: 1,
        status: 'COMPLETED',
        outcome: 'FAILED',
        recordedCount: 4,
        outOfToleranceCount: 1,
        firstFailureSampleIndex: 0,
        hasOutOfTolerance: true,
        statistics: {
          minimum: '4.980000',
          maximum: '5.500000',
          average: '5.120000',
          sampleCount: 4,
        },
        startedAt: '2026-11-03T10:00:01.000Z',
        finishedAt: '2026-11-03T10:00:03.000Z',
        recordedSampleCount: 4,
        expectedSampleCount: 4,
      },
    };

    const finished = applyRunEvent(running.state, completed);
    expect(finished.kind).toBe('applied');
    if (finished.kind !== 'applied') {
      return;
    }

    const step = finished.state.run.steps[0];
    expect(step?.status).toBe('COMPLETED');
    expect(step?.outcome).toBe('FAILED');
    expect(step?.statistics.sampleCount).toBe(4);
    expect(step?.firstFailureSampleIndex).toBe(0);
  });

  it('reports a forward gap instead of guessing missing events', () => {
    const result = applyRunEvent(state(), measurement(5, 1, true));

    expect(result.kind).toBe('gap');
    if (result.kind === 'gap') {
      expect(result.expectedSequence).toBe(4);
    }
    expect(result.state.run.recordedSampleCount).toBe(0);
  });

  it('keeps the first violation when later samples are within tolerance', () => {
    const first = applyRunEvent(state(), measurement(4, 0, false));
    expect(first.kind).toBe('applied');
    if (first.kind !== 'applied') {
      return;
    }

    const second = applyRunEvent(first.state, measurement(5, 1, true));
    expect(second.kind).toBe('applied');
    if (second.kind !== 'applied') {
      return;
    }

    const step = second.state.run.steps[0];
    expect(step?.hasOutOfTolerance).toBe(true);
    expect(step?.outOfToleranceCount).toBe(1);
    expect(step?.firstFailureSampleIndex).toBe(0);
    expect(step?.measurements).toHaveLength(2);
    expect(second.state.run.recordedSampleCount).toBe(2);
  });

  it('ignores events for another run', () => {
    const foreign: RunEventEnvelope = {
      ...measurement(4, 0, true),
      runId: OTHER_RUN_ID,
    };
    const result = applyRunEvent(state(), foreign);

    expect(result.kind).toBe('foreign');
    expect(result.state.run.recordedSampleCount).toBe(0);
  });

  it('makes a terminal run immutable for later non-terminal events', () => {
    const applied = applyRunEvent(state(), cancelled(4));
    expect(applied.kind).toBe('applied');
    if (applied.kind !== 'applied') {
      return;
    }

    expect(applied.state.run.status).toBe('CANCELLED');
    expect(applied.state.run.reasonCode).toBe('USER_CANCELLED');

    const late = applyRunEvent(applied.state, measurement(5, 1, true));
    expect(late.kind).toBe('after-terminal');
    expect(late.state.run.status).toBe('CANCELLED');
  });
});

describe('mergeRunSnapshot', () => {
  it('never replaces a terminal status with a stale RUNNING snapshot', () => {
    const terminal = snapshot({
      status: 'CANCELLED',
      reasonCode: 'USER_CANCELLED',
      lastEventSequence: 8,
    });
    const merged = mergeRunSnapshot(terminal, snapshot({ lastEventSequence: 6 }));

    expect(merged).toBe(terminal);
  });

  it('preserves a recorded violation and unions measurements from a snapshot', () => {
    const live: RunSnapshot = {
      ...snapshot(),
      recordedSampleCount: 2,
      steps: [
        {
          ...STEP,
          status: 'RUNNING',
          recordedCount: 2,
          outOfToleranceCount: 1,
          firstFailureSampleIndex: 0,
          hasOutOfTolerance: true,
          measurements: [measurementRow(0, false), measurementRow(1, true)],
        },
      ],
    };

    const incoming = snapshot({
      lastEventSequence: 5,
      recordedSampleCount: 1,
      steps: [
        {
          ...STEP,
          recordedCount: 1,
          outcome: null,
          measurements: [measurementRow(0, false)],
        },
      ],
    });

    const merged = mergeRunSnapshot(live, incoming);

    expect(merged.recordedSampleCount).toBe(2);
    expect(merged.steps[0]?.hasOutOfTolerance).toBe(true);
    expect(merged.steps[0]?.firstFailureSampleIndex).toBe(0);
    expect(merged.steps[0]?.measurements).toHaveLength(2);
    expect(merged.lastEventSequence).toBe(5);
  });

  it('preserves a backend step outcome when a later partial snapshot has null', () => {
    const completed = snapshot({
      status: 'COMPLETED',
      outcome: 'FAILED',
      steps: [{ ...STEP, status: 'COMPLETED', outcome: 'FAILED' }],
    });
    const incoming = snapshot({
      status: 'COMPLETED',
      outcome: 'FAILED',
      steps: [{ ...STEP, status: 'COMPLETED', outcome: null }],
    });

    const merged = mergeRunSnapshot(completed, incoming);
    expect(merged.steps[0]?.outcome).toBe('FAILED');
  });
});

function measurementRow(sampleIndex: number, isWithinTolerance: boolean) {
  return {
    sampleIndex,
    value: isWithinTolerance ? '5.000000' : '5.500000',
    isWithinTolerance,
    recordedAt: `2026-11-03T10:00:0${sampleIndex + 1}.000Z`,
    elapsedMs: (sampleIndex + 1) * 500,
  };
}
