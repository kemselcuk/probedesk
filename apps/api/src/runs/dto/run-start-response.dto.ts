import { ApiProperty } from '@nestjs/swagger';
import { RunOutcome, RunStatus } from '../../prisma/generated/client.js';

/**
 * Start acknowledgement. `snapshotUrl` and `eventsUrl` are relative API paths
 * that the client can open immediately; execution does not depend on the start
 * HTTP connection staying open.
 */
export class RunStartResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  runId!: string;

  @ApiProperty({
    enum: RunStatus,
    example: RunStatus.RUNNING,
    description:
      'RUNNING for a newly created run. A replay returns the stored current status, which may already be terminal.',
  })
  status!: RunStatus;

  @ApiProperty({
    enum: RunOutcome,
    nullable: true,
    description:
      'Overall outcome. Null until a COMPLETED run has a verdict; a terminal replay reports the stored value.',
  })
  outcome!: RunOutcome | null;

  @ApiProperty({
    type: String,
    example: '/api/runs/6b1f9c9e-2a7c-4d8d-9f5f-7d2c4a1b3e6f',
  })
  snapshotUrl!: string;

  @ApiProperty({
    type: String,
    example: '/api/runs/6b1f9c9e-2a7c-4d8d-9f5f-7d2c4a1b3e6f/events',
  })
  eventsUrl!: string;
}
