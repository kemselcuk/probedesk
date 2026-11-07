import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  RunOutcome,
  RunScenario,
  RunStatus,
} from '../../prisma/generated/client.js';
import {
  BATCH_NUMBER_MAX_LENGTH,
  BATCH_NUMBER_PATTERN,
} from '../run-metadata.js';

export const DEFAULT_RUN_HISTORY_PAGE = 1;
export const DEFAULT_RUN_HISTORY_LIMIT = 20;
export const MAX_RUN_HISTORY_LIMIT = 100;

/**
 * An ISO date (`2026-11-03`) or a date-time with an explicit timezone
 * (`2026-11-03T12:00:00.000Z`). A timezone-less date-time is rejected instead
 * of being interpreted in the server's local zone.
 */
const UTC_DATE_OR_DATE_TIME =
  /^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))$/;

/** Filters and pagination for GET /runs. */
export class ListRunsQueryDto {
  @ApiPropertyOptional({ type: String, format: 'uuid' })
  @IsOptional()
  @IsUUID(undefined, { message: 'planId must be a UUID' })
  planId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Only runs of this published version. When planId is also present it must belong to that plan.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'planVersionId must be a UUID' })
  planVersionId?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Only runs started with this device. Unknown ids return an empty page.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'deviceId must be a UUID' })
  deviceId?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: BATCH_NUMBER_MAX_LENGTH,
    example: 'BATCH-2026-001',
    description:
      'Only runs with this batch. Matches the uppercase canonical key, so display case does not matter. Unknown values return an empty page.',
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

  @ApiPropertyOptional({ enum: RunScenario, example: RunScenario.NORMAL })
  @IsOptional()
  @IsEnum(RunScenario, {
    message: `scenario must be one of ${Object.values(RunScenario).join(', ')}`,
  })
  scenario?: RunScenario;

  @ApiPropertyOptional({ enum: RunStatus, example: RunStatus.COMPLETED })
  @IsOptional()
  @IsEnum(RunStatus, {
    message: `status must be one of ${Object.values(RunStatus).join(', ')}`,
  })
  status?: RunStatus;

  @ApiPropertyOptional({ enum: RunOutcome, example: RunOutcome.PASSED })
  @IsOptional()
  @IsEnum(RunOutcome, {
    message: `outcome must be one of ${Object.values(RunOutcome).join(', ')}`,
  })
  outcome?: RunOutcome;

  @ApiPropertyOptional({
    type: String,
    example: '2026-11-03T00:00:00.000Z',
    description:
      'Inclusive lower bound for startedAt. UTC ISO-8601 date or date-time.',
  })
  @IsOptional()
  @Matches(UTC_DATE_OR_DATE_TIME, {
    message:
      'from must be an ISO-8601 date or date-time with an explicit timezone',
  })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'from must be a valid ISO-8601 date' },
  )
  from?: string;

  @ApiPropertyOptional({
    type: String,
    example: '2026-11-04T00:00:00.000Z',
    description:
      'Exclusive upper bound for startedAt. The range is [from, to). UTC ISO-8601 date or date-time.',
  })
  @IsOptional()
  @Matches(UTC_DATE_OR_DATE_TIME, {
    message:
      'to must be an ISO-8601 date or date-time with an explicit timezone',
  })
  @IsISO8601(
    { strict: true, strictSeparator: true },
    { message: 'to must be a valid ISO-8601 date' },
  )
  to?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    default: DEFAULT_RUN_HISTORY_PAGE,
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = DEFAULT_RUN_HISTORY_PAGE;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_RUN_HISTORY_LIMIT,
    default: DEFAULT_RUN_HISTORY_LIMIT,
    example: DEFAULT_RUN_HISTORY_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(MAX_RUN_HISTORY_LIMIT, {
    message: `limit must not exceed ${MAX_RUN_HISTORY_LIMIT}`,
  })
  limit: number = DEFAULT_RUN_HISTORY_LIMIT;
}
