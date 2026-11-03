import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import { Role } from '../prisma/generated/client.js';
import { CreatePlanDto } from './dto/create-plan.dto.js';
import {
  DraftRevisionDto,
  PlanDetailDto,
  PlanListItemDto,
  PublishedRevisionDto,
  PublishedVersionListItemDto,
} from './dto/plan-response.dto.js';
import { PublishDraftDto } from './dto/publish-draft.dto.js';
import { SaveDraftDto } from './dto/save-draft.dto.js';
import { PlansService } from './plans.service.js';

@ApiTags('plans')
@ApiExtraModels(ApiErrorDto)
@Controller('plans')
@UseGuards(SessionAuthGuard, RolesGuard)
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary: 'Create a plan with an empty draft revision.',
  })
  @ApiCreatedResponse({
    description:
      'The plan identity, its profile and the new empty draft revision.',
    type: PlanDetailDto,
  })
  @ApiBody({ type: CreatePlanDto })
  @ApiBadRequestResponse({
    description:
      'The name or profileId is invalid, or the body contains unknown fields.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() body: CreatePlanDto,
  ): Promise<PlanDetailDto> {
    return this.plansService.create(auth.user.id, body);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'List plans using the role-appropriate revision names.',
  })
  @ApiOkResponse({
    description:
      'Planner responses include the open draft summary. Operator and Viewer responses contain only plans with a published revision and never include a draft key.',
    type: [PlanListItemDto],
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  list(@CurrentAuth() auth: AuthContext): Promise<PlanListItemDto[]> {
    return this.plansService.list(auth.user.role);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Read one plan with role-appropriate revision content.',
  })
  @ApiOkResponse({
    description:
      'Planner responses include the open draft with steps. Operator and Viewer responses include only the latest published revision; a plan without published content is a 404 for them.',
    type: PlanDetailDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The plan does not exist or is not readable by this role.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Plan id.',
  })
  getById(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PlanDetailDto> {
    return this.plansService.getById(auth.user.role, id);
  }

  @Put(':id/draft')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary: 'Replace the open draft atomically using optimistic concurrency.',
  })
  @ApiOkResponse({
    description:
      'The saved draft, including the identities created for new steps.',
    type: DraftRevisionDto,
  })
  @ApiBadRequestResponse({
    description:
      'A field, limit or logicalStepId is invalid. The request may have unknown fields.',
    type: ApiErrorDto,
  })
  @ApiBody({ type: SaveDraftDto })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The plan does not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'expectedRevision is stale or the plan has no open draft. No rows were changed.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Plan id.',
  })
  saveDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: SaveDraftDto,
  ): Promise<DraftRevisionDto> {
    return this.plansService.saveDraft(id, body);
  }

  @Post(':id/draft/publish')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary: 'Publish the open draft atomically as the next version.',
  })
  @ApiCreatedResponse({
    description:
      'The published revision with its version number, publisher and ordered steps.',
    type: PublishedRevisionDto,
  })
  @ApiBody({ type: PublishDraftDto })
  @ApiBadRequestResponse({
    description:
      'expectedRevision is missing or invalid, or the stored draft content is not publishable. Nothing was published.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The plan does not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'expectedRevision is stale, the plan has no open draft, or the draft changed during the transition. Nothing was published.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Plan id.',
  })
  publishDraft(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: PublishDraftDto,
  ): Promise<PublishedRevisionDto> {
    return this.plansService.publishDraft(auth.user.id, id, body);
  }

  @Post(':id/drafts')
  @HttpCode(HttpStatus.CREATED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.PLANNER)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary: 'Create a new draft copied from the latest published version.',
  })
  @ApiCreatedResponse({
    description:
      'The new draft with editRevision 1, baseVersionId and copied steps that keep their logicalStepId values.',
    type: DraftRevisionDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not a Planner or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The plan does not exist.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'An open draft already exists or the plan has no published version. No draft was created.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Plan id.',
  })
  createDraft(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DraftRevisionDto> {
    return this.plansService.createDraft(id);
  }

  @Get(':id/versions')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'List published versions for a plan, newest first.',
  })
  @ApiOkResponse({
    description:
      'Published version summaries including the publisher. A plan without published content is a 404 for Operator and Viewer.',
    type: [PublishedVersionListItemDto],
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The plan does not exist or has no published version for this role.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Plan id.',
  })
  listVersions(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PublishedVersionListItemDto[]> {
    return this.plansService.listVersions(auth.user.role, id);
  }
}
