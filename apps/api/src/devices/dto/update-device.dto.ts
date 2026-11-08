import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const SERIAL_MESSAGE =
  'serialNumber must contain only ASCII letters, digits and ._:/- after trimming';

/**
 * Body of PATCH /devices/:id. The profile is fixed and the DTO deliberately
 * has no profile field, so the global whitelist rejects an attempted change.
 */
export class UpdateDeviceDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    description:
      'Current editRevision. A mismatch is rejected with DEVICE_CONFLICT and no writes.',
  })
  @IsInt({ message: 'expectedRevision must be an integer' })
  @Min(1, { message: 'expectedRevision must be at least 1' })
  expectedRevision!: number;

  @ApiPropertyOptional({ type: String, minLength: 1, maxLength: 100 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'name must be a string' })
  @Length(1, 100, {
    message: 'name must be 1 to 100 characters after trimming',
  })
  name?: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    maxLength: 100,
    example: 'PSU-DEMO-0001',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'serialNumber must be a string' })
  @Length(1, 100, {
    message: 'serialNumber must be 1 to 100 characters after trimming',
  })
  @Matches(/^[A-Za-z0-9._:/-]+$/, { message: SERIAL_MESSAGE })
  serialNumber?: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description:
      'New description. It is trimmed; null, empty or whitespace-only input clears it.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  @IsString({ message: 'description must be a string or null' })
  @MaxLength(500, {
    message: 'description must contain at most 500 characters after trimming',
  })
  description?: string | null;
}
