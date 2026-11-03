import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import type {
  RunHistoryFirstFailure,
  RunHistoryItem,
  RunHistoryPage,
  RunHistoryQuery,
  RunMeasurement,
  RunOutcome,
  RunSnapshot,
  RunSnapshotStep,
  RunStartResponse,
  RunStatus,
  RunStepStatistics,
  RunStepStatus,
  StartRunRequest,
} from './runs-api.types';

const RUN_STATUSES: readonly RunStatus[] = [
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
  'INTERRUPTED',
  'ERROR',
];

const RUN_OUTCOMES: readonly Exclude<RunOutcome, null>[] = ['PASSED', 'FAILED'];

const RUN_STEP_STATUSES: readonly RunStepStatus[] = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'CANCELLED',
  'INTERRUPTED',
  'ERROR',
  'NOT_RUN',
];

const RUN_SCENARIOS: readonly RunSnapshot['scenario'][] = [
  'NORMAL',
  'FORCED_FAILURE',
  'RANDOM',
];

const ROLES: readonly RunSnapshot['requestedBy']['role'][] = [
  'PLANNER',
  'OPERATOR',
  'VIEWER',
];

const MAX_SEED = 4_294_967_295;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Typed boundary for the run endpoints.
 *
 * The Idempotency-Key belongs to one logical user action; the caller decides
 * when to reuse it. A successful response is validated against the generated
 * schema before the screen navigates, so a missing run id can never become a
 * guessed success URL. A snapshot is never completed with a default: a missing
 * required field raises `MalformedApiResponseError` instead of showing a zero
 * or an invented verdict.
 */
@Injectable({ providedIn: 'root' })
export class RunsApi {
  private readonly http = inject(HttpClient);

  startRun(request: StartRunRequest, idempotencyKey: string): Observable<RunStartResponse> {
    const endpoint = 'POST /api/runs';
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });

    return this.http
      .post<unknown>('/api/runs', request, { headers })
      .pipe(map((value) => parseRunStartResponse(value, endpoint)));
  }

  getRun(runId: string): Observable<RunSnapshot> {
    const endpoint = `GET /api/runs/${runId}`;
    return this.http
      .get<unknown>(`/api/runs/${encodeURIComponent(runId)}`)
      .pipe(map((value) => parseRunSnapshot(value, endpoint)));
  }

  /**
   * Reads one page of run history. Only summary counters are requested and
   * parsed; the response is never completed with measurements or defaults.
   */
  listRuns(query: RunHistoryQuery): Observable<RunHistoryPage> {
    const endpoint = 'GET /api/runs';
    return this.http
      .get<unknown>('/api/runs', { params: buildHistoryParams(query) })
      .pipe(map((value) => parseRunHistoryPage(value, endpoint)));
  }

  /**
   * Cancels a running run. The API answers 200 with the stored snapshot for a
   * running run and with the existing terminal snapshot for an already
   * terminal one, so the screen always adopts the server state.
   */
  cancelRun(runId: string): Observable<RunSnapshot> {
    const endpoint = `POST /api/runs/${runId}/cancel`;
    return this.http
      .post<unknown>(`/api/runs/${encodeURIComponent(runId)}/cancel`, null)
      .pipe(map((value) => parseRunSnapshot(value, endpoint)));
  }
}

function parseRunStartResponse(value: unknown, endpoint: string): RunStartResponse {
  const record = requireRecord(value, endpoint, 'response');
  const runId = requireString(record, 'runId', endpoint, 'response');
  if (!UUID_PATTERN.test(runId)) {
    throw new MalformedApiResponseError(endpoint, 'runId is not a UUID.');
  }

  return {
    runId,
    status: parseStatus(record['status'], endpoint),
    outcome: parseOutcome(record['outcome'], endpoint),
    snapshotUrl: requireNonEmptyString(record, 'snapshotUrl', endpoint, 'response'),
    eventsUrl: requireNonEmptyString(record, 'eventsUrl', endpoint, 'response'),
  };
}

