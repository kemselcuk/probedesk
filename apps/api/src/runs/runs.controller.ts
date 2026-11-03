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
import { Role } from '../prisma/generated/client.js';
import { StartRunDto } from './dto/start-run.dto.js';
import { RunStartResponseDto } from './dto/run-start-response.dto.js';
import { RunActiveDto, RunSnapshotDto } from './dto/run-snapshot.dto.js';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from './run-start.js';
import { RunCancellationService } from './run-cancel.service.js';
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
