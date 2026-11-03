import { describe, expect, it } from 'vitest';
import {
  RUN_EVENT_TYPES,
  parseRunEventEnvelope,
} from './run-event.types';

const RUN_ID = '33333333-3333-4333-8333-333333333333';

const MEASUREMENT = {
  stepId: '44444444-4444-4444-8444-444444444444',
  logicalStepId: '55555555-5555-4555-8555-555555555555',
  position: 1,
  sampleIndex: 0,
  value: '5.000000',
  isWithinTolerance: true,
  recordedAt: '2026-11-03T10:00:01.000Z',
  elapsedMs: 500,
  recordedCount: 1,
  outOfToleranceCount: 0,
  firstFailureSampleIndex: null,
  hasOutOfTolerance: false,
  recordedSampleCount: 1,
  expectedSampleCount: 4,
};

function envelope(
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    schemaVersion: 1,
    runId: RUN_ID,
    sequence: 4,
    occurredAt: '2026-11-03T10:00:01.000Z',
    payload: MEASUREMENT,
    ...overrides,
  });
}

describe('parseRunEventEnvelope', () => {
  it('exposes exactly the eight documented event names', () => {
    expect(RUN_EVENT_TYPES).toEqual([
      'run.started',
      'step.started',
      'measurement.recorded',
      'step.completed',
      'run.completed',
      'run.cancelled',
      'run.interrupted',
      'run.errored',
    ]);
  });

  it('parses a measurement envelope and validates the SSE id against the sequence', () => {
    const parsed = parseRunEventEnvelope(
      'measurement.recorded',
      envelope(),
      '4',
    );

    expect(parsed.type).toBe('measurement.recorded');
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.runId).toBe(RUN_ID);
    expect(parsed.sequence).toBe(4);
    if (parsed.type !== 'measurement.recorded') {
      throw new Error('Expected a measurement event.');
    }
    expect(parsed.payload.sampleIndex).toBe(0);
    expect(parsed.payload.isWithinTolerance).toBe(true);
  });

  it.each([
    ['unknown event name', 'run.paused', envelope(), '4'],
    ['bad JSON', 'measurement.recorded', '{oops', '4'],
    ['wrong schema version', 'measurement.recorded', envelope({ schemaVersion: 2 }), '4'],
    ['non-UUID run id', 'measurement.recorded', envelope({ runId: 'run-1' }), '4'],
    ['string sequence', 'measurement.recorded', envelope({ sequence: '4' }), '4'],
    ['zero sequence', 'measurement.recorded', envelope({ sequence: 0 }), '0'],
    ['SSE id mismatch', 'measurement.recorded', envelope(), '5'],
    [
      'missing tolerance flag',
      'measurement.recorded',
      envelope({
        payload: { ...MEASUREMENT, isWithinTolerance: undefined },
      }),
      '4',
    ],
    [
      'invalid date',
      'measurement.recorded',
      envelope({ occurredAt: 'not-a-date' }),
      '4',
    ],
  ])('rejects %s', (_label, type, data, lastEventId) => {
    expect(() => parseRunEventEnvelope(type, data, lastEventId)).toThrow(
      /run event|JSON|schemaVersion|UUID|integer|SSE id|boolean|ISO-8601/i,
    );
  });
});
