/**
 * Authoritative frontend type source for the run SSE contract.
 *
 * The REST DTOs come from the generated OpenAPI client. SSE envelopes are not
 * generated yet (see docs/api.md#sse-protokolü), so this file is the single
 * hand-written copy of the documented wire schema. Keep it in sync with the
 * backend event writer; do not add a second model in the features.
 *
 * Wire shape:
 *   GET /api/runs/:id/events?after=<sequence>
 *   id:    <sequence>
 *   event: run.started | step.started | measurement.recorded | step.completed |
 *          run.completed | run.cancelled | run.interrupted | run.errored
 *   data:  { schemaVersion: 1, runId, sequence, occurredAt, payload }
 *
 * The transport validates this file's fields before anything reaches the
 * reducer. Payload parsers deliberately ignore unknown extra members so the
 * backend can add fields without breaking older clients.
 */

export const RUN_EVENT_TYPES = [
  'run.started',
  'step.started',
  'measurement.recorded',
  'step.completed',
  'run.completed',
  'run.cancelled',
  'run.interrupted',
  'run.errored',
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** Event payload statuses use the same uppercase wire values as the REST DTOs. */
export type RunEventRunStatus =
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'ERROR';

export type RunEventStepStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'INTERRUPTED'
  | 'ERROR'
  | 'NOT_RUN';

export type RunEventOutcome = 'PASSED' | 'FAILED';

export type RunEventScenario = 'NORMAL' | 'FORCED_FAILURE' | 'RANDOM';

/** Stored step statistics carried by step.completed. Nulls stay null. */
export interface RunEventStepStatistics {
  readonly minimum: string | null;
  readonly maximum: string | null;
  readonly average: string | null;
  readonly sampleCount: number | null;
}

export interface RunStartedPayload {
  readonly status: 'RUNNING';
  readonly planId: string;
  readonly planVersionId: string;
  readonly planName: string;
  readonly versionNumber: number;
  readonly scenario: RunEventScenario;
  readonly expectedSampleCount: number;
  readonly stepCount: number;
}

export interface StepStartedPayload {
  readonly stepId: string;
  readonly logicalStepId: string;
  readonly position: number;
  readonly name: string;
  readonly unit: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly sampleCount: number;
  readonly intervalMs: number;
  readonly status: 'RUNNING';
  readonly startedAt: string;
  readonly recordedSampleCount: number;
  readonly expectedSampleCount: number;
}

export interface MeasurementRecordedPayload {
  readonly stepId: string;
  readonly logicalStepId: string;
  readonly position: number;
  readonly sampleIndex: number;
  readonly value: string;
  readonly isWithinTolerance: boolean;
  readonly recordedAt: string;
  readonly elapsedMs: number;
  readonly recordedCount: number;
  readonly outOfToleranceCount: number;
  readonly firstFailureSampleIndex: number | null;
  readonly hasOutOfTolerance: boolean;
  readonly recordedSampleCount: number;
  readonly expectedSampleCount: number;
}

export interface StepCompletedPayload {
  readonly stepId: string;
  readonly logicalStepId: string;
  readonly position: number;
  readonly status: 'COMPLETED';
  readonly outcome: RunEventOutcome;
  readonly recordedCount: number;
  readonly outOfToleranceCount: number;
  readonly firstFailureSampleIndex: number | null;
  readonly hasOutOfTolerance: boolean;
  readonly statistics: RunEventStepStatistics;
  readonly startedAt: string | null;
  readonly finishedAt: string;
  readonly recordedSampleCount: number;
  readonly expectedSampleCount: number;
}

export interface RunCompletedPayload {
  readonly status: 'COMPLETED';
  readonly outcome: RunEventOutcome;
  readonly recordedSampleCount: number;
  readonly expectedSampleCount: number;
  readonly stepCount: number;
  readonly passedStepCount: number;
  readonly failedStepCount: number;
  readonly finishedAt: string;
}

export interface RunCancelledPayload {
  readonly status: 'CANCELLED';
  readonly reasonCode: string;
  readonly cancelledById: string | null;
  readonly recordedSampleCount: number;
  readonly expectedSampleCount: number;
  readonly cancelledStepCount: number;
  readonly notRunStepCount: number;
  readonly finishedAt: string;
}

export interface RunInterruptedPayload {
  readonly status: 'INTERRUPTED';
  readonly reasonCode: string;
  readonly recordedSampleCount: number;
  readonly expectedSampleCount: number;
  readonly interruptedStepCount: number;
  readonly notRunStepCount: number;
  readonly finishedAt: string;
}

export interface RunErroredPayload {
  readonly status: 'ERROR';
  readonly reasonCode: string;
  readonly recordedSampleCount: number;
  readonly expectedSampleCount: number;
  readonly finishedAt: string;
}

export interface RunEventPayloadByType {
  readonly 'run.started': RunStartedPayload;
  readonly 'step.started': StepStartedPayload;
  readonly 'measurement.recorded': MeasurementRecordedPayload;
  readonly 'step.completed': StepCompletedPayload;
  readonly 'run.completed': RunCompletedPayload;
  readonly 'run.cancelled': RunCancelledPayload;
  readonly 'run.interrupted': RunInterruptedPayload;
  readonly 'run.errored': RunErroredPayload;
}

interface RunEventEnvelopeBase<TType extends RunEventType> {
  readonly type: TType;
  readonly schemaVersion: 1;
  readonly runId: string;
  /** Per-run, strictly increasing and gap-free sequence. Also the SSE `id`. */
  readonly sequence: number;
  readonly occurredAt: string;
  readonly payload: RunEventPayloadByType[TType];
}

export type RunEventEnvelope = {
  readonly [TType in RunEventType]: RunEventEnvelopeBase<TType>;
}[RunEventType];

export type TerminalRunEventType =
  | 'run.completed'
  | 'run.cancelled'
  | 'run.interrupted'
  | 'run.errored';

export function isTerminalRunEventType(type: RunEventType): type is TerminalRunEventType {
  return (
    type === 'run.completed' ||
    type === 'run.cancelled' ||
    type === 'run.interrupted' ||
    type === 'run.errored'
  );
}

/**
 * Thrown when the server sent an event that does not match the documented
 * schema. The transport turns it into a controlled stream error; it never
 * reaches a component as an uncaught exception.
 */
export class MalformedRunEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedRunEventError';
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses one SSE message into a typed envelope.
 *
 * `eventType` is the SSE `event:` name and `lastEventId` is the SSE `id:`
 * field. The latter must equal the envelope sequence when the server sends it.
 */
export function parseRunEventEnvelope(
  eventType: string,
  data: string,
  lastEventId: string,
): RunEventEnvelope {
  if (!isRunEventType(eventType)) {
    throw new MalformedRunEventError(`Unknown run event type "${eventType}".`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    throw new MalformedRunEventError('The run event data is not valid JSON.');
  }

  const record = requireRecord(raw, 'data');
  if (record['schemaVersion'] !== 1) {
    throw new MalformedRunEventError('The run event schemaVersion is not 1.');
  }

  const runId = requireUuid(record, 'runId', 'data');
  const sequence = requireInteger(record, 'sequence', 'data', 1);
  const occurredAt = requireDate(record, 'occurredAt', 'data');

  if (lastEventId.length > 0 && lastEventId !== String(sequence)) {
    throw new MalformedRunEventError(
      'The SSE id does not match the envelope sequence.',
    );
  }

  const payload = parsePayload(eventType, record['payload']);

  return {
    type: eventType,
    schemaVersion: 1,
    runId,
    sequence,
    occurredAt,
    payload,
  } as RunEventEnvelope;
}

function isRunEventType(value: string): value is RunEventType {
  return (RUN_EVENT_TYPES as readonly string[]).includes(value);
}

function parsePayload(
  type: RunEventType,
  value: unknown,
): RunEventPayloadByType[RunEventType] {
  const payload = requireRecord(value, 'payload');

  switch (type) {
    case 'run.started':
      return {
        status: requireLiteral(payload['status'], 'RUNNING', 'payload.status'),
        planId: requireUuid(payload, 'planId', 'payload'),
        planVersionId: requireUuid(payload, 'planVersionId', 'payload'),
        planName: requireNonEmptyString(payload, 'planName', 'payload'),
        versionNumber: requireInteger(payload, 'versionNumber', 'payload', 1),
        scenario: requireEnum(
          payload['scenario'],
          ['NORMAL', 'FORCED_FAILURE', 'RANDOM'] as const,
          'payload.scenario',
        ),
        expectedSampleCount: requireInteger(
          payload,
          'expectedSampleCount',
          'payload',
          0,
        ),
        stepCount: requireInteger(payload, 'stepCount', 'payload', 0),
      };
    case 'step.started':
      return {
        stepId: requireUuid(payload, 'stepId', 'payload'),
        logicalStepId: requireUuid(payload, 'logicalStepId', 'payload'),
        position: requireInteger(payload, 'position', 'payload', 1),
        name: requireNonEmptyString(payload, 'name', 'payload'),
        unit: requireNonEmptyString(payload, 'unit', 'payload'),
        minimum: requireDecimalString(payload, 'minimum'),
        maximum: requireDecimalString(payload, 'maximum'),
        sampleCount: requireInteger(payload, 'sampleCount', 'payload', 1),
        intervalMs: requireInteger(payload, 'intervalMs', 'payload', 1),
        status: requireLiteral(payload['status'], 'RUNNING', 'payload.status'),
        startedAt: requireDate(payload, 'startedAt', 'payload'),
        recordedSampleCount: requireInteger(
          payload,
          'recordedSampleCount',
          'payload',
          0,
        ),
        expectedSampleCount: requireInteger(
          payload,
          'expectedSampleCount',
          'payload',
          0,
        ),
      };
    case 'measurement.recorded':
      return {
        stepId: requireUuid(payload, 'stepId', 'payload'),
        logicalStepId: requireUuid(payload, 'logicalStepId', 'payload'),
        position: requireInteger(payload, 'position', 'payload', 1),
        sampleIndex: requireInteger(payload, 'sampleIndex', 'payload', 0),
        value: requireDecimalString(payload, 'value'),
        isWithinTolerance: requireBoolean(payload, 'isWithinTolerance', 'payload'),
        recordedAt: requireDate(payload, 'recordedAt', 'payload'),
        elapsedMs: requireInteger(payload, 'elapsedMs', 'payload', 0),
        recordedCount: requireInteger(payload, 'recordedCount', 'payload', 1),
        outOfToleranceCount: requireInteger(
          payload,
          'outOfToleranceCount',
          'payload',
          0,
        ),
        firstFailureSampleIndex: requireNullableInteger(
          payload,
          'firstFailureSampleIndex',
          'payload',
          0,
        ),
        hasOutOfTolerance: requireBoolean(payload, 'hasOutOfTolerance', 'payload'),
        recordedSampleCount: requireInteger(
          payload,
          'recordedSampleCount',
          'payload',
          0,
        ),
        expectedSampleCount: requireInteger(
          payload,
          'expectedSampleCount',
          'payload',
          0,
        ),
      };
    case 'step.completed':
      return {
        stepId: requireUuid(payload, 'stepId', 'payload'),
        logicalStepId: requireUuid(payload, 'logicalStepId', 'payload'),
        position: requireInteger(payload, 'position', 'payload', 1),
        status: requireLiteral(
          payload['status'],
          'COMPLETED',
          'payload.status',
        ),
        outcome: requireEnum(
          payload['outcome'],
          ['PASSED', 'FAILED'] as const,
          'payload.outcome',
        ),
        recordedCount: requireInteger(payload, 'recordedCount', 'payload', 1),
        outOfToleranceCount: requireInteger(
          payload,
          'outOfToleranceCount',
          'payload',
          0,
        ),
        firstFailureSampleIndex: requireNullableInteger(
          payload,
          'firstFailureSampleIndex',
          'payload',
          0,
        ),
        hasOutOfTolerance: requireBoolean(payload, 'hasOutOfTolerance', 'payload'),
        statistics: parseStatistics(payload['statistics']),
        startedAt: requireNullableDate(payload, 'startedAt', 'payload'),
        finishedAt: requireDate(payload, 'finishedAt', 'payload'),
        recordedSampleCount: requireInteger(
          payload,
          'recordedSampleCount',
          'payload',
          0,
        ),
        expectedSampleCount: requireInteger(
          payload,
          'expectedSampleCount',
          'payload',
          0,
        ),
      };
    case 'run.completed':
      return {
        status: requireLiteral(
          payload['status'],
          'COMPLETED',
          'payload.status',
        ),
        outcome: requireEnum(
          payload['outcome'],
          ['PASSED', 'FAILED'] as const,
          'payload.outcome',
        ),
        recordedSampleCount: requireInteger(
          payload,
          'recordedSampleCount',
          'payload',
          0,
        ),
        expectedSampleCount: requireInteger(
          payload,
          'expectedSampleCount',
          'payload',
          0,
        ),
        stepCount: requireInteger(payload, 'stepCount', 'payload', 0),
        passedStepCount: requireInteger(
          payload,
          'passedStepCount',
          'payload',
          0,
        ),
        failedStepCount: requireInteger(
          payload,
          'failedStepCount',
          'payload',
          0,
        ),
        finishedAt: requireDate(payload, 'finishedAt', 'payload'),
      };
    case 'run.cancelled':
      return {
        status: requireLiteral(
          payload['status'],
          'CANCELLED',
          'payload.status',
        ),
        reasonCode: requireNonEmptyString(payload, 'reasonCode', 'payload'),
        cancelledById: requireNullableUuid(payload, 'cancelledById', 'payload'),
        recordedSampleCount: requireInteger(
          payload,
          'recordedSampleCount',
          'payload',
          0,
        ),
        expectedSampleCount: requireInteger(
          payload,
          'expectedSampleCount',
          'payload',
          0,
        ),
        cancelledStepCount: requireInteger(
          payload,
          'cancelledStepCount',
          'payload',
          0,
        ),
        notRunStepCount: requireInteger(
          payload,
          'notRunStepCount',
          'payload',
          0,
        ),
        finishedAt: requireDate(payload, 'finishedAt', 'payload'),
      };
    case 'run.interrupted':
      return {
        status: requireLiteral(
          payload['status'],
          'INTERRUPTED',
          'payload.status',
        ),
        reasonCode: requireNonEmptyString(payload, 'reasonCode', 'payload'),
        recordedSampleCount: requireInteger(
          payload,
          'recordedSampleCount',
          'payload',
          0,
        ),
        expectedSampleCount: requireInteger(
          payload,
          'expectedSampleCount',
          'payload',
          0,
        ),
        interruptedStepCount: requireInteger(
          payload,
          'interruptedStepCount',
          'payload',
          0,
        ),
        notRunStepCount: requireInteger(
          payload,
          'notRunStepCount',
          'payload',
          0,
        ),
        finishedAt: requireDate(payload, 'finishedAt', 'payload'),
      };
    case 'run.errored':
      return {
        status: requireLiteral(payload['status'], 'ERROR', 'payload.status'),
        reasonCode: requireNonEmptyString(payload, 'reasonCode', 'payload'),
        recordedSampleCount: requireInteger(
          payload,
          'recordedSampleCount',
          'payload',
          0,
        ),
        expectedSampleCount: requireInteger(
          payload,
          'expectedSampleCount',
          'payload',
          0,
        ),
        finishedAt: requireDate(payload, 'finishedAt', 'payload'),
      };
  }
}

function parseStatistics(value: unknown): RunEventStepStatistics {
  const record = requireRecord(value, 'payload.statistics');

  return {
    minimum: requireNullableString(record, 'minimum', 'payload.statistics'),
    maximum: requireNullableString(record, 'maximum', 'payload.statistics'),
    average: requireNullableString(record, 'average', 'payload.statistics'),
    sampleCount: requireNullableInteger(
      record,
      'sampleCount',
      'payload.statistics',
      0,
    ),
  };
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedRunEventError(`${label} is not an object.`);
  }

  return value as Record<string, unknown>;
}

function requireLiteral<T extends string>(
  value: unknown,
  expected: T,
  label: string,
): T {
  if (value !== expected) {
    throw new MalformedRunEventError(`${label} is not "${expected}".`);
  }

  return expected;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T;
  }

  throw new MalformedRunEventError(
    `${label} is not one of ${allowed.join(', ')}.`,
  );
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new MalformedRunEventError(`${label}.${key} is not a non-empty string.`);
  }

  return value;
}

