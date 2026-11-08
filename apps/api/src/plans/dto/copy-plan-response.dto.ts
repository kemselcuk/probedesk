import { ApiProperty } from '@nestjs/swagger';

/** Result of a new copy or of replaying an earlier identical copy request. */
export class CopyPlanResponseDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'New independent plan created by the copy.',
  })
  planId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description:
      'Initial draft revision created with the copy. The id stays stable after the draft is saved or published.',
  })
  draftRevisionId!: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Published source revision named in the request path.',
  })
  sourceVersionId!: string;

  @ApiProperty({
    type: Boolean,
    description:
      'True when an earlier request for the same user, Idempotency-Key and canonical request is replayed.',
  })
  replayed!: boolean;
}
