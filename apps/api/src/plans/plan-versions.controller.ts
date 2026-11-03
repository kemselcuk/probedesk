import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiExtraModels,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import { PublishedRevisionDto } from './dto/plan-response.dto.js';
import { PlansService } from './plans.service.js';

@ApiTags('plan-versions')
@ApiExtraModels(ApiErrorDto)
@Controller('plan-versions')
@UseGuards(SessionAuthGuard, RolesGuard)
export class PlanVersionsController {
  constructor(private readonly plansService: PlansService) {}

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Read one immutable published plan version with ordered steps.',
  })
  @ApiOkResponse({
    description:
      'The published revision and its steps. Draft revisions and unknown ids are reported as 404.',
    type: PublishedRevisionDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The version does not exist or is not published.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Published plan revision id.',
  })
  getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PublishedRevisionDto> {
    return this.plansService.getPublishedVersion(id);
  }
}
