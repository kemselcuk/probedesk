import {
  Controller,
  Get,
  Header,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import { ComparisonQueryDto } from './dto/comparison-query.dto.js';
import { RunComparisonDto } from './dto/comparison.dto.js';
import { ComparisonsService } from './comparisons.service.js';

@ApiTags('comparisons')
@ApiExtraModels(ApiErrorDto)
@Controller('comparisons')
@UseGuards(SessionAuthGuard, RolesGuard)
export class ComparisonsController {
  constructor(private readonly comparisonsService: ComparisonsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Compare two terminal runs of the same plan.',
  })
  @ApiQuery({
    name: 'leftRunId',
    required: true,
    schema: { type: 'string', format: 'uuid' },
    description: 'Left (base) run id.',
  })
  @ApiQuery({
    name: 'rightRunId',
    required: true,
    schema: { type: 'string', format: 'uuid' },
    description: 'Right (comparison) run id.',
  })
  @ApiOkResponse({
    description:
      'Both immutable run summaries, the version difference, logicalStepId matches with changed rule fields, and one-sided added/removed steps. Matching never uses names or order; each run keeps its own limits, verdict and measurement series. Numeric deltas exist only when a matched step has the same unit.',
    type: RunComparisonDto,
  })
  @ApiBadRequestResponse({
    description:
      'A run id is missing, malformed, duplicated or supplied with an unknown query parameter; both ids are also required to differ.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'One or both run ids do not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'RUN_NOT_TERMINAL when either run is still RUNNING. Terminal statuses COMPLETED, CANCELLED, INTERRUPTED and ERROR are accepted.',
    type: ApiErrorDto,
  })
  @ApiUnprocessableEntityResponse({
    description:
      'COMPARISON_PLAN_MISMATCH when the runs belong to different plans. Different versions of one plan are accepted.',
    type: ApiErrorDto,
  })
  compare(@Query() query: ComparisonQueryDto): Promise<RunComparisonDto> {
    return this.comparisonsService.compare(query);
  }
}
