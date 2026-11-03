import { ApiProperty } from '@nestjs/swagger';
import { DeviceProfileDto } from '../../device-profiles/dto/device-profile.dto.js';
import {
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../../prisma/generated/client.js';

const DECIMAL_OUTPUT_PATTERN = '^-?\\d+\\.\\d{6}$';
const PROBABILITY_OUTPUT_PATTERN = '^\\d+\\.\\d{6}$';

/** Safe requester identity; never contains a password hash or session token. */
export class RunRequestedByDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    format: 'email',
    example: 'operator@example.com',
  })
  email!: string;

  @ApiProperty({
    type: String,
    enum: ['PLANNER', 'OPERATOR', 'VIEWER'],
    example: 'OPERATOR',
  })
  role!: 'PLANNER' | 'OPERATOR' | 'VIEWER';
}

/**
 * Stored summary of a completed step. Every numeric member is null while the
 * step is partial; it is never filled with a zero placeholder.
 */
export class RunStepStatisticsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '4.980000',
    description: 'Smallest recorded sample, or null for a partial step.',
  })
  minimum!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '5.020000',
    description: 'Largest recorded sample, or null for a partial step.',
  })
  maximum!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '5.000000',
    description: 'Rounded average, or null for a partial step.',
  })
  average!: string | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: 100,
    description:
      'Sample count covered by the stored summary, or null when no summary exists.',
  })
  sampleCount!: number | null;
}

/** One recorded sample from the immutable run history. */
export class RunMeasurementDto {
  @ApiProperty({ type: Number, minimum: 0, example: 0 })
  sampleIndex!: number;

  @ApiProperty({
    type: String,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '5.000000',
    description: 'Canonical six-fraction-digit measurement value.',
  })
  value!: string;

  @ApiProperty({ type: Boolean, example: true })
  isWithinTolerance!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  recordedAt!: string;

  @ApiProperty({ type: Number, minimum: 0, example: 200 })
  elapsedMs!: number;
}

/** One step of the run snapshot, including its copied rules and samples. */
export class RunSnapshotStepDto {
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

  @ApiProperty({ enum: RunStepStatus, example: RunStepStatus.RUNNING })
  status!: RunStepStatus;

  @ApiProperty({
    enum: RunOutcome,
    nullable: true,
    description:
      'Step verdict. Null unless the step is COMPLETED; a partial step can still report an out-of-tolerance sample.',
  })
  outcome!: RunOutcome | null;

  @ApiProperty({ type: Number, minimum: 0, example: 42 })
  recordedCount!: number;

  @ApiProperty({ type: Number, minimum: 0, example: 0 })
  outOfToleranceCount!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: 0,
    example: null,
    description: 'Index of the first out-of-tolerance sample, if any.',
  })
  firstFailureSampleIndex!: number | null;

  @ApiProperty({
    type: Boolean,
    example: false,
    description:
      'True exactly when outOfToleranceCount is greater than zero. Available even while outcome is null.',
  })
  hasOutOfTolerance!: boolean;

  @ApiProperty({ type: () => RunStepStatisticsDto })
  statistics!: RunStepStatisticsDto;

  @ApiProperty({
    type: [RunMeasurementDto],
    description: 'Recorded samples ordered by ascending sampleIndex.',
  })
  measurements!: RunMeasurementDto[];
}

/**
 * Full immutable run snapshot. Rule fields are copied at start and are never
 * recomputed from the live plan, including after the run is terminal.
 */
export class RunSnapshotDto {
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

  @ApiProperty({ type: String, example: 'sim-v1' })
  simulatorVersion!: string;

  @ApiProperty({ type: String, example: 'decimal-v1' })
  evaluationVersion!: string;

  @ApiProperty({ enum: RunStatus, example: RunStatus.RUNNING })
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

  @ApiProperty({ type: () => RunRequestedByDto })
  requestedBy!: RunRequestedByDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    description: 'Safe technical reason code for an ERROR or cancellation.',
  })
  reasonCode!: string | null;

  @ApiProperty({ type: Number, minimum: 1, maximum: 10_000, example: 6 })
  expectedSampleCount!: number;

  @ApiProperty({ type: Number, minimum: 0, maximum: 10_000, example: 6 })
  recordedSampleCount!: number;

  @ApiProperty({
    type: Number,
    minimum: 0,
    example: 14,
    description:
      'Sequence of the last committed run event covered by this snapshot. Use it as the initial SSE cursor.',
  })
  lastEventSequence!: number;

  @ApiProperty({
    type: [RunSnapshotStepDto],
    description: 'Steps ordered by ascending position.',
  })
  steps!: RunSnapshotStepDto[];
}

/** Compact summary of the single RUNNING run, or JSON null when idle. */
export class RunActiveDto {
  @ApiProperty({ type: String, format: 'uuid' })
  runId!: string;

  @ApiProperty({ type: String, example: 'Power rail verification' })
  planName!: string;

  @ApiProperty({ type: Number, minimum: 1, example: 1 })
  versionNumber!: number;

  @ApiProperty({ enum: RunStatus, example: RunStatus.RUNNING })
  status!: RunStatus;

  @ApiProperty({ type: Number, minimum: 1, maximum: 10_000, example: 6 })
  expectedSampleCount!: number;

  @ApiProperty({ type: Number, minimum: 0, maximum: 10_000, example: 3 })
  recordedSampleCount!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ enum: RunScenario, example: RunScenario.NORMAL })
  scenario!: RunScenario;
}
