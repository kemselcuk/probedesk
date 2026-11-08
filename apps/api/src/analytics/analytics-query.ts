import { Prisma } from '../prisma/generated/client.js';
import type { ResolvedAnalyticsFilters } from './analytics-domain.js';

/**
 * All aggregate queries filter `test_runs.startedAt` over `[from, to)` with the
 * same optional predicates. The time filter always exists, so the returned
 * fragment is a complete WHERE clause.
 */
export function buildAnalyticsWhere(
  filters: ResolvedAnalyticsFilters,
): Prisma.Sql {
  const conditions: Prisma.Sql[] = [
    Prisma.sql`r."startedAt" >= ${filters.from.toISOString()}::timestamptz`,
    Prisma.sql`r."startedAt" < ${filters.to.toISOString()}::timestamptz`,
  ];

  if (filters.planId !== null) {
    conditions.push(Prisma.sql`r."planId" = ${filters.planId}::uuid`);
  }
  if (filters.planVersionId !== null) {
    conditions.push(
      Prisma.sql`r."planRevisionId" = ${filters.planVersionId}::uuid`,
    );
  }
  if (filters.deviceId !== null) {
    conditions.push(Prisma.sql`r."deviceId" = ${filters.deviceId}::uuid`);
  }
  if (filters.batchNumberKey !== null) {
    conditions.push(Prisma.sql`r."batchNumberKey" = ${filters.batchNumberKey}`);
  }
  if (filters.scenario !== null) {
    conditions.push(
      Prisma.sql`r."scenario" = ${filters.scenario}::"RunScenario"`,
    );
  }

  return Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
}

/**
 * One-row KPI aggregate. Pass rate and average duration are computed and
 * rounded by PostgreSQL `numeric`, never by JavaScript binary floating point.
 * The casts to `numeric(20,2)` / `numeric(20,3)` make the wire values fixed
 * scale decimal strings.
 */
export function buildSummaryQuery(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      count(*)::int AS "totalRuns",
      count(*) FILTER (WHERE r."status" = 'COMPLETED')::int
        AS "completedRuns",
      count(*) FILTER (
        WHERE r."status" = 'COMPLETED' AND r."outcome" = 'PASSED'
      )::int AS "passedRuns",
      count(*) FILTER (
        WHERE r."status" = 'COMPLETED' AND r."outcome" = 'FAILED'
      )::int AS "failedRuns",
      count(*) FILTER (WHERE r."status" = 'RUNNING')::int
        AS "runningRuns",
      count(*) FILTER (WHERE r."status" = 'CANCELLED')::int
        AS "cancelledRuns",
      count(*) FILTER (WHERE r."status" = 'INTERRUPTED')::int
        AS "interruptedRuns",
      count(*) FILTER (WHERE r."status" = 'ERROR')::int AS "errorRuns",
      CASE
        WHEN count(*) FILTER (WHERE r."status" = 'COMPLETED') = 0 THEN NULL
        ELSE round(
          100::numeric
            * count(*) FILTER (
              WHERE r."status" = 'COMPLETED' AND r."outcome" = 'PASSED'
            )
            / count(*) FILTER (WHERE r."status" = 'COMPLETED'),
          2
        )::numeric(20, 2)::text
      END AS "passRatePercent",
      round(
        avg(
          extract(epoch FROM (r."finishedAt" - r."startedAt")) * 1000
        ) FILTER (
          WHERE r."status" = 'COMPLETED' AND r."finishedAt" IS NOT NULL
        ),
        3
      )::numeric(20, 3)::text AS "averageDurationMs"
    FROM "test_runs" AS r
    ${where}
  `;
}

/**
 * Per-UTC-day status counts. Missing dates are filled by the service with zero
 * counts and a null pass rate. The date expression uses the stored UTC instant,
 * not the server timezone.
 */
export function buildTrendQuery(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT
      to_char(
        (r."startedAt" AT TIME ZONE 'UTC')::date,
        'YYYY-MM-DD'
      ) AS "date",
      count(*)::int AS "totalRuns",
      count(*) FILTER (WHERE r."status" = 'COMPLETED')::int
        AS "completedRuns",
      count(*) FILTER (
        WHERE r."status" = 'COMPLETED' AND r."outcome" = 'PASSED'
      )::int AS "passedRuns",
      count(*) FILTER (
        WHERE r."status" = 'COMPLETED' AND r."outcome" = 'FAILED'
      )::int AS "failedRuns",
      count(*) FILTER (WHERE r."status" = 'RUNNING')::int
        AS "runningRuns",
      count(*) FILTER (WHERE r."status" = 'CANCELLED')::int
        AS "cancelledRuns",
      count(*) FILTER (WHERE r."status" = 'INTERRUPTED')::int
        AS "interruptedRuns",
      count(*) FILTER (WHERE r."status" = 'ERROR')::int AS "errorRuns",
      CASE
        WHEN count(*) FILTER (WHERE r."status" = 'COMPLETED') = 0 THEN NULL
        ELSE round(
          100::numeric
            * count(*) FILTER (
              WHERE r."status" = 'COMPLETED' AND r."outcome" = 'PASSED'
            )
            / count(*) FILTER (WHERE r."status" = 'COMPLETED'),
          2
        )::numeric(20, 2)::text
      END AS "passRatePercent"
    FROM "test_runs" AS r
    ${where}
    GROUP BY (r."startedAt" AT TIME ZONE 'UTC')::date
  `;
}

/**
 * Top ten failing step groups. Only COMPLETED runs and their COMPLETED steps
 * participate. The grouping key deliberately includes plan version and unit so
 * rule changes are never mixed into one performance row. The stable order ends
 * with the permanent ids and a C-collated unit for deterministic ties.
 */
export function buildTopFailedStepsQuery(where: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    WITH "grouped" AS (
      SELECT
        r."planId" AS "planId",
        r."planRevisionId" AS "planVersionId",
        s."logicalStepId" AS "logicalStepId",
        s."unit" AS "unit",
        min(r."planNameSnapshot") AS "planName",
        min(r."versionNumberSnapshot")::int AS "versionNumber",
        min(s."name") AS "stepName",
        count(*)::int AS "completedStepRuns",
        (count(*) FILTER (WHERE s."outcome" = 'FAILED'))::int
          AS "failedStepRuns"
      FROM "test_runs" AS r
      JOIN "run_steps" AS s ON s."runId" = r."id"
      ${where}
        AND r."status" = 'COMPLETED'
        AND s."status" = 'COMPLETED'
      GROUP BY
        r."planId",
        r."planRevisionId",
        s."logicalStepId",
        s."unit"
      HAVING count(*) FILTER (WHERE s."outcome" = 'FAILED') > 0
    )
    SELECT
      "planId",
      "planVersionId",
      "logicalStepId",
      "unit",
      "planName",
      "versionNumber",
      "stepName",
      "completedStepRuns",
      "failedStepRuns",
      CASE
        WHEN "completedStepRuns" = 0 THEN NULL
        ELSE round(
          100::numeric * "failedStepRuns" / "completedStepRuns",
          2
        )::numeric(20, 2)::text
      END AS "failureRatePercent"
    FROM "grouped"
    ORDER BY
      "failedStepRuns" DESC,
      "completedStepRuns" DESC,
      "planId" ASC,
      "planVersionId" ASC,
      "logicalStepId" ASC,
      "unit" COLLATE "C" ASC
    LIMIT 10
  `;
}
