import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

/** Body of POST /plan-versions/:id/copy. */
export class CopyPlanDto {
  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 100,
    example: 'Power rail verification (copy)',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'name must be a string' })
  @Length(1, 100, {
    message: 'name must be 1 to 100 characters after trimming',
  })
  name!: string;
}