function buildHistoryParams(query: RunHistoryQuery): HttpParams {
  let params = new HttpParams();

  if (query.planId !== undefined && query.planId.length > 0) {
    params = params.set('planId', query.planId);
  }

  if (query.status !== undefined) {
    params = params.set('status', query.status);
  }

  if (query.outcome !== undefined) {
    params = params.set('outcome', query.outcome);
  }

  if (query.from !== undefined && query.from.length > 0) {
    params = params.set('from', query.from);
  }

  if (query.to !== undefined && query.to.length > 0) {
    params = params.set('to', query.to);
  }

  return params.set('page', String(query.page)).set('limit', String(query.limit));
}

function parseRunHistoryPage(value: unknown, endpoint: string): RunHistoryPage {
  const record = requireRecord(value, endpoint, 'history page');
  const items = requireArray(record, 'items', endpoint, 'history page').map((entry, index) =>
    parseRunHistoryItem(entry, endpoint, `history page.items[${index}]`),
  );

  return {
    items,
    page: requireInteger(record, 'page', endpoint, 'history page', 1),
    limit: requireInteger(record, 'limit', endpoint, 'history page', 1),
    total: requireInteger(record, 'total', endpoint, 'history page', 0),
    totalPages: requireInteger(record, 'totalPages', endpoint, 'history page', 0),
  };
}

function parseRunHistoryItem(
  value: unknown,
  endpoint: string,
  label: string,
): RunHistoryItem {
  const record = requireRecord(value, endpoint, label);

  return {
    id: requireUuid(record, 'id', endpoint, label),
    planId: requireUuid(record, 'planId', endpoint, label),
    planVersionId: requireUuid(record, 'planVersionId', endpoint, label),
    planName: requireString(record, 'planName', endpoint, label),
    versionNumber: requireInteger(record, 'versionNumber', endpoint, label, 1),
    status: parseStatus(record['status'], endpoint),
    outcome: parseOutcome(record['outcome'], endpoint),
    scenario: requireEnum(record['scenario'], RUN_SCENARIOS, endpoint, `${label}.scenario`),
    seed: requireInteger(record, 'seed', endpoint, label, 0, MAX_SEED),
    startedAt: requireDate(record, 'startedAt', endpoint, label),
    finishedAt: requireNullableDate(record, 'finishedAt', endpoint, label),
    expectedSampleCount: requireInteger(
      record,
      'expectedSampleCount',
      endpoint,
      label,
      1,
      10_000,
    ),
    recordedSampleCount: requireInteger(
      record,
      'recordedSampleCount',
      endpoint,
      label,
      0,
      10_000,
    ),
    outOfToleranceCount: requireInteger(
      record,
      'outOfToleranceCount',
      endpoint,
      label,
      0,
      10_000,
    ),
    firstFailure: parseRunHistoryFirstFailure(
      record['firstFailure'],
      endpoint,
      `${label}.firstFailure`,
    ),
    partial: requireBoolean(record, 'partial', endpoint, label),
    requestedBy: parseRequestedBy(record['requestedBy'], endpoint),
  };
}

function parseRunHistoryFirstFailure(
  value: unknown,
  endpoint: string,
  label: string,
): RunHistoryFirstFailure | null {
  if (value === null) {
    return null;
  }

  const record = requireRecord(value, endpoint, label);

  return {
    stepPosition: requireInteger(record, 'stepPosition', endpoint, label, 1),
    stepName: requireString(record, 'stepName', endpoint, label),
    logicalStepId: requireUuid(record, 'logicalStepId', endpoint, label),
    sampleIndex: requireInteger(record, 'sampleIndex', endpoint, label, 0),
  };
}

