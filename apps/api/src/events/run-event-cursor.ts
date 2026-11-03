import type { FieldError } from '../common/errors/field-error.js';
import { ValidationFailedException } from '../common/errors/validation.exception.js';

/**
 * Run event sequence is a PostgreSQL INTEGER and starts at 1. A cursor at zero
 * means "replay from the first committed event".
 */
export const MAX_RUN_EVENT_SEQUENCE = 2_147_483_647;

const NON_NEGATIVE_INTEGER = /^\d+$/;

export type RunEventCursorSource = 'query' | 'header';

export interface ParsedRunEventCursor {
  readonly value: number;
  readonly source: RunEventCursorSource;
}

export interface RunEventCursorInput {
  /** Raw Last-Event-ID header. It wins over the query value when present. */
  readonly lastEventId: unknown;
  /** Raw `after` query value; Express may also produce an array for repeats. */
  readonly after: unknown;
  /** Raw query keys, used to reject parameters outside the contract. */
  readonly queryKeys: readonly string[];
}

/**
 * Validates the SSE cursor before any response headers are written.
 *
 * The Last-Event-ID header takes precedence over `?after=` whenever it is
 * present, including when it is empty or malformed. Unknown query parameters
 * are rejected with the same field-error shape as other validation failures.
 */
export function parseRunEventCursor(
  input: RunEventCursorInput,
): ParsedRunEventCursor {
  const unknownKeys = [...new Set(input.queryKeys)].filter(
    (key) => key !== 'after',
  );

  if (unknownKeys.length > 0) {
    throw new ValidationFailedException(
      unknownKeys.map<FieldError>((key) => ({
        path: key,
        code: 'UNKNOWN_FIELD',
        message: `Query parameter "${key}" is not supported.`,
      })),
    );
  }

  const source: RunEventCursorSource =
    input.lastEventId !== undefined ? 'header' : 'query';
  const raw = source === 'header' ? input.lastEventId : input.after;

  if (raw === undefined) {
    return { value: 0, source: 'query' };
  }

  if (typeof raw !== 'string' || !NON_NEGATIVE_INTEGER.test(raw)) {
    throw cursorError(
      source,
      'INVALID_TYPE',
      'The event cursor must be a non-negative integer.',
    );
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_RUN_EVENT_SEQUENCE) {
    throw cursorError(
      source,
      'INVALID_VALUE',
      'The event cursor is outside the supported sequence range.',
    );
  }

  return { value, source };
}

/**
 * A cursor may not point past the last committed event of this run; that state
 * usually means the client mixed up runs or invented a future sequence.
 */
export function assertRunEventCursorWithinRun(
  cursor: ParsedRunEventCursor,
  lastEventSequence: number,
): void {
  if (cursor.value > lastEventSequence) {
    throw cursorError(
      cursor.source,
      'INVALID_VALUE',
      'The event cursor must not exceed the run last event sequence.',
    );
  }
}

function cursorError(
  source: RunEventCursorSource,
  code: string,
  message: string,
): ValidationFailedException {
  return new ValidationFailedException([
    {
      path: source === 'header' ? 'Last-Event-ID' : 'after',
      code,
      message,
    },
  ]);
}
