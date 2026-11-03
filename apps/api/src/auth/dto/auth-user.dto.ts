import { ApiProperty } from '@nestjs/swagger';
import type { Role } from '../../prisma/generated/client.js';

/** Safe user summary returned by login and /auth/me. */
export class AuthUserDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    example: '0f8d4d1e-2d1a-4c58-a8cf-0b5f5c0d3f11',
  })
  id!: string;

  @ApiProperty({
    type: String,
    format: 'email',
    example: 'planner@probedesk.local',
  })
  email!: string;

  @ApiProperty({
    type: String,
    enum: ['PLANNER', 'OPERATOR', 'VIEWER'],
    enumName: 'Role',
    example: 'PLANNER',
  })
  role!: Role;
}
