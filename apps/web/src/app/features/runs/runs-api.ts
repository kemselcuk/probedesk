import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import type {
  RunOutcome,
  RunStartResponse,
  RunStatus,
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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Typed boundary for the run endpoints.
 *
 * The Idempotency-Key belongs to one logical user action; the caller decides
 * when to reuse it. A successful response is validated against the generated
 * schema before the screen navigates, so a missing run id can never become a
 * guessed success URL.
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
}

function parseRunStartResponse(value: unknown, endpoint: string): RunStartResponse {
  const record = requireRecord(value, endpoint);
  const runId = requireString(record, 'runId', endpoint);
  if (!UUID_PATTERN.test(runId)) {
    throw new MalformedApiResponseError(endpoint, 'runId is not a UUID.');
  }

  return {
    runId,
    status: parseStatus(record['status'], endpoint),
    outcome: parseOutcome(record['outcome'], endpoint),
    snapshotUrl: requireNonEmptyString(record, 'snapshotUrl', endpoint),
    eventsUrl: requireNonEmptyString(record, 'eventsUrl', endpoint),
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

function requireRecord(value: unknown, endpoint: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedApiResponseError(endpoint, 'the response is not an object.');
  }

  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new MalformedApiResponseError(endpoint, `${key} is not a string.`);
  }

  return value;
}

function requireNonEmptyString(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
): string {
  const value = requireString(record, key, endpoint);
  if (value.length === 0) {
    throw new MalformedApiResponseError(endpoint, `${key} is empty.`);
  }

  return value;
}
