import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DECIMAL_PATTERN } from '../plan-decimal.js';

const DECIMAL_MESSAGE =
  'must be a decimal string with at most 6 fractional digits';

/** One submitted step. `position` is assigned by the server from array order. */
export class DraftStepDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Existing logical step identity. Omit, send null or send an empty string for a new step; the server creates and returns a new identity.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim().length === 0 ? undefined : value,
  )
  @IsOptional()
  @IsUUID(undefined, { message: 'logicalStepId must be a UUID' })
  logicalStepId?: string | null;

  @ApiProperty({
    type: String,
    minLength: 1,
    maxLength: 100,
    example: 'Output voltage',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'name must be a string' })
  @Length(1, 100, { message: 'name must be 1 to 100 characters after trimming' })
  name!: string;

  @ApiProperty({ type: String, minLength: 1, maxLength: 16, example: 'V' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'unit must be a string' })
  @Length(1, 16, { message: 'unit must be 1 to 16 characters after trimming' })
  unit!: string;

  @ApiProperty({ type: String, example: '4.750000' })
  @IsString({ message: `minimum ${DECIMAL_MESSAGE}` })
  @Matches(DECIMAL_PATTERN, { message: `minimum ${DECIMAL_MESSAGE}` })
  minimum!: string;

  @ApiProperty({ type: String, example: '5.250000' })
  @IsString({ message: `maximum ${DECIMAL_MESSAGE}` })
  @Matches(DECIMAL_PATTERN, { message: `maximum ${DECIMAL_MESSAGE}` })
  maximum!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 1000, example: 100 })
  @IsInt({ message: 'sampleCount must be an integer' })
  @Min(1, { message: 'sampleCount must be at least 1' })
  @Max(1000, { message: 'sampleCount must be at most 1000' })
  sampleCount!: number;

  @ApiProperty({ type: Number, minimum: 100, maximum: 5000, example: 250 })
  @IsInt({ message: 'intervalMs must be an integer' })
  @Min(100, { message: 'intervalMs must be at least 100' })
  @Max(5000, { message: 'intervalMs must be at most 5000' })
  intervalMs!: number;
}

/**
 * Full replacement body of PUT /plans/:id/draft. The array order is
 * authoritative; the server derives positions from it.
 */
export class SaveDraftDto {
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
    type: Number,
    minimum: 1,
    description:
      'Current editRevision from the draft. A mismatch is rejected with DRAFT_CONFLICT and no writes.',
    example: 1,
  })
  @IsInt({ message: 'expectedRevision must be an integer' })
  @Min(1, { message: 'expectedRevision must be at least 1' })
  expectedRevision!: number;

  @ApiProperty({ type: [DraftStepDto], maxItems: 30 })
  @IsArray({ message: 'steps must be an array' })
  @ArrayMaxSize(30, { message: 'steps must contain at most 30 items' })
  @ValidateNested({ each: true })
  @Type(() => DraftStepDto)
  steps!: DraftStepDto[];
}
