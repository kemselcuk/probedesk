import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import type {
  CreatePlanRequest,
  DeviceProfile,
  PlanDetail,
  PlanDraft,
  PlanStep,
  PlanSummary,
  PublishedRevision,
  PublishedVersionListItem,
  PublishDraftRequest,
  SaveDraftRequest,
  SaveDraftResult,
} from './plans-api.types';

/**
 * Typed boundary for the device-profile and plan endpoints.
 *
 * Every request and response uses the generated `@probedesk/api-client`
 * schema. Successful responses are validated before they reach a screen: a
 * missing required field raises `MalformedApiResponseError`, which the normal
 * error-state path displays. No measurement value, step identity, revision or
 * step list is ever defaulted.
 */
@Injectable({ providedIn: 'root' })
export class PlansApi {
  private readonly http = inject(HttpClient);

  listPlans(): Observable<readonly PlanSummary[]> {
    return this.http
      .get<PlanSummary[]>('/api/plans')
      .pipe(map((value) => parseArray(value, 'GET /api/plans', parsePlanSummary)));
  }

  listDeviceProfiles(): Observable<readonly DeviceProfile[]> {
    return this.http
      .get<DeviceProfile[]>('/api/device-profiles')
      .pipe(
        map((value) =>
          parseArray(value, 'GET /api/device-profiles', (entry, endpoint, index) =>
            parseDeviceProfile(entry, endpoint, `device profile ${index + 1}`),
          ),
        ),
      );
  }

  /** Creates the plan and returns its detail, including the empty first draft. */
  createPlan(request: CreatePlanRequest): Observable<PlanDetail> {
    return this.http
      .post<PlanDetail>('/api/plans', request)
      .pipe(map((value) => parsePlanDetail(value, 'POST /api/plans')));
  }

  getPlan(planId: string): Observable<PlanDetail> {
    const endpoint = `GET /api/plans/${planId}`;
    return this.http
      .get<PlanDetail>(`/api/plans/${encodeURIComponent(planId)}`)
      .pipe(map((value) => parsePlanDetail(value, endpoint)));
  }

  saveDraft(planId: string, request: SaveDraftRequest): Observable<SaveDraftResult> {
    const endpoint = `PUT /api/plans/${planId}/draft`;
    return this.http
      .put<SaveDraftResult>(`/api/plans/${encodeURIComponent(planId)}/draft`, request)
      .pipe(map((value) => parseDraftRevision(value, endpoint)));
  }

  /** Publishes the saved draft atomically; the body carries only its revision. */
  publishDraft(planId: string, request: PublishDraftRequest): Observable<PublishedRevision> {
    const endpoint = `POST /api/plans/${planId}/draft/publish`;
    return this.http
      .post<PublishedRevision>(`/api/plans/${encodeURIComponent(planId)}/draft/publish`, request)
      .pipe(map((value) => parsePublishedRevision(value, endpoint)));
  }

  /** Creates a new draft copied from the latest published version. */
  createDraft(planId: string): Observable<PlanDraft> {
    const endpoint = `POST /api/plans/${planId}/drafts`;
    return this.http
      .post<PlanDraft>(`/api/plans/${encodeURIComponent(planId)}/drafts`, null)
      .pipe(map((value) => parseDraftRevision(value, endpoint)));
  }

  /** Published versions, newest first, including the publisher summary. */
  listVersions(planId: string): Observable<readonly PublishedVersionListItem[]> {
    const endpoint = `GET /api/plans/${planId}/versions`;
    return this.http
      .get<PublishedVersionListItem[]>(`/api/plans/${encodeURIComponent(planId)}/versions`)
      .pipe(map((value) => parseArray(value, endpoint, parsePublishedVersionListItem)));
  }

  /** Reads one immutable published revision with its ordered steps. */
  getVersion(versionId: string): Observable<PublishedRevision> {
    const endpoint = `GET /api/plan-versions/${versionId}`;
    return this.http
      .get<PublishedRevision>(`/api/plan-versions/${encodeURIComponent(versionId)}`)
      .pipe(map((value) => parsePublishedRevision(value, endpoint)));
  }
}

