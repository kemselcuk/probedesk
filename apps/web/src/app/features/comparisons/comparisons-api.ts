import { parseRunMetadata } from '../runs/run-metadata';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { MalformedApiResponseError } from '../../core/http/malformed-api-response.error';
import type {
  RunMeasurement,
  RunOutcome,
  RunSnapshotStep,
  RunStatus,
  RunStepOutcome,
  RunStepStatistics,
  RunStepStatus,
} from '../runs/runs-api.types';
import type {
  ComparisonChangeValue,
  ComparisonChangedField,
  ComparisonMatchedStep,
  ComparisonNumericComparison,
  ComparisonResult,
  ComparisonRuleField,
  ComparisonRunSummary,
  ComparisonStatistics,
  ComparisonVersionDifference,
} from './comparisons-api.types';

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

const RUN_SCENARIOS: readonly ComparisonRunSummary['scenario'][] = [
  'NORMAL',
  'FORCED_FAILURE',
  'RANDOM',
];

const RULE_FIELDS: readonly ComparisonRuleField[] = [
  'name',
  'unit',
  'position',
  'minimum',
  'maximum',
  'sampleCount',
  'intervalMs',
];

const ROLES: readonly ComparisonRunSummary['requestedBy']['role'][] = [
  'PLANNER',
  'OPERATOR',
  'VIEWER',
];

const NUMERIC_COMPARISON_REASONS: readonly ComparisonMatchedStep['numericComparison']['reason'][] =
  ['SAME_UNIT', 'UNIT_MISMATCH'];

const MAX_SEED = 4_294_967_295;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Typed boundary for GET /api/comparisons.
 *
 * The response is validated field by field. A missing step, rule, or sample is
 * never completed with an empty array, a zero, or an invented verdict: the
 * parser raises `MalformedApiResponseError`, which the facade exposes as a
 * visible failure. The server remains the only authority for matching shared
 * steps by logicalStepId, changed rule fields, and every stored verdict.
 */
@Injectable({ providedIn: 'root' })
export class ComparisonsApi {
  private readonly http = inject(HttpClient);

  getComparison(leftRunId: string, rightRunId: string): Observable<ComparisonResult> {
    const endpoint = 'GET /api/comparisons';
    const params = new HttpParams()
      .set('leftRunId', leftRunId)
      .set('rightRunId', rightRunId);

    return this.http
      .get<unknown>('/api/comparisons', { params })
      .pipe(map((value) => parseComparison(value, endpoint)));
  }
}

function parseComparison(value: unknown, endpoint: string): ComparisonResult {
  const record = requireRecord(value, endpoint, 'comparison');
  const planId = requireUuid(record, 'planId', endpoint, 'comparison');
  const versionDifference = parseVersionDifference(
    record['versionDifference'],
    endpoint,
    'comparison.versionDifference',
  );
  const leftRun = parseRunSummary(record['leftRun'], endpoint, 'comparison.leftRun');
  const rightRun = parseRunSummary(record['rightRun'], endpoint, 'comparison.rightRun');

  if (leftRun.id === rightRun.id) {
    throw new MalformedApiResponseError(
      endpoint,
      'comparison compares one run with itself.',
    );
  }

  if (leftRun.planId !== planId || rightRun.planId !== planId) {
    throw new MalformedApiResponseError(
      endpoint,
      'comparison run summaries do not belong to the shared planId.',
    );
  }

  if (leftRun.planId !== rightRun.planId) {
    throw new MalformedApiResponseError(
      endpoint,
      'comparison contains runs from different plans.',
    );
  }

  if (
    versionDifference.leftVersionNumber !== leftRun.versionNumber ||
    versionDifference.rightVersionNumber !== rightRun.versionNumber
  ) {
    throw new MalformedApiResponseError(
      endpoint,
      'comparison versionDifference does not match the run summaries.',
    );
  }

  if (
    versionDifference.sameVersion !==
    (leftRun.versionNumber === rightRun.versionNumber)
  ) {
    throw new MalformedApiResponseError(
      endpoint,
      'comparison sameVersion contradicts the version numbers.',
    );
  }

  const matchedSteps = requireArray(record, 'matchedSteps', endpoint, 'comparison').map(
    (entry, index) => parseMatchedStep(entry, endpoint, `comparison.matchedSteps[${index}]`),
  );
  const addedSteps = requireArray(record, 'addedSteps', endpoint, 'comparison').map(
    (entry, index) => parseStep(entry, endpoint, `comparison.addedSteps[${index}]`),
  );
  const removedSteps = requireArray(record, 'removedSteps', endpoint, 'comparison').map(
    (entry, index) => parseStep(entry, endpoint, `comparison.removedSteps[${index}]`),
  );

  const seenLogicalStepIds = new Set<string>();
  for (const matched of matchedSteps) {
    claimLogicalStepId(seenLogicalStepIds, matched.logicalStepId, endpoint);
  }
  for (const step of addedSteps) {
    claimLogicalStepId(seenLogicalStepIds, step.logicalStepId, endpoint);
  }
  for (const step of removedSteps) {
    claimLogicalStepId(seenLogicalStepIds, step.logicalStepId, endpoint);
  }

  return {
    planId,
    versionDifference,
    leftRun,
    rightRun,
    matchedSteps,
    addedSteps,
    removedSteps,
  };
}

