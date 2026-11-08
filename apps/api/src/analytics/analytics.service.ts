import { Inject, Injectable } from '@nestjs/common';
import { ValidationFailedException } from '../common/errors/validation.exception.js';
import { PlanRevisionState, Prisma } from '../prisma/generated/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  enumerateUtcDates,
  resolveAnalyticsFilters,
  type ResolvedAnalyticsFilters,
} from './analytics-domain.js';
import {
  buildAnalyticsWhere,
  buildSummaryQuery,
  buildTopFailedStepsQuery,
  buildTrendQuery,
} from './analytics-query.js';
import type { AnalyticsOverviewQueryDto } from './dto/analytics-overview-query.dto.js';
import {
  AnalyticsOverviewDto,
  AnalyticsOverviewSummaryDto,
  AnalyticsOverviewTrendDayDto,
  AnalyticsOverviewTopFailedStepDto,
} from './dto/analytics-overview.dto.js';

/**
 * A short repeatable-read transaction gives `asOf`, the resolved filters and
 * every aggregate one committed snapshot. Summary, trend and top-step numbers
 * therefore agree even while a run is finishing in another connection.
 */
const ANALYTICS_TRANSACTION_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 10_000,
  maxWait: 5_000,
} as const;

interface AsOfRow {
  asOf: Date | string;
}

interface SummaryRow {
  totalRuns: number;
  completedRuns: number;
  passedRuns: number;
  failedRuns: number;
  runningRuns: number;
  cancelledRuns: number;
  interruptedRuns: number;
  errorRuns: number;
  passRatePercent: string | null;
  averageDurationMs: string | null;
}

interface TrendRow {
  date: string;
  totalRuns: number;
  completedRuns: number;
  passedRuns: number;
  failedRuns: number;
  runningRuns: number;
  cancelledRuns: number;
  interruptedRuns: number;
  errorRuns: number;
  passRatePercent: string | null;
}

interface TopFailedStepRow {
  planId: string;
  planVersionId: string;
  logicalStepId: string;
  planName: string;
  stepName: string;
  versionNumber: number;
  unit: string;
  completedStepRuns: number;
  failedStepRuns: number;
  failureRatePercent: string | null;
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async overview(
    query: AnalyticsOverviewQueryDto,
  ): Promise<AnalyticsOverviewDto> {
    const filters = resolveAnalyticsFilters(query);

    return this.prisma.$transaction(async (tx) => {
      const asOfRows = await tx.$queryRaw<AsOfRow[]>`
        SELECT now() AS "asOf"
      `;
      const asOf = toDate(asOfRows[0]?.asOf);

      await assertPlanVersionBelongsToPlan(tx, filters);

      const where = buildAnalyticsWhere(filters);
      const summaryRows = await tx.$queryRaw<SummaryRow[]>(
        buildSummaryQuery(where),
      );
      const trendRows = await tx.$queryRaw<TrendRow[]>(buildTrendQuery(where));
      const topRows = await tx.$queryRaw<TopFailedStepRow[]>(
        buildTopFailedStepsQuery(where),
      );

      const summaryRow = summaryRows[0];
      if (summaryRow === undefined) {
        throw new Error('The analytics summary query returned no row.');
      }

      return {
        asOf: asOf.toISOString(),
        filters: {
          from: filters.from.toISOString(),
          to: filters.to.toISOString(),
          planId: filters.planId,
          planVersionId: filters.planVersionId,
          deviceId: filters.deviceId,
          batchNumber: filters.batchNumberKey,
          scenario: filters.scenario,
        },
        summary: toSummary(summaryRow),
        trend: fillTrend(filters.from, filters.to, trendRows),
        topFailedSteps: topRows.map(toTopFailedStep),
      };
    }, ANALYTICS_TRANSACTION_OPTIONS);
  }
}

/**
 * A version filter that exists but belongs to another plan is a submitted
 * filter error. An unknown version is not a mismatch: it simply matches no
 * run, like every other unknown filter id.
 */
async function assertPlanVersionBelongsToPlan(
  tx: Prisma.TransactionClient,
  filters: ResolvedAnalyticsFilters,
): Promise<void> {
  if (filters.planId === null || filters.planVersionId === null) {
    return;
  }

  const revision = await tx.planRevision.findFirst({
    where: {
      id: filters.planVersionId,
      // A draft revision is not a published version filter. Treating it as
      // unknown returns an empty overview instead of confirming that another
      // plan's draft exists, which keeps draft content hidden from non-Planners.
      state: PlanRevisionState.PUBLISHED,
    },
    select: { planId: true },
  });

  if (revision !== null && revision.planId !== filters.planId) {
    throw new ValidationFailedException([
      {
        path: 'planVersionId',
        code: 'INVALID_VALUE',
        message: 'planVersionId must belong to planId',
      },
    ]);
  }
}

function toSummary(row: SummaryRow): AnalyticsOverviewSummaryDto {
  return {
    totalRuns: row.totalRuns,
    completedRuns: row.completedRuns,
    passedRuns: row.passedRuns,
    failedRuns: row.failedRuns,
    runningRuns: row.runningRuns,
    cancelledRuns: row.cancelledRuns,
    interruptedRuns: row.interruptedRuns,
    errorRuns: row.errorRuns,
    passRatePercent: row.passRatePercent,
    averageDurationMs: row.averageDurationMs,
  };
}

/**
 * Expands the grouped rows to every UTC day touched by the range. Days without
 * a run keep zero status counts and a null rate; the first and last buckets are
 * naturally partial because the SQL range is `[from, to)`.
 */
function fillTrend(
  from: Date,
  to: Date,
  rows: readonly TrendRow[],
): AnalyticsOverviewTrendDayDto[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));

  return enumerateUtcDates(from, to).map((date) => {
    const row = byDate.get(date);

    if (row === undefined) {
      return {
        date,
        totalRuns: 0,
        completedRuns: 0,
        passedRuns: 0,
        failedRuns: 0,
        runningRuns: 0,
        cancelledRuns: 0,
        interruptedRuns: 0,
        errorRuns: 0,
        passRatePercent: null,
      };
    }

    return {
      date: row.date,
      totalRuns: row.totalRuns,
      completedRuns: row.completedRuns,
      passedRuns: row.passedRuns,
      failedRuns: row.failedRuns,
      runningRuns: row.runningRuns,
      cancelledRuns: row.cancelledRuns,
      interruptedRuns: row.interruptedRuns,
      errorRuns: row.errorRuns,
      passRatePercent: row.passRatePercent,
    };
  });
}

function toTopFailedStep(
  row: TopFailedStepRow,
): AnalyticsOverviewTopFailedStepDto {
  return {
    planId: row.planId,
    planVersionId: row.planVersionId,
    logicalStepId: row.logicalStepId,
    planName: row.planName,
    stepName: row.stepName,
    versionNumber: row.versionNumber,
    unit: row.unit,
    completedStepRuns: row.completedStepRuns,
    failedStepRuns: row.failedStepRuns,
    failureRatePercent: row.failureRatePercent,
  };
}

function toDate(value: Date | string | undefined): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  throw new Error('The analytics snapshot timestamp is not a valid instant.');
}
