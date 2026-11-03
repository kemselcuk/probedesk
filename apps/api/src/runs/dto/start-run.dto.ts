import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { DECIMAL_PATTERN } from '../../plans/plan-decimal.js';
import { RunScenario } from '../../prisma/generated/client.js';

const DECIMAL_MESSAGE =
  'must be a decimal string with at most 6 fractional digits';

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
}
