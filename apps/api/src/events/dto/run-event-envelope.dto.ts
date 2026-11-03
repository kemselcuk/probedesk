import { ApiProperty } from '@nestjs/swagger';
import { RUN_EVENT_SCHEMA_VERSION } from '../../runs/run-domain.js';

/**
 * Data envelope carried by the `data:` field of every SSE frame.
 *
 * The SSE `id:` field mirrors `sequence`; the `event:` field carries one of the
 * documented run event wire names. Payloads contain only run/step measurement
 * data: never passwords, sessions, draft content, idempotency keys or request
 * hashes.
 */
export class RunEventEnvelopeDto {
  @ApiProperty({
    type: 'integer',
    enum: [RUN_EVENT_SCHEMA_VERSION],
    example: RUN_EVENT_SCHEMA_VERSION,
    description: 'Envelope schema version. Currently always 1.',
  })
  schemaVersion!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Run this event belongs to.',
  })
  runId!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    example: 7,
    description:
      'Run-local event sequence. It is also the SSE id field and increases without gaps.',
  })
  sequence!: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Commit timestamp copied from the persisted RunEvent row.',
  })
  occurredAt!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Event-specific payload. It never contains session, password, draft or idempotency data.',
  })
  payload!: Record<string, unknown>;
}
