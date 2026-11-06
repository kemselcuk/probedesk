import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const SERIAL_MESSAGE =
  'serialNumber must contain only ASCII letters, digits and ._:/- after trimming';

/** Body of POST /devices. The profile and creator come from the request. */
export class CreateDeviceDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Id returned by GET /api/device-profiles.',
  })
  @IsUUID(undefined, { message: 'deviceProfileId must be a UUID' })
  deviceProfileId!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'name must be a string' })
  @Length(1, 100, {
    message: 'name must be 1 to 100 characters after trimming',
  })
  name!: string;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 100,
    example: 'PSU-DEMO-0001',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'serialNumber must be a string' })
  @Length(1, 100, {
    message: 'serialNumber must be 1 to 100 characters after trimming',
  })
  @Matches(/^[A-Za-z0-9._:/-]+$/, { message: SERIAL_MESSAGE })
  serialNumber!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description:
      'Optional description. It is trimmed; empty or whitespace-only input is stored as null.',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  })
  @IsOptional()
  @IsString({ message: 'description must be a string or null' })
  @MaxLength(500, {
    message: 'description must contain at most 500 characters after trimming',
  })
  description?: string | null;
}
