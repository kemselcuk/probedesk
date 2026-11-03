import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import type {
  CreatePlanRequest,
  DeviceProfile,
  PlanDetail,
  PlanDraft,
  PlanStep,
  PlanSummary,
  PublishedRevision,
  PublishedVersion,
  PublishedVersionListItem,
  PublishDraftRequest,
  SaveDraftRequest,
  SaveDraftResult,
} from './plans-api.types';

/**
 * Typed boundary for the device-profile and plan endpoints.
 *
 * The wire DTOs come from `@probedesk/api-client`. This file normalises them
 * into the small view model the screens consume, keeping envelope tolerance
 * (for example `{ items }` instead of an array) in one place. Missing required
 * fields fail the request instead of producing invented data.
 */
@Injectable({ providedIn: 'root' })
export class PlansApi {
  private readonly http = inject(HttpClient);

  listPlans(): Observable<readonly PlanSummary[]> {
    return this.http
      .get<unknown>('/api/plans')
      .pipe(map((value) => extractList(value, ['plans']).map(toPlanSummary)));
  }

  listDeviceProfiles(): Observable<readonly DeviceProfile[]> {
    return this.http.get<unknown>('/api/device-profiles').pipe(map(toDeviceProfiles));
  }

  /** Returns the new plan id; the editor loads the created draft afterwards. */
  createPlan(request: CreatePlanRequest): Observable<string> {
    return this.http.post<unknown>('/api/plans', request).pipe(map(toCreatedPlanId));
  }

  getPlan(planId: string): Observable<PlanDetail> {
    return this.http
      .get<unknown>(`/api/plans/${encodeURIComponent(planId)}`)
      .pipe(map(toPlanDetail));
  }

  saveDraft(planId: string, request: SaveDraftRequest): Observable<SaveDraftResult> {
    return this.http
      .put<unknown>(`/api/plans/${encodeURIComponent(planId)}/draft`, request)
      .pipe(map(toSaveDraftResult));
  }

  /** Publishes the saved draft atomically; the body carries only its revision. */
  publishDraft(planId: string, request: PublishDraftRequest): Observable<PublishedRevision> {
    return this.http
      .post<unknown>(`/api/plans/${encodeURIComponent(planId)}/draft/publish`, request)
      .pipe(map(toPublishedRevision));
  }

  /** Creates a new draft copied from the latest published version. */
  createDraft(planId: string): Observable<PlanDraft> {
    return this.http
      .post<unknown>(`/api/plans/${encodeURIComponent(planId)}/drafts`, null)
      .pipe(map((value) => toPlanDraft(requireRecord(value, 'new draft'), '')));
  }

  /** Published versions, newest first, including the publisher summary. */
  listVersions(planId: string): Observable<readonly PublishedVersionListItem[]> {
    return this.http
      .get<unknown>(`/api/plans/${encodeURIComponent(planId)}/versions`)
      .pipe(
        map((value) =>
          extractList(value, ['versions']).map((entry) => toPublishedVersionListItem(entry)),
        ),
      );
  }

  /** Reads one immutable published revision with its ordered steps. */
  getVersion(versionId: string): Observable<PublishedRevision> {
    return this.http
      .get<unknown>(`/api/plan-versions/${encodeURIComponent(versionId)}`)
      .pipe(map(toPublishedRevision));
  }
}

function toPlanSummary(value: unknown): PlanSummary {
  const record = requireRecord(value, 'plan');
  const id = requireString(record, 'id');
  const draft = firstRecord(record, ['draft', 'openDraft']);
  const profile = toDeviceProfile(firstRecord(record, ['deviceProfile', 'profile']));
  const latestVersion = toPublishedVersion(
    firstRecord(record, ['latestPublishedVersion', 'latestVersion']),
  );
  const hasDraftValue = readBoolean(record, 'hasDraft');
  const draftKnown =
    hasDraftValue !== null ||
    draft !== null ||
    hasOwn(record, 'draft') ||
    hasOwn(record, 'openDraft');
  const hasDraft = hasDraftValue ?? draft !== null;
  const draftRevision =
    readInteger(record, 'draftRevision') ??
    (draft === null ? null : readInteger(draft, 'editRevision'));

  return {
    id,
    name: readString(record, 'name') ?? (draft === null ? '' : (readString(draft, 'name') ?? '')),
    profile,
    latestPublishedVersion: latestVersion,
    versionsKnown:
      hasOwn(record, 'latestPublishedVersion') ||
      hasOwn(record, 'latestVersion') ||
      Array.isArray(record['versions']),
    hasDraft: draftKnown ? hasDraft : false,
    draftKnown,
    draftRevision,
  };
}

