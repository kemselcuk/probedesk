import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * Both ids are required. ValidationPipe rejects missing, duplicated and
 * malformed values with the shared `400 VALIDATION_ERROR` body.
 */
export class ComparisonQueryDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Left (base) run id.',
  })
  @IsUUID(undefined, { message: 'leftRunId must be a UUID' })
  leftRunId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Right (comparison) run id.',
  })
  @IsUUID(undefined, { message: 'rightRunId must be a UUID' })
  rightRunId!: string;
}