function requireNullableString(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  if (!Object.hasOwn(record, key)) {
    throw new MalformedRunEventError(`${label}.${key} is missing.`);
  }

  const value = record[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new MalformedRunEventError(`${label}.${key} is not a string or null.`);
  }

  return value;
}

function requireUuid(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = requireNonEmptyString(record, key, label);
  if (!UUID_PATTERN.test(value)) {
    throw new MalformedRunEventError(`${label}.${key} is not a UUID.`);
  }

  return value;
}

function requireNullableUuid(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = requireNullableString(record, key, label);
  if (value !== null && !UUID_PATTERN.test(value)) {
    throw new MalformedRunEventError(`${label}.${key} is not a UUID or null.`);
  }

  return value;
}

function requireInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
): number {
  const value = record[key];
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min
  ) {
    throw new MalformedRunEventError(
      `${label}.${key} is not an integer greater than or equal to ${min}.`,
    );
  }

  return value;
}

function requireNullableInteger(
  record: Record<string, unknown>,
  key: string,
  label: string,
  min: number,
): number | null {
  if (!Object.hasOwn(record, key)) {
    throw new MalformedRunEventError(`${label}.${key} is missing.`);
  }

  const value = record[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new MalformedRunEventError(
      `${label}.${key} is not a non-negative integer or null.`,
    );
  }

  return value;
}

function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  label: string,
): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new MalformedRunEventError(`${label}.${key} is not a boolean.`);
  }

  return value;
}

function requireDecimalString(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  if (
    typeof value !== 'string' ||
    !/^-?\d+(?:\.\d+)?$/.test(value)
  ) {
    throw new MalformedRunEventError(
      `payload.${key} is not a decimal string.`,
    );
  }

  return value;
}

function requireDate(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = requireNonEmptyString(record, key, label);
  if (Number.isNaN(Date.parse(value))) {
    throw new MalformedRunEventError(`${label}.${key} is not an ISO-8601 date.`);
  }

  return value;
}

function requireNullableDate(
  record: Record<string, unknown>,
  key: string,
  label: string,
): string | null {
  const value = requireNullableString(record, key, label);
  if (value !== null && Number.isNaN(Date.parse(value))) {
    throw new MalformedRunEventError(
      `${label}.${key} is not an ISO-8601 date or null.`,
    );
  }

  return value;
}
