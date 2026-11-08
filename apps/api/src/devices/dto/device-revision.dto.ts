import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** Body of POST /devices/:id/archive and POST /devices/:id/restore. */
export class DeviceRevisionDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    description:
      'Current editRevision. A stale value is always rejected with DEVICE_CONFLICT.',
  })
  @IsInt({ message: 'expectedRevision must be an integer' })
  @Min(1, { message: 'expectedRevision must be at least 1' })
  expectedRevision!: number;
}