function parseVersionDifference(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonVersionDifference {
  const record = requireRecord(value, endpoint, label);

  return {
    sameVersion: requireBoolean(record, 'sameVersion', endpoint, label),
    leftVersionNumber: requireInteger(record, 'leftVersionNumber', endpoint, label, 1),
    rightVersionNumber: requireInteger(record, 'rightVersionNumber', endpoint, label, 1),
  };
}

function claimLogicalStepId(
  seen: Set<string>,
  logicalStepId: string,
  endpoint: string,
): void {
  if (seen.has(logicalStepId)) {
    throw new MalformedApiResponseError(
      endpoint,
      `comparison contains logicalStepId ${logicalStepId} more than once.`,
    );
  }

  seen.add(logicalStepId);
}

function parseRunSummary(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonRunSummary {
  const record = requireRecord(value, endpoint, label);

  return {
    id: requireUuid(record, 'id', endpoint, label),
    planId: requireUuid(record, 'planId', endpoint, label),
    planVersionId: requireUuid(record, 'planVersionId', endpoint, label),
    planName: requireString(record, 'planName', endpoint, label),
    ...parseRunMetadata(record, endpoint),
    versionNumber: requireInteger(record, 'versionNumber', endpoint, label, 1),
    profile: parseProfile(record['profile'], endpoint, `${label}.profile`),
    scenario: requireEnum(record['scenario'], RUN_SCENARIOS, endpoint, `${label}.scenario`),
    seed: requireInteger(record, 'seed', endpoint, label, 0, MAX_SEED),
    errorProbability: requireNullableString(record, 'errorProbability', endpoint, label),
    failureStepId: requireNullableUuid(record, 'failureStepId', endpoint, label),
    simulatorVersion: requireNonEmptyString(record, 'simulatorVersion', endpoint, label),
    evaluationVersion: requireNonEmptyString(record, 'evaluationVersion', endpoint, label),
    status: requireEnum(record['status'], RUN_STATUSES, endpoint, `${label}.status`),
    outcome: parseOutcome(record['outcome'], endpoint, `${label}.outcome`),
    startedAt: requireDate(record, 'startedAt', endpoint, label),
    finishedAt: requireNullableDate(record, 'finishedAt', endpoint, label),
    requestedBy: parseRequestedBy(record['requestedBy'], endpoint, `${label}.requestedBy`),
    reasonCode: requireNullableString(record, 'reasonCode', endpoint, label),
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
    ),
    stepCount: requireInteger(record, 'stepCount', endpoint, label, 1),
    partial: requireBoolean(record, 'partial', endpoint, label),
  };
}

function parseProfile(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonRunSummary['profile'] {
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
  label: string,
): ComparisonRunSummary['requestedBy'] {
  const record = requireRecord(value, endpoint, label);

  return {
    id: requireUuid(record, 'id', endpoint, label),
    email: requireString(record, 'email', endpoint, label),
    role: requireEnum(record['role'], ROLES, endpoint, `${label}.role`),
  };
}

function parseMatchedStep(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonMatchedStep {
  const record = requireRecord(value, endpoint, label);
  const logicalStepId = requireUuid(record, 'logicalStepId', endpoint, label);
  const left = parseStep(record['left'], endpoint, `${label}.left`);
  const right = parseStep(record['right'], endpoint, `${label}.right`);

  if (left.logicalStepId !== logicalStepId || right.logicalStepId !== logicalStepId) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label} does not match its left/right logicalStepId.`,
    );
  }

  const changedFields = requireArray(record, 'changedFields', endpoint, label).map(
    (entry, index) => parseChangedField(entry, endpoint, `${label}.changedFields[${index}]`),
  );
  const seenFields = new Set<ComparisonRuleField>();
  for (const change of changedFields) {
    if (seenFields.has(change.field)) {
      throw new MalformedApiResponseError(
        endpoint,
        `${label}.changedFields repeats ${change.field}.`,
      );
    }
    seenFields.add(change.field);
  }

  const numericComparison = parseNumericComparison(
    record['numericComparison'],
    endpoint,
    `${label}.numericComparison`,
  );
  if (numericComparison.comparable !== (left.unit === right.unit)) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.numericComparison comparable flag contradicts the step units.`,
    );
  }
  if (numericComparison.comparable && numericComparison.reason !== 'SAME_UNIT') {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.numericComparison marks a comparable step as UNIT_MISMATCH.`,
    );
  }
  if (!numericComparison.comparable && numericComparison.reason !== 'UNIT_MISMATCH') {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.numericComparison marks a non-comparable step as SAME_UNIT.`,
    );
  }

  return { logicalStepId, changedFields, numericComparison, left, right };
}

