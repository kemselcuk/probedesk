import {
  Body,
  Controller,
  Get,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAuth } from '../auth/current-auth.decorator.js';
import { CsrfGuard } from '../auth/csrf.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ApiErrorDto } from '../common/openapi/api-error.dto.js';
import {
  Role,
  RunOutcome,
  RunScenario,
  RunStatus,
} from '../prisma/generated/client.js';
import { StartRunDto } from './dto/start-run.dto.js';
import { RunStartResponseDto } from './dto/run-start-response.dto.js';
import { RunActiveDto, RunSnapshotDto } from './dto/run-snapshot.dto.js';
import {
  DEFAULT_RUN_HISTORY_LIMIT,
  DEFAULT_RUN_HISTORY_PAGE,
  ListRunsQueryDto,
  MAX_RUN_HISTORY_LIMIT,
} from './dto/list-runs-query.dto.js';
import { RunHistoryPageDto } from './dto/run-history.dto.js';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from './run-start.js';
import { RunCancellationService } from './run-cancel.service.js';
import { RunHistoryService } from './run-history.service.js';
import { RunSnapshotService } from './run-snapshot.service.js';
import { RunsService } from './runs.service.js';

@ApiTags('runs')
@ApiExtraModels(ApiErrorDto, RunActiveDto)
@Controller('runs')
@UseGuards(SessionAuthGuard, RolesGuard)
export class RunsController {
  constructor(
    private readonly runsService: RunsService,
    private readonly runSnapshotService: RunSnapshotService,
    private readonly runCancellationService: RunCancellationService,
    private readonly runHistoryService: RunHistoryService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.OPERATOR)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary:
      'Start a published plan version as the single active run, or replay an idempotent retry.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Client-generated key scoped to the current user. Retrying the same request with this key returns the existing run.',
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
    },
    example: '6b6f0a1e-2b64-4e9d-9b8d-0fbe7e75a0c4',
  })
  @ApiAcceptedResponse({
    description:
      'A new RUNNING run was created with its snapshot, steps and first run.started event. The returned URLs can be opened independently of this request.',
    type: RunStartResponseDto,
  })
  @ApiOkResponse({
    description:
      'An earlier run for the same user and Idempotency-Key was replayed. Its current status may already be terminal.',
    type: RunStartResponseDto,
  })
  @ApiBadRequestResponse({
    description:
      'The Idempotency-Key header or a body field is missing, unknown or outside the scenario contract.',
    type: ApiErrorDto,
  })
  @ApiBody({ type: StartRunDto })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not an Operator or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiConflictResponse({
    description:
      'RUN_ALREADY_ACTIVE for another active run (details.activeRunId), or IDEMPOTENCY_CONFLICT when the key was used with a different request.',
    type: ApiErrorDto,
  })
  async start(
    @CurrentAuth() auth: AuthContext,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: StartRunDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RunStartResponseDto> {
    const result = await this.runsService.start(
      auth.user.id,
      idempotencyKey,
      body,
    );

    response.status(result.replayed ? HttpStatus.OK : HttpStatus.ACCEPTED);
    return result.response;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'List run history with filters and stable pagination.',
  })
  @ApiQuery({
    name: 'planId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description: 'Only runs of this plan.',
  })
  @ApiQuery({
    name: 'planVersionId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description:
      'Only runs of this published version. When planId is also supplied it must belong to that plan.',
  })
  @ApiQuery({
    name: 'deviceId',
    required: false,
    schema: { type: 'string', format: 'uuid' },
    description:
      'Only runs started with this device. Unknown ids return an empty page.',
  })
  @ApiQuery({
    name: 'batchNumber',
    required: false,
    schema: { type: 'string', maxLength: 100, example: 'BATCH-2026-001' },
    description:
      'Only runs with this batch. Matches the uppercase canonical key; display case and surrounding whitespace do not matter.',
  })
  @ApiQuery({
    name: 'scenario',
    required: false,
    schema: {
      type: 'string',
      enum: Object.values(RunScenario),
      example: RunScenario.NORMAL,
    },
    description: 'Only runs using this simulator scenario.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    schema: {
      type: 'string',
      enum: Object.values(RunStatus),
      example: RunStatus.COMPLETED,
    },
    description: 'Only runs in this lifecycle state.',
  })
  @ApiQuery({
    name: 'outcome',
    required: false,
    schema: {
      type: 'string',
      enum: Object.values(RunOutcome),
      example: RunOutcome.PASSED,
    },
    description: 'Only runs with this final verdict.',
  })
  @ApiQuery({
    name: 'from',
    required: false,
    schema: { type: 'string', example: '2026-11-03T00:00:00.000Z' },
    description:
      'Inclusive lower bound for startedAt. UTC ISO-8601 date or date-time with an explicit timezone.',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    schema: { type: 'string', example: '2026-11-04T00:00:00.000Z' },
    description:
      'Exclusive upper bound for startedAt. The range is [from, to). UTC ISO-8601 date or date-time with an explicit timezone.',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      default: DEFAULT_RUN_HISTORY_PAGE,
      example: DEFAULT_RUN_HISTORY_PAGE,
    },
    description: '1-based page number.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_RUN_HISTORY_LIMIT,
      default: DEFAULT_RUN_HISTORY_LIMIT,
      example: DEFAULT_RUN_HISTORY_LIMIT,
    },
    description: `Page size. Defaults to ${DEFAULT_RUN_HISTORY_LIMIT} and must not exceed ${MAX_RUN_HISTORY_LIMIT}.`,
  })
  @ApiOkResponse({
    description:
      'A page ordered by startedAt DESC, id DESC. Items contain aggregate sample counters and the earliest failure but never step or measurement arrays. Date filters are UTC and use the half-open [from, to) range.',
    type: RunHistoryPageDto,
  })
  @ApiBadRequestResponse({
    description:
      'A filter, page or limit is malformed, limit exceeds 100, or an unknown query parameter was supplied.',
    type: ApiErrorDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  list(@Query() query: ListRunsQueryDto): Promise<RunHistoryPageDto> {
    return this.runHistoryService.list(query);
  }

  /**
   * Static route: it must stay registered before GET /runs/:id so the literal
   * `active` is never parsed as a run id. Returning the body directly is
   * required because Nest serialises a null handler result as an empty body;
   * the contract is an explicit JSON null.
   */
  @Get('active')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary: 'Read the single running run summary, or JSON null when idle.',
  })
  @ApiOkResponse({
    description:
      'The RUNNING run summary. The response body is the JSON literal null when no run is active.',
    schema: {
      nullable: true,
      allOf: [{ $ref: getSchemaPath(RunActiveDto) }],
    },
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  async getActive(@Res() response: Response): Promise<void> {
    const active = await this.runSnapshotService.findActive();
    response.status(HttpStatus.OK).json(active);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @Roles(Role.PLANNER, Role.OPERATOR, Role.VIEWER)
  @ApiSecurity('session')
  @ApiOperation({
    summary:
      'Read the immutable run snapshot with its measurements and event cursor.',
  })
  @ApiOkResponse({
    description:
      'Run, copied step rules, measurements and lastEventSequence read from one consistent repeatable-read transaction. A RUNNING run is readable; terminal rule values are never re-evaluated from the live plan.',
    type: RunSnapshotDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The run does not exist.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Run id.',
  })
  async getById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RunSnapshotDto> {
    const snapshot = await this.runSnapshotService.findById(id);
    if (!snapshot) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'The requested resource was not found.',
      );
    }

    return snapshot;
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(CsrfGuard)
  @Roles(Role.OPERATOR)
  @ApiSecurity({ session: [], csrfToken: [] })
  @ApiOperation({
    summary:
      'Cancel the running run, or return the existing terminal snapshot unchanged.',
  })
  @ApiOkResponse({
    description:
      'The run is CANCELLED, or it was already terminal and its existing state is returned unchanged. Already committed measurements and completed steps are preserved; steps that never started are NOT_RUN. Repeating the request is safe.',
    type: RunSnapshotDto,
  })
  @ApiUnauthorizedResponse({
    description: 'The session is missing, expired or revoked.',
    type: ApiErrorDto,
  })
  @ApiForbiddenResponse({
    description: 'The user is not an Operator or the CSRF token is invalid.',
    type: ApiErrorDto,
  })
  @ApiNotFoundResponse({
    description: 'The run does not exist.',
    type: ApiErrorDto,
  })
  @ApiParam({
    name: 'id',
    type: String,
    format: 'uuid',
    description: 'Run id.',
  })
  async cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RunSnapshotDto> {
    const snapshot = await this.runCancellationService.cancel(id, auth.user.id);
    if (!snapshot) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'The requested resource was not found.',
      );
    }

    return snapshot;
  }
}
