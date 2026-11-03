import { RunEventType } from '../prisma/generated/client.js';
import {
  formatRunEventFrame,
  HEARTBEAT_FRAME,
  isTerminalRunEventType,
  RUN_EVENT_WIRE_TYPE_NAMES,
  type StoredRunEvent,
} from './run-event-stream.js';

function storedEvent(
  overrides: Partial<StoredRunEvent> = {},
): StoredRunEvent {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    sequence: 7,
    type: RunEventType.MEASUREMENT_RECORDED,
    schemaVersion: 1,
    occurredAt: new Date('2026-11-03T12:00:00.000Z'),
    payload: { sampleIndex: 1, value: '5.000000' },
    ...overrides,
  };
}

describe('run event stream frames', () => {
  it('writes the run-local sequence as id and the documented wire name as event', () => {
    const frame = formatRunEventFrame(storedEvent());

    expect(frame.startsWith('id: 7\nevent: measurement.recorded\ndata: ')).toBe(
      true,
    );
    expect(frame.endsWith('\n\n')).toBe(true);

    const dataLine = frame
      .split('\n')
      .find((line) => line.startsWith('data: '));
    const envelope = JSON.parse((dataLine ?? '').slice('data: '.length)) as {
      schemaVersion: number;
      runId: string;
      sequence: number;
      occurredAt: string;
      payload: unknown;
    };

    expect(envelope).toEqual({
      schemaVersion: 1,
      runId: '11111111-1111-4111-8111-111111111111',
      sequence: 7,
      occurredAt: '2026-11-03T12:00:00.000Z',
      payload: { sampleIndex: 1, value: '5.000000' },
    });
  });

  it('keeps a payload newline escaped inside one data line', () => {
    const frame = formatRunEventFrame(
      storedEvent({ payload: { note: 'line one\nline two' } }),
    );
    const lines = frame.trimEnd().split('\n');

    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[2]!.slice('data: '.length))).toMatchObject({
      payload: { note: 'line one\nline two' },
    });
    expect(lines[2]).not.toContain('\n');
  });

  it('uses a comment-only heartbeat that consumes no sequence', () => {
    expect(HEARTBEAT_FRAME).toBe(': heartbeat\n\n');
    expect(HEARTBEAT_FRAME).not.toContain('id:');
    expect(HEARTBEAT_FRAME).not.toContain('event:');
    expect(HEARTBEAT_FRAME).not.toContain('data:');
  });

  it('marks exactly the four terminal event types', () => {
    expect(
      [
        RunEventType.RUN_COMPLETED,
        RunEventType.RUN_CANCELLED,
        RunEventType.RUN_INTERRUPTED,
        RunEventType.RUN_ERRORED,
      ].every(isTerminalRunEventType),
    ).toBe(true);
    expect(
      [
        RunEventType.RUN_STARTED,
        RunEventType.STEP_STARTED,
        RunEventType.MEASUREMENT_RECORDED,
        RunEventType.STEP_COMPLETED,
      ].some(isTerminalRunEventType),
    ).toBe(false);
  });

  it('documents all eight wire names in contract order', () => {
    expect(RUN_EVENT_WIRE_TYPE_NAMES).toEqual([
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
});
