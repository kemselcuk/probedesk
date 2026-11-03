import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

/** Body of POST /plans/:id/draft/publish. */
export class PublishDraftDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    description:
      'Current editRevision of the open draft. A mismatch is rejected with DRAFT_CONFLICT and nothing is published.',
    example: 3,
  })
  @IsInt({ message: 'expectedRevision must be an integer' })
  @Min(1, { message: 'expectedRevision must be at least 1' })
  expectedRevision!: number;
}
