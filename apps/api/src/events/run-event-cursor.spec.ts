import { ValidationFailedException } from '../common/errors/validation.exception.js';
import {
  assertRunEventCursorWithinRun,
  parseRunEventCursor,
  type RunEventCursorInput,
} from './run-event-cursor.js';

function input(
  overrides: Partial<RunEventCursorInput> = {},
): RunEventCursorInput {
  return {
    lastEventId: undefined,
    after: undefined,
    queryKeys: [],
    ...overrides,
  };
}

function caught(operation: () => unknown): ValidationFailedException {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationFailedException);
    return error as ValidationFailedException;
  }

  throw new Error('Expected the cursor validation to fail.');
}

describe('run event cursor', () => {
  it('defaults to zero when neither a header nor a query value is present', () => {
    expect(parseRunEventCursor(input())).toEqual({ value: 0, source: 'query' });
  });

  it('parses a non-negative query sequence', () => {
    expect(
      parseRunEventCursor(input({ after: '42', queryKeys: ['after'] })),
    ).toEqual({ value: 42, source: 'query' });
  });

  it('gives Last-Event-ID precedence over after when the header is present', () => {
    expect(
      parseRunEventCursor(
        input({ lastEventId: '9', after: '2', queryKeys: ['after'] }),
      ),
    ).toEqual({ value: 9, source: 'header' });
  });

  it('uses a valid Last-Event-ID even when the ignored query value is malformed', () => {
    expect(
      parseRunEventCursor(
        input({ lastEventId: '4', after: 'not-a-number', queryKeys: ['after'] }),
      ),
    ).toEqual({ value: 4, source: 'header' });
  });

  it.each<{ after?: unknown; lastEventId?: unknown }>([
    { after: '-1' },
    { after: '+1' },
    { after: '1.5' },
    { after: ' 1' },
    { after: '1e3' },
    { after: '' },
    { after: ['1', '2'] },
    { lastEventId: 'bad', after: '1' },
    { lastEventId: '', after: '1' },
  ])('rejects a malformed cursor: %o', (candidate) => {
    const error = caught(() =>
      parseRunEventCursor(
        input({ ...candidate, queryKeys: ['after'] }),
      ),
    );

    expect(error.fieldErrors?.[0]).toMatchObject({
      path: candidate.lastEventId !== undefined ? 'Last-Event-ID' : 'after',
      code: 'INVALID_TYPE',
    });
  });

  it('rejects unknown query parameters with the common field-error shape', () => {
    const error = caught(() =>
      parseRunEventCursor(
        input({ after: '0', queryKeys: ['after', 'limit', 'limit'] }),
      ),
    );

    expect(error.fieldErrors).toEqual([
      expect.objectContaining({ path: 'limit', code: 'UNKNOWN_FIELD' }),
    ]);
  });

  it('rejects a cursor ahead of the run last event sequence', () => {
    const query = caught(() =>
      assertRunEventCursorWithinRun({ value: 5, source: 'query' }, 4),
    );
    expect(query.fieldErrors?.[0]).toMatchObject({
      path: 'after',
      code: 'INVALID_VALUE',
    });

    const header = caught(() =>
      assertRunEventCursorWithinRun({ value: 5, source: 'header' }, 4),
    );
    expect(header.fieldErrors?.[0]).toMatchObject({
      path: 'Last-Event-ID',
      code: 'INVALID_VALUE',
    });
  });

  it('accepts a cursor equal to the last event sequence', () => {
    expect(() =>
      assertRunEventCursorWithinRun({ value: 4, source: 'query' }, 4),
    ).not.toThrow();
  });
});
