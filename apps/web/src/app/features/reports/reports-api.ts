import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { components } from '@probedesk/api-client';
import { catchError, from, map, mergeMap, throwError } from 'rxjs';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import { parseRecordedRun } from '../runs/runs-api';

export type RunReport = components['schemas']['RunReportDto'];
export type ExportFormat = 'csv' | 'json';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable({ providedIn: 'root' })
export class ReportsApi {
  private readonly http = inject(HttpClient);
  report(id: string) {
    return this.http
      .get<unknown>(`/api/runs/${encodeURIComponent(id)}/report`)
      .pipe(map((value) => parseReport(value, id)));
  }
  export(id: string, format: ExportFormat) {
    return this.http
      .get(`/api/runs/${encodeURIComponent(id)}/export`, {
        params: new HttpParams().set('format', format),
        responseType: 'blob',
        observe: 'response',
      })
      .pipe(
        map((response) => {
          const type = response.headers.get('content-type')?.split(';')[0].trim();
          if (!response.body || type !== (format === 'csv' ? 'text/csv' : 'application/json'))
            throw new MalformedApiResponseError('Run export', 'Unexpected download content.');
          return response.body;
        }),
        catchError((error: unknown) => {
          if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob))
            return throwError(() => error);
          // HttpClient represents JSON error responses as Blob for blob requests.
          return from(error.error.text()).pipe(
            mergeMap((text) => {
              let body: unknown;
              try {
                body = JSON.parse(text);
              } catch {
                body = null;
              }
              return throwError(
                () =>
                  new HttpErrorResponse({
                    error: body,
                    headers: error.headers,
                    status: error.status,
                    statusText: error.statusText,
                    url: error.url ?? undefined,
                  }),
              );
            }),
          );
        }),
      );
  }
}
function parseReport(value: unknown, requestedId: string): RunReport {
  const fail = (): never => {
    throw new MalformedApiResponseError('Run report', 'Invalid report response.');
  };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const record = value as Record<string, unknown>;
  const id = record['runId'],
    generatedAt = record['generatedAt'];
  if (
    record['schemaVersion'] !== 1 ||
    typeof id !== 'string' ||
    !UUID.test(id) ||
    id.toLowerCase() !== requestedId.toLowerCase() ||
    typeof generatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(generatedAt) ||
    !Number.isFinite(Date.parse(generatedAt))
  )
    return fail();
  const run = parseRecordedRun(value, 'Run report');
  if (
    run.status === 'RUNNING' ||
    run.expectedSampleCount < 1 ||
    run.expectedSampleCount > 10_000 ||
    run.recordedSampleCount > 10_000 ||
    run.steps.length > 30 ||
    run.steps.some(
      (step) =>
        step.sampleCount < 1 ||
        step.sampleCount > 1000 ||
        step.intervalMs < 100 ||
        step.intervalMs > 5000,
    ) ||
    run.steps.reduce((sum, step) => sum + step.measurements.length, 0) > 10_000
  )
    return fail();
  const decimal = (value: string | null) => value === null || /^-?\d+\.\d{6}$/.test(value);
  if (
    !decimal(run.errorProbability) ||
    run.steps.some(
      (step) =>
        !decimal(step.minimum) ||
        !decimal(step.maximum) ||
        !decimal(step.statistics.minimum) ||
        !decimal(step.statistics.maximum) ||
        !decimal(step.statistics.average) ||
        step.measurements.some((sample) => !decimal(sample.value)),
    )
  )
    return fail();
  // DeviceProfileDto requires description, while the legacy snapshot type permits omission.
  const profile = run.profile;
  if (profile.description !== null && typeof profile.description !== 'string') return fail();
  return {
    ...run,
    profile: { ...profile, description: profile.description },
    schemaVersion: 1,
    runId: id,
    generatedAt,
  };
}
