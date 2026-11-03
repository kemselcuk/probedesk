import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length } from 'class-validator';

/** Body of POST /plans. The first revision is an empty draft. */
export class CreatePlanDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 100,
    example: 'Power rail verification',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'name must be a string' })
  @Length(1, 100, { message: 'name must be 1 to 100 characters after trimming' })
  name!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Id returned by GET /api/device-profiles.',
    example: 'b7c5e4a8-7e3d-4a3f-9c1f-1f1d2c3b4a59',
  })
  @IsUUID(undefined, { message: 'profileId must be a UUID' })
  profileId!: string;
}
