import { describe, expect, it } from 'vitest';
import type { RunSnapshot, RunStatus } from './runs-api.types';
import { isPartialResult, isStoppedAfterAllSamples } from './run-status';

function snapshot(status: RunStatus, recorded: number, expected: number): RunSnapshot {
  return {
    status,
    recordedSampleCount: recorded,
    expectedSampleCount: expected,
  } as RunSnapshot;
}

describe('isPartialResult', () => {
  it('treats a running snapshot as provisional, not partial', () => {
    expect(isPartialResult(snapshot('RUNNING', 1, 4))).toBe(false);
  });

  it.each(['CANCELLED', 'INTERRUPTED', 'ERROR'] as const)(
    'reports %s only when fewer samples were recorded than expected',
    (status) => {
      expect(isPartialResult(snapshot(status, 1, 4))).toBe(true);
      expect(isPartialResult(snapshot(status, 4, 4))).toBe(false);
    },
  );

  it('reports a completed run with missing samples as partial', () => {
    expect(isPartialResult(snapshot('COMPLETED', 3, 4))).toBe(true);
    expect(isPartialResult(snapshot('COMPLETED', 4, 4))).toBe(false);
  });
});

describe('isStoppedAfterAllSamples', () => {
  it.each(['CANCELLED', 'INTERRUPTED', 'ERROR'] as const)(
    'is true for a fully recorded %s run',
    (status) => {
      expect(isStoppedAfterAllSamples(snapshot(status, 4, 4))).toBe(true);
    },
  );

  it('is false while the run is still running or still missing samples', () => {
    expect(isStoppedAfterAllSamples(snapshot('RUNNING', 4, 4))).toBe(false);
    expect(isStoppedAfterAllSamples(snapshot('CANCELLED', 1, 4))).toBe(false);
    expect(isStoppedAfterAllSamples(snapshot('COMPLETED', 4, 4))).toBe(false);
  });
});