function parseRunSnapshot(value: unknown, endpoint: string): RunSnapshot {
  const record = requireRecord(value, endpoint, 'run');

  const steps = requireArray(record, 'steps', endpoint, 'run').map((entry, index) =>
    parseRunSnapshotStep(entry, endpoint, index),
  );

  return {
    id: requireUuid(record, 'id', endpoint, 'run'),
    planId: requireUuid(record, 'planId', endpoint, 'run'),
    planVersionId: requireUuid(record, 'planVersionId', endpoint, 'run'),
    planName: requireString(record, 'planName', endpoint, 'run'),
    versionNumber: requireInteger(record, 'versionNumber', endpoint, 'run', 1),
    profile: parseProfile(record['profile'], endpoint, 'run.profile'),
    scenario: requireEnum(record['scenario'], RUN_SCENARIOS, endpoint, 'run.scenario'),
    seed: requireInteger(record, 'seed', endpoint, 'run', 0, MAX_SEED),
    errorProbability: requireNullableString(record, 'errorProbability', endpoint, 'run'),
    failureStepId: requireNullableUuid(record, 'failureStepId', endpoint, 'run'),
    simulatorVersion: requireNonEmptyString(record, 'simulatorVersion', endpoint, 'run'),
    evaluationVersion: requireNonEmptyString(record, 'evaluationVersion', endpoint, 'run'),
    status: parseStatus(record['status'], endpoint),
    outcome: parseOutcome(record['outcome'], endpoint),
    startedAt: requireDate(record, 'startedAt', endpoint, 'run'),
    finishedAt: requireNullableDate(record, 'finishedAt', endpoint, 'run'),
    requestedBy: parseRequestedBy(record['requestedBy'], endpoint),
    reasonCode: requireNullableString(record, 'reasonCode', endpoint, 'run'),
    expectedSampleCount: requireInteger(record, 'expectedSampleCount', endpoint, 'run', 0),
    recordedSampleCount: requireInteger(record, 'recordedSampleCount', endpoint, 'run', 0),
    lastEventSequence: requireInteger(record, 'lastEventSequence', endpoint, 'run', 0),
    steps,
  };
}

function parseRunSnapshotStep(
  value: unknown,
  endpoint: string,
  index: number,
): RunSnapshotStep {
  const label = `run.steps[${index}]`;
  const record = requireRecord(value, endpoint, label);
  const measurements = requireArray(record, 'measurements', endpoint, label).map(
    (entry, measurementIndex) =>
      parseMeasurement(entry, endpoint, `${label}.measurements[${measurementIndex}]`),
  );

  return {
    runStepId: requireUuid(record, 'runStepId', endpoint, label),
    logicalStepId: requireUuid(record, 'logicalStepId', endpoint, label),
    position: requireInteger(record, 'position', endpoint, label, 1),
    name: requireString(record, 'name', endpoint, label),
    unit: requireNonEmptyString(record, 'unit', endpoint, label),
    minimum: requireString(record, 'minimum', endpoint, label),
    maximum: requireString(record, 'maximum', endpoint, label),
    sampleCount: requireInteger(record, 'sampleCount', endpoint, label, 0),
    intervalMs: requireInteger(record, 'intervalMs', endpoint, label, 0),
    status: requireEnum(record['status'], RUN_STEP_STATUSES, endpoint, `${label}.status`),
    outcome: parseStepOutcome(record['outcome'], endpoint, `${label}.outcome`),
    recordedCount: requireInteger(record, 'recordedCount', endpoint, label, 0),
    outOfToleranceCount: requireInteger(
      record,
      'outOfToleranceCount',
      endpoint,
      label,
      0,
    ),
    firstFailureSampleIndex: requireNullableInteger(
      record,
      'firstFailureSampleIndex',
      endpoint,
      label,
      0,
    ),
    hasOutOfTolerance: requireBoolean(record, 'hasOutOfTolerance', endpoint, label),
    statistics: parseStatistics(record['statistics'], endpoint, `${label}.statistics`),
    measurements,
  };
}

function parseStatistics(
  value: unknown,
  endpoint: string,
  label: string,
): RunStepStatistics {
  const record = requireRecord(value, endpoint, label);

  return {
    minimum: requireNullableString(record, 'minimum', endpoint, label),
    maximum: requireNullableString(record, 'maximum', endpoint, label),
    average: requireNullableString(record, 'average', endpoint, label),
    sampleCount: requireNullableInteger(record, 'sampleCount', endpoint, label, 0),
  };
}

function parseMeasurement(
  value: unknown,
  endpoint: string,
  label: string,
): RunMeasurement {
  const record = requireRecord(value, endpoint, label);

  return {
    sampleIndex: requireInteger(record, 'sampleIndex', endpoint, label, 0),
    value: requireString(record, 'value', endpoint, label),
    isWithinTolerance: requireBoolean(record, 'isWithinTolerance', endpoint, label),
    recordedAt: requireDate(record, 'recordedAt', endpoint, label),
    elapsedMs: requireInteger(record, 'elapsedMs', endpoint, label, 0),
  };
}

