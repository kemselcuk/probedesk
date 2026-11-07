import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DECIMAL_PATTERN } from '../../plans/plan-decimal.js';
import { RunScenario } from '../../prisma/generated/client.js';
import {
  BATCH_NUMBER_MAX_LENGTH,
  BATCH_NUMBER_PATTERN,
} from '../run-metadata.js';

const DECIMAL_MESSAGE =
  'must be a decimal string with at most 6 fractional digits';
const BATCH_MESSAGE =
  'batchNumber must contain only ASCII letters, digits and ._:/- after trimming';

/**
 * Body of POST /runs. The status, outcome, snapshot, counters and timestamps are
 * always derived by the server; unknown fields are rejected by the global
 * ValidationPipe.
 */
export class StartRunDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Published plan revision id.',
  })
  @IsUUID(undefined, { message: 'planVersionId must be a UUID' })
  planVersionId!: string;

  @ApiProperty({
    enum: RunScenario,
    description: 'Deterministic simulator scenario.',
    example: RunScenario.NORMAL,
  })
  @IsEnum(RunScenario, {
    message: `scenario must be one of ${Object.values(RunScenario).join(', ')}`,
  })
  scenario!: RunScenario;

  @ApiProperty({
    type: Number,
    minimum: 0,
    maximum: 4_294_967_295,
    description: 'Unsigned 32-bit simulator seed.',
    example: 123456789,
  })
  @IsInt({ message: 'seed must be an integer' })
  @Min(0, { message: 'seed must be at least 0' })
  @Max(4_294_967_295, { message: 'seed must be at most 4294967295' })
  seed!: number;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Required for FORCED_FAILURE only: the logicalStepId of the failing step in this published version.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'failureStepId must be a UUID' })
  failureStepId?: string | null;

  @ApiPropertyOptional({
    type: String,
    description:
      'Required for RANDOM only: decimal failure probability between 0 and 1 with at most 6 fractional digits.',
    example: '0.050000',
  })
  @IsOptional()
  @IsString({ message: `errorProbability ${DECIMAL_MESSAGE}` })
  @Matches(DECIMAL_PATTERN, { message: `errorProbability ${DECIMAL_MESSAGE}` })
  errorProbability?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Optional active device of the same profile. Its name and serial number are copied into the run snapshot.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'deviceId must be a UUID' })
  deviceId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: 1,
    maxLength: BATCH_NUMBER_MAX_LENGTH,
    example: 'BATCH-2026-001',
    description:
      'Optional batch number. It is trimmed; empty input is absent. The displayed value keeps its case and filters use its uppercase canonical key.',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  @IsOptional()
  @IsString({ message: 'batchNumber must be a string or null' })
  @MaxLength(BATCH_NUMBER_MAX_LENGTH, {
    message: `batchNumber must contain at most ${BATCH_NUMBER_MAX_LENGTH} characters after trimming`,
  })
  @Matches(BATCH_NUMBER_PATTERN, { message: BATCH_MESSAGE })
  batchNumber?: string | null;
}
