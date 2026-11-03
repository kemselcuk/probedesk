import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProbeMeasurementDto {
  @IsNumber(
    { allowInfinity: false, allowNaN: false },
    { message: 'value must be a finite number' },
  )
  @Min(0, { message: 'value must be greater than or equal to 0' })
  value!: number;
}

export class ProbeStepDto {
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  name!: string;

  @ValidateNested()
  @Type(() => ProbeMeasurementDto)
  measurement!: ProbeMeasurementDto;
}

export class ValidationProbeDto {
  @IsString({ message: 'name must be a string' })
  @IsNotEmpty({ message: 'name must not be empty' })
  name!: string;

  @IsInt({ message: 'sampleCount must be an integer' })
  @Min(1, { message: 'sampleCount must be at least 1' })
  sampleCount!: number;

  @IsArray({ message: 'steps must be an array' })
  @ValidateNested({ each: true })
  @Type(() => ProbeStepDto)
  steps!: ProbeStepDto[];
}