function parseNumericComparison(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonNumericComparison {
  const record = requireRecord(value, endpoint, label);
  const comparable = requireBoolean(record, 'comparable', endpoint, label);
  const reason = requireEnum(
    record['reason'],
    NUMERIC_COMPARISON_REASONS,
    endpoint,
    `${label}.reason`,
  );
  if (!Object.hasOwn(record, 'statistics')) {
    throw new MalformedApiResponseError(endpoint, `${label}.statistics is missing.`);
  }

  const statisticsValue = record['statistics'];

  if (statisticsValue === null) {
    if (comparable) {
      throw new MalformedApiResponseError(
        endpoint,
        `${label} is comparable but has no statistics.`,
      );
    }

    return { comparable, reason, statistics: null };
  }

  if (!comparable) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label} is not comparable but contains statistics.`,
    );
  }

  return {
    comparable,
    reason,
    statistics: parseStatisticsComparison(
      statisticsValue,
      endpoint,
      `${label}.statistics`,
    ),
  };
}

function parseStatisticsComparison(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonStatistics {
  const record = requireRecord(value, endpoint, label);

  return {
    minimum: parseDecimalValue(record['minimum'], endpoint, `${label}.minimum`),
    maximum: parseDecimalValue(record['maximum'], endpoint, `${label}.maximum`),
    average: parseDecimalValue(record['average'], endpoint, `${label}.average`),
    sampleCount: parseCountValue(record['sampleCount'], endpoint, `${label}.sampleCount`),
  };
}

function parseDecimalValue(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonStatistics['minimum'] {
  const record = requireRecord(value, endpoint, label);

  return {
    left: requireNullableString(record, 'left', endpoint, label),
    right: requireNullableString(record, 'right', endpoint, label),
    delta: requireNullableString(record, 'delta', endpoint, label),
  };
}

function parseCountValue(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonStatistics['sampleCount'] {
  const record = requireRecord(value, endpoint, label);

  return {
    left: requireNullableInteger(record, 'left', endpoint, label, 0),
    right: requireNullableInteger(record, 'right', endpoint, label, 0),
    delta: requireNullableDelta(record, 'delta', endpoint, label),
  };
}

function requireNullableDelta(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): number | null {
  if (!Object.hasOwn(record, key)) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is missing.`);
  }

  const value = record[key];
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MalformedApiResponseError(
      endpoint,
      `${label}.${key} is not a safe integer or null.`,
    );
  }

  return value;
}

function parseChangedField(
  value: unknown,
  endpoint: string,
  label: string,
): ComparisonChangedField {
  const record = requireRecord(value, endpoint, label);
  const field = requireEnum(record['field'], RULE_FIELDS, endpoint, `${label}.field`);

  return {
    field,
    left: requireChangeValue(record, 'left', endpoint, label),
    right: requireChangeValue(record, 'right', endpoint, label),
  };
}

function parseStep(value: unknown, endpoint: string, label: string): RunSnapshotStep {
  const record = requireRecord(value, endpoint, label);
  const measurements = requireArray(record, 'measurements', endpoint, label).map(
    (entry, index) =>
      parseMeasurement(entry, endpoint, `${label}.measurements[${index}]`),
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

function parseOutcome(value: unknown, endpoint: string, label: string): RunOutcome {
  if (value === null) {
    return null;
  }

  return requireEnum(value, RUN_OUTCOMES, endpoint, label);
}

function parseStepOutcome(
  value: unknown,
  endpoint: string,
  label: string,
): RunStepOutcome {
  if (value === null) {
    return null;
  }

  return requireEnum(value, RUN_OUTCOMES, endpoint, label);
}

function requireChangeValue(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): ComparisonChangeValue {
  const value = record[key];
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  throw new MalformedApiResponseError(
    endpoint,
    `${label}.${key} is not a string or a finite number.`,
  );
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
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is not a UUID.`);
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

function requireNullableUuid(
  record: Record<string, unknown>,
  key: string,
  endpoint: string,
  label: string,
): string | null {
  const value = requireNullableString(record, key, endpoint, label);
  if (value !== null && !UUID_PATTERN.test(value)) {
    throw new MalformedApiResponseError(endpoint, `${label}.${key} is not a UUID.`);
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
