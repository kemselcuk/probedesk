import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '../runs/run-start.js';
import { CopyPlanDto } from './dto/copy-plan.dto.js';
import { CopyPlanResponseDto } from './dto/copy-plan-response.dto.js';
import { PublishedRevisionDto } from './dto/plan-response.dto.js';
import { PlanCopyService } from './plan-copy.service.js';
import { PlansService } from './plans.service.js';

@ApiTags('plan-versions')
@ApiExtraModels(ApiErrorDto)
@Controller('plan-versions')
@UseGuards(SessionAuthGuard, RolesGuard)
export class PlanVersionsController {
  constructor(
    private readonly plansService: PlansService,
    private readonly planCopyService: PlanCopyService,
  ) {}

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

  @Post(':id/copy')
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary:
      'Copy a published plan version into a new independent plan, or replay an idempotent retry.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Client-generated key scoped to the current user. Retrying the same request with this key returns the original target plan.',
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
    },
    example: '6b6f0a1e-2b64-4e9d-9b8d-0fbe7e75a0c4',
  })
  @ApiCreatedResponse({
    description:
      'A new independent plan and its initial DRAFT revision with freshly generated step identities.',
    type: CopyPlanResponseDto,
  })
  @ApiOkResponse({
    description:
      'An earlier copy for the same user and Idempotency-Key was replayed. The original target plan and initial revision ids are returned even after that revision was published.',
    type: CopyPlanResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The Idempotency-Key header, name or body is missing, unknown or invalid.',
    type: ApiErrorDto,
  })
  @ApiBody({ type: CopyPlanDto })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description:
      'The source version does not exist or is not published. Drafts are never copied.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'IDEMPOTENCY_CONFLICT when the key was already used for a different source version or name.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Published source plan revision id.',
  })
  async copy(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CopyPlanDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CopyPlanResponseDto> {
    const result = await this.planCopyService.copy(
      auth.user.id,
      id,
      idempotencyKey,
      body,
    );

    response.status(result.replayed ? HttpStatus.OK : HttpStatus.CREATED);
    return result.response;
  }
}
