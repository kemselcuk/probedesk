import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const DEVICE_STATE_FILTERS = ['active', 'archived', 'all'] as const;
export type DeviceStateFilter = (typeof DEVICE_STATE_FILTERS)[number];

export const DEFAULT_DEVICE_PAGE = 1;
export const DEFAULT_DEVICE_LIMIT = 20;
export const MAX_DEVICE_LIMIT = 100;
export const MAX_DEVICE_SEARCH_LENGTH = 100;

/** Filters and pagination for GET /devices. */
export class ListDevicesQueryDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: MAX_DEVICE_SEARCH_LENGTH,
    description:
      'Case-insensitive prefix search over name and serial number. SQL wildcards are treated literally.',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  })
  @IsOptional()
  @IsString({ message: 'q must be a string' })
  @MaxLength(MAX_DEVICE_SEARCH_LENGTH, {
    message: `q must contain at most ${MAX_DEVICE_SEARCH_LENGTH} characters`,
  })
  q?: string;

  @ApiPropertyOptional({
    enum: DEVICE_STATE_FILTERS,
    default: 'active',
    description: 'Active devices only, archived devices only, or every device.',
  })
  @IsOptional()
  @IsIn(DEVICE_STATE_FILTERS, {
    message: `state must be one of ${DEVICE_STATE_FILTERS.join(', ')}`,
  })
  state: DeviceStateFilter = 'active';

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description:
      'Only devices of this profile. Unknown ids return an empty page.',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'deviceProfileId must be a UUID' })
  deviceProfileId?: string;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    default: DEFAULT_DEVICE_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page: number = DEFAULT_DEVICE_PAGE;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: MAX_DEVICE_LIMIT,
    default: DEFAULT_DEVICE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(MAX_DEVICE_LIMIT, {
    message: `limit must not exceed ${MAX_DEVICE_LIMIT}`,
  })
  limit: number = DEFAULT_DEVICE_LIMIT;
}
