import { ApiProperty } from '@nestjs/swagger';
import { DeviceProfileDto } from '../../device-profiles/dto/device-profile.dto.js';
import {
  RunOutcome,
  RunScenario,
  RunStatus,
} from '../../prisma/generated/client.js';
import {
  RunDeviceSnapshotDto,
  RunRequestedByDto,
  RunSnapshotStepDto,
} from '../../runs/dto/run-snapshot.dto.js';

const DECIMAL_OUTPUT_PATTERN = '^-?\\d+\\.\\d{6}$';

/**
 * Rule fields compared between two steps that share a logicalStepId. Their
 * order is fixed so `changedFields` and the diff table stay deterministic.
 */
export const COMPARISON_RULE_FIELDS = [
  'name',
  'unit',
  'position',
  'minimum',
  'maximum',
  'sampleCount',
  'intervalMs',
] as const;

export type ComparisonRuleField = (typeof COMPARISON_RULE_FIELDS)[number];

/** One changed rule and both runs' stored values. */
export class ComparisonRuleChangeDto {
  @ApiProperty({
    type: String,
    enum: COMPARISON_RULE_FIELDS,
    example: 'minimum',
  })
  field!: ComparisonRuleField;

  @ApiProperty({
    type: 'string',
    oneOf: [{ type: 'string' }, { type: 'number' }],
    example: '4.750000',
    description: 'Left run value: decimal text for limits, integer otherwise.',
  })
  left!: string | number;

  @ApiProperty({
    type: 'string',
    oneOf: [{ type: 'string' }, { type: 'number' }],
    example: '4.500000',
    description: 'Right run value: decimal text for limits, integer otherwise.',
  })
  right!: string | number;
}

/** One stored decimal statistic from each run plus their difference. */
export class ComparisonDecimalValueDto {
  @ApiProperty({
    type: String,
    nullable: true,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '4.980000',
    description: 'Left run value, or null when that run has no summary.',
  })
  left!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '5.020000',
    description: 'Right run value, or null when that run has no summary.',
  })
  right!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '0.040000',
    description:
      'right - left as a canonical six-place decimal. Null when either side is missing; never zero-filled.',
  })
  delta!: string | null;
}

/** One stored sample-count statistic from each run plus their difference. */
export class ComparisonCountValueDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 2,
    description: 'Left run value, or null when that run has no summary.',
  })
  left!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 3,
  })
  right!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    example: 1,
    description: 'right - left, or null when either side is missing.',
  })
  delta!: number | null;
}

/** Side-by-side stored step summaries; every missing member stays null. */
export class ComparisonStatisticsDto {
  @ApiProperty({ type: () => ComparisonDecimalValueDto })
  minimum!: ComparisonDecimalValueDto;

  @ApiProperty({ type: () => ComparisonDecimalValueDto })
  maximum!: ComparisonDecimalValueDto;

  @ApiProperty({ type: () => ComparisonDecimalValueDto })
  average!: ComparisonDecimalValueDto;

  @ApiProperty({ type: () => ComparisonCountValueDto })
  sampleCount!: ComparisonCountValueDto;
}

/**
 * Numeric comparison is only meaningful while both runs measure the same unit.
 * A unit mismatch returns `statistics: null`; no delta is produced.
 */
export class ComparisonNumericComparisonDto {
  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'True exactly when both steps use the same unit.',
  })
  comparable!: boolean;

  @ApiProperty({
    type: String,
    enum: ['SAME_UNIT', 'UNIT_MISMATCH'],
    example: 'SAME_UNIT',
  })
  reason!: 'SAME_UNIT' | 'UNIT_MISMATCH';

  @ApiProperty({
    type: () => ComparisonStatisticsDto,
    nullable: true,
    description:
      'Side-by-side summaries for the same unit, or null when units differ. Deltas are right - left.',
  })
  statistics!: ComparisonStatisticsDto | null;
}

/**
 * A step that exists in both runs, matched only by its persistent
 * logicalStepId. Both sides keep their own copied rules and evaluation.
 */
export class ComparisonMatchedStepDto {
  @ApiProperty({ type: String, format: 'uuid' })
  logicalStepId!: string;

  @ApiProperty({
    type: [ComparisonRuleChangeDto],
    description:
      'Changed rule fields in fixed order: name, unit, position, minimum, maximum, sampleCount, intervalMs. Empty when the rules are identical.',
  })
  changedFields!: ComparisonRuleChangeDto[];

  @ApiProperty({ type: () => ComparisonNumericComparisonDto })
  numericComparison!: ComparisonNumericComparisonDto;

  @ApiProperty({
    type: () => RunSnapshotStepDto,
    description:
      'Left run step with its own copied limits, verdict and measurement series. The series is never aligned to the right one.',
  })
  left!: RunSnapshotStepDto;