function parseProfile(
  value: unknown,
  endpoint: string,
  label: string,
): RunSnapshot['profile'] {
  const record = requireRecord(value, endpoint, label);
  const description = record['description'];

  return {
    id: requireUuid(record, 'id', endpoint, label),
    code: requireNonEmptyString(record, 'code', endpoint, label),
    name: requireString(record, 'name', endpoint, label),
    ...(typeof description === 'string' || description === null ? { description } : {}),
  };
}

function parseRequestedBy(
  value: unknown,
  endpoint: string,
): RunSnapshot['requestedBy'] {
  const label = 'run.requestedBy';
  const record = requireRecord(value, endpoint, label);

  return {
    id: requireUuid(record, 'id', endpoint, label),
    email: requireString(record, 'email', endpoint, label),
    role: requireEnum(record['role'], ROLES, endpoint, `${label}.role`),
  };
}

function parseStatus(value: unknown, endpoint: string): RunStatus {
  if (typeof value === 'string' && RUN_STATUSES.includes(value as RunStatus)) {
    return value as RunStatus;
  }

  throw new MalformedApiResponseError(endpoint, 'status is not a known run status.');
}

function parseOutcome(value: unknown, endpoint: string): RunOutcome {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' && RUN_OUTCOMES.includes(value as 'PASSED' | 'FAILED')) {
    return value as RunOutcome;
  }

  throw new MalformedApiResponseError(endpoint, 'outcome is not a known run outcome.');
}

function parseStepOutcome(
  value: unknown,
  endpoint: string,
  label: string,
): RunSnapshotStep['outcome'] {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' && RUN_OUTCOMES.includes(value as 'PASSED' | 'FAILED')) {
    return value as RunSnapshotStep['outcome'];
  }

  throw new MalformedApiResponseError(endpoint, `${label} is not a known step outcome.`);
}

function requireRecord(
  value: unknown,
  endpoint: string,
  label: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedApiResponseError(endpoint, `${label} is not an object.`);
  }

  return value as Record<string, unknown>;
}

function requireArray(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is not an array.`);
  }

  return value;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is not a string.`);
  }

  return value;
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string {
  const value = requireString(record, key, endpoint, label);
  if (value.length === 0) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is empty.`);
  }

  return value;
}

function requireUuid(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string {
  const value = requireNonEmptyString(record, key, endpoint, label);
  if (!UUID_PATTERN.test(value)) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.${key} is not a UUID.`,
    );
  }

  return value;
}

function requireNullableUuid(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string | null {
  const value = requireNullableString(record, key, endpoint, label);
  if (value !== null && !UUID_PATTERN.test(value)) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.${key} is not a UUID.`,
    );
  }

  return value;
}

function requireNullableString(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string | null {
  if (!Object.hasOwn(record, key)) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is missing.`);
  }

  const value = record[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.${key} is not a string or null.`,
    );
  }

  return value;
}

function requireInteger(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const value = record[key];
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.${key} is not an integer between ${min} and ${max}.`,
    );
  }

  return value;
}

function requireNullableInteger(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
  min: number,
): number | null {
  if (!Object.hasOwn(record, key)) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is missing.`);
  }

  const value = record[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.${key} is not a non-negative integer or null.`,
    );
  }

  return value;
}

function requireBoolean(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is not a boolean.`);
  }

  return value;
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  endpoint: string,
  label: string,
): T {
  if (typeof value === 'string' && allowed.includes(value as T)) {
    return value as T;
  }

  throw new MalformedApiResponseError(
    endpoint,
    `${label} is not one of ${allowed.join(', ')}.`,
  );
}

function requireDate(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string {
  const value = requireNonEmptyString(record, key, endpoint, label);
  if (Number.isNaN(Date.parse(value))) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.${key} is not an ISO-8601 date.`,
    );
  }

  return value;
}

function requireNullableDate(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string | null {
  const value = requireNullableString(record, key, endpoint, label);
  if (value !== null && Number.isNaN(Date.parse(value))) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.${key} is not an ISO-8601 date.`,
    );
  }

  return value;
}
