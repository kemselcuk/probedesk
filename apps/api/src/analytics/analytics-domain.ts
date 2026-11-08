import { ValidationFailedException } from '../common/errors/validation.exception.js';
import type { RunScenario } from '../prisma/generated/client.js';
import { toBatchNumberKey } from '../runs/run-metadata.js';
import type { AnalyticsOverviewQueryDto } from './dto/analytics-overview-query.dto.js';

/** The dashboard refuses a time range wider than one leap year. */
export const ANALYTICS_MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;

/**
 * Validated and canonicalised filter values. UUIDs are lowercase, the batch is
 * the uppercase canonical key used by `test_runs.batchNumberKey`, and both
 * instants are UTC. SQL always receives these canonical values so equivalent
 * inputs produce the same rows.
 */
export interface ResolvedAnalyticsFilters {
  from: Date;
  to: Date;
  planId: string | null;
  planVersionId: string | null;
  deviceId: string | null;
  batchNumberKey: string | null;
  scenario: RunScenario | null;
}

/**
 * Parses the required range and optional filters. The HTTP DTO already
 * validates shape; this second pass keeps a direct service call from silently
 * producing an invalid Date or an inverted range.
 */
export function resolveAnalyticsFilters(
  query: AnalyticsOverviewQueryDto,
): ResolvedAnalyticsFilters {
  const from = parseRequiredInstant(query.from, 'from');
  const to = parseRequiredInstant(query.to, 'to');

  if (from.getTime() >= to.getTime()) {
    throw invalidRange('to', 'to must be after from');
  }

  if (to.getTime() - from.getTime() > ANALYTICS_MAX_RANGE_DAYS * DAY_MS) {
    throw invalidRange(
      'to',
      `to must be at most ${ANALYTICS_MAX_RANGE_DAYS} days after from`,
    );
  }

  return {
    from,
    to,
    planId: query.planId?.toLowerCase() ?? null,
    planVersionId: query.planVersionId?.toLowerCase() ?? null,
    deviceId: query.deviceId?.toLowerCase() ?? null,
    batchNumberKey:
      query.batchNumber === undefined
        ? null
        : toBatchNumberKey(query.batchNumber),
    scenario: query.scenario ?? null,
  };
}

function parseRequiredInstant(value: string, field: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw invalidRange(field, `${field} must be a valid ISO-8601 instant`);
  }

  return parsed;
}

function invalidRange(
  field: string,
  message: string,
): ValidationFailedException {
  return new ValidationFailedException([
    { path: field, code: 'INVALID_VALUE', message },
  ]);
}

/**
 * Every UTC calendar day touched by `[from, to)`, including partial first and
 * last days. A run at exactly `to` belongs to no bucket, and a run at exactly
 * `from` belongs to the first one.
 */
export function enumerateUtcDates(from: Date, to: Date): string[] {
  const firstDay = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const lastMoment = new Date(to.getTime() - 1);
  const lastDay = Date.UTC(
    lastMoment.getUTCFullYear(),
    lastMoment.getUTCMonth(),
    lastMoment.getUTCDate(),
  );
  const dates: string[] = [];

  for (let current = firstDay; current <= lastDay; current += DAY_MS) {
    dates.push(new Date(current).toISOString().slice(0, 10));
  }

  return dates;
}
