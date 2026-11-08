import { ApiProperty } from '@nestjs/swagger';
import {
  RunOutcome,
  RunScenario,
  RunStatus,
} from '../../prisma/generated/client.js';
import { RunDeviceSnapshotDto, RunRequestedByDto } from './run-snapshot.dto.js';

/**
 * Earliest out-of-tolerance sample of a run. It comes from the step rows copied
 * at start, ordered by step position and then by the recorded sample index.
 */
export class RunFirstFailureDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 2,
    description: '1-based position of the failing step inside the run.',
  })
  stepPosition!: number;

  @ApiProperty({ type: String, example: 'Current Draw' })
  stepName!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  logicalStepId!: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    example: 1,
    description: 'Zero-based index of the first out-of-tolerance sample.',
  })
  sampleIndex!: number;
}

/**
 * One run history row. It intentionally contains no step or measurement
 * arrays; `GET /api/runs/:id` serves the full immutable snapshot.
 */
export class RunHistoryItemDto {
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
      'Device values copied at start, or null. Later device edits never change history.',
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

  @ApiProperty({ enum: RunStatus, example: RunStatus.COMPLETED })
  status!: RunStatus;

  @ApiProperty({
    enum: RunOutcome,
    nullable: true,
    description: 'Overall verdict; only a COMPLETED run has one.',
  })
  outcome!: RunOutcome | null;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;

  @ApiProperty({ type: Number, minimum: 1, maximum: 10_000, example: 6 })
  expectedSampleCount!: number;

  @ApiProperty({ type: Number, minimum: 0, maximum: 10_000, example: 6 })
  recordedSampleCount!: number;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 10_000,
    example: 0,
    description:
      'Sum of the stored step out-of-tolerance counters. Aggregate only; use the run snapshot for per-step values.',
  })
  outOfToleranceCount!: number;

  @ApiProperty({
    type: () => RunFirstFailureDto,
    nullable: true,
    description:
      'Earliest failure by step position and sample index, or null when no recorded sample is out of tolerance.',
  })
  firstFailure!: RunFirstFailureDto | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'True only when fewer samples were recorded than expected. A terminal CANCELLED, INTERRUPTED or ERROR run that recorded every expected sample is not partial; status and outcome communicate the stop.',
  })
  partial!: boolean;

  @ApiProperty({ type: () => RunRequestedByDto })
  requestedBy!: RunRequestedByDto;
}

/** One page of the stable startedAt DESC, id DESC run history. */
export class RunHistoryPageDto {
  @ApiProperty({ type: [RunHistoryItemDto] })
  items!: RunHistoryItemDto[];

  @ApiProperty({ type: Number, minimum: 1, example: 1 })
  page!: number;

  @ApiProperty({ type: Number, minimum: 1, maximum: 100, example: 20 })
  limit!: number;

  @ApiProperty({
    type: Number,
    minimum: 0,
    example: 7,
    description: 'Total number of runs matching the filters.',
  })
  total!: number;

  @ApiProperty({
    type: Number,
    minimum: 0,
    example: 1,
    description:
      'Number of pages for this filter and limit. Zero when no run matches.',
  })
  totalPages!: number;
}
