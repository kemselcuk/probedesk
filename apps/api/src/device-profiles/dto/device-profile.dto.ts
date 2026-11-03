import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Device profile summary used when creating or reading a plan. */
export class DeviceProfileDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    example: 'b7c5e4a8-7e3d-4a3f-9c1f-1f1d2c3b4a59',
  })
  id!: string;

  @ApiProperty({ type: String, example: 'DC_POWER_MODULE' })
  code!: string;

  @ApiProperty({ type: String, example: 'DC Power Module' })
  name!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example:
      'Deterministic simulated DC power module used for local demonstrations.',
  })
  description!: string | null;
}