function parsePlanSummary(value: unknown, endpoint: string, index: number): PlanSummary {
  const label = `plan ${index + 1}`;
  const record = requireRecord(value, endpoint, label);
  const summary: PlanSummary = {
    id: requireString(record, 'id', endpoint, label),
    name: requireString(record, 'name', endpoint, label),
    profile: parseDeviceProfile(record['profile'], endpoint, `${label} profile`, `${label}.profile`),
    latestPublishedVersion: parseNullable(
      record,
      'latestPublishedVersion',
      endpoint,
      label,
      parsePublishedVersionSummary,
    ),
  };

  if (Object.hasOwn(record, 'draft')) {
    const draft = record['draft'];
    return {
      ...summary,
      draft:
        draft === null
          ? null
          : (() => {
              const draftRecord = requireRecord(draft, endpoint, `${label} draft`);
              return {
                id: requireString(draftRecord, 'id', endpoint, `${label} draft`),
                editRevision: requireInteger(
                  draftRecord,
                  'editRevision',
                  endpoint,
                  `${label} draft`,
                ),
              };
            })(),
    };
  }

  return summary;
}

function parsePlanDetail(value: unknown, endpoint: string): PlanDetail {
  const record = requireRecord(value, endpoint, 'plan');
  const draftValue = record['draft'];
  const plan: PlanDetail = {
    id: requireString(record, 'id', endpoint, 'plan'),
    name: requireString(record, 'name', endpoint, 'plan'),
    profile: parseDeviceProfile(record['profile'], endpoint, 'plan profile', 'plan.profile'),
    createdAt: requireString(record, 'createdAt', endpoint, 'plan'),
    latestPublishedVersion: parseNullable(
      record,
      'latestPublishedVersion',
      endpoint,
      'plan',
      parsePublishedVersionSummary,
    ),
    published:
      record['published'] === null
        ? null
        : parsePublishedRevision(record['published'], endpoint, 'plan.published'),
  };

  if (draftValue === undefined || draftValue === null) {
    return plan;
  }

  return { ...plan, draft: parseDraftRevision(draftValue, endpoint, 'plan.draft') };
}

function parseDraftRevision(
  value: unknown,
  endpoint: string,
  label = 'draft revision',
): PlanDraft {
  const record = requireRecord(value, endpoint, label);
  requireState(record, 'DRAFT', endpoint, label);

  return {
    id: requireString(record, 'id', endpoint, label),
    editRevision: requireInteger(record, 'editRevision', endpoint, label),
    planId: requireString(record, 'planId', endpoint, label),
    state: 'DRAFT',
    name: requireString(record, 'name', endpoint, label),
    versionNumber: requireNullableInteger(record, 'versionNumber', endpoint, label),
    ...(Object.hasOwn(record, 'baseVersionId')
      ? { baseVersionId: optionalString(record, 'baseVersionId', endpoint, label) }
      : {}),
    steps: parseArray(record['steps'], endpoint, (step, _, index) =>
      parseStep(step, endpoint, `${label} step ${index + 1}`),
    ),
  };
}

function parsePublishedRevision(
  value: unknown,
  endpoint: string,
  label = 'published revision',
): PublishedRevision {
  const record = requireRecord(value, endpoint, label);
  requireState(record, 'PUBLISHED', endpoint, label);

  return {
    id: requireString(record, 'id', endpoint, label),
    planId: requireString(record, 'planId', endpoint, label),
    state: 'PUBLISHED',
    name: requireString(record, 'name', endpoint, label),
    versionNumber: requireInteger(record, 'versionNumber', endpoint, label),
    ...(Object.hasOwn(record, 'baseVersionId')
      ? { baseVersionId: optionalString(record, 'baseVersionId', endpoint, label) }
      : {}),
    publishedAt: requireString(record, 'publishedAt', endpoint, label),
    steps: parseArray(record['steps'], endpoint, (step, _, index) =>
      parseStep(step, endpoint, `${label} step ${index + 1}`),
    ),
  };
}

