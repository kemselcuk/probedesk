import { ApiProperty } from '@nestjs/swagger';

/**
 * Current device record returned by every device endpoint. The creator,
 * session and canonical serial key are deliberately not exposed.
 */
export class DeviceDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  deviceProfileId!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  name!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  serialNumber!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'Trimmed description, or null when it is empty.',
  })
  description!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Archive time, or null while the device is active.',
  })
  archivedAt!: string | null;

  @ApiProperty({
    type: Number,
    minimum: 1,
    description:
      'Optimistic concurrency revision. Updates, archive and restore require the current value.',
  })
  editRevision!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}

/** One page of devices ordered by name ASC, id ASC. */
export class DeviceListResponseDto {
  @ApiProperty({ type: [DeviceDto] })
  items!: DeviceDto[];

  @ApiProperty({ type: Number, minimum: 1 })
  page!: number;

  @ApiProperty({ type: Number, minimum: 1, maximum: 100 })
  limit!: number;

  @ApiProperty({ type: Number, minimum: 0 })
  total!: number;

  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Number of pages for this filter and limit, zero when empty.',
  })
  totalPages!: number;
}
