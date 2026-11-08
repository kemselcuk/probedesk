import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { RunScenario } from '../../prisma/generated/client.js';
import {
  BATCH_NUMBER_MAX_LENGTH,
  BATCH_NUMBER_PATTERN,
} from '../../runs/run-metadata.js';

/**
 * An explicit-timezone ISO-8601 date-time. A date-only value or a time without
 * `Z`/offset is rejected because the dashboard contract requires an actual UTC
 * instant at both range boundaries.
 */
const UTC_ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Required range and optional filters for GET /api/analytics/overview. */
export class AnalyticsOverviewQueryDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-01T00:00:00.000Z',
    description:
      'Inclusive UTC lower bound for run.startedAt. Must include an explicit timezone.',
  })
  @IsDefined({ message: 'from is required' })
  @IsString({ message: 'from must be a string' })
  @Matches(UTC_ISO_DATE_TIME, {
    message: 'from must be an ISO-8601 date-time with an explicit timezone',
  })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'from must be a valid ISO-8601 date-time' },
  )
  from!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-31T00:00:00.000Z',
    description:
      'Exclusive UTC upper bound for run.startedAt. The range is [from, to) and may span at most 366 days.',
  })
  @IsDefined({ message: 'to is required' })
  @IsString({ message: 'to must be a string' })
  @Matches(UTC_ISO_DATE_TIME, {
    message: 'to must be an ISO-8601 date-time with an explicit timezone',
  })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'to must be a valid ISO-8601 date-time' },
  )
  to!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Only runs of this plan. Unknown ids return an empty overview.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'planId must be a UUID' })
  planId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Only runs of this published version. When planId is also present it must belong to that plan; an unknown version returns an empty overview.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'planVersionId must be a UUID' })
  planVersionId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Only runs started with this device. Unknown ids return an empty overview.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'deviceId must be a UUID' })
  deviceId?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: BATCH_NUMBER_MAX_LENGTH,
    example: 'BATCH-2026-001',
    description:
      'Only runs with this batch. The comparison uses the canonical uppercase key, so display case does not matter.',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsOptional()
  @IsString({ message: 'batchNumber must be a string' })
  @MaxLength(BATCH_NUMBER_MAX_LENGTH, {
    message: `batchNumber must contain at most ${BATCH_NUMBER_MAX_LENGTH} characters`,
  })
  @Matches(BATCH_NUMBER_PATTERN, {
    message:
      'batchNumber must contain only ASCII letters, digits and ._:/- after trimming',
  })
  batchNumber?: string;

  @ApiPropertyOptional({
    enum: RunScenario,
    example: RunScenario.NORMAL,
    description: 'Only runs with this simulator scenario.',
  })
  @IsOptional()
  @IsEnum(RunScenario, {
    message: `scenario must be one of ${Object.values(RunScenario).join(', ')}`,
  })
  scenario?: RunScenario;
}