function parsePublishedVersionListItem(
  value: unknown,
  endpoint: string,
  index: number,
): PublishedVersionListItem {
  const label = `version ${index + 1}`;
  const record = requireRecord(value, endpoint, label);
  const publisher = requireRecord(record['publishedBy'], endpoint, `${label}.publishedBy`);

  return {
    id: requireString(record, 'id', endpoint, label),
    versionNumber: requireInteger(record, 'versionNumber', endpoint, label),
    publishedAt: requireString(record, 'publishedAt', endpoint, label),
    name: requireString(record, 'name', endpoint, label),
    publishedBy: {
      id: requireString(publisher, 'id', endpoint, `${label}.publishedBy`),
      email: requireString(publisher, 'email', endpoint, `${label}.publishedBy`),
      role: requireRole(publisher, endpoint, `${label}.publishedBy`),
    },
  };
}

function parsePublishedVersionSummary(value: unknown, endpoint: string): {
  readonly id: string;
  readonly versionNumber: number;
  readonly publishedAt: string;
} {
  const record = requireRecord(value, endpoint, 'latest published version');
  return {
    id: requireString(record, 'id', endpoint, 'latest published version'),
    versionNumber: requireInteger(record, 'versionNumber', endpoint, 'latest published version'),
    publishedAt: requireString(record, 'publishedAt', endpoint, 'latest published version'),
  };
}

function parseStep(value: unknown, endpoint: string, label: string): PlanStep {
  const record = requireRecord(value, endpoint, label);
  return {
    logicalStepId: requireString(record, 'logicalStepId', endpoint, label),
    position: requireInteger(record, 'position', endpoint, label),
    name: requireString(record, 'name', endpoint, label),
    unit: requireString(record, 'unit', endpoint, label),
    minimum: requireString(record, 'minimum', endpoint, label),
    maximum: requireString(record, 'maximum', endpoint, label),
    sampleCount: requireInteger(record, 'sampleCount', endpoint, label),
    intervalMs: requireInteger(record, 'intervalMs', endpoint, label),
  };
}

function parseDeviceProfile(
  value: unknown,
  endpoint: string,
  label = 'device profile',
  path = label,
): DeviceProfile {
  const record = requireRecord(value, endpoint, label);
  return {
    id: requireString(record, 'id', endpoint, path),
    code: requireString(record, 'code', endpoint, path),
    name: requireString(record, 'name', endpoint, path),
    ...(record['description'] === undefined
      ? {}
      : { description: optionalString(record, 'description', endpoint, path) }),
  };
}

function parseArray<T>(
  value: unknown,
  endpoint: string,
  parseEntry: (entry: unknown, endpoint: string, index: number) => T,
): T[] {
  if (!Array.isArray(value)) {
    throw new MalformedApiResponseError(endpoint, 'expected an array.');
  }

  return value.map((entry, index) => parseEntry(entry, endpoint, index));
}

function parseNullable<T>(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
  parse: (value: unknown, endpoint: string) => T,
): T | null {
  if (!Object.hasOwn(record, key)) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is missing.`);
  }

  const value = record[key];
  return value === null ? null : parse(value, `${endpoint} (${label}.${key})`);
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

function requireInteger(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is not an integer.`);
  }

  return value;
}

function requireNullableInteger(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): number | null {
  const value = record[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is not an integer or null.`);
  }

  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null || typeof value === 'string') {
    return value;
  }

  throw new MalformedApiResponseError(endpoint, `${label}.${key} is not a string or null.`);
}

function requireState(
  record: Record<string, unknown>,
  expected: 'DRAFT' | 'PUBLISHED',
  endpoint: string,
  label: string,
): void {
  if (record['state'] !== expected) {
    throw new MalformedApiResponseError(endpoint, `${label}.state is not ${expected}.`);
  }
}

function requireRole(
  record: Record<string, unknown>,
  endpoint: string,
  label: string,
): PublishedVersionListItem['publishedBy']['role'] {
  const value = record['role'];
  if (value === 'PLANNER' || value === 'OPERATOR' || value === 'VIEWER') {
    return value;
  }

  throw new MalformedApiResponseError(endpoint, `${label}.role is not a known role.`);
}
