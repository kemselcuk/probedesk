import { ApiProperty } from '@nestjs/swagger';
import { RunScenario } from '../../prisma/generated/client.js';

/** Resolved filters echoed by the overview response. */
export class AnalyticsOverviewFiltersDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Canonical UTC inclusive lower bound actually applied.',
  })
  from!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Canonical UTC exclusive upper bound actually applied.',
  })
  to!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Applied plan filter, or null.',
  })
  planId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Applied published version filter, or null.',
  })
  planVersionId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Applied device filter, or null.',
  })
  deviceId!: string | null;

  @ApiProperty({
    type: String,
    maxLength: 100,
    nullable: true,
    example: 'BATCH-2026-001',
    description:
      'Applied canonical uppercase batch key, or null. Filtering is exact and case-insensitive on the stored key.',
  })
  batchNumber!: string | null;

  @ApiProperty({
    enum: RunScenario,
    nullable: true,
    description: 'Applied scenario filter, or null.',
  })
  scenario!: RunScenario | null;
}

/**
 * KPI counts for all statuses. `passRatePercent` and `averageDurationMs` are
 * backend-rounded decimal strings; they are null when no applicable sample
 * exists, never zero or an invented value.
 */
export class AnalyticsOverviewSummaryDto {
  @ApiProperty({ type: Number, minimum: 0, example: 42 })
  totalRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 30 })
  completedRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 25 })
  passedRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 5 })
  failedRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 1 })
  runningRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 2 })
  cancelledRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 1 })
  interruptedRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 1 })
  errorRuns!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '83.33',
    description:
      '100 × passedRuns / completedRuns, rounded half-up to two decimal places by PostgreSQL numeric. Null when completedRuns is zero.',
  })
  passRatePercent!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '2500.000',
    description:
      'Mean finishedAt-startedAt duration of COMPLETED runs with a finish time, rounded half-up to three decimal places. Null when no sample exists.',
  })
  averageDurationMs!: string | null;
}

/** One UTC calendar day of the trend; missing days are filled with zero/null. */
export class AnalyticsOverviewTrendDayDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-10-01',
    description: 'UTC calendar day (YYYY-MM-DD).',
  })
  date!: string;

  @ApiProperty({ type: Number, minimum: 0, example: 4 })
  totalRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 3 })
  completedRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 2 })
  passedRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 1 })
  failedRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 0 })
  runningRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 1 })
  cancelledRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 0 })
  interruptedRuns!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 0 })
  errorRuns!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '66.67',
    description:
      'Day pass rate as a two-decimal half-up string, or null when the day has no COMPLETED run.',
  })
  passRatePercent!: string | null;
}

/**
 * One failing step group. Version and unit are part of the identity; the
 * permanent ids support the history drilldown.
 */
export class AnalyticsOverviewTopFailedStepDto {
  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  planVersionId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  logicalStepId!: string;

  @ApiProperty({ type: String, example: 'Power rail verification' })
  planName!: string;

  @ApiProperty({ type: String, example: 'Output Voltage' })
  stepName!: string;

  @ApiProperty({ type: Number, minimum: 1, example: 3 })
  versionNumber!: number;

  @ApiProperty({ type: String, example: 'V' })
  unit!: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 10,
    description:
      'COMPLETED steps in COMPLETED runs for this plan/version/logical step/unit group.',
  })
  completedStepRuns!: number;

  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 4,
    description: 'COMPLETED steps whose recorded outcome is FAILED.',
  })
  failedStepRuns!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '40.00',
    description:
      '100 × failedStepRuns / completedStepRuns, rounded half-up to two decimal places. Null only when the denominator is zero.',
  })
  failureRatePercent!: string | null;
}

/** Complete GET /api/analytics/overview payload. */
export class AnalyticsOverviewDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'Transaction snapshot timestamp. Summary, trend and top steps all come from the same repeatable-read snapshot.',
  })
  asOf!: string;

  @ApiProperty({ type: () => AnalyticsOverviewFiltersDto })
  filters!: AnalyticsOverviewFiltersDto;

  @ApiProperty({ type: () => AnalyticsOverviewSummaryDto })
  summary!: AnalyticsOverviewSummaryDto;

  @ApiProperty({
    type: [AnalyticsOverviewTrendDayDto],
    description:
      'Every UTC day intersecting the range, including zero-count days.',
  })
  trend!: AnalyticsOverviewTrendDayDto[];

  @ApiProperty({
    type: [AnalyticsOverviewTopFailedStepDto],
    description:
      'At most ten failing step groups ordered by failedStepRuns DESC, completedStepRuns DESC and permanent ids.',
  })
  topFailedSteps!: AnalyticsOverviewTopFailedStepDto[];
}
