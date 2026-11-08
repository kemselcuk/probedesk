import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsOverviewQueryDto } from './dto/analytics-overview-query.dto.js';
import { AnalyticsOverviewDto } from './dto/analytics-overview.dto.js';

@ApiTags('analytics')
@ApiExtraModels(ApiErrorDto)
@Controller('analytics')
@UseGuards(SessionAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary:
      'Read dashboard KPIs, the UTC daily trend and the top failing steps from one consistent snapshot.',
  })
  @ApiQuery({
    name: 'from',
    required: true,
    schema: {
      type: 'string',
      format: 'date-time',
      example: '2026-10-01T00:00:00.000Z',
    },
    description:
      'Inclusive UTC lower bound for run.startedAt. Must include an explicit timezone.',
  })
  @ApiQuery({
    name: 'to',
    required: true,
    schema: {
      type: 'string',
      format: 'date-time',
      example: '2026-10-31T00:00:00.000Z',
    },
    description:
      'Exclusive UTC upper bound for run.startedAt. The range is [from, to) and may span at most 366 days.',
  })
  @ApiQuery({
    name: 'planId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description:
      'Only runs of this plan. Unknown ids return an empty overview.',
  })
  @ApiQuery({
    name: 'planVersionId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description:
      'Only runs of this published version. When planId is also present it must belong to that plan; an unknown version returns an empty overview.',
  })
  @ApiQuery({
    name: 'deviceId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description:
      'Only runs started with this device. Unknown ids return an empty overview.',
  })
  @ApiQuery({
    name: 'batchNumber',
    required: false,
    schema: { type: 'string', maxLength: 100, example: 'BATCH-2026-001' },
    description:
      'Only runs with this batch. The comparison uses the canonical uppercase key, so display case does not matter.',
  })
  @ApiQuery({
    name: 'scenario',
    required: false,
    schema: {
      type: 'string',
      enum: ['NORMAL', 'FORCED_FAILURE', 'RANDOM'],
      example: 'NORMAL',
    },
    description: 'Only runs with this simulator scenario.',
  })
  @ApiOkResponse({
    description:
      'Summary totals, every UTC day intersecting [from, to), and at most ten failing step groups. Decimal KPI values are backend-rounded strings; null means no applicable sample.',
    type: AnalyticsOverviewDto,
  })
  @ApiBadRequestResponse({
    description:
      'from/to is missing or malformed, the range is empty or wider than 366 days, a filter is invalid, or an unknown query parameter was supplied.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  overview(
    @Query() query: AnalyticsOverviewQueryDto,
  ): Promise<AnalyticsOverviewDto> {
    return this.analyticsService.overview(query);
  }
}
