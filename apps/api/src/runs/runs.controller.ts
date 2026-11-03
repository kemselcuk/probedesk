import {
  Body,
  Controller,
  Headers,
  Header,
  HttpCode,
  HttpStatus,
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
  ApiOkResponse,
  ApiOperation,
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
import { StartRunDto } from './dto/start-run.dto.js';
import { RunStartResponseDto } from './dto/run-start-response.dto.js';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from './run-start.js';
import { RunsService } from './runs.service.js';

@ApiTags('runs')
@ApiExtraModels(ApiErrorDto)
@Controller('runs')
@UseGuards(SessionAuthGuard, RolesGuard)
export class RunsController {
  constructor(private readonly runsService: RunsService) {}

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
}
