import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { components, operations } from '@probedesk/api-client';
import { Observable, map } from 'rxjs';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';

export type Overview = components['schemas']['AnalyticsOverviewDto'];
export type OverviewQuery = NonNullable<
  operations['AnalyticsController_overview']['parameters']['query']
>;
export type TrendDay = Overview['trend'][number];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);
  overview(query: OverviewQuery): Observable<Overview> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    return this.http
      .get<unknown>('/api/analytics/overview', { params })
      .pipe(map((value) => parseOverview(value, query)));
  }
}
function invalid(): never {
  throw new MalformedApiResponseError('Analytics overview', 'invalid analytics response.');
}
function obj(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
function string(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : invalid();
}
function uuid(value: unknown): string {
  const id = string(value);
  return UUID.test(id) ? id : invalid();
}
function instant(value: unknown): string {
  const result = string(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(result) && Number.isFinite(Date.parse(result))
    ? result
    : invalid();
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
}
function decimal(value: unknown, places: number, percent = false): string | null {
  if (value === null) return null;
  const result = string(value);
  if (
    !new RegExp('^(0|[1-9]\\d*)\\.\\d{' + places + '}$').test(result) ||
    (percent && Number(result) > 100)
  )
    return invalid();
  return result;
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalid();
}
function counts(value: Record<string, unknown>) {
  return {
    totalRuns: count(value['totalRuns']),
    completedRuns: count(value['completedRuns']),
    passedRuns: count(value['passedRuns']),
    failedRuns: count(value['failedRuns']),
    runningRuns: count(value['runningRuns']),
    cancelledRuns: count(value['cancelledRuns']),
    interruptedRuns: count(value['interruptedRuns']),
    errorRuns: count(value['errorRuns']),
  };
}
function parseOverview(value: unknown, query: OverviewQuery): Overview {
  const root = obj(value),
    filters = obj(root['filters']),
    summary = obj(root['summary']);
  const scenario = filters['scenario'];
  if (
    scenario !== null &&
    scenario !== 'NORMAL' &&
    scenario !== 'FORCED_FAILURE' &&
    scenario !== 'RANDOM'
  )
    return invalid();
  const resolved: Overview['filters'] = {
    from: instant(filters['from']),
    to: instant(filters['to']),
    planId: filters['planId'] === null ? null : uuid(filters['planId']),
    planVersionId: filters['planVersionId'] === null ? null : uuid(filters['planVersionId']),
    deviceId: filters['deviceId'] === null ? null : uuid(filters['deviceId']),
    batchNumber: filters['batchNumber'] === null ? null : string(filters['batchNumber']),
    scenario,
  };
  if (
    Date.parse(resolved.from) !== Date.parse(query.from) ||
    Date.parse(resolved.to) !== Date.parse(query.to)
  )
    return invalid();
  for (const key of ['planId', 'planVersionId', 'deviceId'] as const)
    if (resolved[key]?.toLowerCase() !== (query[key]?.toLowerCase() ?? undefined)) return invalid();
  if (
    (resolved.batchNumber ?? undefined) !==
      (query.batchNumber?.trim().toUpperCase() || undefined) ||
    (resolved.scenario ?? undefined) !== query.scenario
  )
    return invalid();
  const rawTrend = list(root['trend']);
  const rawTop = list(root['topFailedSteps']);
  if (rawTrend.length > 367 || rawTop.length > 10) return invalid();
  const trend = rawTrend.map((value) => {
    const day = obj(value),
      date = string(day['date']);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date + 'T00:00:00.000Z')) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      return invalid();
    return { date, ...counts(day), passRatePercent: decimal(day['passRatePercent'], 2, true) };
  });
  const topFailedSteps = rawTop.map((value) => {
    const row = obj(value);
    return {
      planId: uuid(row['planId']),
      planVersionId: uuid(row['planVersionId']),
      logicalStepId: uuid(row['logicalStepId']),
      planName: string(row['planName']),
      stepName: string(row['stepName']),
      versionNumber: count(row['versionNumber']),
      unit: string(row['unit']),
      completedStepRuns: count(row['completedStepRuns']),
      failedStepRuns: count(row['failedStepRuns']),
      failureRatePercent: decimal(row['failureRatePercent'], 2, true),
    };
  });
  const dayCount = Math.ceil(
    (Date.parse(resolved.to) - Date.parse(resolved.from.slice(0, 10) + 'T00:00:00.000Z')) /
      86_400_000,
  );
  if (trend.length !== dayCount) return invalid();
  for (let index = 0; index < trend.length; index++) {
    const expected = new Date(
      Date.parse(resolved.from.slice(0, 10) + 'T00:00:00.000Z') + index * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    if (trend[index].date !== expected) return invalid();
  }
  if (
    topFailedSteps.some(
      (row) => row.versionNumber < 1 || row.failedStepRuns > row.completedStepRuns,
    )
  )
    return invalid();
  return {
    asOf: instant(root['asOf']),
    filters: resolved,
    summary: {
      ...counts(summary),
      passRatePercent: decimal(summary['passRatePercent'], 2, true),
      averageDurationMs: decimal(summary['averageDurationMs'], 3),
    },
    trend,
    topFailedSteps,
  };
}
