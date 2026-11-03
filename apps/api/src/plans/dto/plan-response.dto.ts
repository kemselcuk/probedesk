import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DeviceProfileDto } from '../../device-profiles/dto/device-profile.dto.js';

const DECIMAL_OUTPUT_PATTERN = '^-?\\d+\\.\\d{6}$';

/** One step of a draft or published revision. */
export class PlanStepDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    description:
      'Permanent logical identity shared by every revision of this plan.',
  })
  logicalStepId!: string;

  @ApiProperty({
    type: Number,
    minimum: 1,
    description: 'Server-assigned 1-based order inside the revision.',
  })
  position!: number;

  @ApiProperty({ type: String, example: 'Output voltage' })
  name!: string;

  @ApiProperty({ type: String, example: 'V' })
  unit!: string;

  @ApiProperty({
    type: String,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '4.750000',
  })
  minimum!: string;

  @ApiProperty({
    type: String,
    pattern: DECIMAL_OUTPUT_PATTERN,
    example: '5.250000',
  })
  maximum!: string;

  @ApiProperty({ type: Number, minimum: 1, maximum: 1000, example: 100 })
  sampleCount!: number;

  @ApiProperty({ type: Number, minimum: 100, maximum: 5000, example: 250 })
  intervalMs!: number;
}

export class DraftSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: Number, minimum: 1, example: 3 })
  editRevision!: number;
}

/** Summary of the highest published version; safe for every role. */
export class PublishedVersionSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: Number, minimum: 1, example: 1 })
  versionNumber!: number;

  @ApiProperty({ type: String, format: 'date-time' })
  publishedAt!: string;
}

/** Public publisher fields; never includes password hashes or session data. */
export class PublishedBySummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'email', example: 'planner@example.com' })
  email!: string;

  @ApiProperty({
    type: String,
    enum: ['PLANNER', 'OPERATOR', 'VIEWER'],
    example: 'PLANNER',
  })
  role!: 'PLANNER' | 'OPERATOR' | 'VIEWER';
}

/** One row of GET /plans/:id/versions, newest published version first. */
export class PublishedVersionListItemDto extends PublishedVersionSummaryDto {
  @ApiProperty({ type: String, example: 'Power rail verification' })
  name!: string;

  @ApiProperty({ type: () => PublishedBySummaryDto })
  publishedBy!: PublishedBySummaryDto;
}

/** Open draft returned to a Planner. Other roles never receive this object. */
export class DraftRevisionDto extends DraftSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String, enum: ['DRAFT'], example: 'DRAFT' })
  state!: 'DRAFT';

  @ApiProperty({ type: String, example: 'Power rail verification' })
  name!: string;

  @ApiProperty({ type: Number, nullable: true, example: null })
  versionNumber!: number | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Published revision this draft was copied from, if any.',
  })
  baseVersionId!: string | null;

  @ApiProperty({ type: [PlanStepDto] })
  steps!: PlanStepDto[];
}

/** Latest published revision, readable by every authenticated role. */
export class PublishedRevisionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  planId!: string;

  @ApiProperty({ type: String, enum: ['PUBLISHED'], example: 'PUBLISHED' })
  state!: 'PUBLISHED';

  @ApiProperty({ type: String, example: 'Power rail verification' })
  name!: string;

  @ApiProperty({ type: Number, minimum: 1, example: 1 })
  versionNumber!: number;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
  })
  baseVersionId!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  publishedAt!: string;

  @ApiProperty({ type: [PlanStepDto] })
  steps!: PlanStepDto[];
}

export class PlanListItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    description:
      'Draft name for a Planner; latest published name for Operator and Viewer.',
  })
  name!: string;

  @ApiProperty({ type: () => DeviceProfileDto })
  profile!: DeviceProfileDto;

  @ApiProperty({
    type: () => PublishedVersionSummaryDto,
    nullable: true,
    description: 'Highest published version summary, or null before publish.',
  })
  latestPublishedVersion!: PublishedVersionSummaryDto | null;

  @ApiPropertyOptional({
    type: () => DraftSummaryDto,
    nullable: true,
    description:
      'Present only in a Planner response. Operator and Viewer responses omit the key.',
  })
  draft?: DraftSummaryDto | null;
}

export class PlanDetailDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({
    type: String,
    description:
      'Draft name for a Planner when a draft exists; latest published name otherwise.',
  })
  name!: string;

  @ApiProperty({ type: () => DeviceProfileDto })
  profile!: DeviceProfileDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({
    type: () => PublishedVersionSummaryDto,
    nullable: true,
  })
  latestPublishedVersion!: PublishedVersionSummaryDto | null;

  @ApiPropertyOptional({
    type: () => DraftRevisionDto,
    nullable: true,
    description:
      'Open draft with steps. Present only in a Planner response.',
  })
  draft?: DraftRevisionDto | null;

  @ApiProperty({
    type: () => PublishedRevisionDto,
    nullable: true,
    description: 'Latest published revision with steps, if one exists.',
  })
  published!: PublishedRevisionDto | null;
}
