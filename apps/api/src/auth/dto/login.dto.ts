import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * JSON login body. Email is normalised before lookup; the password is never
 * trimmed or echoed. Unknown fields are rejected by the global validation pipe.
 */
export class LoginDto {
  @ApiProperty({
    type: String,
    format: 'email',
    maxLength: 254,
    example: 'planner@probedesk.local',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254, { message: 'email must be at most 254 characters' })
  email!: string;

  @ApiProperty({
    type: String,
    format: 'password',
    minLength: 1,
    maxLength: 256,
    example: '********',
  })
  @IsString({ message: 'password must be a string' })
  @IsNotEmpty({ message: 'password must not be empty' })
  @MaxLength(256, { message: 'password must be at most 256 characters' })
  password!: string;
}
