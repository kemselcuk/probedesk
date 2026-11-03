import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiFieldErrorDto {
  @ApiProperty({
    type: String,
    description: 'Dotted field path, array indexes included.',
    example: 'steps.1.maximum',
  })
  path!: string;

  @ApiProperty({ type: String, example: 'INVALID_VALUE' })
  code!: string;

  @ApiProperty({
    type: String,
    example: 'maximum must be greater than or equal to minimum',
  })
  message!: string;
}

export class ApiErrorDto {
  @ApiProperty({ type: String, example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({
    type: String,
    example: 'The request contains invalid fields.',
  })
  message!: string;

  @ApiProperty({
    type: String,
    description: 'Correlation id also returned in the X-Request-Id header.',
    example: '5e4d1f0a-cf62-4d2f-9a36-7f3d32f9a0aa',
  })
  requestId!: string;

  @ApiPropertyOptional({
    type: () => [ApiFieldErrorDto],
    description: 'Present when field-level validation failed.',
  })
  fieldErrors?: ApiFieldErrorDto[];

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    description: 'Safe, non-sensitive context for the error.',
  })
  details?: Record<string, unknown>;
}