  @ApiProperty({
    type: () => RunSnapshotStepDto,
    description:
      'Right run step with its own copied limits, verdict and measurement series. The series is never aligned to the left one.',
  })
  right!: RunSnapshotStepDto;
}

/** Version numbers are plan-scoped; both runs always belong to one plan. */
export class ComparisonVersionDifferenceDto {
  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'True when both runs executed the same plan version.',
  })
  sameVersion!: boolean;

  @ApiProperty({ type: Number, minimum: 1, example: 1 })
  leftVersionNumber!: number;

  @ApiProperty({ type: Number, minimum: 1, example: 2 })
  rightVersionNumber!: number;
}

/**
 * One comparison side. Every value comes from the immutable run snapshot
 * written at start; the live plan is never queried.
 */
export class ComparisonRunSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  planVersionId!: string;

  @ApiProperty({ type: String, example: 'Power rail verification' })
  planName!: string;

  @ApiProperty({ type: Number, minimum: 1, example: 1 })
  versionNumber!: number;

  @ApiProperty({ type: () => DeviceProfileDto })
  profile!: DeviceProfileDto;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Device linked at start, or null for legacy and device-less runs.',
  })
  deviceId!: string | null;

  @ApiProperty({
    type: () => RunDeviceSnapshotDto,
    nullable: true,
    description:
      'Device values copied into this run at start, or null. The live device is never joined.',
  })
  deviceSnapshot!: RunDeviceSnapshotDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 100,
    example: 'BATCH-2026-001',
    description: 'Batch display value copied at start, or null.',
  })
  batchNumber!: string | null;

  @ApiProperty({ enum: RunScenario, example: RunScenario.NORMAL })
  scenario!: RunScenario;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 4_294_967_295,
    example: 123_456_789,
  })
  seed!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Canonical probability for RANDOM, otherwise null.',
  })
  errorProbability!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'Logical step selected for FORCED_FAILURE, otherwise null.',
  })
  failureStepId!: string | null;

  @ApiProperty({ type: String, example: 'mulberry32-v1' })
  simulatorVersion!: string;

  @ApiProperty({ type: String, example: 'decimal-v1' })
  evaluationVersion!: string;

  @ApiProperty({ enum: RunStatus, example: RunStatus.COMPLETED })
  status!: RunStatus;

  @ApiProperty({
    enum: RunOutcome,
    nullable: true,
    description:
      'Overall verdict; null for CANCELLED, INTERRUPTED and ERROR runs.',
  })
  outcome!: RunOutcome | null;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;

  @ApiProperty({ type: () => RunRequestedByDto })
  requestedBy!: RunRequestedByDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Safe technical/cancellation reason code, if any.',
  })
  reasonCode!: string | null;

  @ApiProperty({ type: Number, minimum: 1, maximum: 10_000, example: 6 })
  expectedSampleCount!: number;

  @ApiProperty({ type: Number, minimum: 0, maximum: 10_000, example: 6 })
  recordedSampleCount!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 0 })
  outOfToleranceCount!: number;

  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 3,
    description: 'Number of copied steps in this run.',
  })
  stepCount!: number;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'True when the run is not COMPLETED or recorded fewer samples than expected.',
  })
  partial!: boolean;
}

/**
 * Comparison of two terminal runs of one plan. Steps are matched by
 * logicalStepId; matched and one-sided lists are ordered by the owning side's
 * position, then logicalStepId. The response contains no generated timestamp,
 * so identical stored data always serialises identically.
 */
export class RunComparisonDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'The shared plan id. Both runs always belong to this plan.',
  })
  planId!: string;

  @ApiProperty({ type: () => ComparisonVersionDifferenceDto })
  versionDifference!: ComparisonVersionDifferenceDto;

  @ApiProperty({ type: () => ComparisonRunSummaryDto })
  leftRun!: ComparisonRunSummaryDto;

  @ApiProperty({ type: () => ComparisonRunSummaryDto })
  rightRun!: ComparisonRunSummaryDto;

  @ApiProperty({
    type: [ComparisonMatchedStepDto],
    description:
      'Steps present in both runs, ordered by left position then logicalStepId.',
  })
  matchedSteps!: ComparisonMatchedStepDto[];

  @ApiProperty({
    type: [RunSnapshotStepDto],
    description:
      'Steps that exist only in the right run, ordered by right position then logicalStepId. The left side is absent, not zero-filled.',
  })
  addedSteps!: RunSnapshotStepDto[];

  @ApiProperty({
    type: [RunSnapshotStepDto],
    description:
      'Steps that exist only in the left run, ordered by left position then logicalStepId. The right side is absent, not zero-filled.',
  })
  removedSteps!: RunSnapshotStepDto[];
}