function toPlanDetail(value: unknown): PlanDetail {
  const record = requireRecord(value, 'plan');
  const nested = firstRecord(record, ['plan']);
  const source: Record<string, unknown> = nested === null ? record : { ...nested };

  if (nested !== null) {
    for (const key of [
      'latestPublishedVersion',
      'latestVersion',
      'versions',
      'draft',
      'openDraft',
      'hasDraft',
      'draftRevision',
    ]) {
      if (hasOwn(record, key)) {
        source[key] = record[key];
      }
    }
  }

  const summary = toPlanSummary(source);
  const draftRecord = firstRecord(source, ['draft', 'openDraft']);
  const topLevelSteps = readArray(source, 'steps');
  const draft =
    draftRecord !== null
      ? toPlanDraft(draftRecord, summary.name)
      : topLevelSteps !== null && hasOwn(source, 'editRevision')
        ? toPlanDraft(source, summary.name)
        : null;
  const versions = (readArray(source, 'versions') ?? []).flatMap((entry) => {
    const version = toPublishedVersion(entry);
    return version === null ? [] : [version];
  });

  return {
    ...summary,
    draft,
    versions,
  };
}

function toPlanDraft(record: Record<string, unknown>, fallbackName: string): PlanDraft {
  return {
    id:
      readString(record, 'id') ??
      readString(record, 'revisionId') ??
      readString(record, 'draftId') ??
      '',
    editRevision: readInteger(record, 'editRevision') ?? readInteger(record, 'revision') ?? 0,
    name: readString(record, 'name') ?? fallbackName,
    steps: (readArray(record, 'steps') ?? []).map(toPlanStep),
  };
}

function toPlanStep(value: unknown): PlanStep {
  const record = requireRecord(value, 'plan step');
  return {
    logicalStepId: readString(record, 'logicalStepId') ?? '',
    name: readString(record, 'name') ?? '',
    unit: readString(record, 'unit') ?? '',
    minimum: readDecimal(record, 'minimum'),
    maximum: readDecimal(record, 'maximum'),
    sampleCount: readInteger(record, 'sampleCount') ?? 0,
    intervalMs: readInteger(record, 'intervalMs') ?? 0,
  };
}

function toDeviceProfiles(value: unknown): readonly DeviceProfile[] {
  if (Array.isArray(value)) {
    return value.map(toDeviceProfileRequired);
  }

  const record = asRecord(value);
  if (record === null) {
    throw new Error('Unexpected device profile response.');
  }

  for (const key of ['items', 'profiles', 'deviceProfiles', 'data']) {
    const entries = record[key];
    if (Array.isArray(entries)) {
      return entries.map(toDeviceProfileRequired);
    }
  }

  return readString(record, 'id') === null ? [] : [toDeviceProfileRequired(record)];
}

function toDeviceProfileRequired(value: unknown): DeviceProfile {
  const profile = toDeviceProfile(value);
  if (profile === null) {
    throw new Error('Unexpected device profile entry.');
  }

  return profile;
}

function toDeviceProfile(value: unknown): DeviceProfile | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const id = readString(record, 'id');
  if (id === null) {
    return null;
  }

  return {
    id,
    code: readString(record, 'code') ?? '',
    name: readString(record, 'name') ?? '',
    description: readString(record, 'description'),
  };
}

function toPublishedVersion(value: unknown): PublishedVersion | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }

  const id = readString(record, 'id');
  const versionNumber = readInteger(record, 'versionNumber');
  return id === null || versionNumber === null
    ? null
    : {
        id,
        versionNumber,
        publishedAt: readString(record, 'publishedAt') ?? '',
      };
}

