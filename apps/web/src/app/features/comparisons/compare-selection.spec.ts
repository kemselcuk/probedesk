import { describe, expect, it } from 'vitest';
import type { RunHistoryItem } from '../runs/runs-api.types';
import {
  isTerminalStatus,
  runOptionLabel,
  runOptionState,
  validateCompareQuery,
  validateCompareSelection,
} from './compare-selection';

const PLAN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PLAN_ID = '22222222-2222-4222-8222-222222222222';
const LEFT_RUN_ID = '33333333-3333-4333-8333-333333333333';
const RIGHT_RUN_ID = '44444444-4444-4444-8444-444444444444';
const VERSION_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';

function run(overrides: Partial<RunHistoryItem> = {}): RunHistoryItem {
  return {
    id: LEFT_RUN_ID,
    planId: PLAN_ID,
    planVersionId: VERSION_ID,
    planName: 'Power rail verification',
    deviceId: null,
    deviceSnapshot: null,
    batchNumber: null,
    versionNumber: 3,
    scenario: 'NORMAL',
    seed: 42,
    status: 'COMPLETED',
    outcome: 'PASSED',
    startedAt: '2026-11-03T10:00:00.000Z',
    finishedAt: '2026-11-03T10:00:04.000Z',
    expectedSampleCount: 4,
    recordedSampleCount: 4,
    outOfToleranceCount: 0,
    firstFailure: null,
    partial: false,
    requestedBy: { id: USER_ID, email: 'viewer@probedesk.local', role: 'VIEWER' },
    ...overrides,
  };
}

describe('compare selection', () => {
  it('accepts two distinct terminal runs of the same plan and keeps selection order', () => {
    const left = run();
    const right = run({ id: RIGHT_RUN_ID, versionNumber: 4 });
    const result = validateCompareSelection([left, right]);

    expect(result.valid).toBe(true);
    expect(result.left?.id).toBe(LEFT_RUN_ID);
    expect(result.right?.id).toBe(RIGHT_RUN_ID);
    expect(result.reason).toBeNull();
  });

  it('rejects a running run, a different plan, and an incomplete pair', () => {
    expect(
      validateCompareSelection([
        run({ status: 'RUNNING', outcome: null }),
        run({ id: RIGHT_RUN_ID }),
      ]).reason,
    ).toContain('running run cannot be compared');

    expect(
      validateCompareSelection([
        run(),
        run({ id: RIGHT_RUN_ID, planId: OTHER_PLAN_ID }),
      ]).reason,
    ).toContain('same plan');

    expect(validateCompareSelection([run()]).reason).toContain('one more');
    expect(validateCompareSelection([]).reason).toContain('two terminal runs');
  });

  it('treats every status except RUNNING as terminal', () => {
    expect(isTerminalStatus('RUNNING')).toBe(false);
    expect(isTerminalStatus('COMPLETED')).toBe(true);
    expect(isTerminalStatus('CANCELLED')).toBe(true);
    expect(isTerminalStatus('INTERRUPTED')).toBe(true);
    expect(isTerminalStatus('ERROR')).toBe(true);
  });
});

describe('compare query validation', () => {
  it('opens a well-formed pair', () => {
    expect(validateCompareQuery(LEFT_RUN_ID, RIGHT_RUN_ID)).toEqual({
      kind: 'ready',
      leftRunId: LEFT_RUN_ID,
      rightRunId: RIGHT_RUN_ID,
    });
  });

  it('distinguishes an empty link from an incomplete or invalid one', () => {
    expect(validateCompareQuery('', '')).toEqual({ kind: 'empty' });
    expect(validateCompareQuery(LEFT_RUN_ID, '')).toMatchObject({ kind: 'invalid' });
    expect(validateCompareQuery('not-a-run', RIGHT_RUN_ID)).toMatchObject({
      kind: 'invalid',
    });
    expect(validateCompareQuery(LEFT_RUN_ID, LEFT_RUN_ID)).toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('run option labels', () => {
  it('shows version, plan, status, and UTC start time and marks running runs', () => {
    const terminal = run();
    const running = run({ id: RIGHT_RUN_ID, status: 'RUNNING', outcome: null });

    expect(runOptionLabel(terminal)).toContain('Version 3');
    expect(runOptionLabel(terminal)).toContain('Power rail verification');
    expect(runOptionLabel(terminal)).toContain('Passed');
    expect(runOptionLabel(terminal)).toContain('UTC');
    expect(runOptionState(terminal)).toBeNull();
    expect(runOptionState(running)).toContain('Running');
  });
});
