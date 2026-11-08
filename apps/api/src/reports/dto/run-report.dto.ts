import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { DeviceProfileDto } from '../../device-profiles/dto/device-profile.dto.js';
import {
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../../prisma/generated/client.js';
import {
  RunDeviceSnapshotDto,
  RunMeasurementDto,
  RunRequestedByDto,
  RunStepStatisticsDto,
} from '../../runs/dto/run-snapshot.dto.js';

const DECIMAL_OUTPUT_PATTERN = '^-?\\d+\\.\\d{6}$';
const PROBABILITY_OUTPUT_PATTERN = '^\\d+\\.\\d{6}$';

/**
 * One immutable step inside a terminal run report. The rule, counter, summary
 * and measurement values come from the run snapshot; none of them are
 * recalculated from the live plan.
 */
export class RunReportStepDto {
  @ApiProperty({ type: String, format: 'uuid' })
  runStepId!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  logicalStepId!: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    description: '1-based step order inside this run.',
  })
  position!: number;

  @ApiProperty({ type: String, example: 'Output voltage' })
  name!: string;

  @ApiProperty({ type: String, example: 'V' })
  unit!: string;

  @ApiProperty({
    type: String,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '4.750000',
  })
  minimum!: string;

  @ApiProperty({
    type: String,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '5.250000',
  })
  maximum!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 1000, example: 100 })
  sampleCount!: number;

  @ApiProperty({ type: Number, minimum: 100, maximum: 5000, example: 250 })
  intervalMs!: number;

  @ApiProperty({ enum: RunStepStatus, example: RunStepStatus.COMPLETED })
  status!: RunStepStatus;

  @ApiProperty({
    enum: RunOutcome,
    nullable: true,
    description:
      'Stored step verdict. Null unless the step completed; partial steps keep their recorded samples.',
  })
  outcome!: RunOutcome | null;

  @ApiProperty({ type: Number, minimum: 0, example: 100 })
  recordedCount!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 0 })
  outOfToleranceCount!: number;

  @ApiProperty({ type: Number, nullable: true, minimum: 0, example: null })
  firstFailureSampleIndex!: number | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description: 'True exactly when outOfToleranceCount is greater than zero.',
  })
  hasOutOfTolerance!: boolean;

  @ApiProperty({
    type: () => RunStepStatisticsDto,
    description:
      'Stored summary for a completed step; every numeric member is null for a partial step.',
  })
  statistics!: RunStepStatisticsDto;

  @ApiProperty({
    type: [RunMeasurementDto],
    description:
      'Only the samples actually recorded, ordered by ascending sampleIndex. Missing samples are never invented.',
  })
  measurements!: RunMeasurementDto[];
}

/**
 * Versioned terminal-run report projection. It is built from one consistent
 * repeatable-read snapshot and contains no session, request hash, idempotency
 * key, password or event payload data.
 */
export class RunReportDto {
  @ApiProperty({
    type: Number,
    enum: [1],
    example: 1,
    description: 'Report projection schema version.',
  })
  schemaVersion!: 1;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'UTC time at which this projection was generated.',
  })
  generatedAt!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  runId!: string;

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
      'Device values copied at start. Later device edits never change it.',
  })
  deviceSnapshot!: RunDeviceSnapshotDto | null;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 100,
    description:
      'Batch display value copied at start, or null when the run had no batch.',
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
    pattern: PROBABILITY_OUTPUT_PATTERN,
    description: 'Canonical six-place probability for RANDOM, otherwise null.',
  })
  errorProbability!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    format: 'uuid',
    description: 'Logical step selected for FORCED_FAILURE, otherwise null.',
  })
  failureStepId!: string | null;

  @ApiProperty({ type: String, example: 'sim-v1' })
  simulatorVersion!: string;

  @ApiProperty({ type: String, example: 'decimal-v1' })
  evaluationVersion!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  finishedAt!: string | null;

  @ApiProperty({ enum: RunStatus, example: RunStatus.COMPLETED })
  status!: RunStatus;

  @ApiProperty({
    enum: RunOutcome,
    nullable: true,
    description: 'Overall verdict; only a COMPLETED run has one.',
  })
  outcome!: RunOutcome | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Safe technical reason code for a terminal non-success.',
  })
  reasonCode!: string | null;

  @ApiProperty({ type: Number, minimum: 1, maximum: 10_000, example: 6 })
  expectedSampleCount!: number;

  @ApiProperty({ type: Number, minimum: 0, maximum: 10_000, example: 6 })
  recordedSampleCount!: number;

  @ApiProperty({
    type: () => RunRequestedByDto,
    description:
      'Public requester summary. Session and password fields are never included.',
  })
  requestedBy!: RunRequestedByDto;

  @ApiProperty({
    type: [RunReportStepDto],
    description: 'Steps ordered by ascending position.',
  })
  steps!: RunReportStepDto[];
}

export enum ReportExportFormat {
  CSV = 'csv',
  JSON = 'json',
}

/** Query contract for GET /runs/:id/export. */
export class ReportExportQueryDto {
  @ApiProperty({
    enum: ReportExportFormat,
    description:
      'Attachment format. The CSV variant is UTF-8 with BOM, comma-delimited and CRLF-terminated; JSON is the same versioned report projection.',
  })
  @IsEnum(ReportExportFormat, {
    message: `format must be one of ${Object.values(ReportExportFormat).join(', ')}`,
  })
  format!: ReportExportFormat;
}