function toCreatedPlanId(value: unknown): string {
  const record = requireRecord(value, 'created plan');
  const plan = firstRecord(record, ['plan']);
  const planId =
    readString(record, 'id') ??
    readString(record, 'planId') ??
    (plan === null ? null : readString(plan, 'id'));

  if (planId !== null) {
    return planId;
  }

  const draft = firstRecord(record, ['draft']);
  const draftPlanId = draft === null ? null : readString(draft, 'planId');
  if (draftPlanId !== null) {
    return draftPlanId;
  }

  throw new Error('The create plan response did not contain a plan id.');
}

function toSaveDraftResult(value: unknown): SaveDraftResult {
  const record = requireRecord(value, 'saved draft');
  const nested = firstRecord(record, ['draft']);
  const draftRecord = nested ?? record;
  const stepsSource =
    readArray(draftRecord, 'steps') ?? (nested === null ? null : readArray(record, 'steps'));
  const steps = stepsSource === null ? null : stepsSource.map(toPlanStep);
  const logicalStepIds =
    readStringArray(draftRecord, 'logicalStepIds') ??
    (nested === null ? null : readStringArray(record, 'logicalStepIds')) ??
    (steps === null ? null : steps.map((step) => step.logicalStepId));
  const editRevision =
    readInteger(draftRecord, 'editRevision') ??
    readInteger(draftRecord, 'revision') ??
    (nested === null
      ? null
      : (readInteger(record, 'editRevision') ?? readInteger(record, 'revision')));

  if (editRevision === null) {
    throw new Error('The save draft response did not contain an edit revision.');
  }

  return { editRevision, steps, logicalStepIds };
}

function toPublishedRevision(value: unknown): PublishedRevision {
  const record = requireRecord(value, 'published version');
  return {
    id: requireString(record, 'id'),
    planId: readString(record, 'planId') ?? '',
    name: readString(record, 'name') ?? '',
    versionNumber: requireInteger(record, 'versionNumber'),
    publishedAt: requireString(record, 'publishedAt'),
    baseVersionId: readString(record, 'baseVersionId'),
    steps: (readArray(record, 'steps') ?? []).map(toPlanStep),
  };
}

function toPublishedVersionListItem(value: unknown): PublishedVersionListItem {
  const record = requireRecord(value, 'published version');
  const publishedBy = requireRecord(record['publishedBy'], 'publisher');

  return {
    id: requireString(record, 'id'),
    versionNumber: requireInteger(record, 'versionNumber'),
    name: readString(record, 'name') ?? '',
    publishedAt: requireString(record, 'publishedAt'),
    publishedBy: {
      id: requireString(publishedBy, 'id'),
      email: requireString(publishedBy, 'email'),
      role: requireRole(publishedBy, 'role'),
    },
  };
}

function extractList(value: unknown, keys: readonly string[]): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  const record = asRecord(value);
  if (record === null) {
    throw new Error('Unexpected list response.');
  }

  for (const key of [...keys, 'items', 'data']) {
    const entries = record[key];
    if (Array.isArray(entries)) {
      return entries;
    }
  }

  throw new Error('Unexpected list response.');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asRecord(value);
  if (record === null) {
    throw new Error(`Unexpected ${label} response.`);
  }

  return record;
}

function firstRecord(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const entry = asRecord(record[key]);
    if (entry !== null) {
      return entry;
    }
  }

  return null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = readString(record, key);
  if (value === null) {
    throw new Error(`The response did not contain ${key}.`);
  }

  return value;
}

function readInteger(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function requireInteger(record: Record<string, unknown>, key: string): number {
  const value = readInteger(record, key);
  if (value === null) {
    throw new Error(`The response did not contain ${key}.`);
  }

  return value;
}

function requireRole(
  record: Record<string, unknown>,
  key: string,
): PublishedVersionListItem['publishedBy']['role'] {
  const value = requireString(record, key);
  if (value === 'PLANNER' || value === 'OPERATOR' || value === 'VIEWER') {
    return value;
  }

  throw new Error(`The response contained an unknown ${key}.`);
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function readDecimal(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value === 'string') {
    return value;
  }

  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '0';
}

function readArray(record: Record<string, unknown>, key: string): readonly unknown[] | null {
  const value = record[key];
  return Array.isArray(value) ? value : null;
}

function readStringArray(record: Record<string, unknown>, key: string): readonly string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    return null;
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}
